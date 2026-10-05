/**
 * The pinned-npm installer every npm-installed agent shares (story 9.3 for
 * Claude Code; extracted by epic 12 entry 4 so Codex installs the same way,
 * Claude Code unchanged). It installs an agent's pinned ACP adapter into
 * Ogden Agents' own data folder, only when the user clicks Install (AD-21:
 * no terminal).
 *
 * - Everything goes under `<dataDir>/<spec.dir>/`: the pinned `package.json`
 *   and `package-lock.json` (every package with its `integrity`, `pins/`,
 *   bumped by `scripts/agent-pins.mjs --update`) are written into a
 *   `.install-*` temp folder, `npm ci` runs there with npm's cache inside it,
 *   and the result is renamed into `spec.folderName(...)`, so a half-installed
 *   copy is never used (story 1.8's pattern).
 * - npm is `npm-cli.js` beside this Node, else the npm that launched Ogden
 *   Agents, else one on an absolute `PATH` entry ({@link findNpmCli}), run with
 *   `process.execPath` and an argument array: no shell, no `.cmd` (AGENTS.md),
 *   `--ignore-scripts`, and without the `npm_*` variables this server may have
 *   inherited. The user's own `.npmrc` (registry, proxy) still applies.
 * - A tarball that doesn't match the lock fails the whole install (npm's
 *   `EINTEGRITY`), and so does no output and no download for
 *   {@link NPM_IDLE_TIMEOUT_MS}. Any failure removes the temp folder.
 * - npm's output is read for progress (`--loglevel http`, one line per
 *   package fetched) and its error code; it is never logged or shown.
 *
 * Nothing is written outside the data folder: no global install, no `PATH`
 * or profile change, no admin rights.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentSetupError, type AgentInstallProgress } from '@ogden-agents/core';
import { helperEnvironment, NPM_NETWORK } from '../child-env.js';
import { errorCode } from '../error-code.js';
import { renameWithRetry } from '../toolchain-uv/uv-toolchain.js';
import { findNpmCli, pathOf } from './npm-cli.js';

/** Prefix of the temp folders an install works in, inside the agent's folder. */
const WORK_PREFIX = '.install-';

/** How long npm may go without printing a line or growing its download before the install counts as stalled. */
export const NPM_IDLE_TIMEOUT_MS = 60_000;

/** An npm lockfile (v3), as far as the install reads it. */
export interface AdapterLock {
  lockfileVersion?: number;
  packages: Record<string, { version?: string; integrity?: string; optional?: boolean; link?: boolean; os?: string[]; cpu?: string[] }>;
}

/** The `package.json` and `package-lock.json` an install writes and runs `npm ci` on. */
export interface AdapterPins {
  packageJson: unknown;
  lock: AdapterLock;
}

/** What an agent's install is, beside the pins. */
export interface PinnedNpmSpec {
  /** The product name, as the UI's plain words name it. */
  displayName: string;
  /** The agent's folder under the data folder, `agents/<id>`. */
  dir: string;
  /** The pinned adapter package. */
  packageName: string;
  /** Path segments from the package's folder to its entry script (`['dist', 'index.js']`). */
  entry: readonly string[];
  /** The folder a finished install is renamed to. */
  folderName(version: string, withBinary: boolean): string;
  /** Whether a name in the agent's folder is a finished install (an interrupted swap restores only those). */
  isInstalledFolder(name: string): boolean;
  /** For an agent whose lock holds a platform binary package: whether the lock has them, and whether npm put one in `project`. */
  binary?: { locked(lock: AdapterLock): boolean; present(project: string): boolean } | undefined;
  /**
   * For an agent whose package carries a binary Ogden unpacks and checks itself (Grok's brotli-compressed
   * binary, epic 12 entry 4): runs after `npm ci` and the checks above, before the swap into place, in the
   * install's temp folder. It throws an {@link AgentSetupError} in plain words (a hash that does not match
   * refuses the whole install). Never run for an install without its binary packages.
   */
  finalize?: ((project: string, words: InstallWords, options: Pick<InstallPinnedNpmOptions, 'signal' | 'onProgress'>) => Promise<void>) | undefined;
  /** The runnable's path inside an installed `folder`, when it is not the adapter's entry script (Grok's own checked binary). */
  resultPath?: ((folder: string) => string) | undefined;
}

