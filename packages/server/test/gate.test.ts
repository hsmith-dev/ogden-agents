/**
 * The security gate (AD-15 as amended in story 2.1), end to end against a
 * real server: every row of the story's I/O matrix that the server decides,
 * with the clock injected for expiry. The page's side (reload, launch state,
 * New tab, CSP in force) is in tests/e2e/tab-token.spec.ts.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { LEGACY_AUTH_KEY_FILE, openCore, PORT_FILE } from '@ogden-agents/core';
import { LAUNCH_CODES_PATH, TAB_CHECK_PATH, TAB_EXCHANGE_PATH, WS_PROTOCOL } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { createLaunchCodes, createTabTokens, LAUNCH_CODE_TTL_MS, TAB_TOKEN_IDLE_TTL_MS } from '../src/auth.js';
import { createGate } from '../src/gate.js';
import { isServerPath } from '../src/paths.js';
import { createLogger } from '../src/log.js';
import { start, type RunningServer, type StartOptions } from '../src/start.js';
import { codeOfLink, exchange, tabOf, tempDataDir, type SignedIn } from './helpers.js';

const running: RunningServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(running.splice(0).map((s) => s.close()));
});

/** A tiny built UI, so these tests don't depend on `packages/web` being built. */
function webRoot(): string {
  const dir = join(tempDataDir(), 'web');
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")');
  return dir;
}

