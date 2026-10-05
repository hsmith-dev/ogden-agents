/**
 * The desktop build's Node download check (story 13.4, AD-23): a tampered archive fails the build,
 * a cached file is checked too, and the right bytes pass. A local server stands in for nodejs.org;
 * nothing here reaches the network.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PinMismatchError, verifiedArchive } from '../packages/desktop/scripts/node-archive.mjs';

const GOOD = Buffer.from('pretend this is a Node archive');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const pins = (hash: string) => ({ version: '1.2.3', archives: { 'win-x64': { ext: 'zip', sha256: hash } } });

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function mirror(body: Buffer): Promise<{ base: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}
const cache = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-stage-test-'));
  dirs.push(dir);
  return dir;
};

describe('the pinned Node download', () => {
  it('passes the right bytes and asks for the pinned version and file only', async () => {
    const { base, requests } = await mirror(GOOD);
    const dir = cache();
    const result = await verifiedArchive({ plat: 'win-x64', cache: dir, pins: pins(sha(GOOD)), base });
    expect(result.name).toBe('node-v1.2.3-win-x64');
    expect(existsSync(result.file)).toBe(true);
    expect(requests).toEqual(['/v1.2.3/node-v1.2.3-win-x64.zip']);
  });

  it('refuses a tampered download, keeps nothing and says why', async () => {
    const { base } = await mirror(Buffer.from('tampered'));
    const dir = cache();
    await expect(verifiedArchive({ plat: 'win-x64', cache: dir, pins: pins(sha(GOOD)), base })).rejects.toBeInstanceOf(PinMismatchError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('checks a cached file too: a swapped cache entry is refused and removed, not trusted', async () => {
    const { base, requests } = await mirror(GOOD);
    const dir = cache();
    writeFileSync(join(dir, 'node-v1.2.3-win-x64.zip'), 'swapped in the cache');
    await expect(verifiedArchive({ plat: 'win-x64', cache: dir, pins: pins(sha(GOOD)), base })).rejects.toThrow(/SHA-256 mismatch/);
    expect(requests).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    // The next run downloads it again and passes.
    await expect(verifiedArchive({ plat: 'win-x64', cache: dir, pins: pins(sha(GOOD)), base })).resolves.toMatchObject({ sha256: sha(GOOD) });
  });

  it('has no pin for a target it does not know', async () => {
    await expect(verifiedArchive({ plat: 'plan9-x64', cache: cache(), pins: pins(sha(GOOD)), base: 'http://127.0.0.1:1' })).rejects.toThrow('no Node pin for plan9-x64');
  });
});
