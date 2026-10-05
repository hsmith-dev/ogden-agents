#!/usr/bin/env node
// A local stand-in for the GitHub Release the desktop updater reads (story 13.10; 13.13 reuses it).
// Serves, from a folder prepared by `packages/desktop/scripts/release-manifest.mjs`:
//
//   /stable/latest.json   the manifest of the stable channel   (404 without <dir>/stable.json)
//   /next/latest.json     the manifest of the next channel     (404 without <dir>/next.json)
//   /files/<name>         the update artifacts and SHA256SUMS-desktop.txt
//
// The manifests' `url` fields are rewritten to this server. `--tamper` plays a bad release:
//   sig    every manifest carries a signature that is not the file's
//   bytes  the update file's bytes are changed (its signature no longer fits)
//   sums   SHA256SUMS-desktop.txt lists the wrong hashes
// Plain http, loopback only, no network. Prints `ready <port>` when listening.
//
//   node serve.mjs --dir <folder> [--port 0] [--tamper sig|bytes|sums]
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { dir: { type: 'string' }, port: { type: 'string', default: '0' }, tamper: { type: 'string' } }, strict: true });
if (!values.dir) {
  console.error('usage: serve.mjs --dir <folder> [--port N] [--tamper sig|bytes|sums]');
  process.exit(2);
}
const dir = resolve(values.dir);
const tamper = values.tamper;

function manifest(channel, host) {
  const file = join(dir, `${channel}.json`);
  if (!existsSync(file)) return undefined;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  for (const platform of Object.values(m.platforms)) {
    platform.url = `http://${host}/files/${encodeURIComponent(basename(new URL(platform.url).pathname))}`;
    if (tamper === 'sig') platform.signature = Buffer.from('untrusted comment: signature from another file\nRUQ' + 'A'.repeat(90) + '\ntrusted comment: nope\n' + 'A'.repeat(86) + '\n').toString('base64');
  }
  return m;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const host = req.headers.host ?? 'localhost';
  const channel = /^\/(stable|next)\/latest\.json$/.exec(url.pathname)?.[1];
  if (channel !== undefined) {
    const m = manifest(channel, host);
    if (m === undefined) return void res.writeHead(404).end();
    return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(m));
  }
  const name = /^\/files\/([^/]+)$/.exec(url.pathname)?.[1];
  const file = name === undefined ? undefined : join(dir, 'files', decodeURIComponent(name));
  if (file === undefined || !existsSync(file)) return void res.writeHead(404).end();
  let body = readFileSync(file);
  if (tamper === 'bytes' && !file.endsWith('.txt') && !file.endsWith('.sig')) {
    body = Buffer.from(body);
    body[Math.floor(body.length / 2)] ^= 0xff;
  }
  if (tamper === 'sums' && file.endsWith('.txt')) body = Buffer.from(body.toString('utf8').replace(/^[0-9a-f]{64}/gm, 'f'.repeat(64)));
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length }).end(body);
});
server.listen(Number(values.port), '127.0.0.1', () => console.log(`ready ${server.address().port}`));
