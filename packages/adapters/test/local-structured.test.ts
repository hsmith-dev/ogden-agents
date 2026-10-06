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

describe('hostile and odd answers (review fixes)', () => {
  it('never lets a __proto__ or constructor key count as present or allowed', () => {
    const hostile = JSON.parse('{"__proto__":{"x":1},"verdict":"fit","reason":"r"}') as unknown;
    expect(schemaProblems(hostile, SCHEMA)).toEqual(['$.__proto__: not allowed']);
    expect(schemaProblems({}, { type: 'object', required: ['constructor'] })).toEqual(['$.constructor: missing']);
    expect(schemaProblems({ toString: 1 }, { type: 'object', additionalProperties: false, properties: {} })).toEqual(['$.toString: not allowed']);
  });

  it('collects at most twenty problems and never throws on a huge wrong answer, and names a long key shortened', () => {
    const many = Array.from({ length: 150_000 }, () => 'x');
    const problems = schemaProblems(many, { type: 'array', items: { type: 'integer' } });
    expect(problems).toHaveLength(20);
    const key = 'k'.repeat(5_000);
    const named = schemaProblems({ [key]: 1 }, { type: 'object', additionalProperties: false, properties: {} })[0]!;
    expect(named.length).toBeLessThan(80);
  });

  it('refuses a schema that uses a rule it cannot check, or nests too deep, up front and calls nothing', async () => {
    const { unsupportedRule } = await import('../src/index.js');
    expect(unsupportedRule({ type: 'object', properties: { a: { anyOf: [] } } })).toBe('anyOf');
    expect(unsupportedRule({ $ref: '#/x' })).toBe('$ref');
    expect(unsupportedRule({ type: 'string', pattern: '^a' })).toBe('pattern');
    expect(unsupportedRule(SCHEMA)).toBeUndefined();
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 30; i++) deep = { type: 'object', properties: { a: deep } };
    expect(unsupportedRule(deep)).toBe('nested too deeply');
    const server = await fake();
    expect(await ask(server, 'fake-small', 'x', { schema: { type: 'string', pattern: 'a' } })).toMatchObject({ ok: false, kind: 'bad_answer', detail: 'bad_schema' });
    expect(server.log).toEqual([]);
  });

  it('parses JSON after prose or a reasoning block, a fence with a backtick string inside bare JSON, and is linear on a hostile text', () => {
    expect(parseModelJson('Here is the plan: {"a":1} Hope that helps')).toEqual({ json: { a: 1 } });
    expect(parseModelJson('<think>maybe {"a":2}</think>\n{"a":1}')).toEqual({ json: { a: 1 } });
    expect(parseModelJson('{"a":"```not a fence```"}')).toEqual({ json: { a: '```not a fence```' } });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ json: { a: 1 } });
    const started = Date.now();
    expect(parseModelJson(`\`\`\`${' '.repeat(250_000)}`)).toBeUndefined();
    expect(parseModelJson('['.repeat(100_000))).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('compares enum values whatever their key order', () => {
    expect(schemaProblems({ a: 1, b: 2 }, { enum: [{ b: 2, a: 1 }] })).toEqual([]);
  });

  it('refuses a call that is already stopped without sending anything', async () => {
    const server = await fake();
    const controller = new AbortController();
    controller.abort();
    expect(await ask(server, 'fake-small', 'x MANAGER_TEST', { signal: controller.signal })).toMatchObject({ ok: false });
    expect(server.log).toEqual([]);
  });

  it('keeps one deadline for the whole call, not one per request', async () => {
    // Every rung is refused slowly (a server that takes a moment to say no), so the ladder would run long without one deadline.
    const server = await fake({ slowMs: 400 });
    const started = Date.now();
    const result = await ask(server, 'fake-small', 'SLOW MANAGER_TEST MALFORMED', { timeoutMs: 700 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ ok: false });
  });

  it('reads a list of content parts, and treats an empty or null answer as an answer that is not JSON, not as a broken server', async () => {
    const { createServer } = await import('node:http');
    const answers: unknown[] = [[{ type: 'text', text: '{"verdict":"fit","reason":"ok"}' }], null, ''];
    let index = 0;
    const odd = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const content = answers[Math.min(index++, answers.length - 1)];
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      });
    });
    await new Promise<void>((resolve) => odd.listen(0, '127.0.0.1', resolve));
    const port = (odd.address() as import('node:net').AddressInfo).port;
    try {
      const target = { baseUrl: `http://127.0.0.1:${port}/v1` };
      const model = createOpenAiLocalModel();
      expect(await model.structuredComplete(target, { model: 'm', prompt: 'p', schema: SCHEMA })).toMatchObject({ ok: true, mode: 'json_schema' });
      expect(await model.structuredComplete(target, { model: 'm', prompt: 'p', schema: SCHEMA })).toMatchObject({ ok: false, kind: 'bad_answer', detail: 'not_json' });
    } finally {
      odd.closeAllConnections();
      await new Promise((resolve) => odd.close(resolve));
    }
  });

  it('tells a full context from a refused ask by the server\'s code, type or words, and walks on for a 500 on a response_format rung', async () => {
    const { createServer } = await import('node:http');
    let reply: { status: number; body: unknown } = { status: 400, body: {} };
    let calls = 0;
    const odd = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        calls++;
        res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => odd.listen(0, '127.0.0.1', resolve));
    const target = { baseUrl: `http://127.0.0.1:${(odd.address() as import('node:net').AddressInfo).port}/v1` };
    const model = createOpenAiLocalModel();
    const run = () => model.structuredComplete(target, { model: 'm', prompt: 'p', schema: SCHEMA });
    try {
      for (const body of [
        { error: { message: 'x', type: 'exceed_context_size_error', code: 400 } },
        { error: { message: "This model's maximum context length is 4096 tokens", type: 'BadRequestError' } },
        { error: 'Trying to keep the first 4000 tokens when context window is 2048' },
      ]) {
        reply = { status: 400, body };
        calls = 0;
        expect(await run(), JSON.stringify(body)).toMatchObject({ ok: false, kind: 'context_full' });
        expect(calls).toBe(1);
      }
      // A 500 for an unsupported response_format moves down the ladder (three rungs), and the last rung's 500 ends it.
      reply = { status: 500, body: { error: 'boom' } };
      calls = 0;
      expect(await run()).toMatchObject({ ok: false, kind: 'http', status: 500 });
      expect(calls).toBe(3);
    } finally {
      odd.closeAllConnections();
      await new Promise((resolve) => odd.close(resolve));
    }
  });
});
