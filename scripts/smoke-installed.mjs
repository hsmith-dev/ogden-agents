#!/usr/bin/env node
// Clean-install smoke test for the packed tarball.
//
//   node scripts/smoke-installed.mjs [path/to/ogdenmad-<version>.tgz]
//
// In a fresh temp directory, with a fresh npm cache and no workspace in sight,
// runs `npx --yes --package=<tgz> ogdenmad --no-open --port 0`, waits for the
// printed 127.0.0.1 URL, checks that `GET /` returns the page and that a
// WebSocket client that subscribes receives `server.started` (which needs the
// installed `better-sqlite3` to load and the bundled migrations to apply),
// then stops the process tree. The data folder is a temp directory.
// Exits non-zero with the captured output on any failure.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IS_WINDOWS = process.platform === 'win32';
/** Installing from the registry into an empty cache can be slow on CI runners. */
const START_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 15_000;

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tarball = resolve(process.argv[2] ?? join(root, `ogdenmad-${version}.tgz`));

if (!existsSync(tarball)) {
  console.error(`smoke: tarball not found: ${tarball}\nRun \`pnpm build && pnpm pack\` first.`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'ogdenmad-smoke-'));
const cacheDir = mkdtempSync(join(tmpdir(), 'ogdenmad-smoke-cache-'));

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
const dataDir = mkdtempSync(join(tmpdir(), 'ogdenmad-smoke-data-'));
env.OGDENMAD_DATA_DIR = dataDir;

const args = ['--yes', `--package=${tarball}`, 'ogdenmad', '--no-open', '--port', '0'];
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
const exited = new Promise((resolveExit) => child.once('exit', () => resolveExit()));
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

/** @returns {Promise<string>} */
function waitForUrl() {
  return new Promise((resolveUrl, reject) => {
    const check = () => {
      const match = /running at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) resolveUrl(/** @type {string} */ (match[1]));
    };
    child.stdout.on('data', check);
    void exited.then(() => reject(new Error(`ogdenmad exited before printing a URL (code ${child.exitCode})`)));
    check();
  });
}

/** @param {string} url */
async function checkPage(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== 200 || !body.includes('<div id="root"></div>')) {
    throw new Error(`GET / returned ${response.status} without the page:\n${body.slice(0, 500)}`);
  }
}

/** @param {string} url */
function checkServerStarted(url) {
  return new Promise((resolveEvent, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
    // The server sends nothing until the client subscribes (AD-5).
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 })));
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.type === 'server.started') {
        ws.close();
        resolveEvent(message);
      }
    });
    ws.addEventListener('error', () => reject(new Error('WebSocket error before server.started')));
    ws.addEventListener('close', () => reject(new Error('WebSocket closed before server.started')));
  });
}

/** Stops npx and everything it started (npm, the shell, the node server). */
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
  const url = await withTimeout(waitForUrl(), START_TIMEOUT_MS, 'ogdenmad to print its URL');
  console.log(`smoke: server is at ${url}`);
  await withTimeout(checkPage(url), STEP_TIMEOUT_MS, 'GET /');
  console.log('smoke: GET / returned the page');
  const event = await withTimeout(checkServerStarted(url), STEP_TIMEOUT_MS, 'server.started over /ws');
  console.log(`smoke: received ${JSON.stringify(event)}`);
} catch (error) {
  failure = error;
} finally {
  await stopTree();
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
