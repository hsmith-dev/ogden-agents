/**
 * The security gate (AD-15), end to end against a real server: every row of
 * the story's I/O matrix, with the clock injected for expiry.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { AUTH_KEY_FILE, openCore, PORT_FILE } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app.js';
import { createLaunchCodes, createSessions, LAUNCH_CODE_TTL_MS, sessionCookieName, SESSION_TTL_MS } from '../src/auth.js';
import { createGate } from '../src/gate.js';
import { createLogger } from '../src/log.js';
import { start, type RunningServer, type StartOptions } from '../src/start.js';
import { exchange, tempDataDir } from './helpers.js';

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
  { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {},
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
    req.end();
  });
}

/** Opens `/ws` and resolves with 101 on success, or the refusal's HTTP status. */
function upgrade(server: RunningServer, headers: Record<string, string>): Promise<number> {
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

/** Opens `/ws`, subscribes from the start, and resolves with the first event's type. */
function firstEvent(server: RunningServer, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers });
    sockets.push(ws);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 })));
    ws.once('message', (data) => resolve((JSON.parse(String(data)) as { type: string }).type));
    ws.once('error', reject);
  });
}

const codeOf = (server: RunningServer) => new URL(server.launchUrl).searchParams.get('code')!;
const authPath = (server: RunningServer) => `/auth?code=${codeOf(server)}`;

/** Exchanges the launch code over a raw request and returns the cookie pair. */
async function signInRaw(server: RunningServer): Promise<string> {
  const reply = await send(server, authPath(server));
  expect(reply.status).toBe(303);
  return reply.headers['set-cookie']![0]!.split(';')[0]!;
}

