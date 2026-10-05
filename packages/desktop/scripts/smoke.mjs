// Headless smoke of a built desktop app (story 13.2): it starts, the bundled Node runs the packed
// server, the window loads the server's page and the tab exchange happens (`launch code used; tab
// token minted` in the server log), and quitting leaves no `ogden-node` process behind.
//
//   node packages/desktop/scripts/smoke.mjs --app <Ogden Agents.app | ogden-agents.exe>
//   node packages/desktop/scripts/smoke.mjs --installer <setup.exe>      (Windows: installs silently first)
//
// Uses a private data folder (never the user's), the fake nothing: no agent is ever started.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { appExecutable, installNsis, killSidecars, launchApp, listSidecars, newWorkspace, readReport, serverLog, sleep, waitFor, writeQuit } from './app-harness.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' }, installer: { type: 'string' } }, strict: true });
if (!values.app && !values.installer) {
  console.error('usage: smoke.mjs --app <path> | --installer <setup.exe>');
  process.exit(2);
}

const ws = newWorkspace();
// Processes that were here before: never counted, never killed.
const before = new Set(listSidecars().map((p) => p.pid));
let child;
let failed;
try {
  let exe;
  if (values.installer) {
    const dir = join(tmpdir(), `ogden-installed-${process.pid}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    exe = installNsis(values.installer, dir);
  } else exe = appExecutable(values.app);
  console.log(`launching ${exe}`);
  child = launchApp(exe, ws);

  const has = (ev) => readReport(ws.report).find((e) => e.ev === ev);
  await waitFor('server_ready', () => has('server_ready') || has('server_error'), 120_000);
  if (has('server_error')) throw new Error(`the shell could not start the server: ${JSON.stringify(has('server_error').data)}`);
  await waitFor('page_finished', () => has('page_finished'), 60_000);
  const page = has('page_finished').data.url;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(page)) throw new Error(`the window is on ${page}, not the server's origin`);
  await waitFor('the tab exchange in the server log', () => serverLog(ws).includes('launch code used; tab token minted'), 30_000);
  const running = listSidecars(before);
  if (running.length === 0) throw new Error('no ogden-node process while the app runs');
  console.log(`ok: page ${page}, tab token minted, sidecar pids ${running.map((p) => p.pid).join(',')}`);

  writeQuit(ws);
  const exit = await Promise.race([child.exited, sleep(30_000).then(() => 'timeout')]);
  if (exit === 'timeout') throw new Error('the app did not quit within 30 seconds');
  await waitFor('no ogden-node process after quit', () => listSidecars(before).length === 0, 20_000);
  console.log('ok: quit left no ogden-node process');
} catch (error) {
  failed = error;
  console.error(`SMOKE FAILED: ${error.message}`);
  console.error('report:', JSON.stringify(readReport(ws.report), null, 1));
  console.error('server.log (tail):', serverLog(ws).split('\n').slice(-30).join('\n'));
} finally {
  try {
    child?.kill();
  } catch {
    // Already gone.
  }
  killSidecars(before);
}
process.exit(failed ? 1 : 0);
