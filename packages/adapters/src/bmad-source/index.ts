/**
 * `bmad-source` (story 4.14, AD-13): the pinned upstream BMad Method,
 * downloaded only when the user asks, verified in memory, and kept in the
 * data folder.
 *
 * A download is, in order:
 * 1. one `GET` of the codeload tarball of the exact pinned commit, with a
 *    time limit and a size cap (stopped as soon as it grows past it);
 * 2. gunzip with a cap on the unpacked size, the tar read in memory, the
 *    files under the lock's `include` selected (`archive.ts`: anything
 *    unsafe refuses the whole archive), and their content hash compared with
 *    the lock's: nothing has touched the disk yet;
 * 3. exactly those files written into a new `<data>/bmad/.tmp-<name>-…`
 *    folder, the marker `{repo, commit, contentHash}` last, then the folder
 *    renamed into place as `<data>/bmad/<name>/<commit>/` (files under
 *    `<include>`); every other commit's folder is removed.
 *
 * A later reader trusts the marker, not a re-hash: the data folder is the
 * user's own (0700), and anything that can write there can already change
 * the database. Only the exact pinned commit counts, so after an upgrade that
 * moves the pin the status is `missing` until the user downloads again.
 *
 * Nothing here runs on startup or on a read: {@link PinnedSource.status}
 * and {@link PinnedSource.file} look at the data folder only.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BmadDownloadError, type BmadSourcePort } from '@ogden-agents/core';
import type { BmadLockSource, BmadSourceStatus } from '@ogden-agents/shared';
import {
  ArchiveRefusedError,
  BMAD_DOWNLOAD_MAX_BYTES,
  BMAD_UNPACKED_MAX_BYTES,
  extractTo,
  gunzipLimited,
  hashEntries,
  normalizeText,
  parseTar,
  selectVerified,
  tarballUrl,
  type Entries,
} from './archive.js';
import { BMAD_LOCK, type BmadSourceName } from './lock.js';

/** Where every pinned source lives in the data folder. */
export const BMAD_SOURCE_DIR = 'bmad';
/** The marker written last into a verified folder. */
export const VERIFIED_MARKER = '.ogden-verified.json';
/** How long a whole download may take by default. */
export const BMAD_DOWNLOAD_TIMEOUT_MS = 120_000;
export { BMAD_DOWNLOAD_MAX_BYTES, BMAD_UNPACKED_MAX_BYTES } from './archive.js';

/** The `fetch` a source downloads with (tests: a fixture server or a stub). */
export type FetchLike = (url: string, init: { signal: AbortSignal; redirect: 'follow' }) => Promise<Response>;

export interface PinnedSourceOptions {
  /** The server's data folder. */
  dataDir: string;
  /** The source's name in the lock, and its folder below `<data>/bmad/`. */
  name: BmadSourceName;
  /** The pin. Default: the lock's entry for `name`. */
  pin?: BmadLockSource;
  /** Default `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Default {@link BMAD_DOWNLOAD_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Default {@link BMAD_DOWNLOAD_MAX_BYTES}. */
  maxBytes?: number;
  /** Default {@link BMAD_UNPACKED_MAX_BYTES}. */
  maxUnpackedBytes?: number;
  /** Told when a temp or stale folder couldn't be removed (it is tried again on the next download). */
  onCleanupError?: (error: unknown) => void;
}

/** A pinned source: the core port, plus where its verified tree is. */
export interface PinnedSource extends BmadSourcePort {
  /** The pin it downloads. */
  readonly pin: BmadLockSource;
  /** The verified tree's used folder (`<data>/bmad/<name>/<commit>/<include>`), whether or not it is there yet. */
  readonly root: string;
}

interface Marker {
  repo: string;
  commit: string;
  contentHash: string;
}

