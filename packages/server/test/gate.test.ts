/**
 * The security gate (AD-15 as amended in story 2.1), end to end against a
 * real server: every row of the story's I/O matrix that the server decides,
 * with the clock injected for expiry. The page's side (reload, launch state,
 * New tab, CSP in force) is in tests/e2e/tab-token.spec.ts.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_AUTH_KEY_FILE, openCore, PORT_FILE } from '@ogden-agents/core';
import { API_BASE, API_ROUTES, ApiErrorBody, TERMINAL_SOCKET_ROUTE, TEST_ROUTES, WS_PROTOCOL } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { createLaunchCodes, createTabTokens, LAUNCH_CODE_TTL_MS, TAB_TOKEN_IDLE_TTL_MS } from '../src/auth.js';
import { guardedRouteKeys } from '../src/bmad-pieces.js';
import { createGate } from '../src/gate.js';
import { isApiPath, isServerPath } from '../src/paths.js';
import { createLogger } from '../src/log.js';
import type { RunningServer } from '../src/start.js';
import {
  codeOfLink,
  connectTab,
  exchange,
  manualClock,
  send,
  fullTestApp,
  startTestServer,
  tabOf,
  tempDataDir,
  tinyWebRoot,
  trackSocket,
  type Reply,
  type SignedIn,
} from './helpers.js';

const { launchCodes: LAUNCH_CODES_PATH, tabCheck: TAB_CHECK_PATH, tabExchange: TAB_EXCHANGE_PATH } = API_ROUTES;

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
    trackSocket(ws);
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
    trackSocket(ws);
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
    trackSocket(ws);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 })));
    ws.once('message', (data) => resolve((JSON.parse(String(data)) as { type: string }).type));
    ws.once('error', reject);
  });
}

const codeOf = (server: { launchUrl: string }) => codeOfLink(server.launchUrl);

/** POSTs `body` to the code exchange as the page would, with its Origin unless `headers` say otherwise. */
function exchangeRaw(server: RunningServer, body: unknown, headers: Record<string, string> = { origin: server.url }): Promise<Reply> {
  return send(server, TAB_EXCHANGE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A tab's token as a Bearer header, without an Origin. */
const bearer = (tab: SignedIn) => ({ authorization: `Bearer ${tab.token}` });

/** A cookie as story 1.4's gate set it: signed, port-specific, and now ignored. */
const oldCookie = (server: RunningServer) =>
  `ogden_session_${server.port}=AAAAAAAAAAAAAAAAAAAAAA.${Math.floor(Date.now() / 1000) + 3600}.${'A'.repeat(43)}`;

describe('security gate', () => {
  it('launch: the link is /#c=<code>; the code is exchanged over POST for a token in the body, never in a URL, with no cookie; the token opens the API and /ws', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
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
    const server = await startTestServer();
    const html = { accept: 'text/html,application/xhtml+xml' };
    for (const path of ['/', '/settings/appearance', '/no-such-path', '/w/ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3/board/1.2']) {
      const page = await send(server, path, { headers: html });
      expect(page.status, path).toBe(200);
      expect(page.body, path).toContain('<div id="root"></div>');
    }
    expect((await send(server, '/index.html')).status).toBe(200);
    const asset = await send(server, '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.body).toContain('console.log');
    expect((await send(server, '/assets/missing.js')).status).toBe(404);
    expect((await send(server, '/w/ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3/board/1.2/x.js')).status).toBe(404);
    expect((await send(server, '/w/ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3/board/%7Emain.js')).status).toBe(404);

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
    const server = await startTestServer();
    const cookie = oldCookie(server);
    expect((await send(server, TAB_CHECK_PATH, { headers: { cookie } })).status).toBe(401);
    expect((await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: { cookie, origin: server.url } })).status).toBe(401);
    expect(await upgradeRaw(server, { cookie, origin: server.url })).toBe(401);

    const tab = await connectTab(server);
    expect((await send(server, TAB_CHECK_PATH, { headers: { cookie, ...bearer(tab) } })).status).toBe(204);
    expect(await upgrade(server, tab, { cookie, origin: server.url })).toBe(101);
  });

  it('token: the WebSocket needs ogden.v1 and exactly one ogden.auth.<token>, and the server echoes only ogden.v1', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    const origin = { origin: server.url };

    const ok = await upgradeWith(server, tab.protocols, origin);
    expect(ok.status).toBe(101);
    expect(ok.protocol).toBe(WS_PROTOCOL);
    // The echo is ogden.v1 even when the token's offer comes first.
    const reversed = await upgradeWith(server, [tab.protocols[1], tab.protocols[0]], origin);
    expect(reversed.protocol).toBe(WS_PROTOCOL);

    const other = await connectTab(server, server.issueLaunchUrl());
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
    const server = await startTestServer();
    const tab = await connectTab(server);
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
    const server = await startTestServer({ now: clock.now });
    const idle = await connectTab(server);
    const used = await connectTab(server, server.issueLaunchUrl());
    const connected = await connectTab(server, server.issueLaunchUrl());
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

  it('new tab: POST /api/v1/launch-codes returns a fresh launch link on the same host, which opens a second tab with its own token', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const tab = await connectTab(server);

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
    const server = await startTestServer({ lines });
    await connectTab(server);
    const again = await exchangeRaw(server, { code: codeOf(server) });
    expect(again.status).toBe(401);
    expect(again.body).not.toContain('token"');
    expect(again.headers['set-cookie']).toBeUndefined();
    expect(server.tabs.size()).toBe(1);
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toContain('launch code rejected');
    expect(lines.join('')).not.toContain(codeOf(server));
  });

  it('refuses a missing, unknown or malformed code, a foreign or missing Origin, and the retired GET /auth', async () => {
    const server = await startTestServer();
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
    await connectTab(server);
  });

  it('code expiry: an exchange 61 s after issue is refused; one at 59 s works', async () => {
    const late = manualClock();
    const expired = await startTestServer({ now: late.now });
    late.advance(61_000);
    const reply = await exchangeRaw(expired, { code: codeOf(expired) });
    expect(reply.status).toBe(401);
    expect(expired.tabs.size()).toBe(0);

    const early = manualClock();
    const fresh = await startTestServer({ now: early.now });
    early.advance(LAUNCH_CODE_TTL_MS - 1_000);
    await connectTab(fresh);
  });

  it('bad Host: a foreign host or a wrong port gets 403, even with a valid token or a fresh code', async () => {
    const server = await startTestServer();
    const hosts = ['evil.example', `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, `localhost:${server.port + 1}`, '127.0.0.1', `[::1]:${server.port}`];
    for (const host of hosts) {
      expect((await exchangeRaw(server, { code: codeOf(server) }, { host, origin: `http://${host}` })).status, host).toBe(403);
    }
    // The refused exchanges didn't spend the code.
    const tab = await connectTab(server);
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
    const server = await startTestServer();
    const tab = await connectTab(server);
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

  it.each([
    ['terminal socket (story 3.1): /ws/terminal/*', '/ws/terminal/ses_00000000000000000000000000'],
    ['pane socket (epic 16): /ws/pane/*', '/ws/pane/pan_00000000000000000000000000'],
  ])('%s needs the tab token subprotocol and a matching Origin exactly like /ws, and echoes only ogden.v1', async (_name, path) => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    const other = await connectTab(server, server.issueLaunchUrl());
    const origin = { origin: server.url };
    const status = async (protocols: string[], headers: Record<string, string>) => (await upgradeWith(server, protocols, headers, path)).status;

    // Unauthenticated: no offer, no token, a forged or second token, the token in the query or as Bearer.
    expect(await status([], origin)).toBe(401);
    expect(await status([WS_PROTOCOL], origin)).toBe(401);
    expect(await status([tab.protocols[1]], origin)).toBe(401);
    expect(await status([WS_PROTOCOL, `ogden.auth.${'A'.repeat(43)}`], origin)).toBe(401);
    expect(await status([WS_PROTOCOL, tab.protocols[1], other.protocols[1]], origin)).toBe(401);
    expect((await upgradeWith(server, [WS_PROTOCOL], origin, `${path}?token=${tab.token}`)).status).toBe(401);
    expect(await status([WS_PROTOCOL], { ...origin, ...bearer(tab) })).toBe(401);
    // A valid token from a foreign or missing Origin, or to a foreign Host.
    expect(await status(tab.protocols, {})).toBe(403);
    for (const foreign of ['http://evil.example', `http://127.0.0.1:${server.port + 1}`, 'null']) {
      expect(await status(tab.protocols, { origin: foreign }), foreign).toBe(403);
    }
    expect(await status(tab.protocols, { ...origin, host: `evil.example:${server.port}` })).toBe(403);

    // The tab's own upgrade passes the gate; only ogden.v1 is echoed, never the token's offer.
    const ok = await upgradeWith(server, [tab.protocols[1], tab.protocols[0]], origin, path);
    expect(ok.status).toBe(101);
    expect(ok.protocol).toBe(WS_PROTOCOL);
  });

  it('restart: tokens live in memory only, so a restarted server refuses the old one; a new launch link works', async () => {
    const dataDir = tempDataDir();
    const first = await startTestServer({ dataDir });
    const port = first.port;
    const tab = await connectTab(first);
    await first.close();

    const second = await startTestServer({ dataDir, port });
    expect((await send(second, TAB_CHECK_PATH, { headers: bearer(tab) })).status).toBe(401);
    expect(await upgrade(second, tab, { origin: second.url })).toBe(401);
    const fresh = await connectTab(second);
    expect(await firstEvent(second, fresh)).toBe('server.started');
  });

  it('an ordinary request carrying Upgrade and the token subprotocol is not an upgrade: it needs Bearer, and gets the CSP', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    const fake = { upgrade: 'websocket', connection: 'keep-alive', 'sec-websocket-protocol': tab.protocols.join(', '), origin: server.url };
    for (const path of [TAB_CHECK_PATH, LAUNCH_CODES_PATH, '/ws']) {
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
    const server = await startTestServer();
    const csp = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { origin: server.url } });
      trackSocket(ws);
      ws.once('unexpected-response', (_req, res) => {
        resolve(String(res.headers['content-security-policy']));
        res.resume();
      });
      ws.once('error', reject);
    });
    expect(csp).toContain("script-src 'self'");
  });

  it('API routes live under /api/v1: the old unversioned paths answer 404, even with a valid token, and still need one', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    const old: Array<[string, string]> = [
      ['GET', '/api/tab'],
      ['POST', '/api/tab/exchange'],
      ['POST', '/api/launch-codes'],
      ['POST', '/api/server/quit'],
      ['GET', '/api/toolchain'],
      ['POST', '/api/toolchain/uv/install'],
    ];
    for (const [method, path] of old) {
      expect((await send(server, path, { method, headers: tab.headers })).status, `${method} ${path}`).toBe(404);
      expect((await send(server, path, { method, headers: { origin: server.url } })).status, `${method} ${path} without a token`).toBe(401);
    }
    // Nothing above stopped the server or spent anything: the new paths answer as before.
    expect((await send(server, TAB_CHECK_PATH, { headers: bearer(tab) })).status).toBe(204);
  });

  it('errors: every refusal from an API, socket or handshake path has the shared error body, with a shared code', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    const replies: Array<[string, number, Reply]> = [
      ['no token', 401, await send(server, TAB_CHECK_PATH)],
      ['wrong token', 401, await send(server, TAB_CHECK_PATH, { headers: { authorization: 'Bearer nope' } })],
      ['no Origin on a POST', 403, await send(server, LAUNCH_CODES_PATH, { method: 'POST', headers: bearer(tab) })],
      ['foreign Host', 403, await send(server, TAB_CHECK_PATH, { headers: { host: 'evil.example', ...bearer(tab) } })],
      ['spent or unknown code', 401, await exchangeRaw(server, { code: 'nope' })],
      ['exchange without Origin', 403, await exchangeRaw(server, { code: 'nope' }, {})],
      ['unknown API path', 404, await send(server, `${API_BASE}/nothing`, { headers: bearer(tab) })],
      ['old unversioned path', 404, await send(server, '/api/tab', { headers: bearer(tab) })],
      ['/ws without an upgrade', 401, await send(server, '/ws')],
      ['handshake without the launcher token', 401, await send(server, '/launcher/hello')],
    ];
    for (const [what, status, reply] of replies) {
      expect(reply.status, what).toBe(status);
      expect(String(reply.headers['content-type']), what).toContain('application/json');
      const body = ApiErrorBody.safeParse(JSON.parse(reply.body));
      expect(body.success, `${what}: ${reply.body}`).toBe(true);
    }
  });

  it('/api, /api/*, /ws and /ws/* never fall back to the app shell, even with a valid token', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
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
    const server = await startTestServer({ dataDir });
    expect(existsSync(join(server.dataDir, LEGACY_AUTH_KEY_FILE))).toBe(false);
  });

  it('logs: requests carrying a token, a subprotocol or a code never put them in the log', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const tab = await connectTab(server);
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
    const server = await startTestServer();
    const tab = await connectTab(server);
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
    const server = await startTestServer();
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
    expect(() => statSync(file)).toThrow();
  });

  it("close leaves another server's port file alone", async () => {
    const dataDir = tempDataDir();
    const first = await startTestServer({ dataDir });
    // Another server's record replaced ours (only one runs per data folder, but a file can still change).
    const theirs = JSON.stringify({ port: first.port + 1, pid: 1, version: 'x', startedAt: new Date().toISOString() });
    writeFileSync(join(dataDir, PORT_FILE), theirs);
    await first.close();
    expect(readFileSync(join(dataDir, PORT_FILE), 'utf8')).toBe(theirs);
  });
});

