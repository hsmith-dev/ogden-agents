/**
 * The real manager (epic 15, story 15.4) over scripted `LocalModelPort`s and
 * endpoints: the call goes through `LocalEndpoints.target` first (an unconfirmed
 * host or a missing endpoint is refused before anything is called), the input is
 * capped to half of the reported context, `structuredComplete`'s own repair is
 * never doubled, a broken rule gets one repair that names only the rule, every
 * failure kind is told in plain words, and the masked answer is recorded. No
 * model, network or keychain.
 */
import { MANAGER_DECISION_VERSION, MANAGER_PLAN_VERSION, MANAGER_REFUSAL_REASONS, type ManagerPlan } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  EndpointConfirmationRequiredError,
  MANAGER_FAILURE_KINDS,
  MANAGER_FAILURE_WORDS,
  NotFoundError,
  createContextReader,
  createModelManager,
  type LocalEndpoints,
  type LocalFailure,
  type LocalModelPort,
  type LocalModelTarget,
  type ManagerContext,
  type ManagerDecisionContext,
  type StructuredRequest,
  type StructuredResult,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const ENDPOINT = 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as never;
const NO_DASH = /[–—]| - /;
const KEY = 'endpoint-key-0b7e55-never-in-a-prompt';

const context = (overrides: Partial<ManagerContext> = {}): ManagerContext => ({
  goal: 'Add a contact form to the site',
  projectSummary: 'A small website.',
  workers: [
    { agentId: 'alpha', label: 'Alpha', ready: true, modes: ['ask'], chats: [] },
    { agentId: 'beta', label: 'Beta', ready: true, modes: ['ask'], chats: [] },
    { agentId: 'gamma', label: 'Gamma', ready: false, modes: ['ask'], chats: [] },
  ],
  ...overrides,
});
const PLAN: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form to the site',
  steps: [
    { id: 's1', worker: 'alpha', chat: 'new', instruction: 'Write the failing test.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'beta', chat: 'new', instruction: 'Review the result.', mode: 'ask', depends_on: ['s1'] },
  ],
};
const decideContext = (overrides: Partial<ManagerContext> = {}): ManagerDecisionContext => ({ ...context(overrides), plan: PLAN });
const DISPATCH = { version: MANAGER_DECISION_VERSION, action: 'dispatch', reason: 'It is next.', step_id: 's1' };

type Reply = StructuredResult | ((request: StructuredRequest, target: LocalModelTarget) => StructuredResult);
const ok = (value: unknown, mode: 'json_schema' | 'json_object' | 'prompt' = 'json_schema'): StructuredResult => ({ ok: true, value, mode });
const failed = (kind: LocalFailure['kind'], detail?: string): StructuredResult => ({ ok: false, kind, reason: `raw ${kind} words with http://secret-host:1234`, ...(detail === undefined ? {} : { detail }) });

/** A port that answers the scripted replies in order (the last repeats) and records every request. */
function scripted(replies: Reply[], models: Array<{ id: string; contextTokens?: number }> = [{ id: 'm' }]) {
  const requests: Array<{ request: StructuredRequest; target: LocalModelTarget }> = [];
  const calls: string[] = [];
  const port: LocalModelPort = {
    async probe() {
      calls.push('probe');
      return { ok: true, models: models.map((model) => model.id) };
    },
    async listModels() {
      calls.push('listModels');
      return { ok: true, models };
    },
    async structuredComplete(target, request) {
      calls.push('structuredComplete');
      requests.push({ request, target });
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
      return typeof reply === 'function' ? reply(request, target) : reply;
    },
  };
  return { port, requests, calls };
}

const endpoints = (behaviour: 'ok' | 'unconfirmed' | 'missing' | 'none' | 'broken' = 'ok'): Pick<LocalEndpoints, 'target'> => ({
  async target() {
    if (behaviour === 'unconfirmed') throw new EndpointConfirmationRequiredError('far.example.com:8000');
    if (behaviour === 'missing') throw new NotFoundError('endpoint', 'x');
    if (behaviour === 'broken') throw new Error('keychain exploded with sk-secret');
    if (behaviour === 'none') return undefined;
    return { endpointId: ENDPOINT, baseUrl: 'http://localhost:1234/v1', key: KEY };
  },
});

const manager = (port: LocalModelPort, behaviour: Parameters<typeof endpoints>[0] = 'ok', extra: Partial<Parameters<typeof createModelManager>[0]> = {}) => createModelManager({ port, endpoints: endpoints(behaviour), endpointId: ENDPOINT, model: 'm', ...extra });

