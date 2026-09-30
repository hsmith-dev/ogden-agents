#!/usr/bin/env node
// Clean-install smoke test for the packed tarball, or for a published version.
//
//   node scripts/smoke-installed.mjs [path/to/ogden-agents-<version>.tgz]
//   node scripts/smoke-installed.mjs --registry-spec ogden-agents@<version>
//
// Registry mode (the release workflow's verify job) runs exactly what a user
// types, `npx --yes ogden-agents@<version> --no-open --port 0`, against the npm
// registry instead of a local tarball; every check below is the same.
//
// In a fresh temp directory, with a fresh npm cache and no workspace in sight,
// runs `npx --yes --package=<tgz> ogden-agents --no-open --port 0`, which starts
// a detached background server and exits (story 1.7). It waits for the printed
// 127.0.0.1 URL and one-time launch link and a clean launcher exit, checks that
// the server outlived the launcher, that `GET /` serves the page without a
// token while the API refuses one without it, connects a tab through the launch
// link (AD-15 as amended: `/#c=<code>`, exchanged at `POST /api/v1/tab/exchange`
// for a token in the response body, never a URL; no cookie), checks that the
// API accepts the tab's Bearer token and that a WebSocket client offering the
// token subprotocol and a matching Origin receives `server.started` (which needs the installed
// `better-sqlite3` to load and the bundled migrations to apply), then quits the
// server as the UI does and checks it removed `server.json` and
// `launcher.token`. The data folder is a temp directory.
// Exits non-zero with the captured output on any failure.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAlive, prepareInstall, withTimeout } from './installed-package.mjs';

/** Installing from the registry into an empty cache can be slow on CI runners. */
const START_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 15_000;

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** @returns {string | undefined} the value of `--registry-spec <spec>` or `--registry-spec=<spec>` */
function registrySpecArg() {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((arg) => arg === '--registry-spec' || arg.startsWith('--registry-spec='));
  if (index === -1) return undefined;
  const arg = /** @type {string} */ (argv[index]);
  const spec = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[index + 1];
  if (spec === undefined || spec === '' || spec.startsWith('-')) {
    console.error('smoke: --registry-spec needs a package spec, such as ogden-agents@0.1.0');
    process.exit(1);
  }
  return spec;
}

const registrySpec = registrySpecArg();
const tarball =
  registrySpec === undefined ? resolve(process.argv[2] ?? join(root, `ogden-agents-${version}.tgz`)) : undefined;

if (tarball !== undefined && !existsSync(tarball)) {
  console.error(`smoke: tarball not found: ${tarball}\nRun \`pnpm build && pnpm pack\` first.`);
  process.exit(1);
}

/** @type {import('./installed-package.mjs').Install} */
let install;
try {
  install = prepareInstall(registrySpec === undefined ? { tarball } : { registrySpec });
} catch (error) {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const { workDir, dataDir } = install;
const launcher = install.runLauncher(['--no-open', '--port', '0']);
const { child, exited } = launcher;

/**
 * The app's files load without a token (the page shows "Open Ogden Agents"
 * until a tab has one), with the Content-Security-Policy; the API refuses a
 * request without a token.
 * @param {string} url
 */
async function checkPageWithoutToken(url) {
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== 200 || !body.includes('<div id="root"></div>')) {
    throw new Error(`GET / returned ${response.status} without the page:\n${body.slice(0, 500)}`);
  }
  const csp = response.headers.get('content-security-policy') ?? '';
  if (!csp.includes("script-src 'self'")) throw new Error(`GET / has no script-src 'self' policy: "${csp}"`);
  const api = await fetch(`${url}/api/v1/tab`);
  if (api.status !== 401) throw new Error(`the API without a token returned ${api.status}, not 401`);
}

/**
 * Exchanges the launch link's code for a tab token, as the page's boot script
 * does: a same-origin POST, with the token in the response body.
 * @param {string} launchUrl
 * @returns {Promise<string>} the token
 */