/** Every API route with its methods, as the lanes' route files register them (stories 2.2, 2.3 and 9.1). */
const EXPECTED_API_ROUTES = [
  `GET ${API_ROUTES.tabCheck}`,
  // Terminal panes (epic 16): behind the gate; Developer mode is enforced by core on every call.
  `GET ${API_ROUTES.workspacePanes}`,
  `POST ${API_ROUTES.workspacePanes}`,
  `DELETE ${API_ROUTES.workspacePane}`,
  `GET ${API_ROUTES.terminalSettings}`,
  `PUT ${API_ROUTES.terminalSettings}`,
  `GET ${API_ROUTES.terminalLaunchers}`,
  `POST ${API_ROUTES.terminalLaunchers}`,
  `PUT ${API_ROUTES.workspacePaneLayout}`,
  `PATCH ${API_ROUTES.workspacePane}`,
  `POST ${API_ROUTES.workspacePaneRestart}`,
  `POST ${API_ROUTES.launchCodes}`,
  `POST ${API_ROUTES.serverQuit}`,
  `GET ${API_ROUTES.toolchain}`,
  `POST ${API_ROUTES.uvInstall}`,
  `GET ${API_ROUTES.workspaces}`,
  `POST ${API_ROUTES.workspaces}`,
  `GET ${API_ROUTES.chatAgents}`,
  `PUT ${API_ROUTES.chatAgentDefaultModel}`,
  `GET ${API_ROUTES.workspace}`,
  `DELETE ${API_ROUTES.workspaceHistory}`,
  `GET ${API_ROUTES.workspaceSettings}`,
  `PATCH ${API_ROUTES.workspaceSettings}`,
  `GET ${API_ROUTES.folders}`,
  `POST ${API_ROUTES.folders}`,
  `GET ${API_ROUTES.workspaceSessions}`,
  `POST ${API_ROUTES.workspaceSessions}`,
  `GET ${API_ROUTES.workspaceSession}`,
  `POST ${API_ROUTES.sessionMessages}`,
  `POST ${API_ROUTES.sessionCancel}`,
  `PATCH ${API_ROUTES.sessionQueuedMessage}`,
  `DELETE ${API_ROUTES.sessionQueuedMessage}`,
  `POST ${API_ROUTES.sessionQueuedMessageSendNow}`,
  `POST ${API_ROUTES.sessionDriver}`,
  `PUT ${API_ROUTES.sessionPermissionMode}`,
  `PUT ${API_ROUTES.sessionTitle}`,
  `PUT ${API_ROUTES.sessionModel}`,
  `GET ${API_ROUTES.sessionHandoff}`,
  `POST ${API_ROUTES.sessionHandoff}`,
  `POST ${API_ROUTES.sessionHandoffPreview}`,
  `POST ${API_ROUTES.sessionPermission}`,
  `GET ${API_ROUTES.permissionRules}`,
  `DELETE ${API_ROUTES.permissionRule}`,
  `GET ${API_ROUTES.appShortcut}`,
  `POST ${API_ROUTES.appShortcut}`,
  `DELETE ${API_ROUTES.appShortcut}`,
  `DELETE ${API_ROUTES.appShortcutOffer}`,
  `GET ${API_ROUTES.agents}`,
  `POST ${API_ROUTES.agentInstall}`,
  `DELETE ${API_ROUTES.agentInstall}`,
  `POST ${API_ROUTES.agentSignOut}`,
  `POST ${API_ROUTES.agentSignIn}`,
  `DELETE ${API_ROUTES.agentSignIn}`,
  `POST ${API_ROUTES.agentSignInCode}`,
  `PUT ${API_ROUTES.agentApiKey}`,
  `DELETE ${API_ROUTES.agentApiKey}`,
  `GET ${API_ROUTES.onboarding}`,
  `PATCH ${API_ROUTES.onboarding}`,
  `GET ${API_ROUTES.bmadPieces}`,
  // The pinned upstream BMad Method (story 4.14): install-level, not a piece's.
  `GET ${API_ROUTES.bmadSource}`,
  `POST ${API_ROUTES.bmadSource}`,
  `GET ${API_ROUTES.newProjectDefaults}`,
  `PATCH ${API_ROUTES.newProjectDefaults}`,
  `GET ${API_ROUTES.developerMode}`,
  `PUT ${API_ROUTES.developerMode}`,
  `GET ${API_ROUTES.chatSettings}`,
  `PUT ${API_ROUTES.chatSettings}`,
  `GET ${API_ROUTES.updates}`,
  `PUT ${API_ROUTES.updates}`,
  `POST ${API_ROUTES.updatesCheck}`,
  `POST ${API_ROUTES.updatesAppRestart}`,
  `PUT ${API_ROUTES.updatesAppChannel}`,
  `GET ${API_ROUTES.workspaceBmadDetection}`,
  `DELETE ${API_ROUTES.workspaceBmadOffer}`,
  // Plan and Board (story 4.1), each through the guarded helper.
  `GET ${API_ROUTES.workspaceCatalog}`,
  `POST ${API_ROUTES.workspacePlanningSessions}`,
  `GET ${API_ROUTES.workspaceTickets}`,
  // Looking back on an epic (story 7.1), guarded with the trust.
  `POST ${API_ROUTES.workspaceEpicLookBack}`,
  `GET ${API_ROUTES.workspaceLookBackOffers}`,
  `DELETE ${API_ROUTES.workspaceEpicLookBackOffer}`,
  `POST ${API_ROUTES.workspaceRetrospectiveSessions}`,
  `POST ${API_ROUTES.workspaceRetrospectiveSave}`,
  // Story 4.2's pre-registered routes (guarded; one ticket filled by 4.8, setup by 4.3, the status write 501 until 4.10) and the script trust (unguarded).
  `GET ${API_ROUTES.workspaceTicket}`,
  `PUT ${API_ROUTES.workspaceTicketStatus}`,
  `GET ${API_ROUTES.workspaceBmadSetup}`,
  `POST ${API_ROUTES.workspaceBmadSetup}`,
  `PUT ${API_ROUTES.workspaceBmadScriptTrust}`,
  // A document a planning session wrote (story 4.7), guarded.
  `GET ${API_ROUTES.workspaceDocument}`,
  // Unattended builds (story 5.2), each through the guarded helper.
  `POST ${API_ROUTES.workspaceBuilds}`,
  `GET ${API_ROUTES.workspaceBuild}`,
  `POST ${API_ROUTES.workspaceBuildApprove}`,
  `POST ${API_ROUTES.workspaceBuildReject}`,
  `POST ${API_ROUTES.workspaceBuildCommitPlan}`,
  `GET ${API_ROUTES.sessionRun}`,
  `GET ${API_ROUTES.workspaceBuildSandbox}`,
  // Epics 5 and 11's other routes (story 5.3), each through the guarded helper, 501 until their lanes.
  `GET ${API_ROUTES.workspaceRuns}`,
  `GET ${API_ROUTES.workspaceRun}`,
  `POST ${API_ROUTES.runStop}`,
  `POST ${API_ROUTES.runRetry}`,
  `POST ${API_ROUTES.runCheckAgain}`,
  `GET ${API_ROUTES.workspaceBuildSettings}`,
  `PATCH ${API_ROUTES.workspaceBuildSettings}`,
  // The install's run limits and notification settings (story 5.3): install-level, behind the gate only.
  `GET ${API_ROUTES.runLimits}`,
  `PATCH ${API_ROUTES.runLimits}`,
  `GET ${API_ROUTES.notificationSettings}`,
  `PATCH ${API_ROUTES.notificationSettings}`,
  `POST ${API_ROUTES.notificationWebhooks}`,
  `PATCH ${API_ROUTES.notificationWebhook}`,
  `DELETE ${API_ROUTES.notificationWebhook}`,
  `POST ${API_ROUTES.notificationWebhookTest}`,
  // The Local model's endpoints (epic 14 story 14.3): install-level, behind the gate only.
  `GET ${API_ROUTES.localEndpoints}`,
  `POST ${API_ROUTES.localEndpoints}`,
  `PATCH ${API_ROUTES.localEndpoint}`,
  `DELETE ${API_ROUTES.localEndpoint}`,
  `PUT ${API_ROUTES.localEndpointKey}`,
  `DELETE ${API_ROUTES.localEndpointKey}`,
  `POST ${API_ROUTES.localEndpointConfirm}`,
  `PUT ${API_ROUTES.localEndpointDefault}`,
  // Using them (story 14.4): the presets, Test connection and Detect, behind the gate only.
  `GET ${API_ROUTES.localEndpointPresets}`,
  `POST ${API_ROUTES.localEndpointTest}`,
  `POST ${API_ROUTES.localEndpointDetect}`,
  `GET ${API_ROUTES.localEndpointModels}`,
  `POST ${API_ROUTES.localEndpointManagerTest}`,
] as const;

