/**
 * The launcher handshake and the server lifecycle (story 1.7): the launcher
 * token and the gate, `GET /launcher/hello`, restart-when-idle with and
 * without busy sessions, Quit, and the version comparison.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import { PORT_FILE } from '@ogden-agents/core';
import { ServerMessage } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { LOCK_FILE, ServerAlreadyRunningError } from '../src/instance-lock.js';
import { compareVersions } from '../src/launcher.js';
import { LAUNCHER_TOKEN_FILE, LAUNCHER_TOKEN_HEADER, readLauncherToken } from '../src/launcher-token.js';
import { createLogger } from '../src/log.js';
import { start, type RunningServer, type StartOptions } from '../src/start.js';
import { exchange, tempDataDir } from './helpers.js';

const running: RunningServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(running.splice(0).map((s) => s.close()));
});

/** A signed-in `/ws` client that subscribes from the start and records every message type. */
async function subscriber(server: RunningServer, cookie: string) {
  const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`, { headers: { cookie, origin: server.url } });
  sockets.push(ws);
  const types: string[] = [];
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => {
    const message = ServerMessage.parse(JSON.parse(String(data)));
    messages.push(message);
    types.push(message.type);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 }));
  return { ws, types, messages };
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function webRoot(): string {
  const dir = join(tempDataDir(), 'web');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  return dir;
}

async function startServer(options: StartOptions & { lines?: string[] } = {}) {
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
  body: string;
  json: () => unknown;
}

function send(
  server: RunningServer,
  path: string,
  { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: server.port, path, method, agent: false, headers: { host: `127.0.0.1:${server.port}`, ...headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body, json: () => JSON.parse(body) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** A POST with a raw body. */
function sendBody(server: RunningServer, path: string, headers: Record<string, string>, body: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method: 'POST',
        agent: false,
        headers: { host: `127.0.0.1:${server.port}`, 'content-length': String(Buffer.byteLength(body)), ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: text, json: () => JSON.parse(text) }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const tokenOf = (server: RunningServer) => readLauncherToken(server.dataDir)!;
const withToken = (server: RunningServer, extra: Record<string, string> = {}) => ({
  headers: { [LAUNCHER_TOKEN_HEADER]: tokenOf(server), ...extra },
});

/** A workspace with one session in `state`, created through core's entities. */
function sessionIn(server: RunningServer, state: 'working' | 'waiting' | 'idle' | 'done' | 'error') {
  const workspace = server.core.entities.ensureWorkspace(tempDataDir());
  return server.core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', state });
}

describe('launcher token', () => {
  it('is 256 random bits in launcher.token, mode 0600, fresh per start, and removed on close', async () => {
    const dataDir = tempDataDir();
    const first = await startServer({ dataDir });
    const file = join(dataDir, LAUNCHER_TOKEN_FILE);
    const token = readFileSync(file, 'utf8');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);

    await first.close();
    expect(existsSync(file)).toBe(false);

    await startServer({ dataDir });
    expect(readFileSync(file, 'utf8')).not.toBe(token);
  });

  it('close leaves a token it did not write alone', async () => {
    const dataDir = tempDataDir();
    const first = await startServer({ dataDir });
    writeFileSync(join(dataDir, LAUNCHER_TOKEN_FILE), 'someone-elses-token');
    await first.close();
    expect(readLauncherToken(dataDir)).toBe('someone-elses-token');
  });
});

describe('the gate on the handshake', () => {
  it('refuses the handshake without a token, or with a wrong one (401), and never logs the value', async () => {
    const lines: string[] = [];
    const server = await startServer({ lines });
    expect((await send(server, '/launcher/hello')).status).toBe(401);
    const wrong = 'x'.repeat(43);
    expect((await send(server, '/launcher/hello', { headers: { [LAUNCHER_TOKEN_HEADER]: wrong } })).status).toBe(401);
    expect((await send(server, '/launcher/restart-when-idle', { method: 'POST' })).status).toBe(401);
    expect(lines.some((l) => l.includes('launcher token rejected'))).toBe(true);
    const all = lines.join('');
    expect(all).not.toContain(wrong);
    expect(all).not.toContain(tokenOf(server));
  });

  it('a session cookie does not open the handshake', async () => {
    const server = await startServer();
    const cookie = await exchange(server.launchUrl);
    expect((await send(server, '/launcher/hello', { headers: { cookie, origin: server.url } })).status).toBe(401);
  });

  it('the token opens nothing but the handshake', async () => {
    const server = await startServer();
    expect((await send(server, '/', withToken(server))).status).toBe(401);
    expect((await send(server, '/api/server/quit', { method: 'POST', ...withToken(server, { origin: server.url }) })).status).toBe(401);
  });

  it('the handshake is still Host-checked', async () => {
    const server = await startServer();
    const reply = await send(server, '/launcher/hello', withToken(server, { host: `evil.example:${server.port}` }));
    expect(reply.status).toBe(403);
  });
});

describe('GET /launcher/hello', () => {
  it('reports version, pid, port and busy sessions', async () => {
    const server = await startServer();
    const reply = await send(server, '/launcher/hello', withToken(server));
    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual({ version: server.version, pid: process.pid, port: server.port, busySessions: 0 });
  });

  it('counts working and waiting sessions as busy, and no others', async () => {
    const server = await startServer();
    sessionIn(server, 'working');
    sessionIn(server, 'waiting');
    sessionIn(server, 'idle');
    sessionIn(server, 'done');
    sessionIn(server, 'error');
    const reply = await send(server, '/launcher/hello', withToken(server));
    expect((reply.json() as { busySessions: number }).busySessions).toBe(2);
  });

  it('with launch=1, issues a fresh single-use launch link every time, and logs no code', async () => {
    const lines: string[] = [];
    const server = await startServer({ lines });
    const first = (await send(server, '/launcher/hello?launch=1', withToken(server))).json() as { launchUrl: string };
    const second = (await send(server, '/launcher/hello?launch=1', withToken(server))).json() as { launchUrl: string };
    expect(first.launchUrl).toMatch(new RegExp(`^${server.url.replaceAll('.', '\\.')}/auth\\?code=[A-Za-z0-9_-]+$`));
    expect(second.launchUrl).not.toBe(first.launchUrl);
    await exchange(first.launchUrl);
    await exchange(second.launchUrl);
    // Spent.
    expect((await fetch(first.launchUrl, { redirect: 'manual' })).status).toBe(401);
    for (const url of [first.launchUrl, second.launchUrl]) {
      expect(lines.join('')).not.toContain(new URL(url).searchParams.get('code')!);
    }
  });
});

describe('POST /launcher/restart-when-idle', () => {
  it('with a busy session: refuses (409) and keeps serving', async () => {
    const server = await startServer();
    sessionIn(server, 'working');
    const reply = await send(server, '/launcher/restart-when-idle', { method: 'POST', ...withToken(server) });
    expect(reply.status).toBe(409);
    expect(reply.json()).toEqual({ restarting: false, busySessions: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);
    expect(existsSync(join(server.dataDir, PORT_FILE))).toBe(true);
  });

  it('when idle: agrees (202), then stops cleanly and removes server.json and launcher.token', async () => {
    const stops: string[] = [];
    const server = await startServer({ onStop: (reason) => stops.push(reason) });
    sessionIn(server, 'done');
    const reply = await send(server, '/launcher/restart-when-idle', { method: 'POST', ...withToken(server) });
    expect(reply.status).toBe(202);
    expect(reply.json()).toEqual({ restarting: true, busySessions: 0 });
    expect(await server.stopped).toBe('restart');
    // onStop runs right after everything is closed (a server process exits there).
    await new Promise((resolve) => setImmediate(resolve));
    expect(stops).toEqual(['restart']);
    expect(existsSync(join(server.dataDir, PORT_FILE))).toBe(false);
    expect(existsSync(join(server.dataDir, LAUNCHER_TOKEN_FILE))).toBe(false);
    await expect(send(server, '/launcher/hello')).rejects.toThrow();
  });
});

describe('restart re-checks busy sessions when it stops', () => {
  it('aborts if a session became busy after the launcher asked', async () => {
    const stops: string[] = [];
    const server = await startServer({ onStop: (reason) => stops.push(reason) });
    const session = sessionIn(server, 'idle');
    const reply = await send(server, '/launcher/restart-when-idle', { method: 'POST', ...withToken(server) });
    expect(reply.status).toBe(202);
    // Before the stop happens, the session starts working.
    server.core.entities.setSessionState(session.id, 'working');
    await new Promise((r) => setTimeout(r, 300));
    expect(stops).toEqual([]);
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);
    expect(existsSync(join(server.dataDir, PORT_FILE))).toBe(true);
  });
});

describe('POST /api/server/quit', () => {
  it('with busy sessions: refuses (409, with the count) unless the request says force: true', async () => {
    const server = await startServer();
    sessionIn(server, 'waiting');
    const cookie = await exchange(server.launchUrl);
    const headers = { cookie, origin: server.url, 'content-type': 'application/json' };
    const refused = await sendBody(server, '/api/server/quit', headers, '{}');
    expect(refused.status).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'sessions_busy', details: { busySessions: 1 } } });
    await new Promise((r) => setTimeout(r, 150));
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);

    const forced = await sendBody(server, '/api/server/quit', headers, JSON.stringify({ force: true }));
    expect(forced.status).toBe(202);
    expect(await server.stopped).toBe('quit');
  });

  it('tells every connected tab the server is stopping, before it goes', async () => {
    const server = await startServer();
    const cookie = await exchange(server.launchUrl);
    const tabs = [await subscriber(server, cookie), await subscriber(server, cookie)];
    await waitFor(() => tabs.every((t) => t.types.includes('caught_up')), 'both tabs to catch up');
    const reply = await sendBody(server, '/api/server/quit', { cookie, origin: server.url }, '');
    expect(reply.status).toBe(202);
    await server.stopped;
    for (const tab of tabs) {
      expect(tab.messages).toContainEqual({ type: 'server.stopping', reason: 'quit' });
    }
  });

  it('with the session cookie and a matching Origin: stops cleanly and removes both files', async () => {
    const stops: string[] = [];
    const server = await startServer({ onStop: (reason) => stops.push(reason) });
    const cookie = await exchange(server.launchUrl);
    const reply = await send(server, '/api/server/quit', { method: 'POST', headers: { cookie, origin: server.url } });
    expect(reply.status).toBe(202);
    expect(await server.stopped).toBe('quit');
    // onStop runs right after everything is closed (a server process exits there).
    await new Promise((resolve) => setImmediate(resolve));
    expect(stops).toEqual(['quit']);
    expect(existsSync(join(server.dataDir, PORT_FILE))).toBe(false);
    expect(existsSync(join(server.dataDir, LAUNCHER_TOKEN_FILE))).toBe(false);
  });

  it('is refused without a matching Origin (403) or without a cookie (401), and the server keeps running', async () => {
    const server = await startServer();
    const cookie = await exchange(server.launchUrl);
    expect((await send(server, '/api/server/quit', { method: 'POST', headers: { cookie } })).status).toBe(403);
    expect((await send(server, '/api/server/quit', { method: 'POST', headers: { cookie, origin: 'http://evil.example' } })).status).toBe(403);
    expect((await send(server, '/api/server/quit', { method: 'POST', headers: { origin: server.url } })).status).toBe(401);
    await new Promise((r) => setTimeout(r, 150));
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);
  });
});

describe('caught_up', () => {
  it('follows the subscribe backlog, before any live event', async () => {
    const server = await startServer();
    const cookie = await exchange(server.launchUrl);
    const tab = await subscriber(server, cookie);
    await waitFor(() => tab.types.includes('caught_up'), 'caught_up');
    server.core.events.append({ type: 'server.started', workspaceId: null, streamId: 'server', payload: { version: 'live' } });
    await waitFor(() => tab.types.length === 3, 'the live event');
    expect(tab.types).toEqual(['server.started', 'caught_up', 'server.started']);
  });
});

describe('one server per data folder', () => {
  it('a second server on the same folder refuses to start; after close one can start again', async () => {
    const dataDir = tempDataDir();
    const first = await startServer({ dataDir });
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(true);
    const second = startServer({ dataDir });
    await expect(second).rejects.toBeInstanceOf(ServerAlreadyRunningError);
    await expect(second).rejects.toMatchObject({ pid: process.pid });
    // The refused start touched nothing of the running one.
    expect((await send(first, '/launcher/hello', withToken(first))).status).toBe(200);

    await first.close();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    await startServer({ dataDir });
  });

  it('simultaneous starts on one folder: exactly one wins', async () => {
    const dataDir = tempDataDir();
    const results = await Promise.allSettled([startServer({ dataDir }), startServer({ dataDir }), startServer({ dataDir })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ServerAlreadyRunningError);
  });

  it('takes over a stale lock whose process is gone', async () => {
    const dataDir = tempDataDir();
    const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify({ pid: Number(dead.stdout.trim()), nonce: 'old' }));
    const server = await startServer({ dataDir });
    expect(JSON.parse(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).pid).toBe(process.pid);
    await server.close();
  });
});

describe('compareVersions', () => {
  it.each([
    ['0.1.0', '0.2.0', -1],
    ['0.2.0', '0.1.0', 1],
    ['1.2.3', '1.2.3', 0],
    ['1.10.0', '1.9.0', 1],
    ['0.2.0-beta.1', '0.2.0', -1],
    ['0.2.0', '0.2.0-beta.1', 1],
    ['0.2.0-alpha', '0.2.0-beta', -1],
    ['0.2.0-beta.2', '0.2.0-beta.11', -1],
    ['0.2.0-1', '0.2.0-alpha', -1],
    ['0.2.0-beta', '0.2.0-beta.1', -1],
    ['1.0.0+build.5', '1.0.0', 0],
    ['v1.0.0', '1.0.0', 0],
  ])('%s vs %s is %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('is undefined for something that is not semver', () => {
    expect(compareVersions('dev', '1.0.0')).toBeUndefined();
  });
});
