/**
 * The routing rules' contracts (epic 15, story 15.12): `rule` on a plan step (plan.v1 extended compatibly, on a worker step and on a build
 * step), the rule that it must name an existing rule, the rules' caps and shapes, the step's `rule` view, the route, the event and every
 * sentence without a dash.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  MANAGER_PLAN_JSON_SCHEMA,
  MANAGER_PLAN_VERSION,
  MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA,
  MANAGER_REFUSAL_CODES,
  MANAGER_REFUSAL_REASONS,
  ORCHESTRATION_ROUTING_WORDS,
  OrchestrationRoutingResponse,
  OrchestrationStep,
  ROUTING_LIMITS,
  RoutingRule,
  RoutingRuleId,
  RoutingRules,
  SetOrchestrationRoutingRequest,
  checkManagerPlan,
} from '../src/index.js';
import { OrchestrationRoutingChangedInput } from '../src/events-orchestration.js';

const NO_DASH = /—|–| - /;

const step = (id: string, extra: Record<string, unknown> = {}) => ({ id, worker: 'codex', chat: 'new', instruction: `Do ${id}.`, mode: 'ask', depends_on: [] as string[], ...extra });
const build = (id: string, extra: Record<string, unknown> = {}) => ({ id, build: { ticket: '1.1' }, reason: 'Ready to build.', depends_on: [] as string[], ...extra });
const plan = (...steps: unknown[]) => ({ version: MANAGER_PLAN_VERSION, goal: 'Ship it', steps });
const context = { roster: ['codex'], rules: ['r1', 'r2'], buildable: ['1.1'] };
const codeOf = (value: unknown, ctx: Parameters<typeof checkManagerPlan>[1] = context) => {
  const checked = checkManagerPlan(value, ctx);
  return checked.ok ? 'ok' : checked.code;
};

describe('rule on a plan step', () => {
  it('is optional, so a plan from before is still valid, and is in the JSON schema the server is asked with', () => {
    expect(codeOf(plan(step('s1')))).toBe('ok');
    for (const schema of [MANAGER_PLAN_JSON_SCHEMA, MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA]) {
      const items = (schema as { properties: { steps: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.steps.items;
      expect(Object.keys(items.properties)).toContain('rule');
      expect(items.required).not.toContain('rule');
    }
  });

  it('accepts a rule that exists, on a worker step and on a build step', () => {
    expect(codeOf(plan(step('s1', { rule: 'r1' }), build('b1', { rule: 'r2' })))).toBe('ok');
    const checked = checkManagerPlan(plan(step('s1', { rule: 'r2' })), context);
    expect(checked.ok && (checked.value.steps[0] as { rule?: string }).rule).toBe('r2');
  });

  it('refuses a rule that does not exist, and any rule when there are none', () => {
    expect(codeOf(plan(step('s1', { rule: 'r3' })))).toBe('unknown_rule');
    expect(codeOf(plan(step('s1'), build('b1', { rule: 'r9' })))).toBe('unknown_rule');
    expect(codeOf(plan(step('s1', { rule: 'r1' })), { roster: ['codex'] })).toBe('unknown_rule');
    expect(codeOf(plan(step('s1', { rule: 'r1' })), { roster: ['codex'], rules: [] })).toBe('unknown_rule');
  });

  it('refuses a rule that is not an id as a bad reference, never as an unknown field', () => {
    for (const rule of ['', 'r', 'R1', 'rule 1', 'r0', 'r12345', 7, null, ['r1'], { id: 'r1' }, 'r1; run it']) expect(codeOf(plan(step('s1', { rule })))).toBe('bad_reference');
  });

  it('never lets a rule widen the roster: a rule on a step naming a worker that is off the roster is refused as before', () => {
    expect(codeOf(plan(step('s1', { worker: 'grok', rule: 'r1' })))).toBe('off_roster_worker');
    expect(codeOf(plan(step('s1', { worker: 'grok' })))).toBe('off_roster_worker');
  });

  it('keeps every other rule: a mode above Ask and an extra field are still refused beside a rule', () => {
    expect(codeOf(plan(step('s1', { rule: 'r1', mode: 'auto' })))).toBe('mode_above_ask');
    expect(codeOf(plan(step('s1', { rule: 'r1', skip_all: true })))).toBe('forbidden_field');
    expect(codeOf(plan(build('b1', { rule: 'r1', agent: 'codex' })))).toBe('build_field_forbidden');
  });
});

describe('the rules', () => {
  it('caps the count and the length, takes one clean line, and the id is `r` and a number', () => {
    expect(ROUTING_LIMITS).toEqual({ maxRules: 10, maxRuleChars: 300 });
    expect(RoutingRule.safeParse({ id: 'r1', text: 'Tests go to Claude Code' }).success).toBe(true);
    expect(RoutingRule.safeParse({ id: 'r1', text: 'x'.repeat(300) }).success).toBe(true);
    expect(RoutingRule.safeParse({ id: 'r1', text: 'x'.repeat(301) }).success).toBe(false);
    expect(RoutingRule.safeParse({ id: 'r1', text: '' }).success).toBe(false);
    expect(RoutingRule.safeParse({ id: 'r1', text: 'two\nlines' }).success).toBe(false);
    expect(RoutingRule.safeParse({ id: 'r1', text: 'hidden‮character' }).success).toBe(false);
    expect(RoutingRules.safeParse(Array.from({ length: 10 }, (_, index) => ({ id: `r${index + 1}`, text: 'a' }))).success).toBe(true);
    expect(RoutingRules.safeParse(Array.from({ length: 11 }, (_, index) => ({ id: `r${index + 1}`, text: 'a' }))).success).toBe(false);
    expect(['r1', 'r10', 'r9999'].every((id) => RoutingRuleId.safeParse(id).success)).toBe(true);
    expect(['r0', 'r', 'x1', 'r10000', 'r1 '].some((id) => RoutingRuleId.safeParse(id).success)).toBe(false);
  });

  it('is saved with a list of texts, each with an optional id, and answered with the rules and the caps', () => {
    expect(SetOrchestrationRoutingRequest.safeParse({ rules: [{ text: 'a' }, { id: 'r1', text: 'b' }] }).success).toBe(true);
    expect(SetOrchestrationRoutingRequest.safeParse({ rules: [{ id: 'r1' }] }).success).toBe(false);
    expect(OrchestrationRoutingResponse.parse({ rules: [{ id: 'r1', text: 'a' }], maxRules: 10, maxRuleChars: 300 }).rules).toHaveLength(1);
    expect(API_ROUTES.workspaceOrchestrationRouting).toBe('/api/v1/workspaces/:wsId/orchestration/routing');
  });

  it('shows on a step as its id and words, none by default, so a step stored before still reads', () => {
    const base = { runId: 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', stepId: 's1', position: 0, worker: 'codex', chat: 'new', instruction: 'Do it.', dependsOn: [], state: 'proposed', approvedBy: null, sessionId: null };
    expect(OrchestrationStep.parse(base).rule).toBeNull();
    expect(OrchestrationStep.parse({ ...base, rule: { id: 'r1', text: 'Tests go to Codex' } }).rule).toEqual({ id: 'r1', text: 'Tests go to Codex' });
    expect(OrchestrationStep.safeParse({ ...base, rule: { id: 'r1', text: '' } }).success).toBe(false);
  });

  it('is recorded by ids only', () => {
    const event = { type: 'orchestration.routing_changed', workspaceId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', streamId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', payload: { ruleIds: ['r1'], previousRuleIds: [] } };
    expect(OrchestrationRoutingChangedInput.safeParse(event).success).toBe(true);
    expect(OrchestrationRoutingChangedInput.safeParse({ ...event, payload: { ...event.payload, text: 'private' } }).success).toBe(true);
    expect(OrchestrationRoutingChangedInput.parse({ ...event, payload: { ...event.payload, text: 'private' } }).payload).not.toHaveProperty('text');
  });
});

describe('the words', () => {
  it('have a plain refusal for the unknown rule and no dash anywhere', () => {
    expect(MANAGER_REFUSAL_CODES).toContain('unknown_rule');
    expect(MANAGER_REFUSAL_REASONS.unknown_rule).toBe('The manager said a step followed a routing rule that does not exist.');
    for (const words of [...Object.values(ORCHESTRATION_ROUTING_WORDS), MANAGER_REFUSAL_REASONS.unknown_rule]) expect(words).not.toMatch(NO_DASH);
  });

  it('promise only suggestions: the intro says a rule gives a worker nothing the team, its terms or the mode do not allow', () => {
    expect(ORCHESTRATION_ROUTING_WORDS.intro).toMatch(/suggestions only/);
    expect(ORCHESTRATION_ROUTING_WORDS.intro).toMatch(/you still approve every step/);
  });
});
