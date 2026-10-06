/**
 * Builds the manager proposes (epic 15, story 15.11): a build step in `plan.v1` (an optional kind, so every plan from before is still
 * valid) that carries only a ticket and a short reason, the schema that refuses any field naming how to build, the check against the
 * board's tickets that are ready, the build summary the manager reads, and the step's build as stored and shown. Every sentence has no dash.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILD_STEP_LIMITS,
  LinkOrchestrationBuildRequest,
  MANAGER_PLAN_JSON_SCHEMA,
  MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA,
  MANAGER_PLAN_VERSION,
  MANAGER_REFUSAL_CODES,
  MANAGER_REFUSAL_REASONS,
  ManagerBuildStep,
  ManagerPlan,
  ORCHESTRATION_BUILD_BUTTON,
  ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE,
  ORCHESTRATION_BUILD_STEP_NOTE,
  ORCHESTRATION_BUILD_STEP_WORDS,
  ORCHESTRATION_WAITING_BUILD_WORDS,
  OrchestrationStep,
  OrchestrationStepView,
  OrchestrationWaiting,
  buildSummaryText,
  checkManagerPlan,
  isManagerBuildStep,
  orchestrationBuildTitle,
} from '../src/index.js';

const NO_DASH = /—|–| - /;
const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const RUN = 'run_01J00000000000000000000000';

const work = (id: string, extra: Record<string, unknown> = {}) => ({ id, worker: 'codex', chat: 'new', instruction: `Do ${id}.`, mode: 'ask', depends_on: [] as string[], ...extra });
const build = (id: string, ticket = '1.1', extra: Record<string, unknown> = {}) => ({ id, build: { ticket }, reason: 'It is ready.', depends_on: [] as string[], ...extra });
const plan = (...steps: unknown[]) => ({ version: MANAGER_PLAN_VERSION, goal: 'Ship it', steps });
const context = { roster: ['codex', 'claude-code'], buildable: ['1.1', '1.2'] };
const codeOf = (value: unknown, ctx: Parameters<typeof checkManagerPlan>[1] = context) => {
  const checked = checkManagerPlan(value, ctx);
  return checked.ok ? 'ok' : checked.code;
};

describe('a build step in the plan', () => {
  it('is accepted with a ticket on the board that is ready, next to ordinary steps, and a plan without one is as valid as before', () => {
    expect(codeOf(plan(work('s1'), build('s2', '1.1', { depends_on: ['s1'] })))).toBe('ok');
    expect(codeOf(plan(work('s1')))).toBe('ok');
    const checked = checkManagerPlan(plan(build('b', '1.2')), context);
    expect(checked.ok && isManagerBuildStep(checked.value.steps[0]!)).toBe(true);
  });

  it('has no worker, chat, instruction or mode: the step is the id, the ticket, a short reason and what it waits on', () => {
    expect(Object.keys(ManagerBuildStep.shape).sort()).toEqual(['build', 'depends_on', 'id', 'reason', 'rule']);
    expect(Object.keys(ManagerBuildStep.shape.build.shape)).toEqual(['ticket']);
  });

  it.each([
    ['driver', { driver: 'claude-code' }],
    ['agent', { agent: 'claude-code' }],
    ['mode', { mode: 'unattended' }],
    ['sandbox', { sandbox: 'docker' }],
    ['flags', { flags: ['--dangerously-skip-permissions'] }],
    ['a worker', { worker: 'claude-code' }],
    ['a chat', { chat: 'new' }],
    ['an instruction', { instruction: 'Build it your way.' }],
    ['all', { all: true }],
  ])('refuses a build step that names %s', (_name, extra) => {
    expect(codeOf(plan(build('s1', '1.1', extra)))).toBe('build_field_forbidden');
  });

  it.each([
    ['driver', { driver: 'claude-code' }],
    ['agent', { agent: 'claude-code' }],
    ['mode', { mode: 'attended' }],
    ['sandbox', { sandbox: 'none' }],
    ['flags', { flag: 'x' }],
  ])('refuses %s inside the build object', (_name, extra) => {
    expect(codeOf(plan({ id: 's1', build: { ticket: '1.1', ...extra }, reason: 'Ready.', depends_on: [] }))).toBe('build_field_forbidden');
  });

  it('calls a secret looking field a forbidden field rather than a build one, and refuses a secret in the reason', () => {
    expect(codeOf(plan(build('s1', '1.1', { api_key: 'x' })))).toBe('forbidden_field');
    expect(codeOf(plan(build('s1', '1.1', { reason: `Use ${SECRET}` })))).toBe('forbidden_field');
  });

  it('refuses a ticket that is not ready to build now, and no ticket at all when none is given', () => {
    expect(codeOf(plan(build('s1', '9.9')))).toBe('build_ticket_unavailable');
    expect(codeOf(plan(build('s1', '1.1')), { roster: ['codex'] })).toBe('build_ticket_unavailable');
    expect(codeOf(plan(build('s1', '1.1')), { roster: ['codex'], buildable: [] })).toBe('build_ticket_unavailable');
  });

  it('refuses the same ticket twice and a ticket written as anything but a reference', () => {
    expect(codeOf(plan(build('s1', '1.1'), build('s2', '1.1')))).toBe('duplicate_build_ticket');
    expect(codeOf(plan(build('s1', '../etc/passwd')))).toBe('bad_reference');
    expect(codeOf(plan(build('s1', '1.1; rm -rf /')))).toBe('bad_reference');
    expect(codeOf(plan(build('s1', '')))).not.toBe('ok');
  });

  it('keeps the reason short and clean', () => {
    expect(codeOf(plan(build('s1', '1.1', { reason: 'x'.repeat(BUILD_STEP_LIMITS.maxReasonChars + 1) })))).toBe('bad_text');
    expect(codeOf(plan(build('s1', '1.1', { reason: 'x'.repeat(BUILD_STEP_LIMITS.maxReasonChars) })))).toBe('ok');
    expect(codeOf(plan(build('s1', '1.1', { reason: 'ok‮hidden' })))).toBe('bad_text');
    expect(codeOf(plan(build('s1', '1.1', { reason: 'two\nlines' })))).toBe('bad_text');
  });

  it('needs the same prerequisite rules as any step', () => {
    expect(codeOf(plan(build('s1', '1.1', { depends_on: ['nope'] })))).toBe('unknown_dependency');
    expect(codeOf(plan(build('s1', '1.1', { depends_on: ['s2'] }), work('s2', { depends_on: ['s1'] })))).toBe('cyclic_dependency');
    expect(codeOf(plan(build('s1'), build('s1', '1.2')))).toBe('duplicate_step_id');
  });

  it('refuses a worker step that carries a build key, because a build step has nothing else', () => {
    const mixed = plan(work('s1', { build: { ticket: '1.1' } }));
    expect(codeOf(mixed)).toBe('build_field_forbidden');
  });

  it('is in the JSON schema the server is asked with when a ticket is ready, with nothing that names how to build', () => {
    const items = (MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA as { properties: { steps: { items: { properties: Record<string, { properties?: Record<string, unknown> }>; required: string[]; additionalProperties: boolean } } } }).properties.steps.items;
    expect(Object.keys(items.properties).sort()).toEqual(['build', 'chat', 'depends_on', 'id', 'instruction', 'mode', 'reason', 'review_of', 'rule', 'worker']);
    expect(Object.keys(items.properties.build!.properties!)).toEqual(['ticket']);
    expect(items.required.sort()).toEqual(['depends_on', 'id']);
    expect(items.additionalProperties).toBe(false);
    expect(JSON.stringify(MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA)).not.toMatch(/driver|sandbox|flag/i);
  });

  it('is not in the JSON schema asked with when nothing is ready to build: that one is the worker step alone, as before', () => {
    const items = (MANAGER_PLAN_JSON_SCHEMA as { properties: { steps: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.steps.items;
    expect(Object.keys(items.properties).sort()).toEqual(['chat', 'depends_on', 'id', 'instruction', 'mode', 'review_of', 'rule', 'worker']);
    expect(items.required).toEqual(expect.arrayContaining(['id', 'worker', 'chat', 'instruction', 'mode', 'depends_on']));
    expect(JSON.stringify(MANAGER_PLAN_JSON_SCHEMA)).not.toMatch(/build|reason/i);
  });

  it('parses as a plan with both kinds of step and keeps an old plan unchanged', () => {
    expect(ManagerPlan.safeParse(plan(work('s1'), build('s2'))).success).toBe(true);
    expect(ManagerPlan.safeParse(plan(work('s1'))).success).toBe(true);
  });

  it('names its refusals in plain words with no dash', () => {
    for (const code of ['build_field_forbidden', 'build_ticket_unavailable', 'duplicate_build_ticket'] as const) {
      expect(MANAGER_REFUSAL_CODES).toContain(code);
      expect(MANAGER_REFUSAL_REASONS[code]).not.toMatch(NO_DASH);
    }
  });
});

describe('a review of a build step', () => {
  const reviewer = { roster: ['codex', 'claude-code'], reviewer: 'codex', buildable: ['1.1'] };
  const review = (extra: Record<string, unknown> = {}) => work('r', { review_of: 'b', depends_on: ['b'], ...extra });

  it('is accepted by the rostered reviewer when it is not the builder', () => {
    expect(codeOf(plan(build('b'), review()), reviewer)).toBe('ok');
  });

  it('is refused when the reviewer is Claude Code, the builder, and another agent is ready', () => {
    expect(codeOf(plan(build('b'), review({ worker: 'claude-code' })), { ...reviewer, reviewer: 'claude-code', builder: 'claude-code' })).toBe('reviewer_is_worker');
  });

  it('must wait for the build', () => {
    expect(codeOf(plan(build('b'), review({ depends_on: [] })), reviewer)).toBe('review_not_prerequisite');
  });
});

describe('the build as stored and shown', () => {
  const stored = { runId: 'orc_01J00000000000000000000000', stepId: 'b', position: 0, worker: 'claude-code', chat: 'new', instruction: 'It is ready.', dependsOn: [], state: 'proposed', approvedBy: null, sessionId: null };

  it('is absent from an ordinary step and from a step stored before', () => {
    expect(OrchestrationStep.parse(stored).build).toBeNull();
  });

  it('holds a ticket and, once started, the run', () => {
    expect(OrchestrationStep.parse({ ...stored, build: { ticketRef: '1.1', runId: null } }).build).toEqual({ ticketRef: '1.1', runId: null });
    expect(OrchestrationStep.parse({ ...stored, build: { ticketRef: '1.1', runId: RUN } }).build?.runId).toBe(RUN);
    expect(OrchestrationStep.safeParse({ ...stored, build: { ticketRef: '../x', runId: null } }).success).toBe(false);
  });

  it('shows the run as it stands, with the check counts and no diff', () => {
    const view = OrchestrationStepView.parse({
      ...stored,
      build: { ticketRef: '1.1', runId: RUN },
      workerLabel: 'Claude Code',
      sessionState: null,
      report: null,
      buildRun: { runId: RUN, outcome: 'verified', decision: null, checks: { passed: 3, failed: 0, notRun: 0 } },
    });
    expect(view.buildRun?.outcome).toBe('verified');
    expect(Object.keys(view.buildRun!)).toEqual(['runId', 'outcome', 'decision', 'checks']);
  });

  it('has a waiting kind for an automatic run at a build step', () => {
    expect(OrchestrationWaiting.parse({ kind: 'build', stepId: 'b', ticketRef: '1.1' }).kind).toBe('build');
  });

  it('is linked by the person with the run the dialog started and nothing else', () => {
    expect(LinkOrchestrationBuildRequest.safeParse({ runId: RUN }).success).toBe(true);
    expect(LinkOrchestrationBuildRequest.safeParse({ runId: RUN, agent: 'claude-code' }).success).toBe(false);
    expect(LinkOrchestrationBuildRequest.safeParse({ runId: 'nope' }).success).toBe(false);
    expect(LinkOrchestrationBuildRequest.safeParse({}).success).toBe(false);
  });
});

describe('the build summary the manager reads', () => {
  const base = { ticketRef: '1.1', decision: null, checks: { passed: 2, failed: 1, notRun: 0 }, reason: null } as const;

  it('says the outcome and the check counts, and that nothing is merged until the person approves', () => {
    const text = buildSummaryText({ ...base, outcome: 'verified', checks: { passed: 3, failed: 0, notRun: 0 } });
    expect(text).toContain('Build of ticket 1.1 ended built and verified');
    expect(text).toContain('3 passed, 0 failed, 0 not run');
    expect(text).toContain('nothing is merged until you approve it');
  });

  it('says why a build failed, masked, cleaned and cut, and has no dash', () => {
    const text = buildSummaryText({ ...base, outcome: 'failed', reason: `Tests failed.\n‮ ${SECRET} ${'x'.repeat(2000)}` });
    expect(text).toContain('failed');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('‮');
    expect(text.length).toBeLessThanOrEqual(BUILD_STEP_LIMITS.maxSummaryChars);
    expect(buildSummaryText({ ...base, outcome: 'stopped' })).not.toMatch(NO_DASH);
  });

  it('carries the person\'s decision once made, and no checks line when none ran', () => {
    expect(buildSummaryText({ ...base, outcome: 'verified', decision: 'approved' })).toContain('decision on the review page: approved');
    expect(buildSummaryText({ ...base, outcome: 'blocked', checks: null })).not.toContain('End checks');
  });
});

describe('the words', () => {
  it('have no dash', () => {
    for (const text of [ORCHESTRATION_BUILD_BUTTON, ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE, ORCHESTRATION_BUILD_STEP_NOTE, ORCHESTRATION_BUILD_STEP_WORDS, ORCHESTRATION_WAITING_BUILD_WORDS, orchestrationBuildTitle('1.1')]) {
      expect(text).not.toMatch(NO_DASH);
    }
    expect(ORCHESTRATION_WAITING_BUILD_WORDS).toContain('Waiting for you to start the build');
  });
});
