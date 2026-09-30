/**
 * The launcher handshake and the server lifecycle (story 1.7): the launcher
 * token and the gate, `GET /launcher/hello`, restart-when-idle with and
 * without busy sessions, Quit, and the version comparison.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PORT_FILE } from '@ogden-agents/core';
import { API_ROUTES, ServerMessage } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { LOCK_FILE, ServerAlreadyRunningError } from '../src/instance-lock.js';
import { compareVersions } from '../src/launcher.js';
import { LAUNCHER_TOKEN_FILE, LAUNCHER_TOKEN_HEADER, readLauncherToken } from '../src/launcher-token.js';
import { createLogger } from '../src/log.js';
import { start, type RunningServer } from '../src/start.js';
import {
  codeOfLink,
  connectTab,
  exchange,
  send,
  startTestServer,
  tempDataDir,
  tinyWebRoot,
  trackServer,
  trackSocket,
  waitFor,
  type SignedIn,
} from './helpers.js';

/** A connected tab's `/ws` client that subscribes from the start and records every message type. */
async function subscriber(server: RunningServer, tab: SignedIn) {
  const ws = trackSocket(new WebSocket(`${server.url.replace('http', 'ws')}/ws`, tab.protocols, { headers: { origin: server.url } }));
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
    const first = await startTestServer({ dataDir });
    const file = join(dataDir, LAUNCHER_TOKEN_FILE);
    const token = readFileSync(file, 'utf8');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);

    await first.close();
    expect(existsSync(file)).toBe(false);

    await startTestServer({ dataDir });
    expect(readFileSync(file, 'utf8')).not.toBe(token);
  });

  it('close leaves a token it did not write alone', async () => {
    const dataDir = tempDataDir();
    const first = await startTestServer({ dataDir });
    writeFileSync(join(dataDir, LAUNCHER_TOKEN_FILE), 'someone-elses-token');
    await first.close();
    expect(readLauncherToken(dataDir)).toBe('someone-elses-token');
  });
});

describe('the gate on the handshake', () => {
  it('refuses the handshake without a token, or with a wrong one (401), and never logs the value', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    expect((await send(server, '/launcher/hello')).status).toBe(401);
    const wrong = 'x'.repeat(43);
    expect((await send(server, '/launcher/hello', { headers: { [LAUNCHER_TOKEN_HEADER]: wrong } })).status).toBe(401);
    expect((await send(server, '/launcher/restart-when-idle', { method: 'POST' })).status).toBe(401);
    expect(lines.some((l) => l.includes('launcher token rejected'))).toBe(true);
    const all = lines.join('');
    expect(all).not.toContain(wrong);
    expect(all).not.toContain(tokenOf(server));
  });

  it('a tab token does not open the handshake', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    expect((await send(server, '/launcher/hello', { headers: tab.headers })).status).toBe(401);
  });

  it('the token opens nothing but the handshake', async () => {
    const server = await startTestServer();
    // The static app needs no token at all; the API and /ws need a tab's.
    expect((await send(server, API_ROUTES.tabCheck, withToken(server))).status).toBe(401);
    expect((await send(server, '/ws', withToken(server))).status).toBe(401);
    expect((await send(server, API_ROUTES.serverQuit, { method: 'POST', ...withToken(server, { origin: server.url }) })).status).toBe(401);
  });

  it('the handshake is still Host-checked', async () => {
    const server = await startTestServer();
    const reply = await send(server, '/launcher/hello', withToken(server, { host: `evil.example:${server.port}` }));
    expect(reply.status).toBe(403);
  });
});

describe('GET /launcher/hello', () => {
  it('reports version, pid, port and busy sessions', async () => {
    const server = await startTestServer();
    const reply = await send(server, '/launcher/hello', withToken(server));
    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual({ version: server.version, pid: process.pid, port: server.port, busySessions: 0 });
  });

  it('counts working and waiting sessions as busy, and no others', async () => {
    const server = await startTestServer();
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
    const server = await startTestServer({ lines });
    const first = (await send(server, '/launcher/hello?launch=1', withToken(server))).json() as { launchUrl: string };
    const second = (await send(server, '/launcher/hello?launch=1', withToken(server))).json() as { launchUrl: string };
    expect(first.launchUrl).toMatch(new RegExp(`^${server.url.replaceAll('.', '\\.')}/#c=[A-Za-z0-9_-]{43}$`));
    expect(second.launchUrl).not.toBe(first.launchUrl);
    await exchange(first.launchUrl);
    await exchange(second.launchUrl);
    // Spent.
    await expect(exchange(first.launchUrl)).rejects.toThrow(/401/);
    for (const url of [first.launchUrl, second.launchUrl]) {
      expect(lines.join('')).not.toContain(codeOfLink(url));
    }
  });
});

