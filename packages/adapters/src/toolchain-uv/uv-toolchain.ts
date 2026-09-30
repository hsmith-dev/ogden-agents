/**
 * `toolchain-uv` (story 1.8): implements core's `ToolchainPort` for `uv`.
 *
 * - Detection: a `uv` on `PATH` or at uv's standard install locations whose
 *   `uv --version` is at least the pinned minimum; else the private copy at
 *   `<dataDir>/tools/uv/<version>/uv[.exe]` if it runs and reports that version.
 * - Install (only when the user asks): download the pinned archive for this OS
 *   and CPU, check it against the SHA-256 pinned in `uv-release.json`, unpack
 *   `uv` (and `uvx`) into a temp folder inside `<dataDir>/tools/uv/`, then
 *   rename it into place, so a half-unpacked copy is never used.
 *
 * Nothing outside the data folder is touched: no `PATH` or shell-profile
 * change, no install script.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { ToolchainError, type DetectedToolStatus, type ToolchainPort, type ToolProgress } from '@ogden-agents/core';
import { ArchiveError, readTarGz, readZip } from './archive.js';
import {
  archiveUrl,
  compareVersions,
  detectLibc,
  parseVersion,
  selectTarget,
  shortVersion,
  UV_RELEASE,
  type Libc,
  type UvArchive,
  type UvRelease,
  type UvTarget,
} from './release.js';

/** Set to `1` to ignore any `uv` already on this computer (testing the install flow). */
export const UV_IGNORE_SYSTEM_ENV = 'OGDEN_AGENTS_UV_IGNORE_SYSTEM';

/** `<dataDir>/tools/uv`: one folder per installed version. */
export const UV_TOOLS_DIR = join('tools', 'uv');

/** Prefix of the temp folders an install works in, inside {@link UV_TOOLS_DIR}. */
const WORK_PREFIX = '.install-';

/** How long a download may go without receiving a byte before it counts as failed. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

const MISMATCH = "The download didn't match the expected file, so nothing was installed. Try again.";

/** How long `uv --version` may take. */
const VERSION_TIMEOUT_MS = 10_000;

/** Runs `<file> --version` and resolves with its stdout, or `null` if it can't run. */
export type VersionRunner = (file: string) => Promise<string | null>;

export const runVersion: VersionRunner = (file) =>
  new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: VERSION_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      resolve(error === null ? String(stdout) : null);
    });
  });

export interface UvToolchainOptions {
  /** The Ogden Agents data folder; the private copy lives under `tools/uv/`. */
  dataDir: string;
  /** Environment for `PATH`, the home folder and {@link UV_IGNORE_SYSTEM_ENV}. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Default `process.platform`. */
  platform?: string;
  /** Default `process.arch`. */
  arch?: string;
  /** Default: detected from the running Node (Linux only). */
  libc?: Libc;
  /** Default: the pinned release in `uv-release.json`. */
  release?: UvRelease;
  /** Where archives are downloaded from. Default `release.baseUrl` (tests use a local server). */
  baseUrl?: string;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Default {@link runVersion}. */
  runVersion?: VersionRunner;
  /** uv's standard install folders, searched after `PATH`. Default: per OS, see {@link standardUvDirs}. */
  standardDirs?: readonly string[];
  /** Default {@link DOWNLOAD_IDLE_TIMEOUT_MS}. */
  idleTimeoutMs?: number;
  /** Told about temp files that could not be removed; they never change an install's outcome. Default: ignored. */
  onCleanupError?: (error: unknown) => void;
}

/**
 * Where uv's own installer and the common package managers put it, for a
 * server started without the user's shell `PATH`.
 */
