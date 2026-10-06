/**
 * Installing the Local model's harness (epic 14, story 14.2): the pinned
 * OpenCode archive for this computer is downloaded into the data folder as
 * Antigravity's is (`archive/download.ts`: resumed, never more than
 * the pinned size, SHA-256 checked), unpacked file by file into a staging
 * folder (only the pinned file, checked against its own pinned SHA-256), and
 * renamed into `<dataDir>/agents/local/<version>/` with Ogden's install record.
 *
 * On Windows the pinned `rg.exe` (ripgrep) is downloaded the same way and
 * placed beside it: without it the harness downloads ripgrep from GitHub on
 * its first search (spike 14.1), a connection Ogden never allows.
 *
 * Nothing is installed globally, nothing is run, and the user's own folders
 * are never read or written.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSetupError, type AgentInstallProgress, type AgentPlatform } from '@ogden-agents/core';
import { errorCode } from '../error-code.js';
import { DownloadError, discardPartial, downloadVerified } from '../archive/download.js';
import { UnsafeArchiveError, extractPinned } from '../archive/unzip.js';
import { renameWithRetry } from '../toolchain-uv/uv-toolchain.js';
import { readZip, ArchiveError } from '../toolchain-uv/archive.js';
import { LOCAL, OPENCODE } from '../acp-opencode/constants.js';
import { LOCAL_PINS, type LocalArchivePin, type LocalPins, type LocalRipgrepPin } from './descriptor.js';
import { RIPGREP_FILE, currentPlatform, installedOpenCode, localInstallDir, localPin, localVersionDir, ripgrepPin, writeLocalInstallRecord, type InstalledOpenCode } from './layout.js';
import { extractPinnedTarGz } from '../archive/untar.js';

/** Prefixes of the work folders an install uses inside the install folder. */
export const STAGING_PREFIX = '.staging-';
export const ASIDE_PREFIX = '.previous-';
export const DOWNLOADS = '.download';

export const NOT_AVAILABLE = `${LOCAL} isn't available on this computer yet. ${OPENCODE}, which it runs through, has no download for this system.`;
export const ALREADY_INSTALLING = `${LOCAL} is already being installed.`;
const MISMATCH = "The download didn't match the expected file, so nothing was installed. Try again.";
const NOT_FINISHED = "The download didn't finish. Check your internet connection and try again; it picks up where it stopped.";
const NO_SPACE = `${LOCAL} couldn't be saved in Ogden Agents' data folder. Check there is free space, then try again.`;
const NOT_EXPECTED = `The download wasn't the expected ${OPENCODE} files, so nothing was installed. Try again.`;
const IN_USE = `${LOCAL} is in use. Close its chats, then try again.`;
const STOPPED = `The ${LOCAL} install was stopped.`;

export interface InstallLocalOptions {
  dataDir: string;
  platform?: AgentPlatform | undefined;
  pins?: Readonly<LocalPins> | undefined;
  /** The download's `fetch` (tests: a local server's archive). Default: the global one. */
  fetch?: typeof fetch | undefined;
  signal?: AbortSignal | undefined;
  onProgress: (progress: AgentInstallProgress) => void;
  idleTimeoutMs?: number | undefined;
  backoffMs?: number | undefined;
  /** Told about leftovers that could not be removed; they never change an outcome. */
  onCleanupError?: ((error: unknown) => void) | undefined;
}

const removeQuietly = (path: string, onError: (error: unknown) => void) => {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    onError(error);
  }
};

const namesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * Removes what a crashed install left behind: staging and aside folders, and
 * other versions than the pinned one (after a reviewed pin bump).
 */
export function removeLocalLeftovers(dataDir: string, pins: Readonly<LocalPins> = LOCAL_PINS, onError: (error: unknown) => void = () => {}): void {
  const dir = localInstallDir(dataDir);
  for (const entry of namesIn(dir)) {
    const otherVersion = /^\d+\.\d+\.\d+$/.test(entry) && entry !== pins.version;
    if (entry.startsWith(STAGING_PREFIX) || entry.startsWith(ASIDE_PREFIX) || otherVersion) removeQuietly(join(dir, entry), onError);
  }
}

/** The SHA-256 of `data`. */
const sha256Of = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Downloads and checks the ripgrep zip, then writes its `rg.exe` into `staging`. */
async function placeRipgrep(pin: LocalRipgrepPin, downloads: string, staging: string, options: InstallLocalOptions, step: (name: string, percent?: number | null) => void, signal: AbortSignal): Promise<number> {
  const partFile = join(downloads, `ripgrep-${pin.sha256.slice(0, 12)}.zip.part`);
  step('Downloading a search tool');
  await downloadVerified({
    url: pin.url,
    size: pin.size,
    sha256: pin.sha256,
    partFile,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs }),
    signal,
  });
  let found: Buffer | undefined;
  try {
    found = readZip(readFileSync(partFile), (path) => (path === pin.member ? 'rg' : undefined)).get('rg');
  } catch (error) {
    if (error instanceof ArchiveError) throw new UnsafeArchiveError(error.message);
    throw error;
  }
  if (found === undefined) throw new UnsafeArchiveError('the search tool is missing from its archive');
  if (found.length !== pin.file.size || sha256Of(found) !== pin.file.sha256) throw new UnsafeArchiveError('the search tool does not match its pin');
  writeFileSync(join(staging, RIPGREP_FILE), found, { mode: 0o755, flag: 'wx' });
  await discardPartial(partFile).catch(() => {});
  return found.length;
}