describe('launch codes on request', () => {
  it('a background start (no launch, no open) issues no code; the handshake with launch=1 issues one that works', async () => {
    const lines: string[] = [];
    // Not startTestServer, which asks for a launch link.
    const server = trackServer(await start({ port: 0, open: false, log: createLogger((l) => lines.push(l)), dataDir: tempDataDir(), webRoot: tinyWebRoot() }));
    expect(server.launchUrl).toBeUndefined();
    const issued = () => lines.filter((l) => (JSON.parse(l) as { msg: string }).msg.startsWith('launch code issued')).length;
    expect(issued()).toBe(0);
    // A plain handshake (attach check) issues none either.
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);
    expect(issued()).toBe(0);

    const { launchUrl } = (await send(server, '/launcher/hello?launch=1', withToken(server))).json() as { launchUrl: string };
    expect(issued()).toBeGreaterThan(0);
    await exchange(launchUrl);
  });

  it('with launch (foreground mode), the start issues one link', async () => {
    const server = await startTestServer();
    expect(server.launchUrl).toMatch(new RegExp(`^${server.url.replaceAll('.', '\\.')}/#c=[A-Za-z0-9_-]{43}$`));
    await exchange(server.launchUrl);
  });
});

describe('POST /launcher/restart-when-idle', () => {
  it('with a busy session: refuses (409) and keeps serving', async () => {
    const server = await startTestServer();
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
    const server = await startTestServer({ onStop: (reason) => stops.push(reason) });
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
    const server = await startTestServer({ onStop: (reason) => stops.push(reason) });
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

describe('POST /api/v1/server/quit', () => {
  it('with busy sessions: refuses (409, with the count) unless the request says force: true', async () => {
    const server = await startTestServer();
    sessionIn(server, 'waiting');
    const tab = await connectTab(server);
    const headers = { ...tab.headers, 'content-type': 'application/json' };
    const refused = await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: headers, body: '{}' });
    expect(refused.status).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'sessions_busy', details: { busySessions: 1 } } });
    await new Promise((r) => setTimeout(r, 150));
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);

    const forced = await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: headers, body: JSON.stringify({ force: true }) });
    expect(forced.status).toBe(202);
    expect(await server.stopped).toBe('quit');
  });

  it('tells every connected tab the server is stopping, before it goes', async () => {
    const server = await startTestServer();
    const tab = await connectTab(server);
    const other = await connectTab(server, server.issueLaunchUrl());
    const tabs = [await subscriber(server, tab), await subscriber(server, other)];
    await waitFor(() => tabs.every((t) => t.types.includes('caught_up')), 'both tabs to catch up');
    const reply = await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: tab.headers, body: '' });
    expect(reply.status).toBe(202);
    await server.stopped;
    for (const tab of tabs) {
      expect(tab.messages).toContainEqual({ type: 'server.stopping', reason: 'quit' });
    }
  });

  it("with the tab's token and a matching Origin: stops cleanly and removes both files", async () => {
    const stops: string[] = [];
    const server = await startTestServer({ onStop: (reason) => stops.push(reason) });
    const tab = await connectTab(server);
    const reply = await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: tab.headers });
    expect(reply.status).toBe(202);
    expect(await server.stopped).toBe('quit');
    // onStop runs right after everything is closed (a server process exits there).
    await new Promise((resolve) => setImmediate(resolve));
    expect(stops).toEqual(['quit']);
    expect(existsSync(join(server.dataDir, PORT_FILE))).toBe(false);
    expect(existsSync(join(server.dataDir, LAUNCHER_TOKEN_FILE))).toBe(false);
  });

  it('is refused without a matching Origin (403) or without a token (401), and the server keeps running', async () => {
    const server = await startTestServer();
    const { authorization } = (await connectTab(server)).headers as { authorization: string };
    expect((await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: { authorization } })).status).toBe(403);
    expect((await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: { authorization, origin: 'http://evil.example' } })).status).toBe(403);
    expect((await send(server, API_ROUTES.serverQuit, { method: 'POST', headers: { origin: server.url } })).status).toBe(401);
    await new Promise((r) => setTimeout(r, 150));
    expect((await send(server, '/launcher/hello', withToken(server))).status).toBe(200);
  });
});

describe('caught_up', () => {
  it('follows the subscribe backlog, before any live event', async () => {
    const server = await startTestServer();
    const tab = await subscriber(server, await connectTab(server));
    await waitFor(() => tab.types.includes('caught_up'), 'caught_up');
    server.core.events.append({ type: 'server.started', workspaceId: null, streamId: 'server', payload: { version: 'live' } });
    await waitFor(() => tab.types.length === 3, 'the live event');
    expect(tab.types).toEqual(['server.started', 'caught_up', 'server.started']);
  });
});

describe('one server per data folder', () => {
  it('a second server on the same folder refuses to start; after close one can start again', async () => {
    const dataDir = tempDataDir();
    const first = await startTestServer({ dataDir });
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(true);
    const second = startTestServer({ dataDir });
    await expect(second).rejects.toBeInstanceOf(ServerAlreadyRunningError);
    await expect(second).rejects.toMatchObject({ pid: process.pid });
    // The refused start touched nothing of the running one.
    expect((await send(first, '/launcher/hello', withToken(first))).status).toBe(200);

    await first.close();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
    await startTestServer({ dataDir });
  });

  it('simultaneous starts on one folder: exactly one wins', async () => {
    const dataDir = tempDataDir();
    const results = await Promise.allSettled([startTestServer({ dataDir }), startTestServer({ dataDir }), startTestServer({ dataDir })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ServerAlreadyRunningError);
  });

  it('takes over a stale lock whose process is gone', async () => {
    const dataDir = tempDataDir();
    const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify({ pid: Number(dead.stdout.trim()), nonce: 'old' }));
    const server = await startTestServer({ dataDir });
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
