// Helpers for driving a built Ogden Agents desktop app from CI (story 13.2; 13.5, 13.10 and 13.13
// reuse them). The app's own test hooks (src-tauri/src/main.rs) give it a report file and a quit
// file; everything else is observed from outside: the data folder, the server log and the OS
// process list. Nothing here touches the user's real data folder or any real agent.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The executable inside a built macOS `.app`, or a Windows/Linux executable path as given. */
export function appExecutable(appPath) {
  if (!IS_MAC || !appPath.endsWith('.app')) return appPath;
  return join(appPath, 'Contents', 'MacOS', 'ogden-agents');
}

/** Installs an NSIS installer silently into `dir` (current user, no UI) and returns the app's exe. */
export function installNsis(installer, dir) {
  // `/D=` must be the last argument and is not quoted (NSIS).
  const r = spawnSync(installer, ['/S', `/D=${dir}`], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`installer exited ${r.status}: ${r.stderr}`);
  const exe = join(dir, 'ogden-agents.exe');
  if (!existsSync(exe)) throw new Error(`installed, but ${exe} is not there`);
  return exe;
}

/** A fresh working folder with its own data folder, report file and quit file paths. */
export function newWorkspace(prefix = 'ogden-desktop-') {
  const root = process.env.OGDEN_DESKTOP_WORK ? process.env.OGDEN_DESKTOP_WORK : mkdtempSync(join(tmpdir(), prefix));
  const data = join(root, 'data');
  mkdirSync(data, { recursive: true });
  return { root, data, report: join(root, 'report.jsonl'), quitFile: join(root, 'quit') };
}

export function readReport(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { ev: 'unparsable', line: l };
      }
    });
}

/** Starts the app with the test hooks on and a private data folder. Returns the child. */
export function launchApp(exe, ws, extraEnv = {}) {
  // `OGDEN_DESKTOP_ARCH=x86_64` runs the Intel half of a universal macOS app under Rosetta.
  const arch = IS_MAC ? process.env.OGDEN_DESKTOP_ARCH : undefined;
  const child = spawn(arch === undefined ? exe : 'arch', arch === undefined ? [] : [`-${arch}`, exe], {
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      OGDEN_AGENTS_DATA_DIR: ws.data,
      OGDEN_DESKTOP_TEST_REPORT: ws.report,
      OGDEN_DESKTOP_TEST_QUIT_FILE: ws.quitFile,
      ...extraEnv,
    },
  });
  child.exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.on('error', (e) => console.error(`app failed to start: ${e.message}`));
  return child;
}

export async function waitFor(what, fn, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(stepMs);
  }
}

/** Processes whose name or command line mentions the bundled Node sidecar (`ogden-node`). */
export function listSidecars(ignore = new Set()) {
  return listAllSidecars().filter((p) => !ignore.has(p.pid));
}

function listAllSidecars() {
  if (IS_WIN) {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ogden-node.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return r.stdout
      .split(/\r?\n/)
      .filter((l) => l.toLowerCase().includes('ogden-node'))
      .map((l) => ({ name: 'ogden-node.exe', pid: Number(l.split('","')[1]) }));
  }
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => /ogden-node/.test(l))
    .map((l) => ({ pid: Number(l.trim().split(/\s+/)[0]), command: l.trim().slice(0, 200) }));
}

/** Kills the sidecars left behind that were not running before `ignore` was taken (cleanup after a failed check only). */
export function killSidecars(ignore = new Set()) {
  for (const { pid } of listSidecars(ignore)) {
    try {
      if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
      else process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

export function serverLog(ws) {
  const file = join(ws.data, 'logs', 'server.log');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export function writeQuit(ws) {
  mkdirSync(dirname(ws.quitFile), { recursive: true });
  writeFileSync(ws.quitFile, 'quit\n');
}

/** The app's own processes (the shell, by its program name), for waiting until one scenario's app is fully gone. */
export function listApps(ignore = new Set()) {
  if (IS_WIN) {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ogden-agents.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return r.stdout
      .split(/\r?\n/)
      .filter((l) => l.toLowerCase().includes('ogden-agents.exe'))
      .map((l) => ({ pid: Number(l.split('","')[1]) }))
      .filter((p) => !ignore.has(p.pid));
  }
  const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter((l) => /\/ogden-agents(\s|$)/.test(l) || l.includes('Contents/MacOS/ogden-agents'))
    .map((l) => ({ pid: Number(l.trim().split(/\s+/)[0]) }))
    .filter((p) => !ignore.has(p.pid));
}

/** Stops the apps left over from a scenario (never one that was running before the run). */
export function killApps(ignore = new Set()) {
  for (const { pid } of listApps(ignore)) {
    try {
      if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
      else process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The fake ACP agent the installed-package suite runs (it finds it through OGDEN_AGENTS_CLAUDE_ACP_PATH). */
export const FAKE_AGENT = join(REPO, 'tests', 'fixtures', 'fake-acp-agent-installed.mjs');

/**
 * A script that runs the fake agent, optionally with a long-lived child of its own as the real adapter
 * starts `claude` (the agents get an allowlisted environment, so the switch is set inside the script).
 */
export function agentWrapper(dir, { grandchild = false } = {}) {
  const file = join(dir, 'agent.mjs');
  writeFileSync(file, `${grandchild ? "process.env.FAKE_ACP_SPAWN_GRANDCHILD = '1';\n" : ''}await import(${JSON.stringify(pathToFileURL(FAKE_AGENT).href)});\n`);
  return file;
}

/** A tab on the running server the way the page gets one: a launch link from the launcher handshake, exchanged. */
export async function tabOf(ws, port) {
  const url = `http://127.0.0.1:${port}`;
  const token = readFileSync(join(ws.data, 'launcher.token'), 'utf8').trim();
  const hello = await (await fetch(`${url}/launcher/hello?launch=1`, { headers: { 'x-ogden-launcher-token': token } })).json();
  const res = await fetch(`${url}/api/v1/tab/exchange`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ code: new URL(hello.launchUrl).hash.replace(/^#c=/, '') }) });
  if (res.status !== 200) throw new Error(`tab exchange answered ${res.status}`);
  const headers = { authorization: `Bearer ${(await res.json()).token}`, origin: url, 'content-type': 'application/json' };
  return {
    pid: hello.pid,
    get: async (path) => (await fetch(`${url}${path}`, { headers })).json(),
    post: (path, body) => fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
  };
}
