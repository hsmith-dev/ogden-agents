/**
 * Test connection and Detect (epic 14 story 14.4), over the stub port: the
 * state in plain words for each outcome, a host nobody confirmed refused
 * before anything is called, and Detect probing loopback only.
 */
import { describe, expect, it } from 'vitest';
import { createLocalModels, EndpointConfirmationRequiredError, type LocalModelPort, type SecretStorePort } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

// The stub port lives in adapters, which core's tests do not import (AD-1): a tiny local one with the same contract.
function port(table: Record<string, { models?: string[]; fail?: 'unreachable' | 'key_refused' | 'timeout' | 'not_openai'; key?: string }>) {
  const calls: string[] = [];
  const fake: LocalModelPort = {
    async probe(target) {
      calls.push(target.baseUrl);
      const entry = table[target.baseUrl];
      if (entry === undefined || entry.fail === 'unreachable') return { ok: false, kind: 'unreachable', reason: 'The server at x isn\'t answering.' };
      if (entry.fail !== undefined) return { ok: false, kind: entry.fail, reason: 'The server at x didn\'t answer the way an OpenAI compatible server does.' };
      if (entry.key !== undefined && entry.key !== target.key) return { ok: false, kind: 'key_refused', reason: 'no' };
      return { ok: true, models: entry.models ?? [] };
    },
    async listModels() {
      throw new Error('not used');
    },
    async structuredComplete() {
      throw new Error('not used');
    },
  };
  return { fake, calls };
}

const secrets = (): SecretStorePort => {
  const values = new Map<string, string>();
  return { backend: 'memory', get: async (n) => values.get(n), set: async (n, v) => void values.set(n, v), delete: async (n) => void values.delete(n) };
};

describe('Test connection', () => {
  it.each([
    ['ready', { models: ['a', 'b'] }, 'ready', 'Ready. 2 models are available.'],
    ['one model', { models: ['a'] }, 'ready', 'Ready. 1 model is available.'],
    ['running with none', { models: [] }, 'no_models', 'Running, but no model is loaded yet. Load one in the server, then test again.'],
    ['not running', { fail: 'unreachable' as const }, 'not_running', 'Not running. Start the server, then test again.'],
    ['too slow', { fail: 'timeout' as const }, 'not_running', 'Not running. Start the server, then test again.'],
    ['key refused', { models: ['a'], key: 'secret' }, 'key_refused', "The server didn't accept the key. Add the right key, or check the one saved, then test again."],
  ])('%s', async (_name, entry, state, message) => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1234/v1' });
    const { fake } = port({ 'http://localhost:1234/v1': entry });
    expect(await createLocalModels({ endpoints, port: fake }).test(added.id)).toMatchObject({ state, message });
  });

  it('says the server answered strangely, in the adapter\'s words, for anything else', async () => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1234/v1' });
    const { fake } = port({ 'http://localhost:1234/v1': { fail: 'not_openai' } });
    expect(await createLocalModels({ endpoints, port: fake }).test(added.id)).toMatchObject({ state: 'other', message: expect.stringContaining('OpenAI compatible') });
  });

  it('sends the saved key, and refuses a host nobody confirmed before anything is called', async () => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const keyed = await endpoints.add({ label: 'k', baseUrl: 'http://localhost:1234/v1', key: 'secret' });
    const remote = await endpoints.add({ label: 'r', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    await endpoints.update(remote.id, { baseUrl: 'https://b.example.com/v1' });
    const { fake, calls } = port({ 'http://localhost:1234/v1': { models: ['m'], key: 'secret' }, 'https://b.example.com/v1': { models: ['m'] } });
    const models = createLocalModels({ endpoints, port: fake });
    expect((await models.test(keyed.id)).state).toBe('ready');
    await expect(models.test(remote.id)).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
    expect(calls).toEqual(['http://localhost:1234/v1']);
  });
});

describe('models (epic 14 story 14.5)', () => {
  const listing = (models: Array<{ id: string }>): LocalModelPort => ({
    async probe() { return { ok: true, models: models.map((m) => m.id) }; },
    async listModels() { return { ok: true, models }; },
    async structuredComplete() { throw new Error('not used'); },
  });

  it('lists the models, tells the picker once, and marks a chosen model the server dropped as missing, never another', async () => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const told: string[][] = [];
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1234/v1', model: 'gone' });
    const models = createLocalModels({ endpoints, port: listing([{ id: 'a' }, { id: 'b' }]), onModels: (_id, list) => told.push(list.map((m) => m.id)) });
    expect(await models.models(added.id)).toMatchObject({ state: 'ready', model: 'gone', missing: 'gone', message: 'Ready. 2 models are available.' });
    expect(told).toEqual([['a', 'b']]);
    await endpoints.update(added.id, { model: 'b' });
    expect(await models.models(added.id)).toMatchObject({ model: 'b', missing: null });
  });

  it('is running with none when the list is empty, and never fails because the picker could not be told', async () => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1234/v1' });
    const models = createLocalModels({ endpoints, port: listing([]), onModels: () => { throw new Error('boom'); } });
    expect(await models.models(added.id)).toMatchObject({ state: 'no_models', missing: null });
  });

  it('refuses a host nobody confirmed', async () => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const added = await endpoints.add({ label: 'r', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    await endpoints.update(added.id, { baseUrl: 'https://b.example.com/v1' });
    await expect(createLocalModels({ endpoints, port: listing([]) }).models(added.id)).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
  });
});

