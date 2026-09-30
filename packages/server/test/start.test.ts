import { createEventBus } from '@ogdenmad/core';
import { ServerMessage } from '@ogdenmad/shared';
import { connect as tcpConnect, createServer, type Server } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createLogger, type Logger } from '../src/log.js';
import { HOST, start, type RunningServer } from '../src/start.js';

interface Captured {
  log: Logger;
  lines: Array<{ level: string; msg: string }>;
}

function captureLog(): Captured {
  const lines: Captured['lines'] = [];
  return { lines, log: createLogger((line) => lines.push(JSON.parse(line))) };
}

/** Connects and collects every schema-valid server message. */
async function connect(url: string) {
  const ws = new WebSocket(`${url.replace('http', 'ws')}/ws`);
  const received: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data) => {
    received.push(ServerMessage.parse(JSON.parse(String(data))));
    for (const wake of waiters.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const next = async (type: ServerMessage['type']) => {
    for (;;) {
      const found = received.find((m) => m.type === type);
      if (found) return found;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2000);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  };
  return { ws, received, next };
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
  const server = await start({ port: 0, open: false, log: captureLog().log, ...options });
  running.push(server);
  return server;
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

  it('pushes a schema-valid server.started event over /ws', async () => {
    const server = await startTest();
    const client = await connect(server.url);
    sockets.push(client.ws);
    const event = await client.next('server.started');
    expect(event).toMatchObject({ type: 'server.started', version: server.version });
    expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('replays server.started to a client that connects late', async () => {
    const server = await startTest();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const first = await connect(server.url);
    const late = await connect(server.url);
    sockets.push(first.ws, late.ws);
    const a = await first.next('server.started');
    const b = await late.next('server.started');
    expect(b).toEqual(a);
  });

  it('ignores a bad client message, logs a warning and keeps the connection', async () => {
    const { log, lines } = captureLog();
    const server = await startTest({ log });
    const client = await connect(server.url);
    sockets.push(client.ws);
    await client.next('server.started');

    client.ws.send('not json');
    client.ws.send(JSON.stringify({ type: 'launch.missiles' }));
    client.ws.send(JSON.stringify({ type: 'ping' }));

    const pong = await client.next('pong');
    expect(pong.type).toBe('pong');
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    expect(lines.filter((l) => l.level === 'warn').map((l) => l.msg)).toEqual([
      'ignoring unparseable client message',
      'ignoring client message that fails the shared schema',
    ]);
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

  it('serves the core bus it was given', async () => {
    const bus = createEventBus();
    const server = await startTest({ bus });
    const client = await connect(server.url);
    sockets.push(client.ws);
    const at = new Date().toISOString();
    bus.emit({ type: 'server.started', at, version: '9.9.9' });
    await expect.poll(() => client.received.some((m) => m.type === 'server.started' && m.version === '9.9.9')).toBe(true);
  });
});
