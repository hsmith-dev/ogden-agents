// Installing and launching the packed tarball (or a published version) the way
// a user does, in an empty folder, with a fresh npm cache and a temp data
// folder, and cleaning all of it up afterwards. Shared by the clean-install
// smoke test (`scripts/smoke-installed.mjs`) and the end-to-end suite against
// the installed package (`tests/e2e-installed/`).
//
// The first run of the launcher is `npx --yes --package=<tgz> ogden <args>`
// (or `npx --yes <spec> <args>` for a registry spec), which installs it. Later
// runs can start the installed `bin/ogden.js` by its path instead, so npx never
// reinstalls over the package a running server was started from.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const IS_WINDOWS = process.platform === 'win32';

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, what) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Hides one-time launch codes: they are secrets (AD-15), and CI logs are kept.
 * @param {string} text
 */
export function redact(text) {
  return text.replace(/#c=[A-Za-z0-9_-]+/g, '#c=<code>');
}

/**
 * Prints the launcher's (and npx's) output as it arrives, line by line, redacted.
 * @returns {(chunk: string) => void}
 */
export function echoLines() {
  let partial = '';
  /** @param {string} chunk */
  return (chunk) => {
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) if (line.trim() !== '') console.log(`  | ${redact(line)}`);
  };
}

/**
 * @typedef {object} StartedInstall
 * @property {Install} install the install in use now (a retry's, after one)
 * @property {LauncherRun} launcher its launcher run
 * @property {Promise<{ url: string, launchUrl: string }>} ready the printed URLs; rejects as the start failed
 */

/**
 * Starts an install (`start`) and waits up to `timeoutMs` for its launcher to
 * print its URLs. A start that stalls past that (a registry stall on a CI
 * runner, most likely) is retried once in fresh folders, with a log line
 * saying so; any other failure is not retried (retrospective A6: one copy
 * for the smoke and the installed-package suite). `install` and `launcher`
 * always name the current run, so the caller can clean it up and show its
 * output whatever happens.
 * @param {{ start: () => { install: Install, launcher: LauncherRun }, timeoutMs: number, what: string, label: string }} options
 *   `what` names the wait in a timeout's message; `label` starts the retry's log line
 * @returns {StartedInstall}
 */
export function startWithRetry({ start, timeoutMs, what, label }) {
  const first = start();
  /** @type {StartedInstall} */
  const run = { install: first.install, launcher: first.launcher, ready: Promise.resolve({ url: '', launchUrl: '' }) };
  run.ready = (async () => {
    try {
      return await withTimeout(run.launcher.urls(), timeoutMs, what);
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith('timed out'))) throw error;
      console.log(`${label}: RETRY: npx install and start stalled (${error.message}); retrying once in fresh folders`);
      await run.launcher.stop();
      run.install.killBackgroundServer();
      run.install.removeFolders();
      ({ install: run.install, launcher: run.launcher } = start());
      return await withTimeout(run.launcher.urls(), timeoutMs, `${what} (retry)`);
    }
  })();
  // The caller awaits it; this keeps a failure before then from going unhandled.
  run.ready.catch(() => undefined);
  return run;
}

/** @param {number} pid */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/** `taskkill.exe` by absolute path, so no `PATH` entry can stand in for it (as `packages/adapters/src/process-tree.ts`). */
function taskkillPath() {
  return join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'taskkill.exe');
}

/**
 * One `ps` listing as parent links: each pid's parent. POSIX only; empty when `ps` fails.
 * @returns {Map<number, number>}
 */
function parentLinks() {
  /** @type {Map<number, number>} */
  const parents = new Map();
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (listing.status !== 0 || typeof listing.stdout !== 'string') return parents;
  for (const line of listing.stdout.split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(child) && Number.isInteger(parent)) parents.set(/** @type {number} */ (child), /** @type {number} */ (parent));
  }
  return parents;
}

/**
 * Every descendant of `pid` (children, their children, and so on) in `parents`.
 * @param {number} pid
 * @param {Map<number, number>} parents
 * @returns {number[]}
 */