/** A clock the test moves by hand. */
function manualClock() {
  let t = Date.now();
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

async function startGated(options: StartOptions & { lines?: string[] } = {}) {
  const { lines, ...rest } = options;
  const server = await start({
    port: 0,
    open: false,
    log: createLogger((l) => lines?.push(l)),
    dataDir: tempDataDir(),
    webRoot: webRoot(),
    ...rest,
  });
  running.push(server);
  return server;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A raw HTTP request, so `Host` and `Origin` can be anything a hostile client sends. */
function send(
  server: RunningServer,
  path: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      // agent: false, so no kept-alive socket is reused across a restart on the same port.
      { host: '127.0.0.1', port: server.port, path, method, agent: false, headers: { host: `127.0.0.1:${server.port}`, ...headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Opens `/ws` offering `protocols`, and resolves with 101 on success (with the
 * subprotocol the server chose), or the refusal's HTTP status.
 */
function upgradeWith(
  server: RunningServer,
  protocols: string[],
  headers: Record<string, string>,
  path = '/ws',
): Promise<{ status: number; protocol?: string; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`, protocols, { headers });
    sockets.push(ws);
    ws.once('open', () => resolve({ status: 101, protocol: ws.protocol, ws }));
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode!, ws });
      res.resume();
    });
    ws.once('error', reject);
  });
}

/** Opens `/ws` as `tab` would (its subprotocols) with `headers`, and resolves with the status. */
async function upgrade(server: RunningServer, tab: SignedIn | undefined, headers: Record<string, string>): Promise<number> {
  return (await upgradeWith(server, tab?.protocols ?? [], headers)).status;
}

/** Opens `/ws` with raw `headers` and no subprotocol offer. */
function upgradeRaw(server: RunningServer, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers });
    sockets.push(ws);
    ws.once('open', () => resolve(101));
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode!);
      res.resume();
    });
    ws.once('error', reject);
  });
}

/** Opens `/ws` as `tab`, subscribes from the start, and resolves with the first event's type. */
function firstEvent(server: RunningServer, tab: SignedIn): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, tab.protocols, { headers: { origin: tab.origin } });
    sockets.push(ws);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 })));
    ws.once('message', (data) => resolve((JSON.parse(String(data)) as { type: string }).type));
    ws.once('error', reject);
  });
}

const codeOf = (server: RunningServer) => codeOfLink(server.launchUrl);

/** POSTs `body` to the code exchange as the page would, with its Origin unless `headers` say otherwise. */
function exchangeRaw(server: RunningServer, body: unknown, headers: Record<string, string> = { origin: server.url }): Promise<Reply> {
  return send(server, TAB_EXCHANGE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Exchanges a launch code over a raw request and returns the connected tab. */
async function signInRaw(server: RunningServer, code = codeOf(server)): Promise<SignedIn> {
  const reply = await exchangeRaw(server, { code });
  expect(reply.status).toBe(200);
  expect(reply.headers['set-cookie']).toBeUndefined();
  const { token } = JSON.parse(reply.body) as { token: string };
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return tabOf(token, server.url);
}

/** A tab's token as a Bearer header, without an Origin. */
const bearer = (tab: SignedIn) => ({ authorization: `Bearer ${tab.token}` });

/** A cookie as story 1.4's gate set it: signed, port-specific, and now ignored. */
const oldCookie = (server: RunningServer) =>
  `ogden_session_${server.port}=AAAAAAAAAAAAAAAAAAAAAA.${Math.floor(Date.now() / 1000) + 3600}.${'A'.repeat(43)}`;

describe('security gate', () => {
  it('launch: the link is /#c=<code>; the code is exchanged over POST for a token in the body, never in a URL, with no cookie; the token opens the API and /ws', async () => {
    const lines: string[] = [];
    const server = await startGated({ lines });
    expect(server.launchUrl).toBe(`${server.url}/#c=${codeOf(server)}`);
    const reply = await exchangeRaw(server, { code: codeOf(server) });
    expect(reply.status).toBe(200);
    expect(reply.headers.location).toBeUndefined();
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(reply.headers['cache-control']).toBe('no-store');
    const tab = tabOf((JSON.parse(reply.body) as { token: string }).token, server.url);
    expect(server.tabs.size()).toBe(1);

    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(tab) })).status).toBe(204);
    expect(await firstEvent(server, tab)).toBe('server.started');

    // Logged as issued and used, never with the code or the token (AD-16).
    const msgs = lines.map((l) => (JSON.parse(l) as { msg: string }).msg);
    expect(msgs).toContain('launch code issued');
    expect(msgs).toContain('launch code used; tab token minted');
    expect(lines.join('')).not.toContain(codeOf(server));
    expect(lines.join('')).not.toContain(tab.token);
  });

  it('bookmark: the app and its assets load without a token (they hold no user data); API calls and /ws get 401', async () => {
    const server = await startGated();
    const html = { accept: 'text/html,application/xhtml+xml' };
    for (const path of ['/', '/settings/appearance', '/no-such-path']) {
      const page = await send(server, path, { headers: html });
      expect(page.status, path).toBe(200);
      expect(page.body, path).toContain('<div id="root"></div>');
    }
    expect((await send(server, '/index.html')).status).toBe(200);
    const asset = await send(server, '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.body).toContain('console.log');
    expect((await send(server, '/assets/missing.js')).status).toBe(404);

    for (const path of ['/api/v1/anything', TAB_CHECK_PATH, '/api', '/ws']) {
      const api = await send(server, path, { headers: { accept: 'application/json' } });
      expect(api.status, path).toBe(401);
      expect(JSON.parse(api.body), path).toMatchObject({ error: { code: 'unauthorized' } });
    }
    // A method that could change something is never static, whatever the path.
    expect((await send(server, '/settings', { method: 'POST', headers: { ...html, origin: server.url } })).status).toBe(401);
    expect(await upgradeRaw(server, { origin: server.url })).toBe(401);
  });

  it('cookie only: a valid-looking old session cookie opens nothing; the same requests with the token pass', async () => {
    const server = await startGated();
    const cookie = oldCookie(server);
    expect((await send(server, TAB_CHECK_PATH, { headers: { cookie } })).status).toBe(401);
    expect((await send(server, '/api/server/quit', { method: 'POST', headers: { cookie, origin: server.url } })).status).toBe(401);
    expect(await upgradeRaw(server, { cookie, origin: server.url })).toBe(401);

    const tab = await signInRaw(server);
    expect((await send(server, TAB_CHECK_PATH, { headers: { cookie, ...bearer(tab) } })).status).toBe(204);
    expect(await upgrade(server, tab, { cookie, origin: server.url })).toBe(101);
  });

  it('token: the WebSocket needs ogden.v1 and exactly one ogden.auth.<token>, and the server echoes only ogden.v1', async () => {
    const server = await startGated();
    const tab = await signInRaw(server);
    const origin = { origin: server.url };

    const ok = await upgradeWith(server, tab.protocols, origin);
    expect(ok.status).toBe(101);
    expect(ok.protocol).toBe(WS_PROTOCOL);
    // The echo is ogden.v1 even when the token's offer comes first.
    const reversed = await upgradeWith(server, [tab.protocols[1], tab.protocols[0]], origin);
    expect(reversed.protocol).toBe(WS_PROTOCOL);

    const other = await signInRaw(server, codeOfLink(server.issueLaunchUrl()));
    const refused: Array<[string, string[], Record<string, string>]> = [
      ['no offer', [], origin],
      ['token without ogden.v1', [tab.protocols[1]], origin],
      ['ogden.v1 without token', [WS_PROTOCOL], origin],
      ['two tokens', [WS_PROTOCOL, tab.protocols[1], other.protocols[1]], origin],
      ['empty token', [WS_PROTOCOL, 'ogden.auth.'], origin],
      ['Bearer header instead of the subprotocol', [WS_PROTOCOL], { ...origin, ...bearer(tab) }],
    ];
    for (const [what, protocols, headers] of refused) {
      expect((await upgradeWith(server, protocols, headers)).status, what).toBe(401);
    }
    // Never in a query string.
    expect((await upgradeWith(server, [WS_PROTOCOL], origin, `/ws?token=${tab.token}`)).status).toBe(401);
    expect((await send(server, `${TAB_CHECK_PATH}?token=${tab.token}`)).status).toBe(401);
  });

  it('wrong token: a tampered, foreign or malformed token gets 401 on the API and on /ws', async () => {
    const server = await startGated();
    const tab = await signInRaw(server);
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const forged = {
      flipped: flip(tab.token),
      truncated: tab.token.slice(0, -1),
      longer: `${tab.token}A`,
      minted: createTabTokens().mint(),
      garbage: 'not-a-token',
    };
    for (const [what, token] of Object.entries(forged)) {
      expect((await send(server, TAB_CHECK_PATH, { headers: { authorization: `Bearer ${token}` } })).status, what).toBe(401);
      expect(await upgrade(server, tabOf(token, server.url), { origin: server.url }), what).toBe(401);
    }
    for (const authorization of ['', 'Bearer', `Basic ${tab.token}`, tab.token, `Bearer ${tab.token} extra`]) {
      expect((await send(server, TAB_CHECK_PATH, { headers: { authorization } })).status, authorization).toBe(401);
    }
    expect((await send(server, TAB_CHECK_PATH, { headers: { authorization: `bearer ${tab.token}` } })).status).toBe(204);
  });

  it('expiry: a token unused for 12 hours is forgotten; each use restarts the clock; an open socket keeps it alive', async () => {
    const clock = manualClock();
    const server = await startGated({ now: clock.now });
    const idle = await signInRaw(server);
    const used = await signInRaw(server, codeOfLink(server.issueLaunchUrl()));
    const connected = await signInRaw(server, codeOfLink(server.issueLaunchUrl()));
    const socket = await upgradeWith(server, connected.protocols, { origin: server.url });
    expect(socket.status).toBe(101);

    clock.advance(TAB_TOKEN_IDLE_TTL_MS - 60_000);
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(used) })).status).toBe(204);
    clock.advance(120_000);
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(idle) })).status).toBe(401);
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(used) })).status).toBe(204);
    // Held by its open socket, well past the idle limit.
    clock.advance(TAB_TOKEN_IDLE_TTL_MS * 2);
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(connected) })).status).toBe(204);
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(used) })).status).toBe(401);

    // Once the socket closes, the idle clock runs again from then.
    await new Promise<void>((resolve) => {
      socket.ws.once('close', () => resolve());
      socket.ws.close();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    clock.advance(TAB_TOKEN_IDLE_TTL_MS + 1_000);
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(connected) })).status).toBe(401);
  });

  it('new tab: POST /api/launch-codes returns a fresh launch link on the same host, which opens a second tab with its own token', async () => {
    const lines: string[] = [];
    const server = await startGated({ lines });
    const tab = await signInRaw(server);

    const reply = await send(server, LAUNCH_CODES_PATH, { method: 'POST', headers: tab.headers });
    expect(reply.status).toBe(201);
    expect(reply.headers['cache-control']).toBe('no-store');
    const { launchUrl } = JSON.parse(reply.body) as { launchUrl: string };
    expect(launchUrl).toMatch(new RegExp(`^${server.url.replaceAll('.', '\\.')}/#c=[A-Za-z0-9_-]{43}$`));
    const second = tabOf(await exchange(launchUrl), server.url);
    expect(second.token).not.toBe(tab.token);
    for (const t of [tab, second]) expect((await send(server, TAB_CHECK_PATH, { headers: bearer(t) })).status).toBe(204);
    // Spent.
    await expect(exchange(launchUrl)).rejects.toThrow(/401/);

    // A tab on localhost gets a link on localhost, so its new tab shares its storage origin.
    const local = `http://localhost:${server.port}`;
    const fromLocalhost = await send(server, LAUNCH_CODES_PATH, {
      method: 'POST',
      headers: { host: `localhost:${server.port}`, ...bearer(tab), origin: local },
    });
    expect((JSON.parse(fromLocalhost.body) as { launchUrl: string }).launchUrl.startsWith(`${local}/#c=`)).toBe(true);

    // It needs the token (401) and, as a POST, a matching Origin (403).
    expect((await send(server, LAUNCH_CODES_PATH, { method: 'POST', headers: { origin: server.url } })).status).toBe(401);
    expect((await send(server, LAUNCH_CODES_PATH, { method: 'POST', headers: bearer(tab) })).status).toBe(403);
    expect((await send(server, LAUNCH_CODES_PATH, { method: 'POST', headers: { ...bearer(tab), origin: 'http://evil.example' } })).status).toBe(403);
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toContain('launch code issued for a new tab');
    expect(lines.join('')).not.toContain(codeOfLink(launchUrl));
  });

  it('code reuse: a second exchange is refused with 401 and no token, and logged without the code', async () => {
    const lines: string[] = [];
    const server = await startGated({ lines });
    await signInRaw(server);
    const again = await exchangeRaw(server, { code: codeOf(server) });
    expect(again.status).toBe(401);
    expect(again.body).not.toContain('token"');
    expect(again.headers['set-cookie']).toBeUndefined();
    expect(server.tabs.size()).toBe(1);
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toContain('launch code rejected');
    expect(lines.join('')).not.toContain(codeOf(server));
  });

  it('refuses a missing, unknown or malformed code, a foreign or missing Origin, and the retired GET /auth', async () => {
    const server = await startGated();
    const bodies: unknown[] = ['', 'not json', {}, { code: '' }, { code: 'nope' }, { code: `${codeOf(server)}x` }, { code: 7 }, [codeOf(server)]];
    for (const body of bodies) {
      expect((await exchangeRaw(server, body)).status, JSON.stringify(body)).toBe(401);
    }
    // Host and Origin are checked; no token is needed or accepted instead.
    expect((await exchangeRaw(server, { code: codeOf(server) }, {})).status).toBe(403);
    expect((await exchangeRaw(server, { code: codeOf(server) }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await send(server, `${TAB_EXCHANGE_PATH}?code=${codeOf(server)}`)).status).toBe(401);
    // GET /auth is just an app URL now: the launch state's page, never a token.
    const retired = await send(server, `/auth?code=${codeOf(server)}`);
    expect(retired.status).toBe(200);
    expect(retired.body).toContain('<div id="root"></div>');
    expect(retired.headers.location).toBeUndefined();
    expect(server.tabs.size()).toBe(0);
    // None of those spent the real code.
    await signInRaw(server);
  });

  it('code expiry: an exchange 61 s after issue is refused; one at 59 s works', async () => {
    const late = manualClock();
    const expired = await startGated({ now: late.now });
    late.advance(61_000);
    const reply = await exchangeRaw(expired, { code: codeOf(expired) });
    expect(reply.status).toBe(401);
    expect(expired.tabs.size()).toBe(0);

    const early = manualClock();
    const fresh = await startGated({ now: early.now });
    early.advance(LAUNCH_CODE_TTL_MS - 1_000);
    await signInRaw(fresh);
  });

  it('bad Host: a foreign host or a wrong port gets 403, even with a valid token or a fresh code', async () => {
    const server = await startGated();
    const hosts = ['evil.example', `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, `localhost:${server.port + 1}`, '127.0.0.1', `[::1]:${server.port}`];
    for (const host of hosts) {
      expect((await exchangeRaw(server, { code: codeOf(server) }, { host, origin: `http://${host}` })).status, host).toBe(403);
    }
    // The refused exchanges didn't spend the code.
    const tab = await signInRaw(server);
    for (const host of hosts) {
      const page = await send(server, '/', { headers: { host } });
      expect(page.status, host).toBe(403);
      expect(page.body).not.toContain('id="root"');
      expect((await send(server, TAB_CHECK_PATH, { headers: { host, ...bearer(tab) } })).status, host).toBe(403);
    }
    // localhost on the bound port is allowed.
    expect((await send(server, '/', { headers: { host: `localhost:${server.port}` } })).status).toBe(200);
    expect((await send(server, TAB_CHECK_PATH, { headers: { host: `localhost:${server.port}`, ...bearer(tab) } })).status).toBe(204);
  });

  it('bad Origin: /ws and POST with a missing or foreign Origin get 403, even with a valid token', async () => {
    const server = await startGated();
    const tab = await signInRaw(server);
    const foreign = ['http://evil.example', `http://evil.example:${server.port}`, `http://127.0.0.1:${server.port + 1}`, `https://127.0.0.1:${server.port}`, 'null'];

    expect(await upgrade(server, tab, {})).toBe(403);
    for (const origin of foreign) expect(await upgrade(server, tab, { origin }), origin).toBe(403);

    expect((await send(server, '/', { method: 'POST', headers: bearer(tab) })).status).toBe(403);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const origin of foreign) {
        expect((await send(server, '/', { method, headers: { ...bearer(tab), origin } })).status, `${method} ${origin}`).toBe(403);
      }
    }

    // A matching Origin (either loopback name) gets past the gate.
    expect(await upgrade(server, tab, { origin: server.url })).toBe(101);
    expect(await upgrade(server, tab, { origin: `http://localhost:${server.port}` })).toBe(101);
    expect((await send(server, '/', { method: 'POST', headers: tab.headers })).status).not.toBe(403);
    // GET needs no Origin.
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(tab) })).status).toBe(204);
  });

  it('restart: tokens live in memory only, so a restarted server refuses the old one; a new launch link works', async () => {
    const dataDir = tempDataDir();
    const first = await startGated({ dataDir });
    const port = first.port;
    const tab = await signInRaw(first);
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await startGated({ dataDir, port });
    expect((await send(second, TAB_CHECK_PATH, { headers: bearer(tab) })).status).toBe(401);
    expect(await upgrade(second, tab, { origin: second.url })).toBe(401);
    const fresh = await signInRaw(second);
    expect(await firstEvent(second, fresh)).toBe('server.started');
  });

  it('an ordinary request carrying Upgrade and the token subprotocol is not an upgrade: it needs Bearer, and gets the CSP', async () => {
    const server = await startGated();
    const tab = await signInRaw(server);
    const fake = { upgrade: 'websocket', connection: 'keep-alive', 'sec-websocket-protocol': tab.protocols.join(', '), origin: server.url };
    for (const path of [TAB_CHECK_PATH, '/api/launch-codes', '/ws']) {
      const reply = await send(server, path, { headers: fake });
      expect(reply.status, path).toBe(401);
      expect(String(reply.headers['content-security-policy']), path).toContain("script-src 'self'");
    }
    expect((await send(server, LAUNCH_CODES_PATH, { method: 'POST', headers: fake })).status).toBe(401);
    // The subprotocol opens only a real upgrade to /ws; with Bearer the same request passes.
    expect((await send(server, TAB_CHECK_PATH, { headers: { ...fake, ...bearer(tab) } })).status).toBe(204);
    // A fake upgrade to a static path is just the static app.
    const page = await send(server, '/', { headers: fake });
    expect(page.status).toBe(200);
    expect(String(page.headers['content-security-policy'])).toContain("script-src 'self'");
  });

  it('a refused WebSocket upgrade carries the CSP too', async () => {
    const server = await startGated();
    const csp = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { origin: server.url } });
      sockets.push(ws);
      ws.once('unexpected-response', (_req, res) => {
        resolve(String(res.headers['content-security-policy']));
        res.resume();
      });
      ws.once('error', reject);
    });
    expect(csp).toContain("script-src 'self'");
  });

  it('/api, /api/*, /ws and /ws/* never fall back to the app shell, even with a valid token', async () => {
    const server = await startGated();
    const tab = await signInRaw(server);
    for (const path of ['/api', '/api/', '/api/nothing', '/ws/', '/ws/x', '/launcher']) {
      const reply = await send(server, path, { headers: bearer(tab) });
      expect(reply.body, path).not.toContain('id="root"');
      expect([401, 404], path).toContain(reply.status);
    }
    for (const path of ['/ws/', '/ws/x']) {
      const reply = await upgradeWith(server, tab.protocols, { origin: server.url }, path);
      expect(reply.status, path).not.toBe(101);
      expect(reply.status, path).not.toBe(200);
    }
  });

  it('retires the old cookie-signing key: a leftover auth.key is deleted at start', async () => {
    const dataDir = tempDataDir();
    writeFileSync(join(dataDir, LEGACY_AUTH_KEY_FILE), Buffer.alloc(32, 7));
    const server = await startGated({ dataDir });
    expect(existsSync(join(server.dataDir, LEGACY_AUTH_KEY_FILE))).toBe(false);
  });

  it('logs: requests carrying a token, a subprotocol or a code never put them in the log', async () => {
    const lines: string[] = [];
    const server = await startGated({ lines });
    const tab = await signInRaw(server);
    await send(server, TAB_CHECK_PATH, { headers: bearer(tab) });
    await send(server, TAB_CHECK_PATH, { headers: { authorization: 'Bearer forged-token-value' } });
    await upgrade(server, tab, { origin: 'http://evil.example' });
    await upgrade(server, tab, { origin: server.url });
    await exchangeRaw(server, { code: codeOf(server) });
    await send(server, '/launcher/hello', { headers: bearer(tab) });
    const all = lines.join('');
    for (const secret of [tab.token, 'forged-token-value', codeOf(server)]) expect(all).not.toContain(secret);
  });

  it('CSP: every response carries a policy that allows only the app\'s own scripts', async () => {
    const server = await startGated();
    const tab = await signInRaw(server);
    const replies = [
      await send(server, '/'),
      await send(server, '/settings/appearance'),
      await send(server, '/assets/app.js'),
      await send(server, TAB_CHECK_PATH),
      await send(server, TAB_CHECK_PATH, { headers: bearer(tab) }),
    ];
    for (const reply of replies) {
      const csp = String(reply.headers['content-security-policy']);
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:${server.port} ws://localhost:${server.port}`);
      expect(csp).toContain("frame-ancestors 'none'");
      const scripts = /script-src ([^;]*)/.exec(csp)![1]!;
      expect(scripts).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    }
  });

  it('port file: server.json holds port, pid, version and start time, mode 0600, and is gone after close', async () => {
    const server = await startGated();
    const file = join(server.dataDir, PORT_FILE);
    const contents = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(contents).toEqual({
      port: server.port,
      pid: process.pid,
      version: server.version,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/),
    });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    // The launch code is a secret and never lands in the port file.
    expect(readFileSync(file, 'utf8')).not.toContain(codeOf(server));

    await server.close();
    running.splice(running.indexOf(server), 1);
    expect(() => statSync(file)).toThrow();
  });

  it("close leaves another server's port file alone", async () => {
    const dataDir = tempDataDir();
    const first = await startGated({ dataDir });
    // Another server's record replaced ours (only one runs per data folder, but a file can still change).
    const theirs = JSON.stringify({ port: first.port + 1, pid: 1, version: 'x', startedAt: new Date().toISOString() });
    writeFileSync(join(dataDir, PORT_FILE), theirs);
    await first.close();
    running.splice(running.indexOf(first), 1);
    expect(readFileSync(join(dataDir, PORT_FILE), 'utf8')).toBe(theirs);
  });
});

