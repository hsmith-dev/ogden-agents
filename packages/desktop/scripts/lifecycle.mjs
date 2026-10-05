// The built app's lifecycle against the OS (story 13.5, E13-R4), run in CI beside smoke.mjs:
//
//   A. a second launch focuses the first window and starts no second server
//   B. quit with an idle server leaves no Ogden, Node or agent process
//   C. an npm-started server is attached to, never stopped by the app, and still runs after quit
//   D. quit with a busy fake session asks first; "keep working" leaves everything running, and
//      "quit anyway" stops the server AND the agent's own child (spike 13.1: a process-group kill
//      left it behind on macOS)
//   E. killing the shell itself leaves nothing running (a Windows job object; elsewhere the server
//      follows the closed pipe)
//
//   node packages/desktop/scripts/lifecycle.mjs --target <triple> --app <.app | exe> | --installer <setup.exe>
//
// A private data folder per scenario, the fake ACP agent, no network, no real agent or keychain.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { appExecutable, installNsis, IS_WIN, killApps, killSidecars, launchApp, listApps, listSidecars, newWorkspace, readReport, sleep, waitFor, writeQuit } from './app-harness.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' }, installer: { type: 'string' }, target: { type: 'string' } }, strict: true });
if ((!values.app && !values.installer) || !values.target) {
  console.error('usage: lifecycle.mjs --target <triple> (--app <path> | --installer <setup.exe>)');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const repo = resolve(desktop, '..', '..');
const sidecar = join(desktop, 'src-tauri', 'binaries', `ogden-node-${values.target}${IS_WIN ? '.exe' : ''}`);
const staged = join(desktop, 'stage', 'app', 'node_modules', 'ogden-agents');
const FAKE_AGENT = join(repo, 'tests', 'fixtures', 'fake-acp-agent-installed.mjs');

let exe;
if (values.installer) {
  const dir = join(tmpdir(), `ogden-lifecycle-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  exe = installNsis(values.installer, dir);
} else exe = appExecutable(values.app);

const before = new Set(listSidecars().map((p) => p.pid));
const appsBefore = new Set(listApps().map((p) => p.pid));
const cleanups = [];
const results = [];
const events = (ws, ev) => readReport(ws.report).filter((e) => e.ev === ev);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
const noSidecars = () => listSidecars(before).length === 0;

/** A fake agent whose process also starts a long-lived child, as the real adapter starts `claude`. */
function agentWrapper(dir) {
  const file = join(dir, 'agent.mjs');
  writeFileSync(file, `process.env.FAKE_ACP_SPAWN_GRANDCHILD = '1';\nawait import(${JSON.stringify(pathToFileURL(FAKE_AGENT).href)});\n`);
  return file;
}

/** An app with its own data folder and the fake agent; waits until the page loaded. */
async function startApp(name, extraEnv = {}) {
  const ws = newWorkspace(`ogden-lifecycle-${name}-`);
  const child = launchApp(exe, ws, { NODE_ENV: 'test', OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', OGDEN_AGENTS_OFFLINE: '1', OGDEN_AGENTS_CLAUDE_ACP_PATH: agentWrapper(ws.root), ...extraEnv });
  cleanups.push(() => child.kill());
  await waitFor(`${name}: the page`, () => events(ws, 'page_finished').length > 0 || events(ws, 'server_error').length > 0, 120_000).catch((error) => {
    // What the shell reported and what is running, so a start that never finished can be told from a start that was handed to an old app.
    console.error('shell report:', JSON.stringify(readReport(ws.report).map((e) => ({ ev: e.ev, ...e.data }))));
    if (process.platform !== 'win32') console.error('processes:', spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /ogden|AppRun|appimage|WebKit|Xvfb/i.test(l)).join('\n'));
    throw error;
  });
  if (events(ws, 'server_error').length > 0) throw new Error(`${name}: ${JSON.stringify(events(ws, 'server_error')[0].data)}`);
  const ready = events(ws, 'server_ready')[0].data;
  return { ws, child, port: ready.port, owned: ready.owned, url: `http://127.0.0.1:${ready.port}` };
}

/** A tab token the way the page gets one: a launch link from the launcher handshake, exchanged. */
async function tabOf(app) {
  const token = readFileSync(join(app.ws.data, 'launcher.token'), 'utf8').trim();
  const hello = await (await fetch(`${app.url}/launcher/hello?launch=1`, { headers: { 'x-ogden-launcher-token': token } })).json();
  const code = new URL(hello.launchUrl).hash.replace(/^#c=/, '');
  const res = await fetch(`${app.url}/api/v1/tab/exchange`, { method: 'POST', headers: { origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  if (res.status !== 200) throw new Error(`tab exchange answered ${res.status}`);
  const tab = (await res.json()).token;
  const headers = { authorization: `Bearer ${tab}`, origin: app.url, 'content-type': 'application/json' };
  return { pid: hello.pid, headers, post: (path, body) => fetch(`${app.url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }) };
}

/** A project and a chat whose turn is still running ("slow" waits up to 10 s). */
async function startBusyTurn(app) {
  const tab = await tabOf(app);
  const folder = mkdtempSync(join(tmpdir(), 'ogden-lifecycle-project-'));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const ws = await (await tab.post('/api/v1/workspaces', { path: folder })).json();
  const wsId = ws.workspace.id;
  const ses = await (await tab.post(`/api/v1/workspaces/${wsId}/sessions`, {})).json();
  const sent = await tab.post(`/api/v1/workspaces/${wsId}/sessions/${ses.session.id}/messages`, { text: 'slow' });
  if (sent.status >= 300) throw new Error(`the message was refused (${sent.status}): ${await sent.text()}`);
  return tab;
}

async function scenario(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {
        // Already gone.
      }
    }
    killSidecars(before);
    killApps(appsBefore);
    // The single-instance lock is held until the old app is really gone: wait for it before the next scenario starts one.
    await waitFor('the last scenario\'s app to be gone', () => listApps(appsBefore).length === 0, 20_000).catch(() => {});
    await sleep(1500);
  }
}

await scenario('A. a second launch focuses the first window and starts no second server', async () => {
  const app = await startApp('second');
  // Short-lived helpers (the server's start-up probes) come and go for a few seconds; compare once they have.
  await sleep(6000);
  const pids = listSidecars(before).map((p) => p.pid).sort();
  const second = spawn(exe, [], { stdio: 'ignore', env: { ...process.env, OGDEN_AGENTS_DATA_DIR: app.ws.data, OGDEN_DESKTOP_TEST_REPORT: app.ws.report } });
  const exit = await Promise.race([new Promise((r) => second.once('exit', r)), sleep(30_000).then(() => 'timeout')]);
  if (exit === 'timeout') {
    second.kill();
    throw new Error('the second launch did not exit');
  }
  await waitFor('the first app to hear about it', () => events(app.ws, 'second_launch').length > 0, 15_000);
  if (events(app.ws, 'shell_start').length !== 1) throw new Error(`expected one shell start, saw ${events(app.ws, 'shell_start').length}`);
  const after = listSidecars(before).map((p) => p.pid).sort();
  if (JSON.stringify(after) !== JSON.stringify(pids)) throw new Error(`the server processes changed: ${pids} then ${after}`);
  // B. quit with an idle server leaves nothing.
  writeQuit(app.ws);
  await Promise.race([app.child.exited, sleep(30_000)]);
  await waitFor('B. no ogden-node after quit', noSidecars, 20_000);
});

await scenario('C. an npm-started server is attached to, kept running, and not stopped by the app', async () => {
  const ws = newWorkspace('ogden-lifecycle-npm-');
  // The npm route: the same launcher, no shell mode, so its server is not tied to it.
  const env = { ...process.env, OGDEN_AGENTS_DATA_DIR: ws.data, NODE_ENV: 'test', OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', OGDEN_AGENTS_OFFLINE: '1', OGDEN_AGENTS_CLAUDE_ACP_PATH: agentWrapper(ws.root) };
  delete env.OGDEN_AGENTS_SHELL;
  const run = spawnSync(sidecar, [join(staged, 'bin', 'ogden.js'), '--json', '--no-open', '--port', '0'], { env, encoding: 'utf8', timeout: 90_000, windowsHide: true });
  const info = JSON.parse(run.stdout.trim().split('\n')[0]);
  if (info.owned) throw new Error('the npm-route launcher claimed to own its server');
  cleanups.push(() => (alive(info.pid) ? (IS_WIN ? spawnSync('taskkill', ['/pid', String(info.pid), '/T', '/F']) : process.kill(info.pid, 'SIGKILL')) : undefined));
  const child = launchApp(exe, ws, { NODE_ENV: 'test', OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', OGDEN_AGENTS_OFFLINE: '1' });
  cleanups.push(() => child.kill());
  await waitFor('the app to attach', () => events(ws, 'page_finished').length > 0 || events(ws, 'server_error').length > 0, 120_000);
  const ready = events(ws, 'server_ready')[0]?.data;
  if (!ready || ready.owned !== false || ready.port !== info.port) throw new Error(`the app did not attach: ${JSON.stringify(ready)}`);
  writeQuit(ws);
  await Promise.race([child.exited, sleep(30_000)]);
  if (events(ws, 'quit_not_ours').length === 0) throw new Error('quit did not say the server was not the app\'s');
  await sleep(1500);
  if (!alive(info.pid)) throw new Error('the npm-started server stopped with the app');
  // Stop it as the page would.
  const app = { ws, url: info.url };
  const tab = await tabOf(app);
  if ((await tab.post('/api/v1/server/quit', {})).status !== 202) throw new Error('could not stop the npm-started server afterwards');
  await waitFor('the npm-started server to stop', () => !alive(info.pid), 20_000);
});

await scenario('D1. quit with a busy session asks first, and keeping work going leaves everything running', async () => {
  const app = await startApp('busy-keep', { OGDEN_DESKTOP_TEST_CONFIRM: 'keep' });
  await startBusyTurn(app);
  await waitFor('the agent and its child', () => listSidecars(before).length >= 3, 30_000);
  writeQuit(app.ws);
  await waitFor('the question', () => events(app.ws, 'confirm_asked').length > 0, 30_000);
  await waitFor('the quit to be cancelled', () => events(app.ws, 'quit_cancelled').length > 0, 15_000);
  if (app.child.exitCode !== null) throw new Error('the app quit although the user said to keep working');
  if (listSidecars(before).length < 3) throw new Error('the server or the agent stopped although the user said to keep working');
});

await scenario('D2. "quit anyway" stops the server and the agent and its child', async () => {
  const app = await startApp('busy-quit', { OGDEN_DESKTOP_TEST_CONFIRM: 'quit' });
  await startBusyTurn(app);
  await waitFor('the agent and its child', () => listSidecars(before).length >= 3, 30_000);
  writeQuit(app.ws);
  await waitFor('the question', () => events(app.ws, 'confirm_asked').length > 0, 30_000);
  const exit = await Promise.race([app.child.exited, sleep(60_000).then(() => 'timeout')]);
  if (exit === 'timeout') throw new Error('the app did not quit after "quit anyway"');
  await waitFor('no ogden-node (server, agent or its child) after quit', noSidecars, 20_000);
});

await scenario('E. killing the shell leaves nothing running', async () => {
  const app = await startApp('crash');
  await startBusyTurn(app);
  await waitFor('the agent and its child', () => listSidecars(before).length >= 3, 30_000);
  // The shell itself, found by its program name (an AppImage's launcher is a different process that forks it).
  for (const { pid } of listApps(appsBefore)) {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/F']);
    else process.kill(pid, 'SIGKILL');
  }
  await waitFor('no ogden-node after the shell was killed', noSidecars, 45_000);
});

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify(results, null, 1));
process.exit(failed.length > 0 ? 1 : 0);
