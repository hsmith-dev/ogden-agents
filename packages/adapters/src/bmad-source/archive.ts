/**
 * Verifying a pinned upstream BMad tarball (story 4.14, AD-13): the one
 * implementation of the content hash and the safe selection, shared by the
 * runtime (`bmad-source`) and the CI check (`scripts/bmad-lock.mjs`, which
 * imports this file directly with Node). The tar reader is the adapters'
 * shared one (`archive/tar.ts`), re-exported here.
 *
 * Self-contained on purpose: Node builtins and `archive/tar.ts` only
 * (imported with its `.ts` extension), and erasable TypeScript syntax only
 * (no enums, namespaces or parameter properties), so `node` can load it
 * without a build.
 *
 * - The hash is over contents, not archive bytes (codeload's tarball bytes
 *   are not stable): sha256 over each selected file's path and contents, in
 *   sorted path order, text normalized CRLF to LF ({@link hashEntries}).
 * - {@link selectVerified} strips the tarball's top folder, keeps only the
 *   regular files under the lock's `include` prefix (keyed relative to it),
 *   and refuses the whole archive for anything unsafe.
 * - {@link extractTo} writes exactly those entries, and nothing else, into a
 *   fresh folder.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { ArchiveRefusedError, type TarEntry } from '../archive/tar.ts';

// The generic tar reader lives in `archive/tar.ts` (entry 4.12); re-exported here under the same names.
export { ArchiveRefusedError, gunzipLimited, parseTar, type TarEntry } from '../archive/tar.ts';

/**
 * A file set: POSIX path relative to the selected folder → contents
 * (LF-normalized text). {@link selectVerified} also records each file's tar
 * mode in `modes`, so {@link extractTo} keeps executable bits (the hash
 * covers paths and contents only).
 */
export type Entries = Map<string, Buffer> & { modes?: Map<string, number> };

