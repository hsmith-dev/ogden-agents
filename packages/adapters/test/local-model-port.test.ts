/**
 * `LocalModelPort`'s contract (epic 14 story 14.3), run against the in-memory
 * stub and against the real adapter over the fake OpenAI-compatible server on
 * loopback: probe and list models answer the same shapes and the same failures
 * (unreachable, key refused, not an OpenAI server, timeout). The calls never
 * throw and never carry a key or an address in their words.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LocalModelPort, LocalModelTarget } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { createMemoryLocalModel, createOpenAiLocalModel } from '../src/index.js';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

const KEY = 'sk-contract-dummy-key';
const MODELS = ['fake-small', 'fake-large'];

interface Setup {
  port: LocalModelPort;
  ready: LocalModelTarget;
  keyed: LocalModelTarget;
  down: LocalModelTarget;
  notOpenAi: LocalModelTarget;
}

async function memory(): Promise<Setup> {
  const port = createMemoryLocalModel({
    'http://ready/v1': { models: MODELS.map((id) => ({ id })) },
    'http://keyed/v1': { models: MODELS.map((id) => ({ id })), requireKey: KEY },
    'http://odd/v1': { models: [], failWith: 'not_openai' },
  });
  return { port, ready: { baseUrl: 'http://ready/v1' }, keyed: { baseUrl: 'http://keyed/v1', key: KEY }, down: { baseUrl: 'http://nothing/v1' }, notOpenAi: { baseUrl: 'http://odd/v1' } };
}

async function real(): Promise<Setup> {
  const plain = await startFakeServer({ models: MODELS });
  const keyed = await startFakeServer({ models: MODELS, requireKey: KEY });
  const gone = await startFakeServer();
  const down = `${gone.url}/v1`;
  await gone.close();
  const odd = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>'));
  await new Promise<void>((resolve) => odd.listen(0, '127.0.0.1', resolve));
  closers.push(() => plain.close(), () => keyed.close(), () => new Promise<void>((resolve) => { odd.closeAllConnections(); odd.close(() => resolve()); }));
  return {
    port: createOpenAiLocalModel({ timeoutMs: 2_000 }),
    ready: { baseUrl: `${plain.url}/v1` },
    keyed: { baseUrl: `${keyed.url}/v1`, key: KEY },
    down: { baseUrl: down },
    notOpenAi: { baseUrl: `http://127.0.0.1:${(odd.address() as AddressInfo).port}/v1` },
  };
}

describe.each([
  ['the in-memory stub (local-model-memory)', memory],
  ['the OpenAI-compatible adapter', real],
])('LocalModelPort contract: %s', (_name, make) => {
  it('probes a ready endpoint and lists its models', async () => {
    const { port, ready } = await make();
    expect(await port.probe(ready)).toEqual({ ok: true, models: MODELS });
    expect(await port.listModels(ready)).toEqual({ ok: true, models: MODELS.map((id) => ({ id })) });
  });

  it('works with the right key and refuses without it', async () => {
    const { port, keyed } = await make();
    expect(await port.probe(keyed)).toMatchObject({ ok: true });
    expect(await port.probe({ baseUrl: keyed.baseUrl })).toMatchObject({ ok: false, kind: 'key_refused' });
    expect(await port.listModels({ baseUrl: keyed.baseUrl, key: 'wrong' })).toMatchObject({ ok: false, kind: 'key_refused' });
  });

  it('says a server that is not there is unreachable, and one that is not an OpenAI server is not_openai, never throwing', async () => {
    const { port, down, notOpenAi } = await make();
    expect(await port.probe(down)).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(await port.listModels(down)).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(await port.probe(notOpenAi)).toMatchObject({ ok: false, kind: 'not_openai' });
  });

  it('words every failure for the user, without the key, a path or a dash', async () => {
    const { port, keyed, down } = await make();
    for (const result of [await port.probe({ baseUrl: keyed.baseUrl }), await port.probe(down)]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason.length).toBeGreaterThan(5);
      expect(result.reason).not.toContain(KEY);
      expect(result.reason).not.toMatch(/—|–/);
    }
  });
});

describe('structuredComplete', () => {
  it('is answered by the real adapter now (story 14.8; its ladder and failures are in local-structured.test.ts)', async () => {
    const result = await createOpenAiLocalModel().structuredComplete({ baseUrl: 'http://127.0.0.1:1/v1' }, { model: 'm', prompt: 'p', schema: { type: 'object' } });
    expect(result).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('answers what the stub was given, and model_not_found for another model', async () => {
    const port = createMemoryLocalModel({ 'http://x/v1': { models: [{ id: 'm' }], structured: { m: { verdict: 'fit' } } } });
    expect(await port.structuredComplete({ baseUrl: 'http://x/v1' }, { model: 'm', prompt: 'p', schema: {} })).toEqual({ ok: true, value: { verdict: 'fit' }, mode: 'json_schema' });
    expect(await port.structuredComplete({ baseUrl: 'http://x/v1' }, { model: 'other', prompt: 'p', schema: {} })).toMatchObject({ ok: false, kind: 'model_not_found' });
  });

  it('records the calls the stub got, never a key', async () => {
    const port = createMemoryLocalModel({ 'http://x/v1': { models: [] } });
    await port.probe({ baseUrl: 'http://x/v1', key: KEY });
    expect(port.calls).toEqual([{ method: 'probe', baseUrl: 'http://x/v1' }]);
    expect(JSON.stringify(port.calls)).not.toContain(KEY);
  });
});

describe('what a local server reports of its models (epic 14 story 14.5)', () => {
  it('reads sizes, context length and tool support from the preset server\'s own API, and only what it says', async () => {
    const server = await startFakeServer({ models: ['fake-small', 'fake-large'] });
    closers.push(() => server.close());
    const port = createOpenAiLocalModel();
    const base = `${server.url}/v1`;
    const ollama = await port.listModels({ baseUrl: base, preset: 'ollama' });
    expect(ollama).toEqual({
      ok: true,
      models: [
        { id: 'fake-small', sizeBytes: 4_000_000_000, parameterSize: '7B', contextTokens: 4096, toolCall: false },
        { id: 'fake-large', sizeBytes: 4_000_000_000, parameterSize: '7B', contextTokens: 32_768, toolCall: true },
      ],
    });
    const lmstudio = await port.listModels({ baseUrl: base, preset: 'lmstudio' });
    expect(lmstudio).toEqual({ ok: true, models: [{ id: 'fake-small', contextTokens: 4096 }, { id: 'fake-large', contextTokens: 32_768, toolCall: true }] });
    // Another kind of server: only the ids, nothing guessed, and no native call made.
    const before = server.log.length;
    expect(await port.listModels({ baseUrl: base })).toEqual({ ok: true, models: [{ id: 'fake-small' }, { id: 'fake-large' }] });
    expect(server.log.slice(before).map((entry) => entry.path)).toEqual(['/v1/models']);
  });

  it('keeps the ids when the native API is not there', async () => {
    const odd = createServer((req, res) => {
      if (req.url === '/v1/models') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'a' }] }));
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => odd.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => { odd.closeAllConnections(); odd.close(() => resolve()); }));
    const base = `http://127.0.0.1:${(odd.address() as AddressInfo).port}/v1`;
    const port = createOpenAiLocalModel();
    expect(await port.listModels({ baseUrl: base, preset: 'ollama' })).toEqual({ ok: true, models: [{ id: 'a' }] });
    expect(await port.listModels({ baseUrl: base, preset: 'lmstudio' })).toEqual({ ok: true, models: [{ id: 'a' }] });
  });
});
