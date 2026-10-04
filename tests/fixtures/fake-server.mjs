#!/usr/bin/env node
// A stand-in for an Ogden Agents server of another version, for the launcher
// tests (story 1.7). It speaks only the launcher handshake:
//
//   node fake-server.mjs <dataDir> <version> <busySessions>
//
// It writes `server.json` and `launcher.token` the way a real server does,
// answers `GET /launcher/hello` (with `?launch=1`, a launch link to its own
// `/#c=`, exchanged at `POST /api/v1/tab/exchange`, the shared
// `API_ROUTES.tabExchange`) and `POST /launcher/restart-when-idle` (202 and a
// clean exit when idle, 409 when busy). It prints `ready <port>` once listening.
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [dataDir, version, busyArg] = process.argv.slice(2);
if (dataDir === undefined || version === undefined) {
  console.error('usage: fake-server.mjs <dataDir> <version> <busySessions>');
  process.exit(2);
}
const busySessions = Number(busyArg ?? '0');
const token = randomBytes(32).toString('base64url');
const portFile = join(dataDir, 'server.json');
const tokenFile = join(dataDir, 'launcher.token');

const cleanUpAndExit = () => {
  rmSync(portFile, { force: true });
  rmSync(tokenFile, { force: true });
  process.exit(0);
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname.startsWith('/launcher/') && req.headers['x-ogden-launcher-token'] !== token) {
    return json(401, { error: { code: 'unauthorized', message: 'no' } });
  }
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  if (req.method === 'GET' && url.pathname === '/launcher/hello') {
    const info = { version, pid: process.pid, port, busySessions };
    return json(200, url.searchParams.get('launch') === '1' ? { ...info, launchUrl: `http://127.0.0.1:${port}/#c=${randomBytes(32).toString('base64url')}` } : info);
  }
  if (req.method === 'POST' && url.pathname === '/launcher/restart-when-idle') {
    if (busySessions > 0) return json(409, { restarting: false, busySessions });
    json(202, { restarting: true, busySessions: 0 });
    setTimeout(cleanUpAndExit, 50);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/tab/exchange') {
    // As the real gate does (AD-15 as amended): the token in the body, never in a URL; no cookie.
    return json(200, { token: randomBytes(32).toString('base64url') });
  }
  res.writeHead(404);
  res.end();
});

server.listen(0, '127.0.0.1', () => {
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  writeFileSync(tokenFile, token, { mode: 0o600 });
  writeFileSync(portFile, JSON.stringify({ port, pid: process.pid, version, startedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log(`ready ${port}`);
});
process.on('SIGTERM', cleanUpAndExit);
