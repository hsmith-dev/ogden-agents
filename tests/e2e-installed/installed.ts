/**
 * The installed package the global setup started, as the tests see it. The
 * setup runs in Playwright's main process and hands its folders over through
 * the environment; `installed()` rebuilds the install around them, so a test
 * can run the installed launcher again (by its path in the npx install).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { echoLines, prepareInstall, startWithRetry, withTimeout, type Install, type LauncherRun } from '../../scripts/installed-package.mjs';
import { createDataFolder020, type DataFolder020 } from '../fixtures/data-folder-0.2.0.js';
import { packFakeAdapter, testNpmCli } from '../fixtures/fake-adapter/pack.mjs';
import { isAlive, readPortFile, ROOT, waitUntil } from '../support.js';

/**
 * Where the installed server looks for the Claude Agent ACP adapter
 * (`CLAUDE_ACP_PATH_ENV` in packages/server/src/start.ts): every server this
 * suite starts runs the fake agent, never a real one (story 2.13).
 */
export const CLAUDE_ACP_PATH_ENV = 'OGDEN_AGENTS_CLAUDE_ACP_PATH';
/** The fake ACP agent, able to resume a session (`via=resumed` after a restart). */
export const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent-installed.mjs');
/** The same, but it runs a command without asking for permission: the hold proof's agent. */
export const FAKE_AGENT_NO_HOLD = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent-no-hold.mjs');

/**
 * The installed server's test hooks (`packages/server/src/test-hooks.ts`,
 * story 9.7), honoured only because `prepareInstall` sets `NODE_ENV=test`:
 * Install's source (fixture pins and npm, in a JSON file) and an API key
 * check that accepts without reaching Anthropic.
 */
export const CLAUDE_INSTALL_ENV = 'OGDEN_AGENTS_TEST_CLAUDE_INSTALL';
export const API_KEY_CHECK_ENV = 'OGDEN_AGENTS_TEST_API_KEY_CHECK';
/** The fake agent itself, which the onboarding and terminal wrappers run. */
const FAKE_AGENT_CORE = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');
/** The fake `claude` CLI, which the terminal wrapper runs (story 3.10). */
const FAKE_CLI = join(ROOT, 'tests', 'fixtures', 'fake-claude-cli.mjs');
/**
 * The installed server's `claude` stand-in (`CLAUDE_CLI_ENV` in
 * packages/server/src/test-hooks.ts, story 3.10): the agents' and the
 * terminal's `CLAUDE_CODE_EXECUTABLE`, honoured only in a test run.
 */
export const CLAUDE_CLI_ENV = 'OGDEN_AGENTS_TEST_CLAUDE_CLI';

/** The variables every launcher run of a server with `agent` gets. */
export const agentEnv = (agent: string): Record<string, string> => ({ [CLAUDE_ACP_PATH_ENV]: agent });

export const ENV = {
  tarball: 'E2E_INSTALLED_TARBALL',
  workDir: 'E2E_INSTALLED_WORK_DIR',
  cacheDir: 'E2E_INSTALLED_CACHE_DIR',
  dataDir: 'E2E_INSTALLED_DATA_DIR',
  url: 'E2E_INSTALLED_URL',
  pid: 'E2E_INSTALLED_PID',
  startOutput: 'E2E_INSTALLED_START_OUTPUT',
  /**
   * The folder for the specs' own servers (a data folder each) and project
   * folders. The teardown stops any server still running from it and removes it.
   */
  extraDir: 'E2E_INSTALLED_EXTRA_DIR',
} as const;

/** The launcher arguments every run uses: no browser (the test drives its own), any free port. */
export const LAUNCHER_ARGS = ['--no-open', '--port', '0'];

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set; run through \`pnpm e2e:installed\``);
  return value;
}

export interface Installed {
  install: Install;
  /** The server's base URL, `http://127.0.0.1:<port>`. */
  url: string;
  /** The background server's pid, from its `server.json` at start. */
  pid: number;
  dataDir: string;
  /** What the first launcher run (the one that started the server) printed. */
  startOutput: string;
}

export function installed(): Installed {
  const dataDir = env(ENV.dataDir);
  const install = prepareInstall({
    tarball: env(ENV.tarball),
    prefix: 'ogden-agents-e2e',
    reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir },
    env: agentEnv(FAKE_AGENT),
  });
  return { install, url: env(ENV.url), pid: Number(env(ENV.pid)), dataDir, startOutput: env(ENV.startOutput) };
}

/** A new empty folder under the suite's extra folder (a data folder or a project folder), removed by the teardown. */
export function extraFolder(prefix: string): string {
  return mkdtempSync(join(env(ENV.extraDir), `${prefix}-`));
}

