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
