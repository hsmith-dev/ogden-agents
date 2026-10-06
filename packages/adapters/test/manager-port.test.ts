/**
 * `ManagerPort`'s contract (epic 15 story 15.2), run against the fake manager
 * (`manager-memory`). Story 15.4's real adapter runs the same contract. A
 * manager never throws; a value it returns has passed the protocol rules for
 * the context given (a ready worker, a step of the plan), and everything else
 * is a failure with a kind and plain words. The reliability table of story
 * 15.1 is played through it: each row's scripted reply gives the row's outcome.
 */
import type { ManagerContext, ManagerDecisionContext, ManagerPort } from '@ogden-agents/core';
import { MANAGER_DECISION_VERSION, MANAGER_PLAN_VERSION, MANAGER_REFUSAL_REASONS, type ManagerPlan } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { HARNESS_ROSTER, MANAGER_CASES } from '../../../tests/fixtures/manager-cases.js';
import { readJson } from '../../../tests/fixtures/manager-harness.js';
import { createMemoryManager, type MemoryManagerScript } from '../src/index.js';

const NO_DASH = /[–—]| - /;

const context = (overrides: Partial<ManagerContext> = {}): ManagerContext => ({
  goal: 'Add a contact form to the site',
  projectSummary: 'A small website.',
  workers: [
    ...HARNESS_ROSTER.map((agentId) => ({ agentId, label: `Agent ${agentId}`, ready: true, modes: ['ask' as const], chats: [] })),
    { agentId: 'not-ready-agent', label: 'Not ready', ready: false, modes: ['ask' as const], chats: [] },
  ],
  ...overrides,
});

const GOOD_PLAN: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form to the site',
  steps: [
    { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'codex', chat: 'new', instruction: 'Review the diff.', mode: 'ask', depends_on: ['s1'] },
  ],
};
const decideContext = (overrides: Partial<ManagerDecisionContext> = {}): ManagerDecisionContext => ({ ...context(), plan: GOOD_PLAN, ...overrides });

/** The contract every `ManagerPort` keeps, for a port made by `make(script)`. */
function managerContract(name: string, make: (script?: MemoryManagerScript) => ManagerPort) {
  describe(`ManagerPort contract: ${name}`, () => {
    it('proposes a plan whose every worker is a ready worker, and decides in turn, ending with done', async () => {
      const manager = make();
      const plan = await manager.proposePlan(context());
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.value.steps.map((step) => step.worker)).toEqual(HARNESS_ROSTER);
      expect(plan.value.steps.every((step) => step.mode === 'ask')).toBe(true);
      const first = await manager.decideNext({ ...context(), plan: plan.value });
      expect(first).toMatchObject({ ok: true, value: { action: 'dispatch', step_id: 's1' } });
      const report = { version: 'ogden.manager.status.v1' as const, step_id: 's3', worker: 'grok', state: 'done' as const, summary: 'ok', truncated: false };
      expect(await manager.decideNext({ ...context({ lastReport: report }), plan: plan.value })).toMatchObject({ ok: true, value: { action: 'done' } });
    });

    it('fails, never throws, when no worker is ready', async () => {
      const result = await make().proposePlan(context({ workers: [{ agentId: 'a-agent', label: 'A', ready: false, modes: ['ask'], chats: [] }] }));
      expect(result).toMatchObject({ ok: false, kind: 'off_roster' });
    });

    it('never returns a worker that is not ready, even when the model names it', async () => {
      const reply = { ...GOOD_PLAN, steps: [{ ...GOOD_PLAN.steps[0]!, worker: 'not-ready-agent' }] };
      expect(await make({ plans: [reply] }).proposePlan(context())).toMatchObject({ ok: false, kind: 'off_roster', code: 'off_roster_worker' });
    });

    it('refuses a decision naming a step the plan does not have', async () => {
      const reply = { version: MANAGER_DECISION_VERSION, action: 'dispatch', reason: 'Next.', step_id: 's9' };
      expect(await make({ decisions: [reply] }).decideNext(decideContext())).toMatchObject({ ok: false, kind: 'malformed', code: 'unknown_step' });
    });

    it('tells a failure in plain words with no dash, and an aborted call is a failure', async () => {
      for (const kind of ['malformed', 'off_roster', 'too_large', 'too_slow', 'context_too_small', 'host_not_confirmed', 'unavailable'] as const) {
        const failed = await make({ failWith: kind }).proposePlan(context());
        expect(failed).toMatchObject({ ok: false, kind });
        if (!failed.ok) {
          expect(failed.reason).toMatch(/^[A-Z].*\.$/);
          expect(failed.reason).not.toMatch(NO_DASH);
        }
      }
      expect(await make().proposePlan(context(), AbortSignal.abort())).toMatchObject({ ok: false, kind: 'unavailable' });
    });

    // The 15.1 table: each scripted reply that reaches the rules gets its row's outcome.
    for (const each of MANAGER_CASES.filter((candidate) => !candidate.script.hang && candidate.expected.code !== 'too_large' && candidate.expected.code !== 'not_json' && candidate.expected.outcome !== 'repaired')) {
      it(`plays the table row ${each.id}`, async () => {
        const json = readJson(each.script.replies[0]!)!.json;
        if (each.kind === 'plan') {
          const result = await make({ plans: [json] }).proposePlan(context());
          expect(result.ok).toBe(each.expected.outcome === 'accepted');
          if (!result.ok) {
            expect(result.code).toBe(each.expected.code);
            expect(result.reason).toBe(MANAGER_REFUSAL_REASONS[each.expected.code!]);
          }
        } else {
          const stepsOfTable = ['s1', 's2', 's3'];
          const plan: ManagerPlan = { ...GOOD_PLAN, steps: stepsOfTable.map((id) => ({ ...GOOD_PLAN.steps[0]!, id, depends_on: [] })) };
          const result = await make({ decisions: [json] }).decideNext(decideContext({ plan }));
          expect(result.ok).toBe(each.expected.outcome === 'accepted');
          if (!result.ok) expect(result.code).toBe(each.expected.code);
        }
      });
    }
  });
}

managerContract('manager-memory', (script) => createMemoryManager(script));

describe('manager-memory', () => {
  it('plays its scripted replies in turn and repeats the last, and records only the method and the goal', async () => {
    const other: ManagerPlan = { ...GOOD_PLAN, steps: [GOOD_PLAN.steps[0]!] };
    const manager = createMemoryManager({ plans: [GOOD_PLAN, other] });
    expect(await manager.proposePlan(context())).toMatchObject({ ok: true, value: { steps: expect.arrayContaining([expect.anything(), expect.anything()]) } });
    const second = await manager.proposePlan(context());
    expect(second.ok && second.value.steps).toHaveLength(1);
    const third = await manager.proposePlan(context());
    expect(third.ok && third.value.steps).toHaveLength(1);
    expect(manager.calls).toEqual([
      { method: 'proposePlan', goal: 'Add a contact form to the site' },
      { method: 'proposePlan', goal: 'Add a contact form to the site' },
      { method: 'proposePlan', goal: 'Add a contact form to the site' },
    ]);
  });
});
