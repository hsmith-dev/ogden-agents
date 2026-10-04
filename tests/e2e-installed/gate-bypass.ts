/**
 * A test-only fixture that takes the security gate out of the way, without
 * changing the installed package: a loopback proxy in front of the server
 * that makes every request pass the gate. It rewrites `Host` and `Origin` to
 * the server's own, and adds a valid tab token (`Authorization: Bearer`, and
 * `ogden.auth.<token>` on WebSocket upgrades) and the launcher token. Through
 * it, the server behaves as if the gate were gone: every request a real gate
 * would refuse is let through. `bypass.spec.ts` uses it to prove that the gate
 * checks fail when the gate doesn't do its job.
 */
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect, type Socket } from 'node:net';

export interface GateBypass {
  /** The proxy's base URL, `http://127.0.0.1:<port>`. */
  url: string;
  close(): Promise<void>;
}

const AUTH_PROTOCOL_PREFIX = 'ogden.auth.';

export async function startGateBypass(upstream: string, credentials: { tabToken: string; launcherToken: string }): Promise<GateBypass> {
  const { hostname, port, host, origin } = new URL(upstream);
  const upstreamPort = Number(port);

  const passing = (headers: IncomingHttpHeaders): IncomingHttpHeaders => ({
    ...headers,
    host,
    origin,
    authorization: `Bearer ${credentials.tabToken}`,
    'x-ogden-launcher-token': credentials.launcherToken,
  });

  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const forward = httpRequest({ hostname, port: upstreamPort, method: req.method, path: req.url, headers: passing(req.headers) }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    forward.once('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(forward);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  // WebSocket upgrades: the same rewriting on the handshake, then raw bytes both ways.
  server.on('upgrade', (req, client: Socket, head: Buffer) => {
    // Whatever the client offered (or nothing), the server sees what a connected tab sends.
    const headers = passing(req.headers);
    headers['sec-websocket-protocol'] = `ogden.v1, ${AUTH_PROTOCOL_PREFIX}${credentials.tabToken}`;
    delete headers.authorization;
    const upstreamSocket = connect(upstreamPort, hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined) lines.push(`${name}: ${v}`);
      }
      upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstreamSocket.write(head);
      client.pipe(upstreamSocket).pipe(client);
    });
    sockets.add(upstreamSocket);
    upstreamSocket.once('close', () => sockets.delete(upstreamSocket));
    const end = () => {
      client.destroy();
      upstreamSocket.destroy();
    };
    upstreamSocket.once('error', end);
    client.once('error', end);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the gate bypass has no port');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
