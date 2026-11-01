/**
 * `port-probe-node` (27.7) with real sockets on `127.0.0.1`: a port a
 * server holds there answers busy, a free one answers free (and is free
 * again at once: the probe closed it), a port out of range answers busy,
 * and the probe listens on `127.0.0.1` only.
 */
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPortProbeNode, PORT_PROBE_HOST } from '../src/index.js';

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** A server on 127.0.0.1 on a port the system picks; its port. */
async function hold(): Promise<number> {
  const server = createServer();
  server.on('error', () => {});
  servers.push(server);
  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  return (server.address() as { port: number }).port;
}

/** A port that was free a moment ago. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen({ host: '127.0.0.1', port: 0 }, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('port-probe-node (27.7)', () => {
  it('answers busy for a port held on 127.0.0.1', async () => {
    const port = await hold();
    expect(await createPortProbeNode().isFree(port)).toBe(false);
  });

  it('answers free for a free port, and closes it at once', async () => {
    const probe = createPortProbeNode();
    const port = await freePort();
    expect(await probe.isFree(port)).toBe(true);
    // Free again right away: nothing was left listening.
    expect(await probe.isFree(port)).toBe(true);
  });

  it('answers busy for a port out of range, never listening', async () => {
    const probe = createPortProbeNode();
    expect(await probe.isFree(0)).toBe(false);
    expect(await probe.isFree(70_000)).toBe(false);
    expect(await probe.isFree(1.5)).toBe(false);
  });

  it('listens on 127.0.0.1 only, exclusively', async () => {
    expect(PORT_PROBE_HOST).toBe('127.0.0.1');
    const net = await import('node:net');
    const listens: unknown[] = [];
    const original = net.Server.prototype.listen;
    vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: unknown[]) {
      listens.push(args[0]);
      return (original as (...rest: unknown[]) => Server).apply(this, args);
    });
    const port = await freePort();
    listens.length = 0;
    await createPortProbeNode().isFree(port);
    expect(listens).toEqual([{ host: '127.0.0.1', port, exclusive: true }]);
  });
});
