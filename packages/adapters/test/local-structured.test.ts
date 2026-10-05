/**
 * `structuredComplete` (epic 14 story 14.8): one non-streaming chat completion
 * constrained to a caller's schema and validated by Ogden, against the fake
 * OpenAI-compatible server and its modes. The ladder (json_schema, json_object,
 * prompt only), one repair request, the size cap, the timeout and every plain
 * failure. No tools, no files, no streaming, temperature 0.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../../tests/fixtures/fake-openai-server.mjs';
import { createMemoryLocalModel, createOpenAiLocalModel, parseModelJson, schemaProblems } from '../src/index.js';

const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const fake = async (options: Parameters<typeof startFakeServer>[0] = {}) => {
  const server = await startFakeServer(options);
  servers.push(server);
  return server;
};

const SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict', 'reason'], properties: { verdict: { enum: ['fit', 'unfit'] }, reason: { type: 'string' } } };
const ask = (server: FakeServer, model: string, prompt: string, extra: Record<string, unknown> = {}, key?: string) =>
  createOpenAiLocalModel().structuredComplete({ baseUrl: `${server.url}/v1`, key }, { model, prompt, schema: SCHEMA, ...extra });
const chats = (server: FakeServer) => server.log.filter((entry) => entry.path === '/v1/chat/completions');

describe('a conforming answer', () => {
  it('passes on the strictest ask, with one non-streaming request, temperature 0, no tools, and the key only as a bearer', async () => {
    const server = await fake({ requireKey: 'k1' });
    const result = await ask(server, 'fake-small', 'Is this fit? MANAGER_TEST', {}, 'k1');
    expect(result).toEqual({ ok: true, value: { verdict: 'fit', reason: 'ok' }, mode: 'json_schema' });
    expect(chats(server)).toHaveLength(1);
    expect(chats(server)[0]).toMatchObject({ model: 'fake-small', stream: false, temperature: 0, responseFormat: 'json_schema', auth: 'bearer-present', authMatches: true });
    expect(chats(server)[0]!.tools ?? []).toEqual([]);
    expect(chats(server)[0]!.maxTokens).toBe(1024);
  });

  it('has no Authorization header for a keyless endpoint, and caps what is asked for', async () => {
    const server = await fake();
    await ask(server, 'fake-small', 'Is this fit? MANAGER_TEST', { maxTokens: 999_999 });
    expect(chats(server)[0]).toMatchObject({ auth: 'none', maxTokens: 4096 });
  });
});

describe('the ladder', () => {
  it('moves to json_object when the server refuses json_schema', async () => {
    const server = await fake();
    expect(await ask(server, 'fake-nojson', 'Is this fit? MANAGER_TEST')).toMatchObject({ ok: true, mode: 'json_object' });
    expect(chats(server).map((entry) => entry.responseFormat)).toEqual(['json_schema', 'json_object']);
  });

  it('moves to the prompt alone when the server refuses any response_format, and accepts a fenced answer', async () => {
    const server = await fake();
    expect(await ask(server, 'fake-noformat', 'Is this fit? MANAGER_TEST')).toEqual({ ok: true, value: { verdict: 'fit', reason: 'ok' }, mode: 'prompt' });
    expect(chats(server).map((entry) => entry.responseFormat)).toEqual(['json_schema', 'json_object', undefined]);
  });

  it('gives a model that only gets it right when asked again one repair request, then passes', async () => {
    const server = await fake();
    expect(await ask(server, 'fake-small', 'Is this fit? REPAIRABLE')).toEqual({ ok: true, value: { verdict: 'fit', reason: 'ok' }, mode: 'prompt' });
    expect(chats(server)).toHaveLength(4);
  });

  it('fails in plain words after the one repair, with at most four requests, never naming the answer', async () => {
    const server = await fake();
    const result = await ask(server, 'fake-small', 'Is this fit? MANAGER_TEST MALFORMED');
    expect(result).toMatchObject({ ok: false, kind: 'bad_answer' });
    expect((result as { reason: string }).reason).toMatch(/answered, but not in the shape asked for/);
    expect((result as { reason: string }).reason).not.toContain('Sure!');
    expect(chats(server)).toHaveLength(4);
  });
});

describe('failures that stop at once', () => {
  it('a wrong key', async () => {
    const server = await fake({ requireKey: 'right' });
    expect(await ask(server, 'fake-small', 'x MANAGER_TEST', {}, 'wrong')).toMatchObject({ ok: false, kind: 'key_refused' });
    expect(chats(server)).toHaveLength(1);
  });

  it('a server that is not running', async () => {
    const server = await fake();
    const base = server;
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(await ask(base, 'fake-small', 'x')).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('a model the server does not have, and a context that is too small', async () => {
    const server = await fake();
    expect(await ask(server, 'fake-small', 'NOTFOUND')).toMatchObject({ ok: false, kind: 'model_not_found' });
    expect(await ask(server, 'no-such-model', 'x')).toMatchObject({ ok: false, kind: 'model_not_found' });
    expect(await ask(server, 'fake-small', 'CTXFULL')).toMatchObject({ ok: false, kind: 'context_full' });
    expect(chats(server)).toHaveLength(3);
  });

  it('an answer larger than the cap is refused', async () => {
    const server = await fake();
    expect(await ask(server, 'fake-small', 'HUGE')).toMatchObject({ ok: false, kind: 'too_large' });
  });

  it('a model that takes longer than the hard timeout', async () => {
    const server = await fake({ slowMs: 3_000 });
    const started = Date.now();
    expect(await ask(server, 'fake-small', 'SLOW MANAGER_TEST', { timeoutMs: 300 })).toMatchObject({ ok: false, kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('an unusable schema, without calling anything', async () => {
    const server = await fake();
    const port = createOpenAiLocalModel();
    expect(await port.structuredComplete({ baseUrl: `${server.url}/v1` }, { model: 'm', prompt: 'p', schema: { type: 'string', description: 'x'.repeat(30_000) } })).toMatchObject({ ok: false, kind: 'bad_answer' });
    expect(server.log).toEqual([]);
  });

  it('can be stopped by the caller', async () => {
    const server = await fake({ slowMs: 3_000 });
    const controller = new AbortController();
    const pending = ask(server, 'fake-small', 'SLOW MANAGER_TEST', { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toMatchObject({ ok: false });
  });
});

describe('Ogden checks the answer itself', () => {
  it('refuses an answer that is JSON but not the shape, even when the server accepted the constraint', async () => {
    const server = await fake();
    const strict = { ...SCHEMA, properties: { verdict: { enum: ['maybe'] }, reason: { type: 'string' } } };
    // A model that ignores the constraint (this one always answers verdict fit, whatever it was asked).
    const result = await ask(server, 'fake-noformat', 'Is this fit? MANAGER_TEST', { schema: strict });
    expect(result).toMatchObject({ ok: false, kind: 'bad_answer' });
    expect((result as { reason: string }).reason).toMatch(/not in the shape asked for/);
    // The rungs each got the same fenced answer that did not fit; the repair got something else.
    expect(chats(server).length).toBe(4);
  });

  it('reads the JSON of a plain or a fenced answer, and nothing else', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ json: { a: 1 } });
    expect(parseModelJson('Here:\n```json\n{"a":1}\n```\nDone')).toEqual({ json: { a: 1 } });
    expect(parseModelJson('Sure! fit.')).toBeUndefined();
    expect(parseModelJson('')).toBeUndefined();
  });

  it.each([
    [{ a: 'x' }, { type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, 0],
    [{}, { type: 'object', required: ['a'] }, 1],
    [{ a: 1, b: 2 }, { type: 'object', additionalProperties: false, properties: { a: { type: 'integer' } } }, 1],
    [[1, 'x'], { type: 'array', items: { type: 'integer' }, maxItems: 1 }, 2],
    ['abc', { type: 'string', minLength: 5 }, 1],
    [5, { type: 'number', maximum: 3 }, 1],
    [null, { type: ['string', 'null'] }, 0],
    [1.5, { type: 'integer' }, 1],
    ['x', { const: 'y' }, 1],
    [{ a: { b: [] } }, { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'array', minItems: 1 } } } } }, 1],
  ])('checks %j against a schema: %j gives %i problem(s)', (value, schema, count) => {
    expect(schemaProblems(value, schema)).toHaveLength(count);
  });

  it('never puts the value in a problem', () => {
    expect(schemaProblems({ secret: 'sk-123' }, { type: 'object', additionalProperties: false, properties: {} }).join(' ')).not.toContain('sk-123');
  });
});

describe('the stub answers the same contract', () => {
  it('answers what it was given and fails the same kinds', async () => {
    const stub = createMemoryLocalModel({ 'http://x/v1': { models: [{ id: 'm' }], structured: { m: { verdict: 'fit', reason: 'ok' } } } });
    expect(await stub.structuredComplete({ baseUrl: 'http://x/v1' }, { model: 'm', prompt: 'p', schema: SCHEMA })).toEqual({ ok: true, value: { verdict: 'fit', reason: 'ok' }, mode: 'json_schema' });
    expect(await stub.structuredComplete({ baseUrl: 'http://y/v1' }, { model: 'm', prompt: 'p', schema: SCHEMA })).toMatchObject({ ok: false, kind: 'unreachable' });
  });
});