export function standardUvDirs(platform: string, env: NodeJS.ProcessEnv, home: string): string[] {
  const dirs = [env.UV_INSTALL_DIR, env.XDG_BIN_HOME, join(home, '.local', 'bin'), join(home, '.cargo', 'bin')];
  if (platform === 'win32') {
    if (env.LOCALAPPDATA !== undefined) dirs.push(join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  return dirs.filter((dir): dir is string => dir !== undefined && dir !== '');
}

interface Found {
  path: string;
  version: [number, number, number];
}

export function createUvToolchain(options: UvToolchainOptions): ToolchainPort & {
  /** The folder the private copy is installed in. */
  readonly privateDir: string;
} {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const release = options.release ?? UV_RELEASE;
  const fetchImpl = options.fetch ?? fetch;
  const run = options.runVersion ?? runVersion;
  const idleTimeoutMs = options.idleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS;
  const onCleanupError = options.onCleanupError ?? (() => {});
  const exe = platform === 'win32' ? '.exe' : '';
  const toolsDir = join(options.dataDir, UV_TOOLS_DIR);
  const privateDir = join(toolsDir, release.version);
  const minimum = parseVersion(release.minimumVersion);
  if (minimum === undefined) throw new Error(`uv-release.json: bad minimumVersion "${release.minimumVersion}"`);
  let libc: Libc | undefined = options.libc;
  const target = () =>
    selectTarget({ os: platform, cpu: options.arch ?? process.arch, libc: () => (libc ??= detectLibc()) });

  const versionOf = async (file: string): Promise<[number, number, number] | undefined> => {
    const output = await run(file);
    return output === null ? undefined : parseVersion(output);
  };

  /** Each distinct `uv` on `PATH`, then in the standard folders, with its version. */
  const systemCandidates = async (): Promise<Found[]> => {
    const pathDirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter((dir) => dir !== '');
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    const dirs = [...pathDirs, ...(options.standardDirs ?? standardUvDirs(platform, env, home))];
    const seen = new Set<string>();
    const found: Found[] = [];
    for (const dir of dirs) {
      const file = join(dir, `uv${exe}`);
      let real: string;
      try {
        if (!statSync(file).isFile()) continue;
        real = realpathSync(file);
      } catch {
        continue;
      }
      if (seen.has(real) || real.startsWith(toolsDir)) continue;
      seen.add(real);
      const version = await versionOf(file);
      if (version !== undefined) found.push({ path: file, version });
      // The first usable one wins, as a shell would pick it.
      if (version !== undefined && compareVersions(version, minimum) >= 0) break;
    }
    return found;
  };

  const status = async (): Promise<DetectedToolStatus> => {
    let tooOld: Found | undefined;
    if (env[UV_IGNORE_SYSTEM_ENV] !== '1') {
      for (const candidate of await systemCandidates()) {
        if (compareVersions(candidate.version, minimum) >= 0) {
          return { state: 'ready', version: candidate.version.join('.'), source: 'system' };
        }
        if (tooOld === undefined || compareVersions(candidate.version, tooOld.version) > 0) tooOld = candidate;
      }
    }
    const privateUv = join(privateDir, `uv${exe}`);
    if (existsSync(privateUv)) {
      const version = await versionOf(privateUv);
      if (version !== undefined && version.join('.') === release.version) {
        return { state: 'ready', version: release.version, source: 'private' };
      }
    }
    // No download for this OS or CPU: Install can't help, whatever else is found.
    const selected = target();
    if ('unsupported' in selected) return { state: 'failed', reason: selected.unsupported, canInstall: false };
    if (tooOld !== undefined) {
      return {
        state: 'missing',
        reason: `Your uv is older than ${shortVersion(release.minimumVersion)} (this computer has ${tooOld.version.join('.')}).`,
      };
    }
    return { state: 'missing' };
  };

  const installUv = async (onProgress: (progress: ToolProgress) => void): Promise<{ version: string }> => {
    const selected = target();
    if ('unsupported' in selected) {
      throw new ToolchainError('unsupported_platform', selected.unsupported, {
        canInstall: false,
        details: { platform, arch: options.arch ?? process.arch },
      });
    }
    const archive = release.archives[selected.target];
    if (archive === undefined) {
      throw new ToolchainError('unsupported_platform', `Ogden Agents has no uv download for this computer (${selected.target}).`, {
        canInstall: false,
        details: { target: selected.target },
      });
    }

    mkdirSync(toolsDir, { recursive: true, mode: 0o700 });
    removeLeftovers(toolsDir, onCleanupError);
    const work = mkdtempSync(join(toolsDir, WORK_PREFIX));
    try {
      const url = archiveUrl(release, archive, options.baseUrl);
      // One buffer: what is hashed against the pin is exactly what is unpacked.
      const data = await download(url, archive, onProgress, selected.target);
      const actual = createHash('sha256').update(data).digest('hex');
      if (actual !== archive.sha256.toLowerCase()) {
        throw new ToolchainError('hash_mismatch', MISMATCH, {
          details: { target: selected.target, url, expected: archive.sha256, actual },
        });
      }
      const staging = join(work, 'uv');
      unpack(data, archive, selected.target, staging);

      const installed = await versionOf(join(staging, `uv${exe}`));
      if (installed === undefined || installed.join('.') !== release.version) {
        throw new ToolchainError('install_failed', "The downloaded uv didn't start on this computer.", {
          details: { target: selected.target, reported: installed?.join('.') ?? null },
        });
      }

      await moveIntoPlace(staging, join(work, 'previous'));
      return { version: release.version };
    } finally {
      // Best effort: a folder the OS still holds must never turn the outcome into another one.
      try {
        rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        onCleanupError(error);
      }
    }
  };

  /**
   * Renames `staging` to the private folder. An existing copy is first moved
   * aside to `aside` (and restored if the rename fails), so a failure never
   * leaves no copy at all.
   */
  const moveIntoPlace = async (staging: string, aside: string) => {
    const hadPrevious = existsSync(privateDir);
    if (hadPrevious) await renameWithRetry(privateDir, aside);
    try {
      await renameWithRetry(staging, privateDir);
    } catch (error) {
      if (hadPrevious) {
        try {
          await renameWithRetry(aside, privateDir);
        } catch (restoreError) {
          onCleanupError(restoreError);
        }
      }
      throw new ToolchainError('install_failed', "uv couldn't be put in place, so nothing changed. Try again.", {
        details: { reason: String(error) },
        cause: error,
      });
    }
  };

  /** Downloads `url` into memory, never more than the pinned size, reporting progress. */
  const download = async (
    url: string,
    archive: UvArchive,
    onProgress: (progress: ToolProgress) => void,
    targetName: UvTarget,
  ): Promise<Buffer> => {
    const controller = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(new Error('the download stalled')), idleTimeoutMs);
    };
    const failed = (cause: unknown, details: Record<string, unknown> = {}) =>
      new ToolchainError('download_failed', "The download didn't finish. Check your internet connection and try again.", {
        details: { target: targetName, url, reason: String(cause), ...details },
        cause,
      });
    const tooLarge = (bytes: number) =>
      new ToolchainError('hash_mismatch', MISMATCH, {
        details: { target: targetName, url, reason: 'larger than the pinned size', expectedSize: archive.size, bytes },
      });

    armIdle();
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
      } catch (error) {
        throw failed(error);
      }
      if (!response.ok || response.body === null) {
        throw new ToolchainError('download_failed', `The download couldn't start (error ${response.status}). Try again later.`, {
          details: { target: targetName, url, status: response.status },
        });
      }
      const header = Number(response.headers.get('content-length'));
      if (Number.isSafeInteger(header) && header > archive.size) {
        controller.abort();
        throw tooLarge(header);
      }
      const total = archive.size;
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      onProgress({ bytes, total });
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          armIdle();
          bytes += chunk.byteLength;
          if (bytes > archive.size) {
            controller.abort();
            throw tooLarge(bytes);
          }
          chunks.push(chunk);
          onProgress({ bytes, total });
        }
      } catch (error) {
        if (error instanceof ToolchainError) throw error;
        throw failed(controller.signal.aborted ? controller.signal.reason : error, { bytes, total });
      }
      if (bytes !== archive.size) throw failed(new Error('the download ended early'), { bytes, total });
      return Buffer.concat(chunks, bytes);
    } finally {
      clearTimeout(idle);
    }
  };

  /** Writes `uv` (and `uvx`, `uvw` when present) from the verified archive into `dir`. */
  const unpack = (data: Buffer, archive: UvArchive, targetName: UvTarget, dir: string) => {
    const names = new Set([`uv${exe}`, `uvx${exe}`, `uvw${exe}`]);
    const topFolder = `uv-${targetName}`;
    // `uv-<target>/uv` in the tarballs; the Windows zips hold `uv.exe` at the top.
    const pick = (path: string) => {
      const parts = path.split('/');
      const base = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === topFolder ? parts[1] : undefined;
      return base !== undefined && names.has(base) ? base : undefined;
    };
    let files: Map<string, Buffer>;
    try {
      files = archive.file.endsWith('.zip') ? readZip(data, pick) : readTarGz(data, pick);
    } catch (error) {
      throw new ToolchainError('extract_failed', "The download couldn't be unpacked, so nothing was installed. Try again.", {
        details: { target: targetName, reason: error instanceof ArchiveError ? error.message : String(error) },
        cause: error,
      });
    }
    if (!files.has(`uv${exe}`)) {
      throw new ToolchainError('extract_failed', "The download didn't contain uv, so nothing was installed.", {
        details: { target: targetName, found: [...files.keys()] },
      });
    }
    try {
      mkdirSync(dir, { mode: 0o700 });
      chmodSync(dir, 0o700);
      for (const [name, contents] of files) {
        const file = join(dir, name);
        writeFileSync(file, contents, { mode: 0o755 });
        chmodSync(file, 0o755);
      }
    } catch (error) {
      throw new ToolchainError('install_failed', "uv couldn't be written to Ogden Agents' data folder. Check there is free space, then try again.", {
        details: { target: targetName, reason: String(error) },
        cause: error,
      });
    }
  };

  return { uvVersion: release.version, privateDir, status, installUv };
}

/** Removes temp folders a crashed or killed install left behind, best effort. */
function removeLeftovers(toolsDir: string, onError: (error: unknown) => void): void {
  for (const entry of readdirSync(toolsDir)) {
    if (!entry.startsWith(WORK_PREFIX)) continue;
    try {
      rmSync(join(toolsDir, entry), { recursive: true, force: true });
    } catch (error) {
      onError(error);
    }
  }
}

const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** `renameSync`, retried briefly when Windows (an antivirus scan, say) holds the folder. */
export async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= attempts || !RETRYABLE_RENAME.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}
