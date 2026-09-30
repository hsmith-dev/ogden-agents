#!/usr/bin/env node
// Clean-install smoke test for the packed tarball.
//
//   node scripts/smoke-installed.mjs [path/to/ogden-agents-<version>.tgz]
//
// In a fresh temp directory, with a fresh npm cache and no workspace in sight,
// runs `npx --yes --package=<tgz> ogden-agents --no-open --port 0`, which starts
// a detached background server and exits (story 1.7). It waits for the printed
// 127.0.0.1 URL and one-time launch link and a clean launcher exit, checks that
// the server outlived the launcher, that `GET /` without a session is refused,
// signs in through the launch link (AD-15), checks that `GET /` with the cookie
// returns the page and that a WebSocket client sending the cookie and a
// matching Origin receives `server.started` (which needs the installed
// `better-sqlite3` to load and the bundled migrations to apply), then quits the
// server as the UI does and checks it removed `server.json` and
// `launcher.token`. The data folder is a temp directory.
// Exits non-zero with the captured output on any failure.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
/** Installing from the registry into an empty cache can be slow on CI runners. */
const START_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 15_000;

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tarball = resolve(process.argv[2] ?? join(root, `ogden-agents-${version}.tgz`));

if (!existsSync(tarball)) {
  console.error(`smoke: tarball not found: ${tarball}\nRun \`pnpm build && pnpm pack\` first.`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'ogden-agents-smoke-'));
const cacheDir = mkdtempSync(join(tmpdir(), 'ogden-agents-smoke-cache-'));

// A clean environment for npm: drop any npm/pnpm config inherited from a
// `pnpm run` parent, and use an empty cache so no earlier install is reused.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(npm|pnpm)_/i.test(key)),
);
env.npm_config_cache = cacheDir;
env.npm_config_update_notifier = 'false';
env.npm_config_fund = 'false';
env.npm_config_audit = 'false';
// Keep the database and logs out of the user's real data folder.
const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-smoke-data-'));
env.OGDEN_AGENTS_DATA_DIR = dataDir;