describe('Detect', () => {
  const candidates = [
    { id: 'one', label: 'One', baseUrl: 'http://localhost:1234/v1' },
    { id: 'two', label: 'Two', baseUrl: 'http://localhost:11434/v1' },
    { id: 'far', label: 'Far', baseUrl: 'http://192.168.1.5:9999/v1' },
  ];

  it('probes 127.0.0.1 then localhost on each loopback candidate, once, and never another host', async () => {
    const core = openTestCore(tempDir());
    const { fake, calls } = port({ 'http://localhost:1234/v1': { models: ['a'] }, 'http://127.0.0.1:11434/v1': { models: [] } });
    const found = await createLocalModels({ endpoints: core.localEndpoints(secrets()), port: fake }).detect(candidates);
    expect(found).toEqual([
      { presetId: 'one', label: 'One', baseUrl: 'http://localhost:1234/v1', models: 1 },
      { presetId: 'two', label: 'Two', baseUrl: 'http://127.0.0.1:11434/v1', models: 0 },
    ]);
    expect(calls).toEqual(['http://127.0.0.1:1234/v1', 'http://localhost:1234/v1', 'http://127.0.0.1:11434/v1']);
    expect(calls.some((url) => url.includes('192.168'))).toBe(false);
  });

  it('finds nothing when nothing answers', async () => {
    const core = openTestCore(tempDir());
    const { fake } = port({});
    expect(await createLocalModels({ endpoints: core.localEndpoints(secrets()), port: fake }).detect(candidates)).toEqual([]);
  });
});

describe('Test as a manager (epic 14 story 14.8)', () => {
  const answering = (result: Awaited<ReturnType<LocalModelPort['structuredComplete']>>, calls: unknown[] = []): LocalModelPort => ({
    async probe() { return { ok: true, models: [] }; },
    async listModels() { return { ok: true, models: [] }; },
    async structuredComplete(target, request) {
      calls.push({ target, request });
      return result;
    },
  });
  const run = async (result: Awaited<ReturnType<LocalModelPort['structuredComplete']>>) => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const added = await endpoints.add({ label: 'x', baseUrl: 'http://localhost:1234/v1', key: 'k' });
    const calls: Array<{ target: { baseUrl: string; key?: string }; request: { model: string; schema: unknown; timeoutMs?: number; prompt: string } }> = [];
    const answer = await createLocalModels({ endpoints, port: answering(result, calls) }).managerTest(added.id, 'm1');
    return { answer, calls };
  };

  it('passes on a conforming answer, says how the model was asked, and sends one fixed small request with no tools', async () => {
    const { answer, calls } = await run({ ok: true, value: {}, mode: 'json_schema' });
    expect(answer).toMatchObject({ pass: true, mode: 'json_schema', message: 'Passed. The model answered in the shape a manager needs, with the server enforcing the shape.' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.request).toMatchObject({ model: 'm1', timeoutMs: 60_000 });
    expect(calls[0]!.target).toEqual({ baseUrl: 'http://localhost:1234/v1', key: 'k' });
    expect(JSON.stringify(calls[0]!.request.schema)).toContain('"tasks"');
    expect((await run({ ok: true, value: {}, mode: 'prompt' })).answer.message).toContain('in plain words');
  });

  it.each([
    [{ ok: false, kind: 'timeout', reason: 'x' }, 'Too slow: no answer in 60 seconds.'],
    [{ ok: false, kind: 'context_full', reason: 'x' }, "The model's context is too small for this test. Load it with a larger context in the server."],
    [{ ok: false, kind: 'model_not_found', reason: 'x' }, "The server doesn't have that model right now."],
    [{ ok: false, kind: 'bad_answer', reason: 'The model answered, but not in the shape asked for (the answer is not JSON).' }, "The model's answer was not valid JSON, even when asked again."],
    [{ ok: false, kind: 'bad_answer', reason: 'The model answered, but not in the shape asked for ($.tasks: missing).' }, 'The model answered with JSON, but ignored the shape it was asked for, even when asked again.'],
    [{ ok: false, kind: 'key_refused', reason: "The server at h didn't accept the key." }, "The server at h didn't accept the key."],
  ] as const)('fails in plain words: %j', async (result, message) => {
    const { answer } = await run(result as never);
    expect(answer).toEqual({ pass: false, mode: null, ms: expect.any(Number), message });
    expect(answer.message).not.toMatch(/—|–/);
  });

  it('refuses a host nobody confirmed before anything is called', async () => {
    const core = openTestCore(tempDir());
    const endpoints = core.localEndpoints(secrets());
    const added = await endpoints.add({ label: 'r', baseUrl: 'https://a.example.com/v1', confirmHost: 'https://a.example.com' });
    await endpoints.update(added.id, { baseUrl: 'https://b.example.com/v1' });
    const calls: unknown[] = [];
    await expect(createLocalModels({ endpoints, port: answering({ ok: true, value: {}, mode: 'prompt' }, calls) }).managerTest(added.id, 'm')).rejects.toBeInstanceOf(EndpointConfirmationRequiredError);
    expect(calls).toEqual([]);
  });
});