/**
 * The same installed package, set up for a server of a spec's own: its own
 * data folder (Welcome already done) and `agent`. Nothing is installed again: its launcher runs by
 * path (`runInstalledLauncher`). Never call its `removeFolders`, which would
 * remove the shared install; `stopOwnServer` cleans up.
 */
export function ownInstall(name: string, agent: string): Install {
  const dataDir = extraFolder(`${name}-data`);
  // These specs are not about the first run: Welcome is marked done, so a tab lands on Projects (story 9.5).
  // The first run on an installed package is journey.spec.ts's (Skip for now) and onboarding-journey.spec.ts's (story 9.7).
  writeFileSync(join(dataDir, 'onboarding.json'), `${JSON.stringify({ welcomeCompleted: true })}\n`, { mode: 0o600 });
  return prepareInstall({
    tarball: env(ENV.tarball),
    prefix: 'ogden-agents-e2e',
    reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir },
    env: agentEnv(agent),
  });
}

export interface UpgradeServer {
  /** The install, set up for this server: the 0.2.0 data folder (`data.dataDir`) and the fake agent. */
  install: Install;
  /** The data folder as 0.2.0 left it (`fixtures/data-folder-0.2.0.ts`), with its two projects' repos. */
  data: DataFolder020;
  /** Stops the server if it still runs, and removes the data folder and the repos. */
  remove(): Promise<void>;
}

/**
 * The same installed package on a data folder as 0.2.0 left it (story 10.7):
 * its database, as 0.2.0's migrations and server wrote it, and the
 * `onboarding.json` 0.2.0 writes once its Welcome is finished or skipped (or
 * when that state is first read with projects); no `preferences.json`. The
 * fake agent runs. Nothing is installed again.
 */
export function upgradeServer(name: string): UpgradeServer {
  const data = createDataFolder020({ dataDir: extraFolder(`${name}-data`) });
  const install = prepareInstall({
    tarball: env(ENV.tarball),
    prefix: 'ogden-agents-e2e',
    reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir: data.dataDir },
    env: agentEnv(FAKE_AGENT),
  });
  const remove = async () => {
    await stopOwnServer(install);
    try {
      data.remove();
    } catch {
      // Windows may still hold a handle briefly; the teardown removes the extra folder and reports what remains.
    }
  };
  return { install, data, remove };
}

export interface Launched {
  /** The server's base URL, `http://127.0.0.1:<port>`. */
  url: string;
  /** The one-time launch link the launcher printed. */
  launchUrl: string;
  /** The background server's pid. */
  pid: number;
  /** What the launcher printed. */
  output: string;
}

/** Runs the installed launcher of `install` in background mode, as a user does, and waits until it exits and the server is up. */
export async function launch(install: Install): Promise<Launched> {
  const run = install.runInstalledLauncher(LAUNCHER_ARGS);
  try {
    return await launched(install, run, await withTimeout(run.urls(), 60_000, 'the launcher to print its URLs'));
  } finally {
    await run.stop();
  }
}

/** Waits until the launcher `run` of `install`, which printed `printed`, exits and leaves the server up. */
async function launched(install: Install, run: LauncherRun, printed: { url: string; launchUrl: string }): Promise<Launched> {
  await withTimeout(run.exited, 15_000, 'the launcher to exit');
  if (run.child.exitCode !== 0) throw new Error(`the launcher exited with code ${run.child.exitCode}\n${run.output()}`);
  const record = install.readPortFile();
  if (record === undefined || !isAlive(record.pid)) throw new Error(`the background server is not running after the launcher exited\n${run.output()}`);
  return { ...printed, pid: record.pid, output: run.output() };
}

/** Waits until the server `pid` has exited (after Quit, say). */
export const waitForExit = (pid: number) => waitUntil(() => !isAlive(pid), `server ${pid} to exit`, 15_000);

/**
 * Stops whatever server is still running from a spec's own data folder (a
 * failed test may leave one), then removes the folder. A server that quit
 * leaves nothing to stop.
 */