describe('a good answer', () => {
  it('is accepted with a record of the masked answer, asked in one request with the shared schema, no tools and no key in the prompt', async () => {
    const { port, requests, calls } = scripted([ok(PLAN)]);
    const result = await manager(port).proposePlan(context());
    expect(result).toMatchObject({ ok: true, value: PLAN, record: { call: 'plan', outcome: 'accepted', asked: 'json_schema', repaired: false } });
    expect(calls).toEqual(['structuredComplete']);
    const { request, target } = requests[0]!;
    expect(request).toMatchObject({ model: 'm', schemaName: 'manager_plan', maxTokens: 2_048 });
    expect(request.prompt).toContain('Add a contact form to the site');
    expect(`${request.system}${request.prompt}`).not.toContain(KEY);
    // The key goes only in the call's target, where the adapter sends it as a header.
    expect(target.key).toBe(KEY);
    expect(result.ok && JSON.parse(result.record!.output!)).toEqual(PLAN);
  });

  it('decides the next step, validated against the plan', async () => {
    const { port, requests } = scripted([ok(DISPATCH)]);
    const result = await manager(port).decideNext(decideContext());
    expect(result).toMatchObject({ ok: true, value: { action: 'dispatch', step_id: 's1' }, record: { call: 'decision', outcome: 'accepted' } });
    expect(requests[0]!.request.schemaName).toBe('manager_decision');
    expect(requests[0]!.request.prompt).toContain('The plan so far:');
  });

  it('masks a secret in what it records, and refuses an answer that holds one', async () => {
    const withKey = { ...PLAN, steps: [{ ...PLAN.steps[0]!, instruction: 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 to log in.' }] };
    const { port } = scripted([ok(withKey)]);
    const result = await manager(port).proposePlan(context());
    expect(result).toMatchObject({ ok: false, kind: 'malformed', code: 'forbidden_field' });
    expect(JSON.stringify(result)).not.toContain('sk-ant');
  });
});

describe('the one repair', () => {
  it('asks once more, naming only the rule that failed and none of the model\'s own text, then accepts', async () => {
    const offRoster = { ...PLAN, steps: [{ ...PLAN.steps[0]!, worker: 'gamma' }] };
    const { port, requests } = scripted([ok(offRoster), ok(PLAN, 'prompt')]);
    const result = await manager(port).proposePlan(context());
    expect(result).toMatchObject({ ok: true, record: { outcome: 'accepted', repaired: true, asked: 'prompt' } });
    expect(requests).toHaveLength(2);
    const second = requests[1]!.request.prompt;
    expect(second).toContain(`Your last answer was not accepted. ${MANAGER_REFUSAL_REASONS.off_roster_worker}`);
    expect(second.startsWith(requests[0]!.request.prompt)).toBe(true);
    expect(second.slice(requests[0]!.request.prompt.length)).not.toContain('gamma');
  });

  it('refuses after the repair when the rule is still broken, with the rule in the record and nothing dispatched', async () => {
    const offRoster = { ...PLAN, steps: [{ ...PLAN.steps[0]!, worker: 'gamma' }] };
    const { port, requests } = scripted([ok(offRoster)]);
    const result = await manager(port).proposePlan(context());
    expect(result).toMatchObject({ ok: false, kind: 'off_roster', code: 'off_roster_worker', reason: MANAGER_REFUSAL_REASONS.off_roster_worker, record: { outcome: 'refused', repaired: true, failure: 'off_roster', code: 'off_roster_worker' } });
    expect(requests).toHaveLength(2);
    expect(result.ok ? '' : JSON.parse(result.record!.output!).steps[0].worker).toBe('gamma');
  });

  it('never repairs after structuredComplete failed: it has already repaired once, and a second ask would double it', async () => {
    for (const detail of ['not_json', 'off_shape']) {
      const { port, requests } = scripted([failed('bad_answer', detail)]);
      const result = await manager(port).proposePlan(context());
      expect(result).toMatchObject({ ok: false, kind: 'malformed' });
      expect(requests, detail).toHaveLength(1);
    }
    expect(await manager(scripted([failed('bad_answer', 'not_json')]).port).proposePlan(context())).toMatchObject({ code: 'not_json' });
  });

  it('is not repaired a second time, and a decision naming a step the plan lacks is repaired once and then refused', async () => {
    const { port, requests } = scripted([ok({ ...DISPATCH, step_id: 's9' })]);
    const result = await manager(port).decideNext(decideContext());
    expect(result).toMatchObject({ ok: false, kind: 'malformed', code: 'unknown_step' });
    expect(requests).toHaveLength(2);
  });

  it('reports a failure of the repair itself as that failure', async () => {
    const offRoster = { ...PLAN, steps: [{ ...PLAN.steps[0]!, worker: 'gamma' }] };
    const result = await manager(scripted([ok(offRoster), failed('timeout')]).port).proposePlan(context());
    expect(result).toMatchObject({ ok: false, kind: 'too_slow', record: { repaired: true, failure: 'too_slow' } });
  });
});

describe('the endpoint rules', () => {
  it('refuses a host nobody confirmed before anything is called', async () => {
    const { port, calls } = scripted([ok(PLAN)]);
    const result = await manager(port, 'unconfirmed').proposePlan(context());
    expect(result).toMatchObject({ ok: false, kind: 'host_not_confirmed', reason: MANAGER_FAILURE_WORDS.host_not_confirmed });
    expect(calls).toEqual([]);
  });

  it('through the real endpoints a non-loopback endpoint with no confirmation is refused, and works once confirmed', async () => {
    const core = openTestCore(tempDir());
    const values = new Map<string, string>();
    const secrets = { values, backend: 'memory' as const, get: async (name: string) => values.get(name), set: async (name: string, value: string) => void values.set(name, value), delete: async (name: string) => void values.delete(name) };
    const real = core.localEndpoints(secrets);
    const added = await real.add({ label: 'Far away', baseUrl: 'https://far.example.com:8000/v1', confirmHost: 'https://far.example.com:8000' });
    // Changing the address drops the confirmation, which is exactly the state to refuse.
    const moved = await real.update(added.id, { baseUrl: 'https://other.example.com:8000/v1' });
    expect(moved.needsConfirmation).toBe(true);
    const { port, calls } = scripted([ok(PLAN)]);
    const unconfirmed = createModelManager({ port, endpoints: real, endpointId: moved.id, model: 'm' });
    expect(await unconfirmed.proposePlan(context())).toMatchObject({ ok: false, kind: 'host_not_confirmed' });
    expect(calls).toEqual([]);
    real.confirm(moved.id, { host: 'https://other.example.com:8000' });
    expect(await unconfirmed.proposePlan(context())).toMatchObject({ ok: true });
    expect(calls).toEqual(['structuredComplete']);
    // An endpoint that was removed is missing, again with nothing called.
    await real.remove(moved.id);
    expect(await unconfirmed.proposePlan(context())).toMatchObject({ ok: false, kind: 'endpoint_missing' });
    expect(calls).toEqual(['structuredComplete']);
  });

  it('says the endpoint is missing when it is gone or none is set up, and unavailable when the lookup itself breaks, never with the error text', async () => {
    for (const behaviour of ['missing', 'none'] as const) expect(await manager(scripted([ok(PLAN)]).port, behaviour).proposePlan(context())).toMatchObject({ ok: false, kind: 'endpoint_missing', reason: MANAGER_FAILURE_WORDS.endpoint_missing });
    const broken = await manager(scripted([ok(PLAN)]).port, 'broken').proposePlan(context());
    expect(broken).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(JSON.stringify(broken)).not.toContain('sk-secret');
  });
});

describe('the cap on the input', () => {
  it('is half of the context the server reports for the model, and a smaller conversation than the default when it reports none', async () => {
    const readers = scripted([ok(PLAN)], [{ id: 'm', contextTokens: 8_192 }]);
    const small = await manager(readers.port, 'ok', { contextOf: createContextReader(readers.port) }).proposePlan(context({ lastReport: { version: 'ogden.manager.status.v1', step_id: 's1', worker: 'alpha', state: 'idle', summary: 'x'.repeat(4_000), truncated: false } }));
    expect(small.ok).toBe(true);
    const { request } = readers.requests[0]!;
    expect(request.system!.length + request.prompt.length + JSON.stringify(request.schema).length).toBeLessThanOrEqual(4_096 * 3);
    // 8192 tokens: half is 4096, so the answer may use up to the other half.
    expect(request.maxTokens).toBe(4_096);
  });

  it('refuses as context too small, without calling the model, when even the least input does not fit', async () => {
    const readers = scripted([ok(PLAN)], [{ id: 'm', contextTokens: 512 }]);
    const result = await manager(readers.port, 'ok', { contextOf: createContextReader(readers.port) }).proposePlan(context());
    expect(result).toMatchObject({ ok: false, kind: 'context_too_small', reason: MANAGER_FAILURE_WORDS.context_too_small });
    expect(readers.calls).toEqual(['listModels']);
  });

  it('tells a server that says the context was full as context too small', async () => {
    expect(await manager(scripted([failed('context_full')]).port).proposePlan(context())).toMatchObject({ ok: false, kind: 'context_too_small' });
  });

  it('reads the reported context once per endpoint and model for a while, and reads none when the server cannot say', async () => {
    const { port, calls } = scripted([ok(PLAN)], [{ id: 'm', contextTokens: 32_768 }]);
    let at = 0;
    const reader = createContextReader(port, 1_000, () => at);
    expect(await reader({ baseUrl: 'http://a/v1' }, 'm')).toBe(16_384);
    expect(await reader({ baseUrl: 'http://a/v1' }, 'm')).toBe(16_384);
    reader.forget?.({ baseUrl: 'http://a/v1' }, 'm');
    expect(await reader({ baseUrl: 'http://a/v1' }, 'm')).toBe(16_384);
    expect(await reader({ baseUrl: 'http://a/v1' }, 'other')).toBeUndefined();
    at = 2_000;
    await reader({ baseUrl: 'http://a/v1' }, 'm');
    expect(calls.filter((call) => call === 'listModels')).toHaveLength(4);
    const down: Pick<LocalModelPort, 'listModels'> = { listModels: async () => ({ ok: false, kind: 'unreachable', reason: 'down' }) };
    expect(await createContextReader(down)({ baseUrl: 'http://a/v1' }, 'm')).toBeUndefined();
    const throwing: Pick<LocalModelPort, 'listModels'> = { listModels: async () => { throw new Error('boom'); } };
    expect(await createContextReader(throwing)({ baseUrl: 'http://a/v1' }, 'm')).toBeUndefined();
  });
});

describe('every failure kind is told in plain words', () => {
  const cases: Array<[string, StructuredResult, string]> = [
    ['a hang', failed('timeout'), 'too_slow'],
    ['a huge reply', failed('too_large'), 'too_large'],
    ['a full context', failed('context_full'), 'context_too_small'],
    ['no JSON', failed('bad_answer', 'not_json'), 'malformed'],
    ['the wrong shape', failed('bad_answer', 'off_shape'), 'malformed'],
    ['a refused key', failed('key_refused'), 'unavailable'],
    ['a missing model', failed('model_not_found'), 'unavailable'],
    ['a server that is down', failed('unreachable'), 'unavailable'],
    ['a server that is not compatible', failed('not_openai'), 'unavailable'],
    ['an HTTP error', failed('http'), 'unavailable'],
  ];
  for (const [about, reply, kind] of cases) {
    it(`${about} is ${kind}, with words of our own: no address, no key, no dash`, async () => {
      const result = await manager(scripted([reply]).port).proposePlan(context());
      expect(result).toMatchObject({ ok: false, kind });
      if (result.ok) return;
      expect(result.reason).toMatch(/^[A-Z].*\.$/);
      expect(result.reason).not.toMatch(NO_DASH);
      expect(result.reason).not.toMatch(/secret-host|1234|raw /);
      expect(result.record).toMatchObject({ outcome: 'refused', failure: kind });
    });
  }

  it('has words for every kind', () => {
    for (const kind of MANAGER_FAILURE_KINDS) {
      expect(MANAGER_FAILURE_WORDS[kind]).toMatch(/^[A-Z].*\.$/);
      expect(MANAGER_FAILURE_WORDS[kind]).not.toMatch(NO_DASH);
    }
  });

  it('is unavailable, and never throws, when the port throws or the call was aborted first', async () => {
    const throwing: LocalModelPort = { probe: async () => ({ ok: true, models: [] }), listModels: async () => ({ ok: true, models: [] }), structuredComplete: async () => { throw new Error('socket exploded'); } };
    expect(await manager(throwing).proposePlan(context())).toMatchObject({ ok: false, kind: 'unavailable' });
    const { port, calls } = scripted([ok(PLAN)]);
    expect(await manager(port).proposePlan(context(), AbortSignal.abort())).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(calls).toEqual([]);
  });

  it('spends one deadline over the call and its repair', async () => {
    const offRoster = { ...PLAN, steps: [{ ...PLAN.steps[0]!, worker: 'gamma' }] };
    const timeouts: number[] = [];
    const { port } = scripted([(request) => { timeouts.push(request.timeoutMs ?? 0); return ok(offRoster); }]);
    await manager(port, 'ok', { timeoutMs: 5_000 }).proposePlan(context());
    expect(timeouts).toHaveLength(2);
    expect(timeouts[0]).toBeLessThanOrEqual(5_000);
    expect(timeouts[1]).toBeLessThanOrEqual(timeouts[0]!);
  });
});