function descendantsIn(pid, parents) {
  /** @type {Map<number, number[]>} */
  const children = new Map();
  for (const [child, parent] of parents) children.set(parent, [...(children.get(parent) ?? []), child]);
  /** @type {number[]} */
  const found = [];
  const queue = [pid];
  while (queue.length > 0) {
    for (const child of children.get(/** @type {number} */ (queue.shift())) ?? []) {
      if (child === pid || found.includes(child)) continue;
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/**
 * This process and its ancestors (up the parent chain) in `parents`.
 * @param {Map<number, number>} parents
 * @returns {Set<number>}
 */
function selfAndAncestorsIn(parents) {
  const chain = new Set([process.pid]);
  let current = process.ppid;
  while (current > 0 && !chain.has(current)) {
    chain.add(current);
    current = parents.get(current) ?? 0;
  }
  return chain;
}

/**
 * Every descendant of `pid` (children, their children, and so on), from one
 * `ps` listing. POSIX only.
 * @param {number} pid
 * @returns {number[]}
 */
export function descendantsOf(pid) {
  return descendantsIn(pid, parentLinks());
}

/**
 * Kills `pid` and everything it started (3.10 F7): the installed server with
 * its agents (each in a process group of its own) and its terminal's CLI (in
 * a PTY's session). On Windows `taskkill /T /F` by absolute path. On POSIX
 * every descendant is listed first (a killed parent's children are handed to
 * init, and could no longer be found), then the root and each descendant are
 * `SIGKILL`ed, with the process group each leads. Does nothing for a bad pid,
 * this process or one of its ancestors (a stale pid reused), and never kills
 * them as descendants either; a tree already gone is not an error.
 * @param {number} pid
 */
export function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (IS_WINDOWS) {
    spawnSync(taskkillPath(), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  const parents = parentLinks();
  // A stale `server.json` pid reused by this process or one of its ancestors (the test runner, its shell): never kill those.
  const self = selfAndAncestorsIn(parents);
  if (self.has(pid)) return;
  const descendants = descendantsIn(pid, parents).filter((each) => !self.has(each));
  for (const each of [pid, ...descendants]) {
    // Its group, if it leads one (an agent spawned detached, a PTY's shell): anything started since the listing goes too.
    try {
      process.kill(-each, 'SIGKILL');
    } catch {
      // It leads no group, or the group is gone.
    }
    try {
      process.kill(each, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * The running server's port file (`server.json`) in `dataDir`, or undefined.
 * @param {string} dataDir
 * @returns {{ port: number, pid: number, version: string } | undefined}
 */
export function readPortFile(dataDir) {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'server.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * @typedef {object} LauncherRun
 * @property {import('node:child_process').ChildProcess} child
 * @property {() => string} output everything the launcher (and npx) printed so far
 * @property {Promise<void>} exited resolves once the process closed and its output is all read
 * @property {() => boolean} hasExited
 * @property {() => Promise<{ url: string, launchUrl: string }>} urls the printed server URL and one-time launch link
 * @property {() => Promise<void>} stop stops the launcher and everything it started (npx, npm), but not the background server
 */

/**
 * @typedef {object} Install
 * @property {string} workDir the empty folder npx runs in
 * @property {string} cacheDir the fresh npm cache (npx installs the package under it)
 * @property {string} dataDir the temp data folder (`OGDEN_AGENTS_DATA_DIR`)
 * @property {Record<string, string | undefined>} env the environment every launcher run gets
 * @property {(launcherArgs: string[], options?: { echo?: (chunk: string) => void }) => LauncherRun} runLauncher runs the launcher through npx, as a user does (installing it first if needed); `echo` receives its output (npm's progress included) as it arrives
 * @property {(launcherArgs: string[]) => LauncherRun} runInstalledLauncher runs the already installed `bin/ogden.js` by its absolute path, with this Node: no npx, so nothing is reinstalled under a running server
 * @property {() => { port: number, pid: number, version: string } | undefined} readPortFile the running server's `server.json`
 * @property {() => boolean} killBackgroundServer kills the background server if one is still running, with every process it started (`killProcessTree`); true if it had to
 * @property {(name: string) => any} requireInstalled loads a dependency of the installed package (such as `ws`)
 * @property {() => void} checkNoAgentAdapter throws if the installed package declares or pulled in an agent adapter (story 2.2)
 * @property {() => void} removeFolders removes the work folder, the npm cache and the data folder (best effort)
 */

/**
 * @typedef {{ workDir: string, cacheDir: string, dataDir: string }} InstallFolders
 */

/**
 * Agent adapters are not dependencies of the package (story 2.2): the Claude
 * Agent ACP adapter and its Agent SDK add about 230 MB, and onboarding
 * installs them on demand. Only the ACP client SDK ships.
 */
export const AGENT_ADAPTER_PACKAGES = [
  '@agentclientprotocol/claude-agent-acp',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/claude-code',
  '@agentclientprotocol/codex-acp',
];

/** @param {string} name */
const isAgentAdapter = (name) => AGENT_ADAPTER_PACKAGES.some((adapter) => name === adapter || name.startsWith(`${adapter}-`));

/**
 * Prepares an empty work folder, npm cache and data folder for installing
 * `tarball` (a path) or `registrySpec` (such as `ogden-agents@0.1.0`).
 * `reuse` picks up the folders of an earlier `prepareInstall` (in another
 * process, say) instead of making new ones. `omitOptional` installs without
 * optional dependencies (`node-pty`, AD-19), as on a computer where they
 * can't build. `env` adds variables to every launcher run, after the ones set
 * here (the installed-package suite's fake agent, story 2.13).
 * @param {{ tarball?: string, registrySpec?: string, prefix?: string, reuse?: InstallFolders, omitOptional?: boolean, env?: Record<string, string> }} options
 * @returns {Install}
 */
export function prepareInstall({ tarball, registrySpec, prefix = 'ogden-agents-smoke', reuse, omitOptional = false, env: extraEnv = {} }) {
  if ((tarball === undefined) === (registrySpec === undefined)) throw new Error('prepareInstall needs exactly one of tarball and registrySpec');
  const workDir = reuse?.workDir ?? mkdtempSync(join(tmpdir(), `${prefix}-`));
  const cacheDir = reuse?.cacheDir ?? mkdtempSync(join(tmpdir(), `${prefix}-cache-`));
  const dataDir = reuse?.dataDir ?? mkdtempSync(join(tmpdir(), `${prefix}-data-`));

  // A clean environment for npm: drop any npm/pnpm config inherited from a
  // `pnpm run` parent, and use an empty cache so no earlier install is reused.
  /** @type {Record<string, string | undefined>} */
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm|pnpm)_/i.test(key)));
  env.npm_config_cache = cacheDir;
  env.npm_config_update_notifier = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_audit = 'false';
  // Log each registry fetch, so a slow or stalled install shows progress
  // (and what it was waiting on) instead of nothing.
  env.npm_config_loglevel = 'http';
  if (omitOptional) env.npm_config_omit = 'optional';
  // Keep the database and logs out of the user's real data folder.
  env.OGDEN_AGENTS_DATA_DIR = dataDir;
  // And API keys out of the real OS keychain: the server keeps them in memory
  // (story 9.2). The server honours that only in a test run, hence NODE_ENV.
  env.OGDEN_AGENTS_TEST_SECRET_STORE = 'memory';
  env.NODE_ENV = 'test';
  Object.assign(env, extraEnv);

  // A registry spec runs as a user types it: npx picks the package's only bin.
  const packageArgs = registrySpec === undefined ? ['--yes', `--package=${tarball}`, 'ogden'] : ['--yes', registrySpec];

  // On Windows `npx` is `npx.cmd`. Run through a shell by a quoted bare name, cmd.exe
  // resolves the batch file's own folder (%~dp0) to the current directory, so npx
  // looks for npm inside the empty work dir. Instead run npm's `npx-cli.js` directly
  // with this Node, which ships npm beside it; no shell and no quoting needed.
  const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (IS_WINDOWS && !existsSync(npxCli)) throw new Error(`npx not found beside Node at ${npxCli}`);

  /**
   * @param {string[]} launcherArgs
   * @param {{ echo?: (chunk: string) => void }} [options]
   */
  function runLauncher(launcherArgs, { echo } = {}) {
    const args = [...packageArgs, ...launcherArgs];
    return track(IS_WINDOWS ? spawnNode([npxCli, ...args]) : spawn('npx', args, { cwd: workDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), echo);
  }

  /** @param {string[]} launcherArgs */
  function runInstalledLauncher(launcherArgs) {
    const bin = join(installedDir('ogden-agents'), 'bin', 'ogden.js');
    if (!existsSync(bin)) throw new Error(`the installed launcher is missing: ${bin}`);
    return track(spawnNode([bin, ...launcherArgs]));
  }

  /** @param {string[]} args */
  function spawnNode(args) {
    // Detached on POSIX so `stop` can end the whole process group.
    return spawn(process.execPath, args, { cwd: workDir, env, detached: !IS_WINDOWS, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  }

  /**
   * @param {import('node:child_process').ChildProcessByStdio<null, import('node:stream').Readable, import('node:stream').Readable>} child
   * @param {(chunk: string) => void} [echo]
   * @returns {LauncherRun}
   */
  function track(child, echo) {
    let output = '';
    /** @param {unknown} chunk */
    const collect = (chunk) => {
      output += String(chunk);
      echo?.(String(chunk));
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => collect(`\n(spawn error: ${error.message})\n`));
    // `close`, not `exit`: the launcher prints its URLs and exits at once, and
    // `close` fires only after its output has all been read.
    /** @type {Promise<void>} */
    const exited = new Promise((resolveExit) => child.once('close', () => resolveExit()));
    let childExited = false;
    void exited.then(() => (childExited = true));

    /** @returns {Promise<{ url: string, launchUrl: string }>} */
    const urls = () =>
      new Promise((resolveUrl, reject) => {
        const check = () => {
          const url = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
          const launchUrl = /one-time link: (http:\/\/127\.0\.0\.1:\d+\/#c=[A-Za-z0-9_-]+)/.exec(output)?.[1];
          if (url !== undefined && launchUrl !== undefined) resolveUrl({ url, launchUrl });
          return url !== undefined && launchUrl !== undefined;
        };
        child.stdout?.on('data', check);
        void exited.then(() => {
          if (!check()) reject(new Error(`ogden-agents exited before printing a URL (code ${child.exitCode})`));
        });
        check();
      });

    /** Stops npx and everything it started (npm, the shell, the launcher). */
    const stop = async () => {
      if (childExited || child.pid === undefined) return;
      if (IS_WINDOWS) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // The group is already gone.
        }
      }
      try {
        await withTimeout(exited, 10_000, 'process tree to stop');
      } catch {
        if (!IS_WINDOWS) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      }
    };

    return { child, output: () => output, exited, hasExited: () => childExited, urls, stop };
  }

  function killBackgroundServer() {
    const record = readPortFile(dataDir);
    if (record === undefined || !isAlive(record.pid)) return false;
    // The whole tree (3.10 F7): agents run in process groups of their own and the terminal's CLI in a PTY,
    // so killing the server alone could leave them holding the data and project folders (on Windows above all).
    killProcessTree(record.pid);
    return true;
  }

  /**
   * The folder npx installed package `name` in (the package itself or one of its dependencies).
   * @param {string} name
   */
  function installedDir(name) {
    const npxDir = join(cacheDir, '_npx');
    for (const entry of existsSync(npxDir) ? readdirSync(npxDir) : []) {
      const dir = join(npxDir, entry, 'node_modules', name);
      if (existsSync(join(dir, 'package.json'))) return dir;
    }
    throw new Error(`${name} is not installed under ${npxDir}`);
  }

  /** @param {string} name */
  function requireInstalled(name) {
    return createRequire(join(installedDir(name), 'package.json'))(name);
  }

  function checkNoAgentAdapter() {
    const packageDir = installedDir('ogden-agents');
    const { dependencies = {}, optionalDependencies = {} } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const declared = [...Object.keys(dependencies), ...Object.keys(optionalDependencies)].filter(isAgentAdapter);
    if (declared.length > 0) throw new Error(`the package depends on agent adapters: ${declared.join(', ')}`);
    const modules = dirname(packageDir);
    const installed = [];
    for (const scope of new Set(AGENT_ADAPTER_PACKAGES.map((name) => /** @type {string} */ (name.split('/')[0])))) {
      if (!existsSync(join(modules, scope))) continue;
      for (const name of readdirSync(join(modules, scope))) if (isAgentAdapter(`${scope}/${name}`)) installed.push(`${scope}/${name}`);
    }
    if (installed.length > 0) throw new Error(`installing the package pulled in agent adapters: ${installed.join(', ')}`);
  }

  function removeFolders() {
    for (const dir of [workDir, cacheDir, dataDir]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Best effort: Windows may still hold a handle briefly.
      }
    }
  }

  return {
    workDir,
    cacheDir,
    dataDir,
    env,
    runLauncher,
    runInstalledLauncher,
    readPortFile: () => readPortFile(dataDir),
    killBackgroundServer,
    requireInstalled,
    checkNoAgentAdapter,
    removeFolders,
  };
}
