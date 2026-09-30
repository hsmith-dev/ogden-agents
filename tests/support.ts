/**
 * The root tests' one support module, for the launcher tests (Vitest) and the
 * browser tests (Playwright) alike, so it imports neither runner: the built
 * server (`dist/server.js`, as `pnpm build` writes it) on a temp data folder,
 * the launcher handshake, and connecting and quitting the way the page does.
 * Routes come from the shared `API_ROUTES`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The shared routes' own file (it has no imports): the root package depends
// only on the server (AD-1), so it doesn't resolve `@ogden-agents/shared`.
import { API_ROUTES } from '../packages/shared/src/api.ts';

export { API_ROUTES };

type ServerModule = typeof import('@ogden-agents/server');
/** A started server with its launch link (`startServer` asks for one). */
export type RunningServer = Awaited<ReturnType<ServerModule['start']>> & { launchUrl: string };
export type StartOptions = Parameters<ServerModule['start']>[0];

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const WEB_ROOT = join(ROOT, 'dist', 'web');

/** The built server module, for `start` and its exports (such as `ToolchainError`). */
export async function serverModule(): Promise<ServerModule> {
  return (await import(pathToFileURL(join(ROOT, 'dist', 'server.js')).href)) as ServerModule;
}

/** A fresh temp data folder; the caller removes it with `removeDataDir`. */
export function makeDataDir(prefix = 'ogden-agents-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDataDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** The fake ACP agent, which also stands in for the Claude CLI (`--cli`, the fake login program). */
export const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

/**
 * Starts the built server on `port` (0: any free port) with `dataDir`, logging nowhere, with a launch link.
 * `extra` adds options (a stub toolchain, say). The agent is the fake one unless `extra` names another,
 * so no test runs the real Claude Code adapter or its login.
 */
export async function startServer(dataDir: string, port = 0, extra: StartOptions = {}): Promise<RunningServer> {
  const { start, createLogger } = await serverModule();
  return start({ port, open: false, dataDir, webRoot: WEB_ROOT, log: createLogger(() => {}), claudeAdapterPath: FAKE_AGENT, ...extra, launch: true });
}

// Shared with the plain-Node install scripts: whether a process with a pid
// exists, and the running server's port file (`server.json`) in a data folder.
export { isAlive, readPortFile } from '../scripts/installed-package.mjs';

/** Polls `predicate` until it holds, or throws after `timeoutMs`. */
export async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The launcher token the running server wrote to `launcher.token` in `dataDir`. */
export function readLauncherToken(dataDir: string): string {
  return readFileSync(join(dataDir, 'launcher.token'), 'utf8').trim();
}

/**
 * A fresh single-use launch link from the server at `url` whose data folder
 * is `dataDir`, through the launcher handshake with its launcher token,
 * exactly as `npx ogden-agents` asks for one.
 */
export async function launchLink(url: string, dataDir: string): Promise<string> {
  const token = readLauncherToken(dataDir);
  const response = await fetch(`${url}/launcher/hello?launch=1`, { headers: { 'x-ogden-launcher-token': token } });
  if (!response.ok) throw new Error(`the launcher handshake returned ${response.status}`);
  return ((await response.json()) as { launchUrl: string }).launchUrl;
}

/** The launch code in a launch link (`<origin>/#c=<code>`). */
export function codeOfLink(launchUrl: string): string {
  const match = /^#c=([A-Za-z0-9_-]{43})$/.exec(new URL(launchUrl).hash);
  if (match === null) throw new Error(`not a launch link: ${launchUrl.replace(/#.*/, '#…')}`);
  return match[1]!;
}

/** POSTs a launch code to the exchange as the page's boot script does, with the page's Origin. */
export function postCode(origin: string, code: string): Promise<Response> {
  return fetch(`${origin}${API_ROUTES.tabExchange}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

/**
 * Opens a launch link as the page's boot script does and returns the tab's
 * token, from the response body (never a URL). Throws unless the exchange
 * answered 200 with a token and set no cookie.
 */
export async function exchange(launchUrl: string): Promise<string> {
  const response = await postCode(new URL(launchUrl).origin, codeOfLink(launchUrl));
  if (response.status !== 200) throw new Error(`the code exchange returned ${response.status}, not 200`);
  if (response.headers.get('set-cookie') !== null) throw new Error('the code exchange set a cookie');
  const { token } = (await response.json()) as { token?: unknown };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('the code exchange returned no token');
  return token;
}

/** Quit, as the UI does it (the tab's token and the page's Origin); resolves with the reply. */
export function requestQuit(url: string, token: string): Promise<Response> {
  return fetch(`${url}${API_ROUTES.serverQuit}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: url } });
}