/** The largest tarball a download accepts (BMad Method's is under 2 MB). */
export const BMAD_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** The largest unpacked tar accepted (BMad Method's is under 25 MB). */
export const BMAD_UNPACKED_MAX_BYTES = 256 * 1024 * 1024;

/** The codeload URL of a pin's tarball: the exact commit, never a branch or tag. */
export function tarballUrl(pin: { repo: string; commit: string }): string {
  return `https://codeload.github.com/${pin.repo}/tar.gz/${pin.commit}`;
}

/** Text contents with CRLF turned into LF; a buffer with a NUL byte is binary and returned unchanged. */
export function normalizeText(data: Buffer): Buffer {
  if (data.includes(0) || !data.includes(13)) return data;
  return Buffer.from(data.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

/** `sha256:<hex>` over each entry's path and contents, in sorted path order. */
export function hashEntries(entries: Entries): string {
  const hash = createHash('sha256');
  for (const path of [...entries.keys()].sort()) {
    const data = entries.get(path)!;
    hash.update(`${path}\0${data.length}\0`);
    hash.update(data);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Why `path` (a raw archive path) is unsafe to use, or `undefined` when it is a plain relative path. */
function unsafePath(path: string): string | undefined {
  if (path.includes('\0')) return 'has a NUL byte';
  if (path.includes('\\')) return 'has a backslash';
  if (path.startsWith('/')) return 'is absolute';
  if (/^[A-Za-z]:/.test(path)) return 'names a drive';
  const segments = path.replace(/\/$/, '').split('/');
  if (segments.some((segment) => segment === '..')) return 'leaves its folder';
  if (segments.some((segment) => segment === '' || segment === '.')) return 'is not a plain path';
  return undefined;
}

/**
 * The regular files under `include` (`''` for the whole tree, else a prefix
 * ending in `/`, such as `skills/`), keyed by their path below it, text
 * normalized to LF: the exact set that is hashed and written.
 *
 * The tarball's one top folder (`<repo>-<commit>/`) is stripped. The whole
 * archive is refused for any entry anywhere whose path is absolute, names a
 * drive, has a backslash or NUL, or leaves its folder; for a second top
 * folder; and, under `include`, for a duplicate path (also one differing
 * only in case, which a case-insensitive disk would merge) or any entry that
 * is not a regular file or a folder (a symlink, a hardlink, a device). Paths
 * are compared NFC-normalized and lowercased (a case- or
 * normalization-insensitive disk would merge them), and a file whose path is
 * a folder of another file is refused too. An archive with no file under
 * `include` is refused as well.
 */
export function selectVerified(tarEntries: readonly TarEntry[], include: string): Entries {
  if (include !== '' && (!include.endsWith('/') || unsafePath(include) !== undefined)) {
    throw new ArchiveRefusedError(`the include prefix "${include}" is not a folder path`);
  }
  const entries: Entries = new Map();
  const modes = new Map<string, number>();
  const folded = new Set<string>();
  const fold = (path: string) => path.normalize('NFC').toLowerCase();
  let top: string | undefined;
  for (const entry of tarEntries) {
    const why = unsafePath(entry.path);
    if (why !== undefined) throw new ArchiveRefusedError(`archive entry ${JSON.stringify(entry.path)} ${why}`);
    const trimmed = entry.path.replace(/\/$/, '');
    const slash = trimmed.indexOf('/');
    const first = slash === -1 ? trimmed : trimmed.slice(0, slash);
    if (top === undefined) top = first;
    else if (first !== top) throw new ArchiveRefusedError(`archive entry ${JSON.stringify(entry.path)} is outside the archive's top folder`);
    if (slash === -1) continue;
    const inTree = trimmed.slice(slash + 1);
    if (!`${inTree}/`.startsWith(include) && !inTree.startsWith(include)) continue;
    if (`${inTree}/` === include) {
      // The include folder itself.
      if (entry.type !== 'dir') throw new ArchiveRefusedError(`archive entry ${include} is not a folder`);
      continue;
    }
    const key = inTree.slice(include.length);
    if (entry.type === 'dir') continue;
    if (entry.type !== 'file') throw new ArchiveRefusedError(`archive entry ${include}${key} is a ${entry.type}, not a regular file`);
    const folds = fold(key);
    if (entries.has(key) || folded.has(folds)) throw new ArchiveRefusedError(`archive entry ${include}${key} appears more than once`);
    folded.add(folds);
    entries.set(key, normalizeText(Buffer.from(entry.data)));
    modes.set(key, entry.mode);
  }
  if (entries.size === 0) throw new ArchiveRefusedError(`the archive has no files under "${include}"`);
  // A file that is also a folder of another file can't be written.
  for (const key of entries.keys()) {
    const segments = fold(key).split('/');
    for (let i = 1; i < segments.length; i++) {
      if (folded.has(segments.slice(0, i).join('/'))) throw new ArchiveRefusedError(`archive entry ${include}${key} is inside a file`);
    }
  }
  entries.modes = modes;
  return entries;
}

/**
 * Writes `entries` below `dir` (which must be a new, empty folder of the
 * caller's): folders readable only by the user (0700), files 0600, or 0700
 * when their tar mode has an executable bit (`entries.modes`), each
 * created exclusively (`wx`, so nothing already there is followed or
 * overwritten), each path checked to resolve inside `dir` first.
 */
export function extractTo(entries: Entries, dir: string): void {
  const root = resolve(dir);
  for (const [key, data] of entries) {
    const why = unsafePath(key);
    if (why !== undefined) throw new ArchiveRefusedError(`refusing to write ${JSON.stringify(key)}: it ${why}`);
    const target = resolve(root, ...key.split('/'));
    const rel = relative(root, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || !target.startsWith(root + sep)) {
      throw new ArchiveRefusedError(`refusing to write ${JSON.stringify(key)}: it resolves outside the folder`);
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const executable = ((entries.modes?.get(key) ?? 0) & 0o111) !== 0;
    writeFileSync(target, data, { flag: 'wx', mode: executable ? 0o700 : 0o600 });
  }
}