/** The adapter's version the lock pins, or throws (a pins bug). */
export function pinnedVersionOf(spec: Pick<PinnedNpmSpec, 'packageName'>, pins: AdapterPins): string {
  const version = pins.lock.packages[`node_modules/${spec.packageName}`]?.version;
  if (version === undefined) throw new Error(`the adapter pins do not lock ${spec.packageName}`);
  return version;
}

/** The adapter's entry script inside an installed folder. */
export const entryIn = (spec: Pick<PinnedNpmSpec, 'packageName' | 'entry'>, folder: string): string =>
  join(folder, 'node_modules', ...spec.packageName.split('/'), ...spec.entry);

/** npm's output lines and how it ended. */
export interface NpmProcess {
  /** Resolves once npm has exited (or failed to start: `exitCode` `null`, `startError` its errno code only, never a message or a path). */
  exited: Promise<{ exitCode: number | null; startError?: string }>;
  /** Stops npm. Safe to call more than once. */
  kill(): void;
}

export interface NpmRunInput {
  /** The Node that runs npm (`process.execPath`). */
  nodePath: string;
  npmCli: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  /** Each line npm prints, on either stream. Never logged. */
  onLine(line: string): void;
}

export type NpmRunner = (input: NpmRunInput) => NpmProcess;

/** An error's errno code (`ENOENT`), or `unknown`: never its message, which can hold paths. */
const errnoCode = (error: unknown): string => errorCode(error, 'unknown');

/** Runs `node npm-cli.js <args>`: an argument array, no shell, a hidden window on Windows. */
export const spawnNpm: NpmRunner = (input) => {
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(input.nodePath, [input.npmCli, ...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    return { exited: Promise.resolve({ exitCode: null, startError: errnoCode(error) }), kill: () => {} };
  }
  const read = (stream: NodeJS.ReadableStream | null) => {
    if (stream === null) return;
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) input.onLine(line);
    });
    stream.on('end', () => {
      if (buffer !== '') input.onLine(buffer);
      buffer = '';
    });
    stream.on('error', () => {});
  };
  read(child.stdout);
  read(child.stderr);
  const exited = new Promise<{ exitCode: number | null; startError?: string }>((resolve) => {
    child.on('error', (error) => resolve({ exitCode: null, startError: errnoCode(error) }));
    child.on('close', (code) => resolve({ exitCode: code }));
  });
  return {
    exited,
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
};

export interface InstallPinnedNpmOptions {
  dataDir: string;
  /** Keep the optional dependencies (the platform binary package an agent's lock holds). */
  withBinary: boolean;
  onProgress: (progress: AgentInstallProgress) => void;
  pins: AdapterPins;
  /** Default {@link spawnNpm}. */
  runNpm?: NpmRunner | undefined;
  /** `npm_execpath` as the server found it at start (see {@link findNpmCli}). */
  launcherNpm?: string | undefined;
  /** Default {@link findNpmCli}, with {@link launcherNpm} and the `PATH` of {@link env}. */
  npmCli?: string | undefined;
  /** The Node that runs npm. Default `process.execPath`. */
  nodePath?: string | undefined;
  /** npm's environment, less every `npm_*` variable. Default `process.env`. */
  env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Default {@link NPM_IDLE_TIMEOUT_MS}. */
  idleTimeoutMs?: number | undefined;
  /** Aborting stops npm; the install then rejects and leaves nothing. */
  signal?: AbortSignal | undefined;
  /** Told about temp files that could not be removed; they never change an install's outcome. */
  onCleanupError?: ((error: unknown) => void) | undefined;
}

/** What {@link wordsFor} returns. */
export type InstallWords = ReturnType<typeof wordsFor>;