describe('gate placement', () => {
  it('registers no route outside /api, /ws and /launcher except the static files and the SPA shell, which alone are token-free', () => {
    const core = openCore(tempDataDir());
    try {
      const log = createLogger(() => {});
      const gate = createGate({ port: () => 1, codes: createLaunchCodes(), tabs: createTabTokens(), log });
      const control = {
        info: () => ({ version: '0', pid: 1, port: 1, busySessions: 0 }),
        issueLaunchUrl: () => '',
        restartWhenIdle: () => ({ restarting: false, busySessions: 0 }),
        quit: () => ({ stopping: false, busySessions: 0 }),
      };
      const toolchain = {
        status: async () => ({ state: 'missing' as const }),
        installUv: async () => ({ started: false, uv: { state: 'missing' as const } }),
        settled: async () => {},
      };
      const app = createApp({ events: core.events, webRoot: webRoot(), log, gate, control, toolchain, tabs: createTabTokens() });
      const outside = app.routes.filter((route) => !isServerPath(route.path)).map((route) => `${route.method} ${route.path}`);
      // The gate and the static files (ALL /*), then the SPA shell's guard and index.html (GET /*). Nothing else:
      // a new page-level route would be reachable without a token, so it must live under /api instead.
      expect(outside).toEqual(['ALL /*', 'ALL /*', 'GET /*', 'GET /*']);
      expect(app.routes[0]!.handler).toBe(gate);
    } finally {
      core.close();
    }
  });


  it('is the first handler registered, for every method and path', () => {
    const core = openCore(tempDataDir());
    try {
      const log = createLogger(() => {});
      const gate = createGate({ port: () => 1, codes: createLaunchCodes(), tabs: createTabTokens(), log });
      const app = createApp({ events: core.events, webRoot: webRoot(), log, gate });
      expect(app.routes[0]).toMatchObject({ method: 'ALL', path: '/*', handler: gate });
    } finally {
      core.close();
    }
  });

  it('refuses everything while the port is unknown', async () => {
    const core = openCore(tempDataDir());
    try {
      const log = createLogger(() => {});
      const codes = createLaunchCodes();
      const code = codes.issue();
      const gate = createGate({ port: () => undefined, codes, tabs: createTabTokens(), log });
      const app = createApp({ events: core.events, webRoot: webRoot(), log, gate });
      const response = await app.request(TAB_EXCHANGE_PATH, {
        method: 'POST',
        headers: { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      expect(response.status).toBe(403);
    } finally {
      core.close();
    }
  });
});

describe('launch codes', () => {
  it('are single-use, random and expire after 60 s', () => {
    const clock = manualClock();
    const codes = createLaunchCodes(clock.now);
    const a = codes.issue();
    const b = codes.issue();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url').length * 8).toBeGreaterThanOrEqual(128);
    expect(codes.redeem(a)).toBe(true);
    expect(codes.redeem(a)).toBe(false);
    clock.advance(LAUNCH_CODE_TTL_MS);
    expect(codes.redeem(b)).toBe(false);
  });
});
