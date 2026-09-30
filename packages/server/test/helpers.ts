/**
 * The server tests' one support module: temp folders, a tiny built UI,
 * starting a real server that is closed after the test, raw HTTP requests,
 * and connecting a tab the way the page does (AD-15 as amended in story 2.1).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, webSocketProtocols } from '@ogden-agents/shared';
import { afterEach } from 'vitest';
import type WebSocket from 'ws';
import { createLogger } from '../src/log.js';
import { start, type RunningServer, type StartOptions } from '../src/start.js';

const dirs: string[] = [];
const servers: RunningServer[] = [];
const sockets: WebSocket[] = [];

// Registered before any test file's own afterEach hooks, so it runs after them
// (hooks run in reverse order). In order: sockets, then servers, then the
// folders they used.
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  // close() is safe to call again on a server a test already closed.
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A fresh temp data folder, removed after the test. */
export function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-server-'));
  dirs.push(dir);
  return dir;
}

/** Terminates `ws` after the test, if it is still open. Returns it. */
export function trackSocket<T extends WebSocket>(ws: T): T {
  sockets.push(ws);
  return ws;
}

/** A tiny built UI (`index.html` and `assets/app.js`), so tests don't depend on `packages/web` being built. */
export function tinyWebRoot(): string {
  const dir = join(tempDataDir(), 'web');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
  return dir;
}

/** A clock the test moves by hand. */
export function manualClock() {
  let t = Date.now();
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** Polls `predicate` until it holds, or throws after `timeoutMs`. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A started test server; it has a launch link, since tests start it with `launch: true`. */
export type TestServer = RunningServer & { launchUrl: string };

/** The fake ACP agent (`tests/fixtures/fake-acp-agent.mjs`), which also stands in for the Claude CLI (`--cli`). */
export const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

/**
 * Starts a real server on any free port, a temp data folder and a tiny UI,
 * with a launch link, and closes it after the test. Log lines go to `lines`
 * (if given); any start option overrides these defaults. The agent is the
 * fake one, so no test ever runs the real Claude Code adapter or its login.
 */
export async function startTestServer(options: StartOptions & { lines?: string[] } = {}): Promise<TestServer> {
  const { lines, ...rest } = options;
  const server = await start({
    port: 0,
    open: false,
    log: createLogger((line) => lines?.push(line)),
    dataDir: tempDataDir(),
    webRoot: tinyWebRoot(),
    claudeAdapterPath: FAKE_AGENT,
    ...rest,
    launch: true,
  });
  servers.push(server);
  return server;
}

/** Closes `server` after the test (for one started some other way). Returns it. */
export function trackServer<T extends RunningServer>(server: T): T {
  servers.push(server);
  return server;
}

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}

/**
 * A raw HTTP request to `server`, so `Host` and `Origin` can be anything a
 * hostile client sends (`Host` defaults to the server's own). No kept-alive
 * socket is reused, so it works across a restart on the same port.
 */
export function send(
  server: { port: number },
  path: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const length: Record<string, string> = body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) };
    const req = request(
      { host: '127.0.0.1', port: server.port, path, method, agent: false, headers: { host: `127.0.0.1:${server.port}`, ...length, ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text, json: () => JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** What a connected tab sends: its token and the page's own origin. */
export interface SignedIn {
  token: string;
  origin: string;
  /** `Authorization: Bearer <token>` and `Origin`, for REST calls. */
  headers: Record<string, string>;
  /** The subprotocols a tab offers on `/ws`. */
  protocols: [string, string];
}

/** What a tab holding `token` sends to the server at `origin`. */
export function tabOf(token: string, origin: string): SignedIn {
  return {
    token,
    origin,
    headers: { authorization: `Bearer ${token}`, origin },
    protocols: webSocketProtocols(token),
  };
}

/** The launch code in a launch link (`<origin>/#c=<code>`). */
export function codeOfLink(launchUrl: string): string {
  const match = /^#c=([A-Za-z0-9_-]{43})$/.exec(new URL(launchUrl).hash);
  if (match === null) throw new Error(`not a launch link: ${launchUrl.replace(/#.*/, '#…')}`);
  return match[1]!;
}

/**
 * Opens a launch link as the page's boot script does: POSTs its code to
 * `/api/v1/tab/exchange` with the page's Origin and returns the tab token
 * from the response body. Checks that no cookie was set.
 */
export async function exchange(launchUrl: string): Promise<string> {
  const { origin } = new URL(launchUrl);
  const response = await fetch(`${origin}${API_ROUTES.tabExchange}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code: codeOfLink(launchUrl) }),
  });
  if (response.status !== 200) throw new Error(`the code exchange returned ${response.status}, not 200`);
  if (response.headers.get('set-cookie') !== null) throw new Error('the code exchange set a cookie');
  const { token } = (await response.json()) as { token?: unknown };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('the code exchange returned no token');
  return token;
}

/** A new tab connected through `launchUrl`: by default the server's start-up link, which only one tab can spend. */
export async function connectTab(server: { url: string; launchUrl: string }, launchUrl = server.launchUrl): Promise<SignedIn> {
  return tabOf(await exchange(launchUrl), server.url);
}

const signedIn = new WeakMap<object, Promise<SignedIn>>();

/**
 * The server's first tab, connected through its start-up launch link. Cached
 * per server, since that code can be spent only once.
 */
export function signIn(server: { url: string; launchUrl: string }): Promise<SignedIn> {
  let pending = signedIn.get(server);
  if (pending === undefined) {
    pending = connectTab(server);
    signedIn.set(server, pending);
  }
  return pending;
}
