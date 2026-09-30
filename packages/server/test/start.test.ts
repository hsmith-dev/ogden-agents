import { readFileSync, statSync } from 'node:fs';
import { connect as tcpConnect, createServer, type Server } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { openCore } from '@ogden-agents/core';
import { SERVER_STREAM, ServerMessage, type CoreEvent } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createLogger, LOG_DIR, type Logger } from '../src/log.js';
import { HOST, start, type RunningServer } from '../src/start.js';
import { signIn, tempDataDir } from './helpers.js';

interface Captured {
  log: Logger;
  lines: Array<{ level: string; msg: string }>;
}

function captureLog(): Captured {
  const lines: Captured['lines'] = [];
  return { lines, log: createLogger((line) => lines.push(JSON.parse(line))) };
}

/**
 * Connects a tab through the launch link, opens `/ws` with its token
 * subprotocol and a matching `Origin`, sends `subscribe` after `afterSeq`
 * (unless `null`), and collects every schema-valid server message.
 */
async function connect(server: RunningServer, afterSeq: number | null = 0) {
  const { protocols, origin } = await signIn(server);
  const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`, protocols, { headers: { origin } });
  sockets.push(ws);
  const received: ServerMessage[] = [];
  /** `caught_up` and `server.stopping`, kept apart so `received` counts events and pongs as before. */
  const control: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    const message = ServerMessage.parse(JSON.parse(String(data)));
    (message.type === 'caught_up' || message.type === 'server.stopping' ? control : received).push(message);
    for (const wake of waiters.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  if (afterSeq !== null) ws.send(JSON.stringify({ type: 'subscribe', afterSeq }));

  /** Resolves once `predicate` holds for the received messages. */
  const until = async (predicate: (all: ServerMessage[]) => boolean, what: string) => {
    for (;;) {
      if (predicate(received)) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), 2000);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
  const next = async (type: ServerMessage['type']) => {
    await until(() => [...received, ...control].some((m) => m.type === type), type);
    return [...received, ...control].find((m) => m.type === type)!;
  };
  const events = () => received.filter((m): m is CoreEvent => m.type !== 'pong');
  const seqs = () => events().map((e) => e.seq);
  const close = () =>
    new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  return { ws, received, control, next, until, events, seqs, close };
}

const running: RunningServer[] = [];
const sockets: WebSocket[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(running.splice(0).map((s) => s.close()));
  await Promise.all(
    blockers.splice(0).map((b) => new Promise<void>((resolve) => b.close(() => resolve()))),
  );
});

async function startTest(options: Parameters<typeof start>[0] = {}) {
  const server = await start({ port: 0, open: false, log: captureLog().log, dataDir: tempDataDir(), ...options });
  running.push(server);
  return server;
}

/** A port that was free a moment ago. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, HOST, () => resolve((probe.address() as { port: number }).port));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Appends `count` install-level events and returns them. */
function appendEvents(server: RunningServer, count: number) {
  return Array.from({ length: count }, (_, i) =>
    server.core.events.append({
      type: 'server.started',
      workspaceId: null,
      streamId: SERVER_STREAM,
      payload: { version: `test.${i}` },
    }),
  );
}

describe('server start', () => {
  it('binds only to 127.0.0.1', async () => {
    const server = await startTest();
    expect(server.url).toBe(`http://${HOST}:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
  });

  const external = Object.values(networkInterfaces())
    .flat()
    .find((i) => i !== undefined && i.family === 'IPv4' && !i.internal)?.address;

  it.skipIf(external === undefined)('refuses connections on a non-loopback interface', async () => {
    const server = await startTest();
    const error = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      const socket = tcpConnect({ host: external!, port: server.port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(undefined);
      });
      socket.once('error', (err) => resolve(err));
    });
    expect(error?.code).toBe('ECONNREFUSED');
  });

  it('appends a schema-valid server.started event and pushes it to a subscriber', async () => {
    const server = await startTest();
    const client = await connect(server);
    const event = await client.next('server.started');
    expect(event).toMatchObject({
      type: 'server.started',
      workspaceId: null,
      streamId: SERVER_STREAM,
      payload: { version: server.version },
    });
    if (event.type !== 'server.started') throw new Error('unreachable');
    expect(event.id).toMatch(/^evt_/);
    expect(event.seq).toBeGreaterThan(0);
    expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('sends nothing until the client subscribes', async () => {
    const server = await startTest();
    const client = await connect(server, null);
    client.ws.send(JSON.stringify({ type: 'ping' }));
    await client.next('pong');
    expect(client.events()).toEqual([]);
  });

  it('gives a late client the same logged event', async () => {
    const server = await startTest();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const first = await connect(server);
    const late = await connect(server);
    const a = await first.next('server.started');
    const b = await late.next('server.started');
    expect(b).toEqual(a);
  });

  it('catch-up: a client subscribing after N receives exactly N+1…M, then live events', async () => {
    const server = await startTest();
    const stored = [...server.core.events.readAfter(0), ...appendEvents(server, 5)];
    const n = stored[2]!.seq;
    const client = await connect(server, n);
    const expected = stored.filter((e) => e.seq > n);
    await client.until((all) => all.length >= expected.length, 'the backlog');
    expect(client.events()).toEqual(expected);

    const live = appendEvents(server, 2);
    await client.until((all) => all.length >= expected.length + 2, 'live events');
    expect(client.seqs()).toEqual([...expected, ...live].map((e) => e.seq));
  });

  it('page reconnect: a client that drops and resubscribes after its last seq sees nothing twice', async () => {
    const server = await startTest();
    appendEvents(server, 2);
    const first = await connect(server);
    await first.until((all) => all.length === 3, 'initial events');
    const lastSeen = first.seqs().at(-1)!;
    await first.close();

    const missed = appendEvents(server, 3);
    const again = await connect(server, lastSeen);
    await again.until((all) => all.length === 3, 'missed events');
    const live = appendEvents(server, 1);
    await again.until((all) => all.length === 4, 'a live event');

    const seen = [...first.seqs(), ...again.seqs()];
    expect(again.seqs()).toEqual([...missed, ...live].map((e) => e.seq));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(server.core.events.readAfter(0).map((e) => e.seq));
  });

  it('a second subscribe on one connection replaces the first', async () => {
    const server = await startTest();
    const client = await connect(server);
    await client.next('server.started');
    const [event] = appendEvents(server, 1);
    await client.until((all) => all.length === 2, 'the appended event');
    client.ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 }));
    await client.until((all) => all.length === 4, 'the replayed backlog');
    appendEvents(server, 1);
    await client.until((all) => all.length === 5, 'one live event');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.received).toHaveLength(5);
    expect(client.seqs().slice(2, 4)).toEqual([event!.seq - 1, event!.seq]);
  });

  it('restart: serves earlier events from the same data folder, and seq continues upward', async () => {
    const dataDir = tempDataDir();
    const first = await startTest({ dataDir });
    appendEvents(first, 2);
    const before = first.core.events.readAfter(0);
    await first.close();
    running.splice(running.indexOf(first), 1);

    const second = await startTest({ dataDir });
    const client = await connect(second);
    await client.until((all) => all.length === before.length + 1, 'all events');
    const events = client.events();
    expect(events.slice(0, before.length)).toEqual(before);
    const restarted = events.at(-1)!;
    expect(restarted.type).toBe('server.started');
    expect(restarted.seq).toBeGreaterThan(before.at(-1)!.seq);
  });

  it('ignores bad client messages, including a bad afterSeq, logs warnings and keeps the connection', async () => {
    const { log, lines } = captureLog();
    const server = await startTest({ log });
    const client = await connect(server, null);

    client.ws.send('not json');
    client.ws.send(JSON.stringify({ type: 'launch.missiles' }));
    for (const afterSeq of [-1, 1.5, '3', null]) client.ws.send(JSON.stringify({ type: 'subscribe', afterSeq }));
    client.ws.send(JSON.stringify({ type: 'ping' }));

    const pong = await client.next('pong');
    expect(pong.type).toBe('pong');
    expect(client.events()).toEqual([]);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    expect(lines.filter((l) => l.level === 'warn').map((l) => l.msg)).toEqual([
      'ignoring unparseable client message',
      ...Array(5).fill('ignoring client message that fails the shared schema'),
    ]);

    client.ws.send(JSON.stringify({ type: 'subscribe', afterSeq: 0 }));
    await client.next('server.started');
  });

  it('falls back to the next port when the requested one is busy', async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const busyPort = await new Promise<number>((resolve) => {
      blocker.listen(0, HOST, () => resolve((blocker.address() as { port: number }).port));
    });
    const { log, lines } = captureLog();
    const server = await startTest({ port: busyPort, log });
    expect(server.port).not.toBe(busyPort);
    expect(server.port).toBeGreaterThan(busyPort);
    expect(lines.some((l) => l.level === 'warn' && l.msg === 'requested port was busy')).toBe(true);
  });

  it('serves the core it was given, and leaves it open on close', async () => {
    const core = openCore(tempDataDir());
    try {
      const server = await startTest({ core });
      const client = await connect(server);
      await client.next('server.started');
      core.events.append({ type: 'server.started', workspaceId: null, streamId: SERVER_STREAM, payload: { version: '9.9.9' } });
      await client.until(
        (all) => all.some((m) => m.type === 'server.started' && m.payload.version === '9.9.9'),
        'the appended event',
      );
      await server.close();
      running.splice(running.indexOf(server), 1);
      // Still open: appending works after the server has closed.
      expect(() =>
        core.events.append({ type: 'server.started', workspaceId: null, streamId: SERVER_STREAM, payload: { version: '1' } }),
      ).not.toThrow();
    } finally {
      core.close();
    }
  });

  it('releases the port when appending server.started fails', async () => {
    const core = openCore(tempDataDir());
    try {
      const failing = {
        ...core,
        events: {
          ...core.events,
          append: () => {
            throw new Error('disk full');
          },
        },
      } as typeof core;
      const port = await freePort();
      await expect(startTest({ core: failing, port })).rejects.toThrow('disk full');
      // The port is free again: another server can bind it.
      const probe = createServer();
      blockers.push(probe);
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, HOST, () => resolve());
      });
    } finally {
      core.close();
    }
  });

  it('creates an explicit data folder that does not exist yet, readable only by the user', async () => {
    const dataDir = join(tempDataDir(), 'not', 'yet');
    const server = await startTest({ dataDir });
    expect(server.dataDir).toBe(dataDir);
    const stats = statSync(dataDir);
    expect(stats.isDirectory()).toBe(true);
    if (process.platform !== 'win32') expect(stats.mode & 0o777).toBe(0o700);
  });

  it('writes JSON-line logs to the data folder when no logger is given', async () => {
    const dataDir = tempDataDir();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      running.push(await start({ port: 0, open: false, dataDir }));
    } finally {
      stderr.mockRestore();
    }
    const lines = readFileSync(join(dataDir, LOG_DIR, 'server.log'), 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l) as { msg: string }).some((l) => l.msg === 'server listening')).toBe(true);
  });
});