/** The plain words an install says, by the agent's product name. */
export function wordsFor(displayName: string) {
  return {
    downloading: `Downloading ${displayName}`,
    checking: `Checking ${displayName}`,
    noNpm: `Ogden Agents couldn't find npm, so ${displayName} wasn't installed. Install Node.js with npm, then try again.`,
    mismatch: "The download didn't match the expected files, so nothing was installed. Try again.",
    offline: "The download didn't finish. Check your internet connection and try again.",
    noSpace: `${displayName} couldn't be written to Ogden Agents' data folder. Check there is free space, then try again.`,
    failed: `${displayName} couldn't be installed. Try again.`,
    notRight: `${displayName} was downloaded but didn't look right, so nothing was installed. Try again.`,
    stopped: `Installing ${displayName} was stopped.`,
    noBinary: `${displayName} has no build for this computer (${process.platform}-${process.arch}).`,
    couldNotPlace: `${displayName} couldn't be put in place, so nothing changed. Try again.`,
  } as const;
}

/** npm error codes that mean the network, not the package. */
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNABORTED', 'EPROTO', 'E500', 'E502', 'E503', 'E504']);

/** The plain words for npm's error code. */
function reasonFor(words: ReturnType<typeof wordsFor>, code: string | undefined): string {
  if (code === 'EINTEGRITY') return words.mismatch;
  if (code === 'ENOSPC' || code === 'EDQUOT') return words.noSpace;
  if (code !== undefined && NETWORK_CODES.has(code)) return words.offline;
  return words.failed;
}

/**
 * npm's environment (AD-16): the base allowlist and what npm needs to reach
 * its registry as the user set it up (proxies, certificate authorities, its
 * config folders: `NPM_NETWORK`), never an agent key or any other variable
 * of this server's; no inherited `npm_*` settings (any case), plus npm's
 * cache in the temp folder.
 */
export function npmEnv(env: Readonly<Record<string, string | undefined>>, cache: string): Record<string, string> {
  const out = helperEnvironment(NPM_NETWORK, env);
  for (const name of Object.keys(out)) if (name.toLowerCase().startsWith('npm_')) delete out[name];
  out.npm_config_cache = cache;
  out.npm_config_update_notifier = 'false';
  return out;
}

/** Whether a lock entry's `os` and `cpu` (with `!` negations) allow this computer. */
function allowedHere(values: readonly string[] | undefined, current: string): boolean {
  if (values === undefined || values.length === 0) return true;
  if (values.includes(`!${current}`)) return false;
  const positive = values.filter((value) => !value.startsWith('!'));
  return positive.length === 0 || positive.includes(current);
}

/** How many packages `npm ci` fetches from `lock`: optional ones only when kept, and only for this OS and CPU. */
export function packagesToFetch(lock: AdapterLock, withBinary: boolean): number {
  return Object.entries(lock.packages).filter(([path, entry]) => {
    if (path === '' || entry.link === true) return false;
    if (entry.optional !== true) return true;
    return withBinary && allowedHere(entry.os, process.platform) && allowedHere(entry.cpu, process.arch);
  }).length;
}

/** A line npm prints for each package it has fetched with `--loglevel http`. */
const FETCHED = /^npm http (?:fetch GET 2\d\d |cache )/;
/** npm's error code line (`npm error code X`, or `npm ERR! code X` before npm 10). */
const ERROR_CODE = /^npm (?:error|ERR!) code ([A-Za-z0-9_]{1,40})\s*$/;

/** Total bytes of the files under `dir` (npm's download cache), best effort. */
function sizeOf(dir: string): number {
  let total = 0;
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      const stat = statSync(join(dir, name));
      if (stat.isFile()) total += stat.size;
    } catch {
      // Moved or removed while walking.
    }
  }
  return total;
}

/** Removes temp folders a crashed or killed install left behind in `dir`, best effort. */
function removeLeftovers(spec: Pick<PinnedNpmSpec, 'isInstalledFolder'>, dir: string, onError: (error: unknown) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(WORK_PREFIX)) continue;
    restorePrevious(spec, dir, join(dir, entry, 'previous'), onError);
    try {
      rmSync(join(dir, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      onError(error);
    }
  }
}