async function signIn(launchUrl) {
  const { origin, hash } = new URL(launchUrl);
  const code = /^#c=([A-Za-z0-9_-]{43})$/.exec(hash)?.[1];
  if (code === undefined) throw new Error('the launch link has no #c=<code>');
  const response = await fetch(`${origin}/api/v1/tab/exchange`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (response.headers.get('set-cookie') !== null) throw new Error('the code exchange set a cookie');
  const body = response.ok ? await response.json() : {};
  const token = typeof body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.token) ? body.token : undefined;
  if (response.status !== 200 || token === undefined) throw new Error(`the code exchange returned ${response.status} without a token`);
  return token;
}

/**
 * @param {string} url
 * @param {string} token
 */
async function checkApi(url, token) {
  const response = await fetch(`${url}/api/v1/tab`, { headers: { authorization: `Bearer ${token}` } });
  if (response.status !== 204) throw new Error(`the API with the tab's token returned ${response.status}, not 204`);
}

/**
 * @param {string} url
 * @param {string} token
 */
function checkServerStarted(url, token) {
  // The `ws` client from the package npx just installed (it is a runtime
  // dependency). Node's global WebSocket can't send the Origin header the gate
  // requires; `ws` can.
  /** @type {typeof import('ws').WebSocket} */
  const WebSocket = install.requireInstalled('ws');
  return new Promise((resolveEvent, reject) => {
    const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`, ['ogden.v1', `ogden.auth.${token}`], { headers: { origin: url } });
    ws.on('open', () => {
      if (ws.protocol !== 'ogden.v1') reject(new Error(`the server chose the subprotocol "${ws.protocol}", not ogden.v1`));
    });
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

/**
 * Quit, as the UI does it, and waits for the background server to exit and
 * remove its files.
 * @param {string} url
 * @param {string} token
 * @param {number} pid
 */
async function quit(url, token, pid) {
  const response = await fetch(`${url}/api/v1/server/quit`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: url } });
  if (response.status !== 202) throw new Error(`Quit returned ${response.status}`);
  while (isAlive(pid)) await new Promise((r) => setTimeout(r, 100));
  for (const file of ['server.json', 'launcher.token']) {
    if (existsSync(join(dataDir, file))) throw new Error(`${file} is still there after Quit`);
  }
}

let failure;
try {
  console.log(`smoke: installing ${registrySpec ?? tarball} with npx in ${workDir}`);
  const { url, launchUrl } = await withTimeout(launcher.urls(), START_TIMEOUT_MS, 'ogden-agents to print its URLs');
  console.log(`smoke: server is at ${url}`);
  // The launcher exits once the background server is up (AD-21: the terminal is free).
  await withTimeout(exited, STEP_TIMEOUT_MS, 'the launcher to exit');
  if (child.exitCode !== 0) throw new Error(`the launcher exited with code ${child.exitCode}`);
  console.log('smoke: the launcher exited 0 and the server kept running');
  await withTimeout(checkPageWithoutToken(url), STEP_TIMEOUT_MS, 'GET / without a token');
  console.log('smoke: GET / returned the page with its CSP, and the API refused a request without a token');
  const token = await withTimeout(signIn(launchUrl), STEP_TIMEOUT_MS, 'the launch link');
  console.log('smoke: the launch link gave this tab a token');
  await withTimeout(checkApi(url, token), STEP_TIMEOUT_MS, 'the API with the token');
  console.log("smoke: the API accepted the tab's token");
  const event = await withTimeout(checkServerStarted(url, token), STEP_TIMEOUT_MS, 'server.started over /ws');
  console.log(`smoke: received ${JSON.stringify(event)}`);
  const record = install.readPortFile();
  if (record === undefined) throw new Error('server.json is missing while the server runs');
  await withTimeout(quit(url, token, record.pid), STEP_TIMEOUT_MS, 'the server to quit');
  console.log('smoke: Quit stopped the server and removed server.json and launcher.token');
} catch (error) {
  failure = error;
} finally {
  await launcher.stop();
  install.killBackgroundServer();
  install.removeFolders();
}

if (failure !== undefined) {
  console.error(`smoke: FAILED: ${failure instanceof Error ? failure.message : String(failure)}`);
  console.error('--- captured output ---');
  console.error(launcher.output() || '(none)');
  process.exit(1);
}
console.log('smoke: OK');
process.exit(0);
