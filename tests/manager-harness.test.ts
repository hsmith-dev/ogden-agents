/**
 * The manager reliability harness (epic 15 story 15.1): the table of scripted
 * manager replies, the fake manager that plays it, the rules each reply must
 * meet, and the report over a model. Everything runs on the in-memory fake or
 * the fake OpenAI-compatible server on loopback: no real model, no real network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenAiLocalModel, schemaProblems } from '../packages/adapters/src/index.js';
import { startFakeServer, type FakeServer } from './fixtures/fake-openai-server.mjs';
import {
  DECISION_SCHEMA,
  HARNESS_LIMITS,
  MANAGER_CASES,
  PLAN_SCHEMA,
  REFUSAL_CODES,
  REFUSAL_REASONS,
  caseById,
  checkManagerReply,
  markerFor,
} from './fixtures/manager-cases.js';
import { SAMPLE_GOALS, createFakeManager, formatReport, formatTable, matches, measureModel, readJson, runCaseTable } from './fixtures/manager-harness.js';

const TARGET = { baseUrl: 'http://fake.invalid/v1' };
const MODEL = 'fake-manager';
const NO_DASHES = /[–—]| - /;
const schemaCheck = (value: unknown, schema: Readonly<Record<string, unknown>>) => schemaProblems(value, schema);

const servers: FakeServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('the table', () => {
  it('has unique ids, every kind and group, and every required family of case', () => {
    const ids = MANAGER_CASES.map((each) => each.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(MANAGER_CASES.map((each) => each.kind))).toEqual(new Set(['plan', 'decision']));
    expect(new Set(MANAGER_CASES.map((each) => each.group))).toEqual(new Set(['good', 'wrapped', 'malformed', 'rules', 'adversarial', 'transport']));
    // Every kind of misbehaviour the ticket lists has a case.
    for (const wanted of [
      'plan-good', 'decision-dispatch', 'plan-fenced', 'plan-prose', 'plan-truncated', 'plan-wrong-version', 'plan-oversize-reply',
      'plan-unknown-field', 'plan-extra-step-field', 'plan-off-roster', 'plan-mode-auto', 'plan-mode-skip-all', 'plan-skip-all-field',
      'plan-credential-field', 'plan-build-request', 'plan-shell-request', 'plan-override-text', 'plan-duplicate-ids', 'plan-cyclic', 'plan-slow',
    ]) expect(ids).toContain(wanted);
  });

  it('gives every refusal a code with a plain reason, and no dashes anywhere a person might read', () => {
    for (const each of MANAGER_CASES) {
      expect(each.about).not.toMatch(NO_DASHES);
      if (each.expected.outcome === 'refused') expect(REFUSAL_CODES).toContain(each.expected.code);
      else expect(each.expected.code).toBeUndefined();
    }
    for (const code of REFUSAL_CODES) {
      expect(REFUSAL_REASONS[code]).toMatch(/^[A-Z].*\.$/);
      expect(REFUSAL_REASONS[code]).not.toMatch(NO_DASHES);
    }
  });

  it('has an oversize reply past the cap and an oversize instruction past its limit', () => {
    expect(caseById('plan-oversize-reply').script.replies[0]!.length).toBeGreaterThan(HARNESS_LIMITS.maxReplyBytes);
    const long = readJson(caseById('plan-instruction-too-long').script.replies[0]!)!.json as { steps: Array<{ instruction: string }> };
    expect(long.steps[0]!.instruction.length).toBeGreaterThan(HARNESS_LIMITS.maxInstructionChars);
  });
});

describe('the reference rules agree with the table', () => {
  for (const each of MANAGER_CASES.filter((candidate) => !candidate.script.hang)) {
    it(`${each.id}: ${each.expected.outcome}${each.expected.code === undefined ? '' : ` (${each.expected.code})`}`, () => {
      const last = each.script.replies[each.script.replies.length - 1]!;
      const parsed = last.length > HARNESS_LIMITS.maxReplyBytes ? undefined : readJson(last);
      if (each.expected.code === 'not_json' || each.expected.code === 'too_large') {
        expect(parsed).toBeUndefined();
        return;
      }
      expect(parsed).toBeDefined();
      const checked = checkManagerReply(each.kind, parsed!.json);
      if (each.expected.outcome === 'refused') {
        expect(checked).toMatchObject({ ok: false, code: each.expected.code });
        if (!checked.ok) expect(checked.reason).toBe(REFUSAL_REASONS[checked.code]);
      } else {
        expect(checked.ok).toBe(true);
      }
    });
  }

  it('keeps a step that tries to override the rules at mode Ask, with the text only as text', () => {
    const checked = checkManagerReply('plan', readJson(caseById('plan-override-text').script.replies[0]!)!.json);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(((checked.value as { steps: unknown }).steps as Array<{ mode: string }>).map((entry) => entry.mode)).toEqual(['ask']);
  });

  it('refuses a roster agent only when it is off the roster given', () => {
    const value = readJson(caseById('plan-good').script.replies[0]!)!.json;
    expect(checkManagerReply('plan', value, ['claude-code', 'codex', 'grok']).ok).toBe(true);
    expect(checkManagerReply('plan', value, ['claude-code'])).toMatchObject({ ok: false, code: 'off_roster_worker' });
  });

  it('refuses a value that is not an object', () => {
    expect(checkManagerReply('plan', [])).toMatchObject({ ok: false, code: 'missing_field' });
    expect(checkManagerReply('decision', 'done')).toMatchObject({ ok: false, code: 'missing_field' });
  });

  it('accepts the good samples under the schemas, and the schemas refuse what the rules would', () => {
    for (const each of MANAGER_CASES.filter((candidate) => candidate.group === 'good')) {
      const value = readJson(each.script.replies[0]!)!.json;
      expect(schemaProblems(value, each.kind === 'plan' ? PLAN_SCHEMA : DECISION_SCHEMA)).toEqual([]);
    }
    for (const id of ['plan-unknown-field', 'plan-mode-auto', 'plan-skip-all-field', 'plan-wrong-version', 'plan-missing-field', 'plan-too-many-steps', 'plan-instruction-too-long']) {
      expect(schemaProblems(readJson(caseById(id).script.replies[0]!)!.json, PLAN_SCHEMA).length).toBeGreaterThan(0);
    }
  });
});

describe('the fake manager', () => {
  it('plays each case on cue: the scripted reply for the case in the prompt, one reply per request', async () => {
    const fake = createFakeManager();
    for (const each of MANAGER_CASES.filter((candidate) => !candidate.script.hang && candidate.script.replies[0]!.length <= HARNESS_LIMITS.maxReplyBytes)) {
      const result = await fake.structuredComplete(TARGET, { model: MODEL, prompt: `${markerFor(each.id)} go`, schema: PLAN_SCHEMA });
      if (readJson(each.script.replies[0]!) !== undefined) expect(result).toMatchObject({ ok: true, value: readJson(each.script.replies[0]!)!.json });
    }
    expect(fake.attempts('plan-good')).toBe(1);
    expect(fake.attempts('plan-repairable')).toBe(2);
    expect(fake.attempts('plan-truncated')).toBe(4);
    expect(fake.requests.every((entry) => entry.n >= 1)).toBe(true);
  });

  it('answers a model it does not serve and a case it does not know in plain failures, and lists its one model', async () => {
    const fake = createFakeManager();
    expect(await fake.structuredComplete(TARGET, { model: 'other', prompt: 'x', schema: PLAN_SCHEMA })).toMatchObject({ ok: false, kind: 'model_not_found' });
    expect(await fake.structuredComplete(TARGET, { model: MODEL, prompt: `${markerFor('nope')}`, schema: PLAN_SCHEMA })).toMatchObject({ ok: false, kind: 'bad_answer' });
    expect(await fake.probe(TARGET)).toEqual({ ok: true, models: [MODEL] });
    expect(await fake.listModels(TARGET)).toEqual({ ok: true, models: [{ id: MODEL }] });
  });

  it('refuses a reply over the size cap and never returns a value', async () => {
    const fake = createFakeManager();
    expect(await fake.structuredComplete(TARGET, { model: MODEL, prompt: markerFor('plan-oversize-reply'), schema: PLAN_SCHEMA })).toMatchObject({ ok: false, kind: 'too_large' });
  });

  it('hangs until its timeout, and stops at once when aborted', async () => {
    const fake = createFakeManager();
    const started = Date.now();
    expect(await fake.structuredComplete(TARGET, { model: MODEL, prompt: markerFor('plan-slow'), schema: PLAN_SCHEMA, timeoutMs: 50 })).toMatchObject({ ok: false, kind: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    const controller = new AbortController();
    const pending = fake.structuredComplete(TARGET, { model: MODEL, prompt: markerFor('plan-slow'), schema: PLAN_SCHEMA, timeoutMs: 60_000, signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: 'timeout' });
    const aborted = await fake.structuredComplete(TARGET, { model: MODEL, prompt: markerFor('plan-slow'), schema: PLAN_SCHEMA, timeoutMs: 60_000, signal: AbortSignal.abort() });
    expect(aborted).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('treats a reply that fails the schema as a failed request when given a schema check, and tries again', async () => {
    const fake = createFakeManager({ schemaCheck });
    const result = await fake.structuredComplete(TARGET, { model: MODEL, prompt: markerFor('plan-unknown-field'), schema: PLAN_SCHEMA });
    expect(result).toMatchObject({ ok: false, kind: 'bad_answer', detail: 'off_shape' });
    expect(fake.attempts('plan-unknown-field')).toBe(4);
  });
});

describe('the table through each port', () => {
  it('the fake manager alone matches every row', async () => {
    const fake = createFakeManager();
    const run = await runCaseTable({ port: fake, target: TARGET, model: MODEL, countRequests: () => fake.requests.length, timeoutMs: 30 });
    expect(formatTable(run)).toBe(`Cases matching the table: ${MANAGER_CASES.length} of ${MANAGER_CASES.length}`);
    expect(run.mismatches).toEqual([]);
    expect(run.rows.find((row) => row.id === 'plan-repairable')!.observed).toMatchObject({ outcome: 'repaired', requests: 2 });
    expect(run.rows.find((row) => row.id === 'plan-override-text')!.observed).toEqual({ outcome: 'accepted', requests: 1 });
  });

  it('the fake manager with a schema check matches every row too', async () => {
    const fake = createFakeManager({ schemaCheck });
    const run = await runCaseTable({ port: fake, target: TARGET, model: MODEL, countRequests: () => fake.requests.length, timeoutMs: 30 });
    expect(run.mismatches).toEqual([]);
  });

  it('the real adapter against the fake server matches every row, with no tools and no real network', async () => {
    const server = await startFakeServer({ models: [MODEL], managerCases: Object.fromEntries(MANAGER_CASES.map((each) => [each.id, each.script])) });
    servers.push(server);
    const chats = () => server.log.filter((entry) => entry.path === '/v1/chat/completions');
    const run = await runCaseTable({ port: createOpenAiLocalModel(), target: { baseUrl: `${server.url}/v1` }, model: MODEL, countRequests: () => chats().length });
    expect(run.mismatches).toEqual([]);
    expect(run.total).toBe(MANAGER_CASES.length);
    expect(chats().every((entry) => (entry.tools ?? []).length === 0 && entry.stream === false)).toBe(true);
    expect(run.rows.find((row) => row.id === 'plan-repairable')!.observed.outcome).toBe('repaired');
    expect(run.rows.find((row) => row.id === 'plan-slow')!.observed).toMatchObject({ outcome: 'refused', code: 'timeout' });
  });

  it('a refusal for another reason is a mismatch, and a schema refusal never stands for a port code', () => {
    expect(matches({ outcome: 'refused', code: 'forbidden_field' }, { outcome: 'refused', requests: 1 })).toBe(false);
    expect(matches({ outcome: 'refused', code: 'timeout' }, { outcome: 'refused', requests: 1 })).toBe(false);
    expect(matches({ outcome: 'refused', code: 'forbidden_field' }, { outcome: 'refused', schemaRefused: true, requests: 4 })).toBe(true);
    expect(matches({ outcome: 'refused', code: 'not_json' }, { outcome: 'refused', schemaRefused: true, requests: 4 })).toBe(false);
  });

  it('a mismatch is reported in plain words', async () => {
    const wrong = MANAGER_CASES.map((each) => (each.id === 'plan-good' ? { ...each, expected: { outcome: 'refused' as const, code: 'empty_plan' as const } } : each));
    const fake = createFakeManager();
    const run = await runCaseTable({ port: fake, target: TARGET, model: MODEL, cases: wrong, countRequests: () => fake.requests.length, timeoutMs: 30 });
    expect(run.mismatches.map((row) => row.id)).toEqual(['plan-good']);
    expect(formatTable(run)).toContain('Different from the table: plan-good expected refused (empty_plan), got accepted');
  });
});

describe('the report over a model', () => {
  const goalCases = ['plan-good', 'plan-prose-only', 'plan-unknown-field'];
  const promptFor = (goal: string) => markerFor(goalCases[SAMPLE_GOALS.indexOf(goal)]!);
  let tick = 0;
  const now = () => (tick += 5);

  it('has three sample goals', () => {
    expect(SAMPLE_GOALS).toHaveLength(3);
  });

  it('tallies the valid-JSON rate, the usable plan rate and the latency over the fake', async () => {
    tick = 0;
    const report = await measureModel({ port: createFakeManager(), target: TARGET, model: MODEL, promptFor, now, timeoutMs: 100 });
    expect(report).toMatchObject({ model: MODEL, runs: 3, validJsonRuns: 2, conformingRuns: 1, meanLatencyMs: 5, maxLatencyMs: 5 });
    expect(report.validJsonRate).toBeCloseTo(2 / 3);
    expect(report.conformingRate).toBeCloseTo(1 / 3);
    const text = formatReport(report);
    expect(text).toContain('Answered in JSON: 2 of 3 (67%)');
    expect(text).toContain('Gave a usable plan: 1 of 3 (33%)');
    expect(text).toContain('Not usable:');
    expect(text).not.toMatch(NO_DASHES);
  });

  it('counts a schema failure from the real adapter as valid JSON that did not fit, and not JSON as neither', async () => {
    const server = await startFakeServer({ models: [MODEL], managerCases: Object.fromEntries(MANAGER_CASES.map((each) => [each.id, each.script])) });
    servers.push(server);
    const report = await measureModel({ port: createOpenAiLocalModel(), target: { baseUrl: `${server.url}/v1` }, model: MODEL, promptFor, timeoutMs: 2_000 });
    expect(report).toMatchObject({ runs: 3, validJsonRuns: 2, conformingRuns: 1 });
  });

  it('is all ones for a model that always answers well, and zeros with no runs', async () => {
    const good = await measureModel({ port: createFakeManager(), target: TARGET, model: MODEL, repeats: 2 });
    expect(good).toMatchObject({ runs: 6, validJsonRate: 1, conformingRate: 1 });
    const none = await measureModel({ port: createFakeManager(), target: TARGET, model: MODEL, goals: [] });
    expect(none).toMatchObject({ runs: 0, validJsonRate: 0, conformingRate: 0, meanLatencyMs: 0, maxLatencyMs: 0 });
  });

  it('counts a model that is down as not JSON', async () => {
    const report = await measureModel({ port: createFakeManager(), target: TARGET, model: 'missing' });
    expect(report).toMatchObject({ runs: 3, validJsonRuns: 0, conformingRuns: 0 });
  });
});

describe('the harness stays offline', () => {
  it('imports no network, process or file module and never calls fetch', () => {
    for (const file of ['manager-cases.ts', 'manager-harness.ts']) {
      const source = readFileSync(join(import.meta.dirname, 'fixtures', file), 'utf8');
      expect(source).not.toMatch(/from 'node:(http|https|net|tls|dgram|dns|child_process|fs|os)'|fetch\(|XMLHttpRequest|process\.env/);
    }
  });
});