/** Whether `relPath` is a plain `/`-separated relative path (no `..`, no drive, no backslash). */
function plainRelative(relPath: string): boolean {
  if (relPath === '' || relPath.includes('\\') || relPath.includes('\0') || relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) return false;
  return relPath.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** The tarball's bytes, or a `BmadDownloadError('offline')`: no answer, an HTTP error, the time limit, or past `maxBytes`. */
async function fetchTarball(fetchImpl: FetchLike, url: string, timeoutMs: number, maxBytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    } catch (error) {
      throw new BmadDownloadError('offline', controller.signal.aborted ? 'timed out' : `no answer: ${String(error)}`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new BmadDownloadError('offline', `HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new BmadDownloadError('offline', `the download is ${declared} bytes, over ${maxBytes}`);
    }
    if (response.body === null) throw new BmadDownloadError('offline', 'an empty answer');
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new BmadDownloadError('offline', `the download grew past ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error instanceof BmadDownloadError) throw error;
      throw new BmadDownloadError('offline', controller.signal.aborted ? 'timed out' : `the download broke off: ${String(error)}`);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

/** The regular files below `dir` (symlinks and others skipped), keyed by `/`-separated path, text LF-normalized; `skip` is left out at the top. */
function readTree(dir: string, skip: string, prefix = ''): Entries {
  const entries: Entries = new Map();
  for (const name of readdirSync(dir)) {
    if (prefix === '' && name === skip) continue;
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) for (const [key, data] of readTree(path, skip, `${prefix}${name}/`)) entries.set(key, data);
    else if (stat.isFile()) entries.set(`${prefix}${name}`, normalizeText(readFileSync(path)));
  }
  return entries;
}

export function createPinnedSource(options: PinnedSourceOptions): PinnedSource {
  const pin = options.pin ?? BMAD_LOCK.sources[options.name];
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? BMAD_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? BMAD_DOWNLOAD_MAX_BYTES;
  const maxUnpackedBytes = options.maxUnpackedBytes ?? BMAD_UNPACKED_MAX_BYTES;
  const base = join(options.dataDir, BMAD_SOURCE_DIR);
  const sourceDir = join(base, options.name);
  const folder = join(sourceDir, pin.commit);
  const includeSegments = pin.include.split('/').filter((segment) => segment !== '');
  const root = join(folder, ...includeSegments);
  const tmpPrefix = `.tmp-${options.name}-`;
  let inFlight: Promise<BmadSourceStatus> | undefined;

  const cleanup = (path: string) => {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      try {
        options.onCleanupError?.(error);
      } catch {
        // A listener never changes the outcome.
      }
    }
  };

  /** Whether the marker in the commit's folder names exactly this pin. */
  const ready = (): boolean => {
    try {
      const marker = JSON.parse(readFileSync(join(folder, VERIFIED_MARKER), 'utf8')) as Partial<Marker> | null;
      return marker !== null && marker.repo === pin.repo && marker.commit === pin.commit && marker.contentHash === pin.contentHash;
    } catch {
      return false;
    }
  };

  const status = (): BmadSourceStatus => ({
    state: inFlight !== undefined ? 'downloading' : ready() ? 'ready' : 'missing',
    version: pin.version,
    commit: pin.commit,
  });

  /** Whether the tree on disk still hashes to the pin (a file deleted or changed since the marker was written fails). */
  const intact = (): boolean => {
    try {
      return hashEntries(readTree(root, pin.include === '' ? VERIFIED_MARKER : '')) === pin.contentHash;
    } catch {
      return false;
    }
  };

  const run = async (): Promise<BmadSourceStatus> => {
    const archive = await fetchTarball(fetchImpl, tarballUrl(pin), timeoutMs, maxBytes);
    // Verify before any byte touches the disk.
    let entries: Map<string, Buffer>;
    try {
      entries = selectVerified(parseTar(gunzipLimited(archive, maxUnpackedBytes)), pin.include);
    } catch (error) {
      if (error instanceof ArchiveRefusedError) throw new BmadDownloadError('integrity', error.message);
      throw error;
    }
    const actual = hashEntries(entries);
    if (actual !== pin.contentHash) throw new BmadDownloadError('integrity', `expected ${pin.contentHash}, got ${actual}`);
    // The marker sits at the commit folder's top; a tree that has one of its own would be overwritten by it.
    if (pin.include === '' && entries.has(VERIFIED_MARKER)) throw new BmadDownloadError('integrity', `the tree has a file named ${VERIFIED_MARKER}`);

    mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
    // Temp folders a stopped server left behind; only this source's, and only one download of it runs at a time.
    for (const name of readdirSync(base)) if (name.startsWith(tmpPrefix)) cleanup(join(base, name));
    const tmp = join(base, `${tmpPrefix}${randomBytes(8).toString('hex')}`);
    mkdirSync(tmp, { mode: 0o700 });
    try {
      const tree = join(tmp, ...includeSegments);
      mkdirSync(tree, { recursive: true, mode: 0o700 });
      try {
        extractTo(entries, tree);
      } catch (error) {
        // Whatever the disk refused (a collision it merges, say): never a raw file-system error with the user's path.
        throw new BmadDownloadError('integrity', error instanceof ArchiveRefusedError ? error.message : `extraction failed (${String((error as NodeJS.ErrnoException).code ?? 'unknown')})`);
      }
      const marker: Marker = { repo: pin.repo, commit: pin.commit, contentHash: pin.contentHash };
      writeFileSync(join(tmp, VERIFIED_MARKER), `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 });
      // A folder for this commit without a valid marker is a leftover: replaced.
      if (existsSync(folder)) rmSync(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      renameSync(tmp, folder);
    } catch (error) {
      cleanup(tmp);
      throw error;
    }
    // Only the exact pinned commit counts: every other one goes.
    for (const name of readdirSync(sourceDir)) if (name !== pin.commit) cleanup(join(sourceDir, name));
    return { state: 'ready', version: pin.version, commit: pin.commit };
  };

  return {
    pin,
    root,
    status,
    download() {
      if (inFlight !== undefined) return inFlight;
      // An explicit action only: a ready copy is re-hashed, and one damaged since (a file deleted or changed) is downloaded again.
      if (ready() && intact()) return Promise.resolve(status());
      const pending = run().finally(() => {
        if (inFlight === pending) inFlight = undefined;
      });
      inFlight = pending;
      return pending;
    },
    file(relPath) {
      if (!plainRelative(relPath) || !ready()) return undefined;
      const path = join(root, ...relPath.split('/'));
      try {
        return lstatSync(path).isFile() ? path : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

export interface UpstreamBmadSourceOptions extends Omit<PinnedSourceOptions, 'name' | 'pin'> {
  /** The lock (tests: a fixture's). Default {@link BMAD_LOCK}. */
  lock?: { sources: { 'bmad-method': BmadLockSource } };
}

/**
 * The pinned upstream BMad Method (`<data>/bmad/bmad-method/<commit>/skills/`):
 * core's `BmadSourcePort`, whose `file` paths are relative to `skills/`
 * (`bmad-ticket/scripts/tickets.py`).
 */
export function createUpstreamBmadSource({ lock, ...options }: UpstreamBmadSourceOptions): PinnedSource {
  return createPinnedSource({ ...options, name: 'bmad-method', pin: (lock ?? BMAD_LOCK).sources['bmad-method'] });
}

export { BMAD_LOCK, type BmadSourceName } from './lock.js';
export { FOLDER_HASH_MAX_BYTES, FOLDER_HASH_MAX_ENTRIES, hashFolder, hashFolderWithCounts, type FolderHash, type FolderHashLimits } from './folder-hash.js';
export { ArchiveRefusedError, extractTo, tarballUrl, gunzipLimited, hashEntries, normalizeText, parseTar, selectVerified, type Entries, type TarEntry } from './archive.js';
