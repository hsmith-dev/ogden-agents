// The app updating itself, end to end against a local fake release (story 13.10, E13-R6; 13.13 reuses it).
//
//   node packages/desktop/scripts/update-e2e.mjs --app <installed app N> --bundle <N+1 build outputs>
//        --version-next 0.5.1 --target <rust triple>
//
// The installed app N (a test build, signed for the updater with a throwaway key whose public key it
// carries) reads a local fake release server (tests/fixtures/fake-release-server) serving N+1:
//   S0  on the stable channel, a release only the next channel has is not offered
//   S1  on the next channel: N finds N+1, downloads and verifies it, the page is told, Restart is
//       refused while a fake agent turn runs, goes ahead when it ends, and N+1 opens with the data intact
//   S2  a bad signature is refused with N still running and the reason told to the page
//   S3  a bad checksum is refused the same way
// Private data folders, no real agent, network or keychain.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { appExecutable, IS_WIN, killSidecars, launchApp, listSidecars, newWorkspace, readReport, sleep, waitFor, writeQuit } from './app-harness.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' }, bundle: { type: 'string' }, 'version-next': { type: 'string' }, target: { type: 'string' } }, strict: true });
for (const k of ['app', 'bundle', 'version-next', 'target']) {
  if (!values[k]) {
    console.error('usage: update-e2e.mjs --app <path> --bundle <dir> --version-next <v> --target <triple>');
    process.exit(2);
  }
}
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const FAKE_AGENT = join(repo, 'tests', 'fixtures', 'fake-acp-agent-installed.mjs');
const SERVER = join(repo, 'tests', 'fixtures', 'fake-release-server', 'serve.mjs');
const exe = appExecutable(values.app);
const nextVersion = values['version-next'];
const before = new Set(listSidecars().map((p) => p.pid));
const events = (ws, ev) => readReport(ws.report).filter((e) => e.ev === ev);
const cleanups = [];
/** Fake release servers: kept for the whole run (an app is stopped after each scenario, a server is not). */
const servers = [];
const results = [];
/** The app of the scenario running, so a failure can show what the shell reported. */
let current;

// 1. The release folder the fake server serves: N+1's update artifacts, their sums and a manifest.
const release = mkdtempSync(join(tmpdir(), 'ogden-fake-release-'));
const made = spawnSync(process.execPath, [join(here, 'release-manifest.mjs'), '--in', resolve(values.bundle), '--out', join(release, 'files'), '--version', nextVersion, '--tag', `v${nextVersion}`, '--repo', 'fake/release', '--updater-only'], { encoding: 'utf8' });
if (made.status !== 0) {
  console.error(made.stdout, made.stderr);
  process.exit(1);
}
const manifestJson = readFileSync(join(release, 'files', 'latest.json'), 'utf8');
// Only the next channel has N+1.
writeFileSync(join(release, 'next.json'), manifestJson);

function fakeServer(tamper) {
  const child = spawn(process.execPath, [SERVER, '--dir', release, ...(tamper ? ['--tamper', tamper] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
  servers.push(child);
  return new Promise((ok, fail) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const m = /ready (\d+)/.exec(out);
      if (m) ok({ base: `http://127.0.0.1:${m[1]}`, child });
    });
    child.once('exit', () => fail(new Error('the fake release server exited')));
  });
}

function agentWrapper(dir) {
  const file = join(dir, 'agent.mjs');
  writeFileSync(file, `await import(${JSON.stringify(pathToFileURL(FAKE_AGENT).href)});\n`);
  return file;
}

/** A copy of the installed app for one scenario, so a replaced app never carries into the next. */
async function startApp(name, { channel, base }) {
  const ws = newWorkspace(`ogden-update-${name}-`);
  // A prerelease build defaults to the next channel, so the stable channel is chosen explicitly.
  writeFileSync(join(ws.data, 'desktop-update.json'), `{"channel":"${channel}"}\n`);
  const child = launchApp(exe, ws, { NODE_ENV: 'test', OGDEN_AGENTS_TEST_SECRET_STORE: 'memory', OGDEN_AGENTS_OFFLINE: '1', OGDEN_AGENTS_CLAUDE_ACP_PATH: agentWrapper(ws.root), OGDEN_DESKTOP_TEST_UPDATE_BASE: base });
  cleanups.push(() => child.kill());
  await waitFor(`${name}: the page`, () => events(ws, 'page_finished').length > 0 || events(ws, 'server_error').length > 0, 120_000);
  current = ws;
  return { ws, child, port: events(ws, 'server_ready')[0].data.port };
}

async function tabOf(ws, port) {
  const url = `http://127.0.0.1:${port}`;
  const token = readFileSync(join(ws.data, 'launcher.token'), 'utf8').trim();
  const hello = await (await fetch(`${url}/launcher/hello?launch=1`, { headers: { 'x-ogden-launcher-token': token } })).json();
  const res = await fetch(`${url}/api/v1/tab/exchange`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ code: new URL(hello.launchUrl).hash.replace(/^#c=/, '') }) });
  const headers = { authorization: `Bearer ${(await res.json()).token}`, origin: url, 'content-type': 'application/json' };
  return {
    get: async (path) => (await fetch(`${url}${path}`, { headers })).json(),
    post: (path, body) => fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
  };
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
    if (current) console.error('shell report:', JSON.stringify(readReport(current.report).map((e) => ({ ev: e.ev, ...e.data }))));
  }
  // Whatever the scenario left running (a failed one never reached its quit): stop it, so the next one starts clean.
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch {
      // Already gone.
    }
  }
  killSidecars(before);
  await sleep(1500);
}

