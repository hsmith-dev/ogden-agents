/**
 * Ogden's own calls to an OpenAI-compatible endpoint (epic 14, story 14.2):
 * the probe before a chat, with the key only as a bearer token, no redirect
 * followed, a hard timeout and a cap on the answer, and every failure in
 * plain words. Only the fake server on loopback is ever called.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { callEndpoint, endpointFailureWords, endpointUrl, EndpointError, hostOf, modelIdsOf, probeEndpoint } from '../src/index.js';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fake(options: Parameters<typeof startFakeServer>[0] = {}): Promise<FakeServer> {
  const server = await startFakeServer(options);
  closers.push(() => server.close());
  return server;
}

async function raw(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('probing an endpoint', () => {
  it('lists the models a ready server serves, once each', async () => {
    const server = await fake();
    expect(await probeEndpoint({ baseUrl: `${server.url}/v1` })).toEqual({ ok: true, models: ['fake-small', 'fake-large', 'fake-nojson', 'fake-noformat'] });
    expect(server.log.map((entry) => `${entry.method} ${entry.path}`)).toEqual(['GET /v1/models']);
  });

  it('sends the key only as a bearer token, and a keyless endpoint gets no Authorization header', async () => {
    const server = await fake({ requireKey: 'dummy-key' });
    expect(await probeEndpoint({ baseUrl: `${server.url}/v1`, key: 'dummy-key' })).toMatchObject({ ok: true });
    expect(server.log.at(-1)).toMatchObject({ auth: 'bearer-present', authMatches: true });
    expect(await probeEndpoint({ baseUrl: `${server.url}/v1` })).toEqual({ ok: false, kind: 'key_refused', status: 401 });
    expect(await probeEndpoint({ baseUrl: `${server.url}/v1`, key: 'wrong' })).toEqual({ ok: false, kind: 'key_refused', status: 401 });
  });

  it('says a server that is not running is unreachable, quickly', async () => {
    const server = await fake();
    const base = `${server.url}/v1`;
    await server.close();
    const started = Date.now();
    expect(await probeEndpoint({ baseUrl: base })).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('times out on a server that never answers', async () => {
    const url = await raw(() => {});
    const started = Date.now();
    expect(await probeEndpoint({ baseUrl: `${url}/v1`, timeoutMs: 150 })).toEqual({ ok: false, kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('refuses something that is not an OpenAI compatible model list', async () => {
    const html = await raw((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>hello</html>'));
    expect(await probeEndpoint({ baseUrl: `${html}/v1` })).toEqual({ ok: false, kind: 'not_openai' });
    const wrong = await raw((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"models": []}'));
    expect(await probeEndpoint({ baseUrl: `${wrong}/v1` })).toEqual({ ok: false, kind: 'not_openai' });
  });

  it('reports an HTTP error with its status, and a refused key as its own kind', async () => {
    const missing = await raw((_req, res) => res.writeHead(404).end('nope'));
    expect(await probeEndpoint({ baseUrl: `${missing}/v1` })).toEqual({ ok: false, kind: 'http', status: 404 });
    const forbidden = await raw((_req, res) => res.writeHead(403).end('no'));
    expect(await probeEndpoint({ baseUrl: `${forbidden}/v1`, key: 'k' })).toEqual({ ok: false, kind: 'key_refused', status: 403 });
  });

  it('never follows a redirect, so a key cannot be carried to another host', async () => {
    const other = await fake({ requireKey: 'dummy-key' });
    const redirecting = await raw((_req, res) => res.writeHead(302, { location: `${other.url}/v1/models` }).end());
    const result = await probeEndpoint({ baseUrl: `${redirecting}/v1`, key: 'dummy-key' });
    expect(result.ok).toBe(false);
    expect(other.log).toEqual([]);
  });

  it('refuses an answer larger than it allows', async () => {
    const big = await raw((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(`{"data":[${'{"id":"x"},'.repeat(5_000)}{"id":"y"}]}`));
    expect(await probeEndpoint({ baseUrl: `${big}/v1`, ...{ maxBytes: 1_000 } })).toEqual({ ok: false, kind: 'too_large' });
  });

  it('never throws, whatever fetch does', async () => {
    const throwing = (() => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }) }))) as unknown as typeof fetch;
    expect(await probeEndpoint({ baseUrl: 'http://localhost:1/v1', fetch: throwing })).toMatchObject({ ok: false, kind: 'unreachable' });
    await expect(callEndpoint({ baseUrl: 'http://localhost:1/v1', fetch: throwing }, 'models')).rejects.toBeInstanceOf(EndpointError);
  });

  it('stops at once when told to', async () => {
    const url = await raw(() => {});
    const controller = new AbortController();
    const probe = probeEndpoint({ baseUrl: `${url}/v1`, signal: controller.signal, timeoutMs: 10_000 });
    setTimeout(() => controller.abort(), 50);
    expect(await probe).toMatchObject({ ok: false });
  });
});

describe('reading a model list and building URLs', () => {
  it('reads the ids of a models answer, once each, and ignores entries without one', () => {
    expect(modelIdsOf({ data: [{ id: 'a' }, { id: 'a' }, { id: '' }, {}, { id: 5 }, { id: 'b' }] })).toEqual(['a', 'b']);
    expect(modelIdsOf({})).toBeUndefined();
    expect(modelIdsOf(null)).toBeUndefined();
    expect(modelIdsOf({ data: [] })).toEqual([]);
  });

  it('joins a path onto the base whatever the slashes', () => {
    expect(endpointUrl('http://localhost:1234/v1', 'models')).toBe('http://localhost:1234/v1/models');
    expect(endpointUrl('http://localhost:1234/v1/', '/models')).toBe('http://localhost:1234/v1/models');
  });
});

describe('what a failure says', () => {
  it('names only the host, never the path, credentials or key, and no dash', () => {
    const base = 'https://user:secret@example.com:8443/private/v1?token=abc';
    expect(hostOf(base)).toBe('example.com:8443');
    for (const kind of ['unreachable', 'timeout', 'key_refused', 'not_openai', 'too_large', 'http'] as const) {
      const words = endpointFailureWords(kind, base, 500);
      expect(words).toContain('example.com:8443');
      expect(words).not.toMatch(/secret|private|token|abc/);
      expect(words).not.toMatch(/—|–/);
    }
    expect(endpointFailureWords('http', 'http://localhost:1/v1', 502)).toContain('(502)');
    expect(hostOf('not a url')).toBe('the server');
  });
});
