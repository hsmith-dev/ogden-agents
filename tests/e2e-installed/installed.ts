/**
 * The installed package the global setup started, as the tests see it. The
 * setup runs in Playwright's main process and hands its folders over through
 * the environment; `installed()` rebuilds the install around them, so a test
 * can run the installed launcher again (by its path in the npx install).
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareInstall, withTimeout, type Install } from '../../scripts/installed-package.mjs';
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
  // The first run on an installed package is journey.spec.ts's.
  writeFileSync(join(dataDir, 'onboarding.json'), `${JSON.stringify({ welcomeCompleted: true })}\n`, { mode: 0o600 });
  return prepareInstall({
    tarball: env(ENV.tarball),
    prefix: 'ogden-agents-e2e',
    reuse: { workDir: env(ENV.workDir), cacheDir: env(ENV.cacheDir), dataDir },
    env: agentEnv(agent),
  });
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
    const printed = await withTimeout(run.urls(), 60_000, 'the launcher to print its URLs');
    await withTimeout(run.exited, 15_000, 'the launcher to exit');
    if (run.child.exitCode !== 0) throw new Error(`the launcher exited with code ${run.child.exitCode}\n${run.output()}`);
    const record = install.readPortFile();
    if (record === undefined || !isAlive(record.pid)) throw new Error(`the background server is not running after the launcher exited\n${run.output()}`);
    return { ...printed, pid: record.pid, output: run.output() };
  } finally {
    await run.stop();
  }
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