async function quitAndClean(ws) {
  writeQuit(ws);
  await waitFor('no ogden-node after quit', () => listSidecars(before).length === 0, 45_000);
}

const good = await fakeServer(undefined);

await scenario('S0. the stable channel is not offered a release only the next channel has', async () => {
  const app = await startApp('stable', { channel: 'stable', base: good.base });
  await waitFor('the check to finish', () => events(app.ws, 'update_check_failed').length + events(app.ws, 'update_none').length > 0, 60_000);
  await sleep(2000);
  if (events(app.ws, 'update_found').length > 0) throw new Error('the stable channel was offered the next channel\'s release');
  await quitAndClean(app.ws);
});

await scenario('S2. a bad signature is refused, the old version keeps running and the page says why', async () => {
  const bad = await fakeServer('bytes');
  const app = await startApp('badsig', { channel: 'next', base: bad.base });
  await waitFor('the update to be refused', () => events(app.ws, 'update_failed').length > 0, 120_000);
  if (!/signature/i.test(events(app.ws, 'update_failed')[0].data.why)) throw new Error(`refused for the wrong reason: ${events(app.ws, 'update_failed')[0].data.why}`);
  const tab = await tabOf(app.ws, app.port);
  const notice = await tab.get('/api/v1/updates');
  if (!notice.app?.update?.failed) throw new Error('the page was not told it failed');
  if ((await tab.post('/api/v1/updates/app/restart', { whenIdle: false })).status < 400) throw new Error('Restart was accepted for a failed update');
  if (events(app.ws, 'update_installing').length > 0) throw new Error('a refused update was installed');
  await quitAndClean(app.ws);
});

await scenario('S3. a bad checksum is refused the same way', async () => {
  const bad = await fakeServer('sums');
  const app = await startApp('badsum', { channel: 'next', base: bad.base });
  await waitFor('the update to be refused', () => events(app.ws, 'update_failed').length > 0, 120_000);
  if (!/checksum/i.test(events(app.ws, 'update_failed')[0].data.why)) throw new Error(`refused for the wrong reason: ${events(app.ws, 'update_failed')[0].data.why}`);
  if (events(app.ws, 'update_installing').length > 0) throw new Error('a refused update was installed');
  await quitAndClean(app.ws);
});

// Last: it replaces the installed app.
await scenario('S1. next channel: finds, verifies, waits for a running turn, restarts into the new version with the data intact', async () => {
  const app = await startApp('good', { channel: 'next', base: good.base });
  await waitFor('the update to be downloaded and verified', () => events(app.ws, 'update_downloaded').length > 0, 120_000);
  const tab = await tabOf(app.ws, app.port);
  const notice = await tab.get('/api/v1/updates');
  if (notice.app?.update?.version !== nextVersion || notice.app.update.downloaded !== true) throw new Error(`the page was not told: ${JSON.stringify(notice.app)}`);

  // A project and a chat with a turn that is still running.
  const folder = mkdtempSync(join(tmpdir(), 'ogden-update-project-'));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const ws = await (await tab.post('/api/v1/workspaces', { path: folder })).json();
  const wsId = ws.workspace.id;
  const ses = await (await tab.post(`/api/v1/workspaces/${wsId}/sessions`, {})).json();
  await tab.post(`/api/v1/workspaces/${wsId}/sessions/${ses.session.id}/messages`, { text: 'slow' });
  await waitFor('the turn to be running', async () => (await tab.get('/api/v1/updates')).app.blocked === true, 30_000);

  const refused = await tab.post('/api/v1/updates/app/restart', { whenIdle: false });
  if (refused.status !== 409) throw new Error(`Restart during a running turn answered ${refused.status}, not 409`);
  if (events(app.ws, 'update_installing').length > 0) throw new Error('the app began installing during a running turn');
  const queued = await tab.post('/api/v1/updates/app/restart', { whenIdle: true });
  if (queued.status !== 202) throw new Error(`Restart when they finish answered ${queued.status}`);

  // The turn ends (at most 10 s), then the app installs and opens as the new version.
  await waitFor('the update to install', () => events(app.ws, 'update_installing').length > 0, 90_000);
  await waitFor('the new version to start', () => readReport(app.ws.report).filter((e) => e.ev === 'shell_start' && e.data.version === nextVersion).length > 0, 180_000);
  await waitFor('the new version to show its page', () => readReport(app.ws.report).filter((e) => e.ev === 'page_finished').length >= 2, 120_000);
  const ready = events(app.ws, 'server_ready').at(-1).data;
  const after = await tabOf(app.ws, ready.port);
  const projects = await after.get('/api/v1/workspaces');
  if (!JSON.stringify(projects).includes(wsId)) throw new Error('the project is gone after the update');
  await quitAndClean(app.ws);
});

for (const child of servers) child.kill();
rmSync(release, { recursive: true, force: true });
killSidecars(before);
console.log(JSON.stringify(results, null, 1));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