function failure(error: unknown, signal: AbortSignal): AgentSetupError {
  if (error instanceof AgentSetupError) return error;
  if (signal.aborted) return new AgentSetupError(STOPPED, { details: { step: 'stopped' } });
  if (error instanceof DownloadError) {
    const message = error.kind === 'mismatch' ? MISMATCH : error.kind === 'disk' ? NO_SPACE : NOT_FINISHED;
    return new AgentSetupError(message, { cause: error, details: { step: 'download', kind: error.kind, ...error.details } });
  }
  if (error instanceof UnsafeArchiveError) return new AgentSetupError(NOT_EXPECTED, { cause: error, details: { step: 'unpack', reason: error.message } });
  return new AgentSetupError(NO_SPACE, { cause: error, details: { step: 'unpack', code: errorCode(error, 'unknown') } });
}

/**
 * Installs the pinned harness for this computer into `<dataDir>/agents/local/<version>/`.
 * Rejects with an `AgentSetupError` in plain words, leaving nothing half installed.
 */
export async function installLocal(options: InstallLocalOptions): Promise<InstalledOpenCode> {
  const platform = options.platform ?? currentPlatform();
  const pins = options.pins ?? LOCAL_PINS;
  const pin: LocalArchivePin | undefined = localPin(platform, pins);
  if (pin === undefined) throw new AgentSetupError(NOT_AVAILABLE, { details: { step: 'start', platform } });
  const onCleanupError = options.onCleanupError ?? (() => {});
  const signal = options.signal ?? new AbortController().signal;
  const installDir = localInstallDir(options.dataDir);
  const versionDir = localVersionDir(options.dataDir, pins);
  const step = (name: string, percent: number | null = null) => options.onProgress({ step: name, percent });
  let staging: string | undefined;
  try {
    mkdirSync(installDir, { recursive: true, mode: 0o700 });
    removeLocalLeftovers(options.dataDir, pins, onCleanupError);
    const downloads = join(installDir, DOWNLOADS);
    mkdirSync(downloads, { recursive: true, mode: 0o700 });
    const partFile = join(downloads, `${pins.version}-${platform}.${pin.format}.part`);
    const downloading = `Downloading ${LOCAL}`;
    await downloadVerified({
      url: pin.url,
      size: pin.size,
      sha256: pin.sha256,
      partFile,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
      ...(options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs }),
      signal,
      onProgress: (bytes, total) => step(downloading, total === 0 ? null : Math.floor((bytes / total) * 90)),
    });
    if (signal.aborted) throw new AgentSetupError(STOPPED);

    step(`Unpacking ${LOCAL}`, 92);
    staging = mkdtempSync(join(installDir, STAGING_PREFIX));
    if (process.platform !== 'win32') chmodSync(staging, 0o755);
    try {
      if (pin.format === 'zip') await extractPinned(partFile, staging, pin.files);
      else await extractPinnedTarGz(partFile, staging, pin.files);
    } catch (error) {
      // An archive that isn't what the pin says is never resumed or unpacked again.
      if (error instanceof UnsafeArchiveError) await discardPartial(partFile).catch(() => {});
      throw error;
    }
    if (signal.aborted) throw new AgentSetupError(STOPPED);

    const rg = ripgrepPin(platform, pins);
    const rgSize = rg === undefined ? undefined : await placeRipgrep(rg, downloads, staging, options, step, signal);
    if (signal.aborted) throw new AgentSetupError(STOPPED);

    step(`Checking ${LOCAL}`, 98);
    writeLocalInstallRecord(staging, {
      version: pins.version,
      platform,
      files: Object.fromEntries(Object.entries(pin.files).map(([name, file]) => [name, file.size])),
      ...(rgSize === undefined ? {} : { ripgrep: rgSize }),
    });
    // Moved into place, setting aside (then removing) what was there.
    const aside = join(installDir, `${ASIDE_PREFIX}${randomBytes(4).toString('hex')}`);
    const had = existsSync(versionDir);
    if (had) await renameWithRetry(versionDir, aside);
    try {
      await renameWithRetry(staging, versionDir);
    } catch (error) {
      if (had) await renameWithRetry(aside, versionDir).catch(onCleanupError);
      const code = errorCode(error, 'unknown');
      throw new AgentSetupError(code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? IN_USE : NO_SPACE, { cause: error, details: { step: 'move', code } });
    }
    staging = undefined;
    if (had) removeQuietly(aside, onCleanupError);
    await discardPartial(partFile).catch(onCleanupError);
    // Nothing else downloads here: the folder goes once the archive (and ripgrep) are in place.
    removeQuietly(downloads, onCleanupError);
    const installed = installedOpenCode(options.dataDir, platform, pins);
    if (installed === undefined) throw new AgentSetupError(NO_SPACE, { details: { step: 'verify' } });
    return installed;
  } catch (error) {
    throw failure(error, signal);
  } finally {
    if (staging !== undefined) removeQuietly(staging, onCleanupError);
  }
}