const args = ['--yes', `--package=${tarball}`, 'ogden', '--no-open', '--port', '0'];
// On Windows `npx` is `npx.cmd`. Run through a shell by a quoted bare name, cmd.exe
// resolves the batch file's own folder (%~dp0) to the current directory, so npx
// looks for npm inside the empty work dir. Instead run npm's `npx-cli.js` directly
// with this Node, which ships npm beside it; no shell and no quoting needed.
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
if (IS_WINDOWS && !existsSync(npxCli)) {
  console.error(`smoke: npx not found beside Node at ${npxCli}`);
  process.exit(1);
}
const child = IS_WINDOWS
  ? spawn(process.execPath, [npxCli, ...args], {
      cwd: workDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  : spawn('npx', args, { cwd: workDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
child.stdout.on('data', (chunk) => (output += String(chunk)));
child.stderr.on('data', (chunk) => (output += String(chunk)));
/** @type {Promise<void>} */
// `close`, not `exit`: the launcher prints its URLs and exits at once, and
// `close` fires only after its output has all been read.
const exited = new Promise((resolveExit) => child.once('close', () => resolveExit()));
let childExited = false;
void exited.then(() => (childExited = true));

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, what) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** @returns {Promise<{ url: string, launchUrl: string }>} */
function waitForUrl() {
  return new Promise((resolveUrl, reject) => {
    const check = () => {
      const url = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1];
      const launchUrl = /one-time link: (http:\/\/127\.0\.0\.1:\d+\/auth\?code=[A-Za-z0-9_-]+)/.exec(output)?.[1];
      if (url !== undefined && launchUrl !== undefined) resolveUrl({ url, launchUrl });
    };
    child.stdout.on('data', check);
    void exited.then(() => {
      check();
      reject(new Error(`ogden-agents exited before printing a URL (code ${child.exitCode})`));
    });
    check();
  });
}

/** @param {string} url */
async function checkRefusedWithoutSession(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== 401 || !body.includes('npx ogden-agents')) {
    throw new Error(`GET / without a session returned ${response.status}, not the 401 page:\n${body.slice(0, 500)}`);
  }
}

/**
 * Exchanges the launch link for the session cookie, as a browser does.
 * @param {string} launchUrl
 * @returns {Promise<string>} the cookie's `name=value`
 */
async function signIn(launchUrl) {
  const response = await fetch(launchUrl, { redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (response.status !== 303 || setCookie === null) {
    throw new Error(`the launch link returned ${response.status}${setCookie === null ? ' and no cookie' : ''}`);
  }
  return /** @type {string} */ (setCookie.split(';')[0]);
}

/**
 * @param {string} url
 * @param {string} cookie
 */
async function checkPage(url, cookie) {
  const response = await fetch(url, { headers: { cookie } });
  const body = await response.text();
  if (response.status !== 200 || !body.includes('<div id="root"></div>')) {
    throw new Error(`GET / returned ${response.status} without the page:\n${body.slice(0, 500)}`);
  }
}

/**
 * The `ws` client from the package npx just installed (it is a runtime
 * dependency). Node's global WebSocket can't send the Cookie and Origin headers
 * the gate requires; `ws` can.
 * @returns {typeof import('ws').WebSocket}
 */
function installedWs() {
  const npxDir = join(cacheDir, '_npx');
  for (const entry of existsSync(npxDir) ? readdirSync(npxDir) : []) {
    const manifest = join(npxDir, entry, 'node_modules', 'ws', 'package.json');
    if (existsSync(manifest)) return createRequire(manifest)('ws');
  }
  throw new Error(`ws is not installed under ${npxDir}`);
}

/**
 * @param {string} url
 * @param {string} cookie
 */
function checkServerStarted(url, cookie) {
  const WebSocket = installedWs();
  return new Promise((resolveEvent, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`, { headers: { cookie, origin: url } });
    // The server sends nothing until the client subscribes (AD-5).
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 })));
    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message?.type === 'server.started') {
        ws.close();
        resolveEvent(message);
      }
    });
    ws.on('error', (error) => reject(new Error(`WebSocket error before server.started: ${error.message}`)));
    ws.on('close', () => reject(new Error('WebSocket closed before server.started')));
  });
}

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/** @returns {{ pid: number } | undefined} */
function readPortFile() {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'server.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Quit, as the UI does it, and waits for the background server to exit and
 * remove its files.
 * @param {string} url
 * @param {string} cookie
 * @param {number} pid
 */
async function quit(url, cookie, pid) {
  const response = await fetch(`${url}/api/server/quit`, { method: 'POST', headers: { cookie, origin: url } });
  if (response.status !== 202) throw new Error(`Quit returned ${response.status}`);
  while (isAlive(pid)) await new Promise((r) => setTimeout(r, 100));
  for (const file of ['server.json', 'launcher.token']) {
    if (existsSync(join(dataDir, file))) throw new Error(`${file} is still there after Quit`);
  }
}

/** Kills the background server if a failure left it running. */
function killBackgroundServer() {
  const record = readPortFile();
  if (record === undefined || !isAlive(record.pid)) return;
  try {
    process.kill(record.pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/** Stops npx and everything it started (npm, the shell, the launcher). */
async function stopTree() {
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
}

function cleanUp() {
  for (const dir of [workDir, cacheDir, dataDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Best effort: Windows may still hold a handle briefly.
    }
  }
}

let failure;
try {
  console.log(`smoke: installing ${tarball} with npx in ${workDir}`);
  const { url, launchUrl } = await withTimeout(waitForUrl(), START_TIMEOUT_MS, 'ogden-agents to print its URLs');
  console.log(`smoke: server is at ${url}`);
  // The launcher exits once the background server is up (AD-21: the terminal is free).
  await withTimeout(exited, STEP_TIMEOUT_MS, 'the launcher to exit');
  if (child.exitCode !== 0) throw new Error(`the launcher exited with code ${child.exitCode}`);
  console.log('smoke: the launcher exited 0 and the server kept running');
  await withTimeout(checkRefusedWithoutSession(url), STEP_TIMEOUT_MS, 'GET / without a session');
  console.log('smoke: GET / without a session was refused');
  const cookie = await withTimeout(signIn(launchUrl), STEP_TIMEOUT_MS, 'the launch link');
  console.log('smoke: signed in through the launch link');
  await withTimeout(checkPage(url, cookie), STEP_TIMEOUT_MS, 'GET /');
  console.log('smoke: GET / returned the page');
  const event = await withTimeout(checkServerStarted(url, cookie), STEP_TIMEOUT_MS, 'server.started over /ws');
  console.log(`smoke: received ${JSON.stringify(event)}`);
  const record = readPortFile();
  if (record === undefined) throw new Error('server.json is missing while the server runs');
  await withTimeout(quit(url, cookie, record.pid), STEP_TIMEOUT_MS, 'the server to quit');
  console.log('smoke: Quit stopped the server and removed server.json and launcher.token');
} catch (error) {
  failure = error;
} finally {
  await stopTree();
  killBackgroundServer();
  cleanUp();
}

if (failure !== undefined) {
  console.error(`smoke: FAILED: ${failure instanceof Error ? failure.message : String(failure)}`);
  console.error('--- captured output ---');
  console.error(output || '(none)');
  process.exit(1);
}
console.log('smoke: OK');
process.exit(0);
