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

/** @param {number} pid */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
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
 * @property {() => boolean} killBackgroundServer kills the background server if one is still running; true if it had to
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
 * process, say) instead of making new ones.
 * @param {{ tarball?: string, registrySpec?: string, prefix?: string, reuse?: InstallFolders }} options
 * @returns {Install}
 */
export function prepareInstall({ tarball, registrySpec, prefix = 'ogden-agents-smoke', reuse }) {
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
  // Keep the database and logs out of the user's real data folder.
  env.OGDEN_AGENTS_DATA_DIR = dataDir;

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
    try {
      process.kill(record.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
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