describe('security gate', () => {
  it('launch: the code sets a strict HttpOnly cookie and redirects (303) to /, and then the page and /ws work', async () => {
    const lines: string[] = [];
    const server = await startGated({ lines });
    const reply = await send(server, authPath(server));
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/');
    const [setCookie] = reply.headers['set-cookie']!;
    expect(setCookie).toMatch(new RegExp(`^${sessionCookieName(server.port)}=[^;]+`));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    expect(setCookie).not.toMatch(/Domain=/i);

    const cookie = setCookie!.split(';')[0]!;
    const page = await send(server, '/', { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain('<div id="root"></div>');
    expect((await send(server, '/assets/app.js', { headers: { cookie } })).status).toBe(200);
    expect(await firstEvent(server, { cookie, origin: server.url })).toBe('server.started');

    // Logged as issued and used, never with the code (AD-16).
    const msgs = lines.map((l) => (JSON.parse(l) as { msg: string }).msg);
    expect(msgs).toContain('launch code issued');
    expect(msgs).toContain('launch code used');
    expect(lines.join('')).not.toContain(codeOf(server));
  });

  it('no cookie: a page navigation to an app route gets the launch page (401); assets and API calls get plain 401', async () => {
    const server = await startGated();
    const html = { accept: 'text/html,application/xhtml+xml' };
    const page = await send(server, '/settings/appearance', { headers: html });
    expect(page.status).toBe(401);
    expect(page.body).toContain('Open Ogden Agents from your terminal');
    expect(page.body).not.toContain('id="root"');
    // Styled with DESIGN.md tokens in both themes.
    expect(page.body).toContain('--background: #F6F7F5');
    expect(page.body).toContain('--background: #0F1210');
    expect(page.body).toContain('prefers-color-scheme: dark');

    const asset = await send(server, '/assets/app.js', { headers: html });
    expect(asset.status).toBe(401);
    expect(asset.body).toBe('Unauthorized');
    const api = await send(server, '/api/v1/anything', { headers: { accept: 'application/json' } });
    expect(api.body).toBe('Unauthorized');
    expect((await send(server, '/settings', { method: 'POST', headers: html })).body).toBe('Unauthorized');
  });

  it('signed in: an app route serves the UI, and a missing asset is a 404', async () => {
    const server = await startGated();
    const cookie = await signInRaw(server);
    const page = await send(server, '/settings/appearance', { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.body).toContain('<div id="root"></div>');
    expect((await send(server, '/assets/missing.js', { headers: { cookie } })).status).toBe(404);
    expect((await send(server, '/api/v1/missing', { headers: { cookie } })).status).toBe(404);
  });

  it('the launch URL works through fetch the way a browser follows it', async () => {
    const server = await startGated();
    const cookie = await exchange(server.launchUrl);
    const page = await fetch(server.url, { headers: { cookie } });
    expect(page.status).toBe(200);
  });

  it('no cookie: / gets the "open from your terminal" page (401), an asset 401, /ws is refused', async () => {
    const server = await startGated();
    const page = await send(server, '/');
    expect(page.status).toBe(401);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.body).toContain('npx ogden-agents');
    expect(page.body).toContain('ogden');
    expect(page.body).not.toContain('server.started');
    expect(page.body).not.toContain('id="root"');

    const asset = await send(server, '/assets/app.js');
    expect(asset.status).toBe(401);
    expect(asset.body).not.toContain('console.log');
    expect((await send(server, '/index.html')).status).toBe(401);
    expect((await send(server, '/no-such-path')).status).toBe(401);

    expect(await upgrade(server, { origin: server.url })).toBe(401);
  });

  it('code reuse: a second exchange is refused with 401 and no cookie, and logged without the code', async () => {
    const lines: string[] = [];
    const server = await startGated({ lines });
    await signInRaw(server);
    const again = await send(server, authPath(server));
    expect(again.status).toBe(401);
    expect(again.headers['set-cookie']).toBeUndefined();
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toContain('launch code rejected');
    expect(lines.join('')).not.toContain(codeOf(server));
  });

  it('refuses a missing, unknown or malformed code', async () => {
    const server = await startGated();
    for (const path of ['/auth', '/auth?code=', '/auth?code=nope', `/auth?code=${codeOf(server)}x`]) {
      const reply = await send(server, path);
      expect(reply.status, path).toBe(401);
      expect(reply.headers['set-cookie'], path).toBeUndefined();
    }
    // None of those spent the real code.
    await signInRaw(server);
  });

  it('code expiry: an exchange 61 s after issue is refused; one at 59 s works', async () => {
    const late = manualClock();
    const expired = await startGated({ now: late.now });
    late.advance(61_000);
    const reply = await send(expired, authPath(expired));
    expect(reply.status).toBe(401);
    expect(reply.headers['set-cookie']).toBeUndefined();

    const early = manualClock();
    const fresh = await startGated({ now: early.now });
    early.advance(LAUNCH_CODE_TTL_MS - 1_000);
    await signInRaw(fresh);
  });

  it('bad Host: a foreign host or a wrong port gets 403, even with a valid cookie or a fresh code', async () => {
    const server = await startGated();
    const code = authPath(server);
    const hosts = ['evil.example', `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, `localhost:${server.port + 1}`, '127.0.0.1', `[::1]:${server.port}`];
    for (const host of hosts) {
      expect((await send(server, code, { headers: { host } })).status, host).toBe(403);
    }
    // The refused exchanges didn't spend the code.
    const cookie = await signInRaw(server);
    for (const host of hosts) {
      const reply = await send(server, '/', { headers: { host, cookie } });
      expect(reply.status, host).toBe(403);
      expect(reply.body).not.toContain('id="root"');
    }
    // localhost on the bound port is allowed.
    expect((await send(server, '/', { headers: { host: `localhost:${server.port}`, cookie } })).status).toBe(200);
  });

  it('bad Origin: /ws and POST with a missing or foreign Origin get 403, even with a valid cookie', async () => {
    const server = await startGated();
    const cookie = await signInRaw(server);
    const foreign = ['http://evil.example', `http://evil.example:${server.port}`, `http://127.0.0.1:${server.port + 1}`, `https://127.0.0.1:${server.port}`, 'null'];

    expect(await upgrade(server, { cookie })).toBe(403);
    for (const origin of foreign) expect(await upgrade(server, { cookie, origin }), origin).toBe(403);

    expect((await send(server, '/', { method: 'POST', headers: { cookie } })).status).toBe(403);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const origin of foreign) {
        expect((await send(server, '/', { method, headers: { cookie, origin } })).status, `${method} ${origin}`).toBe(403);
      }
    }

    // A matching Origin (either loopback name) gets past the gate.
    expect(await upgrade(server, { cookie, origin: server.url })).toBe(101);
    expect(await upgrade(server, { cookie, origin: `http://localhost:${server.port}` })).toBe(101);
    expect((await send(server, '/', { method: 'POST', headers: { cookie, origin: server.url } })).status).not.toBe(403);
    // GET needs no Origin.
    expect((await send(server, '/', { headers: { cookie } })).status).toBe(200);
  });

  it('tampered cookie: an altered ID, expiry or signature, or an expired cookie, gets 401', async () => {
    const clock = manualClock();
    const server = await startGated({ now: clock.now });
    const pair = await signInRaw(server);
    const value = pair.slice(sessionCookieName(server.port).length + 1);
    const [id, expires, signature] = value.split('.') as [string, string, string];
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const variants = {
      id: `${flip(id)}.${expires}.${signature}`,
      expiry: `${id}.${Number(expires) + 1}.${signature}`,
      signature: `${id}.${expires}.${flip(signature)}`,
      truncated: `${id}.${expires}.${signature.slice(0, -2)}`,
      missingPart: `${id}.${signature}`,
      empty: '',
      garbage: 'not-a-session',
    };
    for (const [what, forged] of Object.entries(variants)) {
      const cookie = `${sessionCookieName(server.port)}=${forged}`;
      expect((await send(server, '/', { headers: { cookie } })).status, what).toBe(401);
      expect(await upgrade(server, { cookie, origin: server.url }), what).toBe(401);
    }
    // A cookie signed by another install's key is refused too.
    const other = createSessions(Buffer.alloc(32, 7), clock.now).create().value;
    expect((await send(server, '/', { headers: { cookie: `${sessionCookieName(server.port)}=${other}` } })).status).toBe(401);

    expect((await send(server, '/', { headers: { cookie: pair } })).status).toBe(200);
    clock.advance(SESSION_TTL_MS + 1_000);
    expect((await send(server, '/', { headers: { cookie: pair } })).status).toBe(401);
  });

  it('restart: a valid cookie keeps working on the same data folder and port, until auth.key is deleted', async () => {
    const dataDir = tempDataDir();
    const first = await startGated({ dataDir });
    // The cookie is named for the port (sessionCookieName), so restart where the
    // server normally does: on the same port.
    const port = first.port;
    const cookie = await signInRaw(first);
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await startGated({ dataDir, port });
    expect((await send(second, '/', { headers: { cookie } })).status).toBe(200);
    expect(await firstEvent(second, { cookie, origin: second.url })).toBe('server.started');
    await second.close();
    running.splice(running.indexOf(second), 1);

    rmSync(join(dataDir, AUTH_KEY_FILE));
    const third = await startGated({ dataDir, port });
    expect((await send(third, '/', { headers: { cookie } })).status).toBe(401);
  });

  it('ignores a session cookie named for another port', async () => {
    const server = await startGated();
    const pair = await signInRaw(server);
    const value = pair.slice(sessionCookieName(server.port).length + 1);
    const foreign = `${sessionCookieName(server.port + 1)}=${value}`;
    expect((await send(server, '/', { headers: { cookie: foreign } })).status).toBe(401);
  });

  it('keeps auth.key: 32 bytes, readable only by the user', async () => {
    const server = await startGated();
    const file = join(server.dataDir, AUTH_KEY_FILE);
    expect(readFileSync(file)).toHaveLength(32);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
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
  it('is the first handler registered, for every method and path', () => {
    const core = openCore(tempDataDir());
    try {
      const log = createLogger(() => {});
      const gate = createGate({ port: () => 1, codes: createLaunchCodes(), sessions: createSessions(Buffer.alloc(32)), log });
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
      const gate = createGate({ port: () => undefined, codes, sessions: createSessions(Buffer.alloc(32)), log });
      const app = createApp({ events: core.events, webRoot: webRoot(), log, gate });
      const response = await app.request(`/auth?code=${code}`, { headers: { host: '127.0.0.1:4317' } });
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