describe('gate placement', () => {
  it('registers no route outside /api, /ws and /launcher except the static files and the SPA shell, which alone are token-free', () => {
    const core = openCore(tempDataDir());
    try {
      const gate = createGate({ port: () => 1, codes: createLaunchCodes(), tabs: createTabTokens(), log: createLogger(() => {}) });
      const app = fullTestApp(core, { gate });
      // Every lane's route (stories 2.2 and 2.3) is registered with exactly its methods, both ways:
      // a missing route or a stray extra method on a known path fails. The code exchange is
      // answered by the gate itself and registers no route.
      const registered = [...new Set(app.routes.filter((route) => isApiPath(route.path)).map((route) => `${route.method} ${route.path}`))].sort();
      expect(registered).toEqual([...EXPECTED_API_ROUTES].sort());
      // Every shared route has a handler; the code exchange is answered by the gate itself.
      for (const path of Object.values(API_ROUTES).filter((route) => route !== API_ROUTES.tabExchange)) {
        expect(app.routes.map((route) => route.path), path).toContain(path);
      }
      const outside = app.routes.filter((route) => !isServerPath(route.path)).map((route) => `${route.method} ${route.path}`);
      // The gate and the static files (ALL /*), then the SPA shell's guard and index.html (GET /*). Nothing else:
      // a new page-level route would be reachable without a token, so it must live under /api instead.
      expect(outside).toEqual(['ALL /*', 'ALL /*', 'GET /*', 'GET /*']);
      expect(app.routes[0]!.handler).toBe(gate);
      // Both sockets, the events' and the terminal's (story 3.2), are registered after the gate, GET only.
      const sockets = app.routes.flatMap((route, index) => (route.path.startsWith('/ws') ? [{ route: `${route.method} ${route.path}`, index }] : []));
      expect(sockets.map((socket) => socket.route).sort()).toEqual(['GET /ws', `GET ${TERMINAL_SOCKET_ROUTE}`].sort());
      for (const socket of sockets) expect(socket.index, socket.route).toBeGreaterThan(0);
      // Every API route is one of the shared routes, all under /api/v1 (Conventions).
      const api = app.routes.filter((route) => isApiPath(route.path)).map((route) => route.path);
      expect(api.length).toBeGreaterThan(0);
      for (const path of api) {
        expect(path.startsWith(`${API_BASE}/`), path).toBe(true);
        expect(Object.values(API_ROUTES) as string[], path).toContain(path);
      }
    } finally {
      core.close();
    }
  });


  it("registers a BMad piece's route through the guarded helper, after the gate, inside a workspace under /api/v1 (story 10.2)", () => {
    const core = openCore(tempDataDir());
    try {
      const log = createLogger(() => {});
      const gate = createGate({ port: () => 1, codes: createLaunchCodes(), tabs: createTabTokens(), log });
      const app = createApp({ events: core.events, webRoot: tinyWebRoot(), log, gate, bmad: core.bmad, bmadScriptTrust: core.bmadScriptTrust, bmadProbe: true });
      // The routes serving a piece: Plan and Board (stories 4.1 and 4.2) and the test probe (10.1); epics 5 to 7 add theirs the same way.
      const pieceRoutes = [
        `GET ${API_ROUTES.workspaceCatalog}`,
        `POST ${API_ROUTES.workspacePlanningSessions}`,
        `GET ${API_ROUTES.workspaceTickets}`,
        `POST ${API_ROUTES.workspaceEpicLookBack}`,
        `GET ${API_ROUTES.workspaceLookBackOffers}`,
        `DELETE ${API_ROUTES.workspaceEpicLookBackOffer}`,
        `POST ${API_ROUTES.workspaceRetrospectiveSessions}`,
        `POST ${API_ROUTES.workspaceRetrospectiveSave}`,
        `GET ${API_ROUTES.workspaceTicket}`,
        `PUT ${API_ROUTES.workspaceTicketStatus}`,
        `GET ${API_ROUTES.workspaceBmadSetup}`,
        `POST ${API_ROUTES.workspaceBmadSetup}`,
        `GET ${API_ROUTES.workspaceDocument}`,
        `POST ${API_ROUTES.workspaceBuilds}`,
        `GET ${API_ROUTES.workspaceBuild}`,
        `POST ${API_ROUTES.workspaceBuildApprove}`,
        `POST ${API_ROUTES.workspaceBuildReject}`,
        `POST ${API_ROUTES.workspaceBuildCommitPlan}`,
        `GET ${API_ROUTES.sessionRun}`,
        `GET ${API_ROUTES.workspaceBuildSandbox}`,
        `GET ${API_ROUTES.workspaceRuns}`,
        `GET ${API_ROUTES.workspaceRun}`,
        `POST ${API_ROUTES.runStop}`,
        `POST ${API_ROUTES.runRetry}`,
        `POST ${API_ROUTES.runCheckAgain}`,
        `GET ${API_ROUTES.workspaceBuildSettings}`,
        `PATCH ${API_ROUTES.workspaceBuildSettings}`,
      ];
      expect(guardedRouteKeys(app)).toEqual([...pieceRoutes, `GET ${TEST_ROUTES.bmadProbe}`].sort());
      for (const key of guardedRouteKeys(app)) expect(key.slice(key.indexOf(' ') + 1).startsWith(`${API_BASE}/workspaces/:wsId/`), key).toBe(true);
      const index = app.routes.findIndex((route) => route.path === TEST_ROUTES.bmadProbe);
      expect(index).toBeGreaterThan(0);
      expect(TEST_ROUTES.bmadProbe.startsWith(`${API_BASE}/workspaces/:wsId/`)).toBe(true);
      // Without the probe's hook only Plan and Board serve a piece; without core's guard, or its script trust, nothing does.
      expect(guardedRouteKeys(createApp({ events: core.events, webRoot: tinyWebRoot(), log, gate, bmad: core.bmad, bmadScriptTrust: core.bmadScriptTrust }))).toEqual(
        pieceRoutes.sort(),
      );
      expect(guardedRouteKeys(createApp({ events: core.events, webRoot: tinyWebRoot(), log, gate, bmad: core.bmad }))).toEqual([]);
      expect(guardedRouteKeys(createApp({ events: core.events, webRoot: tinyWebRoot(), log, gate }))).toEqual([]);
    } finally {
      core.close();
    }
  });

  it('is the first handler registered, for every method and path', () => {
    const core = openCore(tempDataDir());
    try {
      const log = createLogger(() => {});
      const gate = createGate({ port: () => 1, codes: createLaunchCodes(), tabs: createTabTokens(), log });
      const app = createApp({ events: core.events, webRoot: tinyWebRoot(), log, gate });
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
      const app = createApp({ events: core.events, webRoot: tinyWebRoot(), log, gate });
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