/**
 * A crash between moving an installed copy aside and renaming the new one
 * into place leaves the old copy in `<work>/previous/<name>` and nothing at
 * `<dir>/<name>`: it is moved back rather than deleted with the temp folder.
 */
function restorePrevious(spec: Pick<PinnedNpmSpec, 'isInstalledFolder'>, dir: string, previous: string, onError: (error: unknown) => void): void {
  let names: string[];
  try {
    names = readdirSync(previous);
  } catch {
    return;
  }
  for (const name of names) {
    if (!spec.isInstalledFolder(name) || existsSync(join(dir, name))) continue;
    try {
      renameSync(join(previous, name), join(dir, name));
    } catch (error) {
      onError(error);
    }
  }
}

/** Removes the `.install-*` folders a crashed or killed install left in the agent's folder (server start). */
export function removeStalePinnedInstalls(spec: PinnedNpmSpec, dataDir: string, onError: (error: unknown) => void = () => {}): void {
  removeLeftovers(spec, join(dataDir, spec.dir), onError);
}

/**
 * Installs the pinned adapter under `<dataDir>/<spec.dir>/`, reporting
 * progress. Resolves with the installed entry script, or rejects with an
 * {@link AgentSetupError} in plain words (its `details` carry the step and
 * npm's error code only) having left no temp folder and no half-installed copy.
 */
export async function installPinnedNpm(spec: PinnedNpmSpec, options: InstallPinnedNpmOptions): Promise<{ path: string; version: string }> {
  const { pins } = options;
  const words = wordsFor(spec.displayName);
  const version = pinnedVersionOf(spec, pins);
  const onCleanupError = options.onCleanupError ?? (() => {});
  const npmCli =
    options.npmCli ?? findNpmCli({ execPath: options.nodePath ?? process.execPath, launcherNpm: options.launcherNpm, pathEnv: pathOf(options.env ?? process.env) });
  if (npmCli === undefined || !existsSync(npmCli)) throw new AgentSetupError(words.noNpm, { details: { step: 'find_npm' } });
  if (options.signal?.aborted === true) throw new AgentSetupError(words.stopped, { details: { step: 'start' } });

  const dir = join(options.dataDir, spec.dir);
  let work: string;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    removeLeftovers(spec, dir, onCleanupError);
    work = mkdtempSync(join(dir, WORK_PREFIX));
  } catch (error) {
    throw new AgentSetupError(words.noSpace, { details: { step: 'prepare', code: errnoCode(error) }, cause: error });
  }
  try {
    const project = join(work, 'adapter');
    const cache = join(work, 'cache');
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), `${JSON.stringify(pins.packageJson, null, 2)}\n`);
    writeFileSync(join(project, 'package-lock.json'), `${JSON.stringify(pins.lock, null, 2)}\n`);

    await runCi(words, { ...options, npmCli, project, cache, total: packagesToFetch(pins.lock, options.withBinary) });

    options.onProgress({ step: words.checking, percent: 95 });
    const entry = entryIn(spec, project);
    let installed: string | undefined;
    try {
      installed = (JSON.parse(readFileSync(join(project, 'node_modules', ...spec.packageName.split('/'), 'package.json'), 'utf8')) as { version?: string }).version;
    } catch {
      installed = undefined;
    }
    if (!existsSync(entry) || installed !== version) {
      throw new AgentSetupError(words.notRight, { details: { step: 'verify', installed: installed ?? null, pinned: version } });
    }
    if (options.withBinary && spec.binary?.locked(pins.lock) === true && !spec.binary.present(project)) {
      throw new AgentSetupError(words.noBinary, { details: { step: 'verify', platform: process.platform, arch: process.arch } });
    }

    if (options.withBinary && spec.finalize !== undefined) await spec.finalize(project, words, { signal: options.signal, onProgress: options.onProgress });

    const name = spec.folderName(version, options.withBinary);
    const target = join(dir, name);
    // Aside under its own name, so a crash mid-swap can be undone at the next start (`restorePrevious`).
    mkdirSync(join(work, 'previous'));
    await moveIntoPlace(words, project, target, join(work, 'previous', name), onCleanupError);
    options.onProgress({ step: words.checking, percent: 100 });
    return { path: spec.resultPath === undefined ? entryIn(spec, target) : spec.resultPath(target), version };
  } finally {
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      onCleanupError(error);
    }
  }
}