export async function stopOwnServer(install: Install): Promise<void> {
  const pid = install.readPortFile()?.pid;
  install.killBackgroundServer();
  if (pid !== undefined) await waitForExit(pid).catch(() => {});
  try {
    rmSync(install.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Windows may still hold a handle briefly; the teardown removes the extra folder and reports what remains.
  }
}

/**
 * The teardown's sweep of the extra folder: kills every server still running
 * from a data folder in it, and returns their pids.
 */
export function killExtraServers(extraDir: string): number[] {
  const killed: number[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(extraDir);
  } catch {
    return killed;
  }
  for (const entry of entries) {
    const record = readPortFile(join(extraDir, entry));
    if (record === undefined || !isAlive(record.pid)) continue;
    try {
      process.kill(record.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    killed.push(record.pid);
  }
  return killed;
}

/** How the onboarding journey's Claude Code gets signed in: the fake login, or an API key. */
export type OnboardingSignIn = 'subscription' | 'apiKey';

export interface OnboardingServer {
  /** The install, set up for this server: its own data folder (nothing in it), home folder and Claude Code. */
  install: Install;
  /** The server's home folder (HOME, USERPROFILE, APPDATA, XDG_DATA_HOME under it): the folder browser starts here, and the app shortcut would go here. */
  home: string;
  /** The project folder, `<home>/Documents/<projectName>`. */
  project: string;
  projectName: string;
  /** The fake login's state file: present (`{"loggedIn":true}`) means signed in. */
  loginState: string;
  /** The fixture adapter's version, which Install installs. */
  fixtureVersion: string;
  /** Stops the server if it still runs, and removes every folder of it. */
  remove(): Promise<void>;
}

/**
 * A first-run server of the installed package for the onboarding journey
 * (story 9.7): a fresh data folder with nothing written in advance, so its
 * launch link lands on Welcome; its own home folder and project folder; and
 * no Claude Code until Install puts the fixture adapter in the data folder
 * (`OGDEN_AGENTS_CLAUDE_ACP_PATH` is left empty, else Install never runs).
 * The fixture is packed here with a wrapper whose fake-agent switches are
 * baked in (the server passes agents only an allowlisted environment): the
 * `claude-terminal` sign-in, the fake login's state file, and either a
 * sign-in (`subscription`) or an API key (`apiKey`) for every prompt.
 * Keys stay in memory (`prepareInstall`'s `OGDEN_AGENTS_TEST_SECRET_STORE`).
 */
export function onboardingServer(name: string, signIn: OnboardingSignIn): OnboardingServer {
  const dataDir = extraFolder(`${name}-data`);
  const work = extraFolder(`${name}-fixture`);
  // The real path: Windows temp folders may be 8.3 short names, which the folder browser shows long.
  const home = realpathSync.native(extraFolder(`${name}-home`));
  const projectName = `${name}-repo`;
  const project = join(home, 'Documents', projectName);
  mkdirSync(project, { recursive: true });
  const loginState = join(work, 'login-state.json');

  const switches: Record<string, string> = {
    FAKE_ACP_AUTH: 'claude-terminal',
    FAKE_LOGIN_STATE: loginState,
    // A resend after signing in again reopens the agent's own session (`via=resumed`).
    FAKE_ACP_RESUME: 'resume',
    ...(signIn === 'subscription' ? { FAKE_ACP_REQUIRE_LOGIN: loginState } : { FAKE_ACP_REQUIRE_API_KEY: '1' }),
  };
  const wrapper = join(work, 'agent.mjs');
  writeFileSync(wrapper, `Object.assign(process.env, ${JSON.stringify(switches)});\nawait import(${JSON.stringify(pathToFileURL(FAKE_AGENT_CORE).href)});\n`);
  const npmCli = testNpmCli();
  const { pins, version } = packFakeAdapter(join(work, 'pack'), { npmCli, agent: wrapper });
  const source = join(work, 'install.json');
  writeFileSync(source, `${JSON.stringify({ pins, npmCli })}\n`);

  const install = prepareInstall({
    tarball: env(ENV.tarball),
    prefix: 'ogden-agents-e2e',
    reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir },
    env: {
      // Empty: no adapter is given, so Install runs (start.ts reads an empty value as unset).
      [CLAUDE_ACP_PATH_ENV]: '',
      [CLAUDE_INSTALL_ENV]: source,
      [API_KEY_CHECK_ENV]: 'accept',
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CONFIG_HOME: join(home, '.config'),
    },
  });

  const remove = async () => {
    await stopOwnServer(install);
    for (const dir of [work, home]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Windows may still hold a handle briefly; the teardown removes the extra folder and reports what remains.
      }
    }
  };
  return { install, home, project, projectName, loginState, fixtureVersion: version, remove };
}

/** A script that sets `switches` in its environment, then runs `target` (the server passes agents only an allowlisted environment). */
function wrapper(file: string, switches: Record<string, string>, target: string): string {
  writeFileSync(file, `Object.assign(process.env, ${JSON.stringify(switches)});\nawait import(${JSON.stringify(pathToFileURL(target).href)});\n`);
  return file;
}

export interface TerminalServer {
  /** The project folder (its real path, as the CLI sees its working folder). */
  project: string;
  /** Starts the server in the background, as a user does (installing the package first for `omitOptional`). */
  launch(): Promise<Launched>;
  /** Stops the server if it still runs, and removes every folder of it. */
  remove(): Promise<void>;
  /** The server's own log (codes and timings, never what the terminal prints; AD-16), for a failed test's report. */
  serverLog(): string;
}

/** How long an install of its own may take to install and start (a registry stall on a CI runner is retried once). */
const FRESH_INSTALL_TIMEOUT_MS = 240_000;

/**
 * A server of the installed package for the terminal journey (story 3.10):
 * its own data folder (Welcome done), a home folder of its own (HOME,
 * USERPROFILE, APPDATA, LOCALAPPDATA and the XDG folders, so nothing reads
 * the user's own `~/.claude` or app folders), and a project. The chat's
 * agent is the fake ACP agent with `resume` and `FAKE_ACP_CLAUDE_RECORD` (it
 * records the chat's exchanges as Claude Code does); the terminal's `claude`
 * is the fake CLI, through the server's test hook. Both record in
 * `<home>/.claude`, where the server reads the session's record on switching
 * back. No real `claude` runs.
 *
 * `omitOptional`: an install of its own without optional dependencies
 * (`node-pty`, AD-19), in its own folders, with a fresh npm cache seeded from
 * the suite's. As in the global setup, npx's output is streamed and a stalled
 * install and start is retried once in fresh folders (`startWithRetry`).
 */
export function terminalServer(name: string, { omitOptional = false }: { omitOptional?: boolean } = {}): TerminalServer {
  const work = extraFolder(`${name}-fixture`);
  // Real paths: macOS temp folders are reached through /var, and Windows ones may be 8.3 short names.
  const home = realpathSync.native(extraFolder(`${name}-home`));
  const project = realpathSync.native(extraFolder(`${name}-repo`));
  const claudeConfig = join(home, '.claude');
  const agent = wrapper(join(work, 'agent.mjs'), { FAKE_ACP_RESUME: 'resume', FAKE_ACP_CLAUDE_RECORD: '1', CLAUDE_CONFIG_DIR: claudeConfig }, FAKE_AGENT_CORE);
  const cli = wrapper(join(work, 'claude.mjs'), { CLAUDE_CONFIG_DIR: claudeConfig }, FAKE_CLI);
  const serverEnv = {
    [CLAUDE_ACP_PATH_ENV]: agent,
    [CLAUDE_CLI_ENV]: cli,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CONFIG_HOME: join(home, '.config'),
  };

  /** A data folder of its own, Welcome done (these servers are not about the first run). */
  const newDataDir = () => {
    const dataDir = extraFolder(`${name}-data`);
    writeFileSync(join(dataDir, 'onboarding.json'), `${JSON.stringify({ welcomeCompleted: true })}\n`, { mode: 0o600 });
    return dataDir;
  };
  /** Fresh folders for an install of its own, its npm cache seeded from the suite's (all under the extra folder). */
  const freshInstall = () => {
    const cacheDir = extraFolder(`${name}-cache`);
    const shared = join(env(ENV.cacheDir), '_cacache');
    if (existsSync(shared)) cpSync(shared, join(cacheDir, '_cacache'), { recursive: true });
    return prepareInstall({
      tarball: env(ENV.tarball),
      prefix: 'ogden-agents-e2e',
      reuse: { workDir: extraFolder(`${name}-work`), cacheDir, dataDir: newDataDir() },
      omitOptional: true,
      env: serverEnv,
    });
  };

  let install: Install = omitOptional
    ? freshInstall()
    : prepareInstall({
        tarball: env(ENV.tarball),
        prefix: 'ogden-agents-e2e',
        reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir: newDataDir() },
        env: serverEnv,
      });

  const launchFresh = async (): Promise<Launched> => {
    let first = true;
    const start = () => {
      // The retry gets fresh folders (the first ones are removed by `startWithRetry`).
      if (!first) install = freshInstall();
      first = false;
      console.log(`e2e:installed: installing ${env(ENV.tarball)} without optional dependencies in ${install.workDir}`);
      return { install, launcher: install.runLauncher(LAUNCHER_ARGS, { echo: echoLines() }) };
    };
    const run = startWithRetry({ start, timeoutMs: FRESH_INSTALL_TIMEOUT_MS, what: 'the launcher to print its URLs', label: 'e2e:installed' });
    try {
      return await launched(run.install, run.launcher, await run.ready);
    } finally {
      await run.launcher.stop();
    }
  };

  const remove = async () => {
    await stopOwnServer(install);
    const own = omitOptional ? [install.workDir, install.cacheDir] : [];
    for (const dir of [work, home, project, ...own]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Windows may still hold a handle briefly; the teardown removes the extra folder and reports what remains.
      }
    }
  };
  return { project, launch: () => (omitOptional ? launchFresh() : launch(install)), remove, serverLog: () => join(install.dataDir, 'logs', 'server.log') };
}