/** `npm ci` in `project`, with progress, the idle timeout and the abort signal. Rejects in plain words. */
async function runCi(
  words: ReturnType<typeof wordsFor>,
  options: InstallPinnedNpmOptions & { npmCli: string; project: string; cache: string; total: number },
): Promise<void> {
  const runNpm = options.runNpm ?? spawnNpm;
  const idleTimeoutMs = options.idleTimeoutMs ?? NPM_IDLE_TIMEOUT_MS;
  const args = [
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    '--no-progress',
    '--color=false',
    '--loglevel',
    'http',
    ...(options.withBinary ? [] : ['--omit=optional']),
  ];
  let fetched = 0;
  let npmCode: string | undefined;
  let stalled = false;
  let aborted = false;
  const report = () => {
    const percent = options.total > 0 ? Math.min(90, Math.floor((fetched / options.total) * 90)) : null;
    options.onProgress({ step: words.downloading, percent });
  };
  report();

  let idle: ReturnType<typeof setTimeout> | undefined;
  let lastSize = 0;
  let npm: NpmProcess | undefined;
  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      // A large package downloads for a while before npm prints its line: a growing cache is progress too.
      const size = sizeOf(options.cache);
      if (size > lastSize) {
        lastSize = size;
        armIdle();
        return;
      }
      stalled = true;
      npm?.kill();
    }, idleTimeoutMs);
  };
  const onAbort = () => {
    aborted = true;
    npm?.kill();
  };

  armIdle();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    npm = runNpm({
      nodePath: options.nodePath ?? process.execPath,
      npmCli: options.npmCli,
      args,
      cwd: options.project,
      env: npmEnv(options.env ?? process.env, options.cache),
      onLine: (line) => {
        armIdle();
        const code = ERROR_CODE.exec(line);
        if (code !== null) npmCode ??= code[1];
        if (FETCHED.test(line)) {
          fetched++;
          report();
        }
      },
    });
    if (options.signal?.aborted === true) onAbort();
    const { exitCode, startError } = await npm.exited;
    if (aborted) throw new AgentSetupError(words.stopped, { details: { step: 'npm_ci', stopped: true } });
    if (stalled) throw new AgentSetupError(words.offline, { details: { step: 'npm_ci', stalled: true, idleTimeoutMs } });
    if (startError !== undefined) throw new AgentSetupError(words.failed, { details: { step: 'npm_ci', startError: errnoCode({ code: startError }) } });
    if (exitCode !== 0) throw new AgentSetupError(reasonFor(words, npmCode), { details: { step: 'npm_ci', exitCode, npmCode: npmCode ?? null } });
  } finally {
    clearTimeout(idle);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Renames `staging` to `target`. An existing copy is first moved aside (and
 * restored if the rename fails), so a failure never leaves no copy at all.
 */
async function moveIntoPlace(words: ReturnType<typeof wordsFor>, staging: string, target: string, aside: string, onCleanupError: (error: unknown) => void): Promise<void> {
  const hadPrevious = existsSync(target);
  // A folder Windows still holds (an antivirus scan of node_modules) gets longer than uv's to let go.
  if (hadPrevious) await renameWithRetry(target, aside, 10);
  try {
    await renameWithRetry(staging, target, 10);
  } catch (error) {
    if (hadPrevious) {
      try {
        await renameWithRetry(aside, target, 10);
      } catch (restoreError) {
        onCleanupError(restoreError);
      }
    }
    throw new AgentSetupError(words.couldNotPlace, {
      details: { step: 'rename', code: errnoCode(error) },
      cause: error,
    });
  }
}
