/**
 * `manager-memory` (epic 15 story 15.2): a deterministic in-memory
 * `ManagerPort`, the stub the tracer (15.3) and core's tests use in place of a
 * model. It calls nothing and holds no key. It plays scripted replies (any
 * JSON, good or adversarial) through the same check a real manager's answer
 * passes ({@link validatePlanFor}, {@link validateDecisionFor}), so a scripted
 * off roster or malformed reply is a failure and never a value; with no script
 * it plans one step per ready worker, in order, and dispatches them in turn.
 */
import {
  validateDecisionFor,
  validatePlanFor,
  type ManagerContext,
  type ManagerDecisionContext,
  type ManagerFailure,
  type ManagerFailureKind,
  type ManagerPort,
  type ManagerResult,
} from '@ogden-agents/core';
import { MANAGER_DECISION_VERSION, MANAGER_PLAN_VERSION, type ManagerDecision, type ManagerPlan } from '@ogden-agents/shared';

export interface MemoryManagerScript {
  /** What `proposePlan` answers, one reply per call; the last repeats. Unscripted: a plan of one step per ready worker. */
  plans?: readonly unknown[] | undefined;
  /** What `decideNext` answers, one reply per call; the last repeats. Unscripted: dispatch the next step of the plan, then done. */
  decisions?: readonly unknown[] | undefined;
  /** Every call fails with this kind. */
  failWith?: ManagerFailureKind | undefined;
}

const WORDS: Readonly<Record<ManagerFailureKind, string>> = {
  malformed: 'The manager did not answer in the shape Ogden needs.',
  off_roster: 'The manager named an agent that is not on this team.',
  too_large: 'The manager sent back far more than a plan needs.',
  too_slow: 'The manager took too long to answer.',
  context_too_small: "The manager's model cannot hold what it needs to read.",
  host_not_confirmed: 'You have not confirmed this manager yet.',
  unavailable: 'The manager is not available right now.',
};

const failure = (kind: ManagerFailureKind): ManagerFailure => ({ ok: false, kind, reason: WORDS[kind] });

export type MemoryManager = ManagerPort & {
  /** Every call it got: the method and the goal, nothing else. */
  readonly calls: ReadonlyArray<{ method: 'proposePlan' | 'decideNext'; goal: string }>;
};

export function createMemoryManager(script: MemoryManagerScript = {}): MemoryManager {
  const calls: Array<{ method: 'proposePlan' | 'decideNext'; goal: string }> = [];
  let plans = 0;
  let decisions = 0;
  const next = (replies: readonly unknown[], index: number): unknown => replies[Math.min(index, replies.length - 1)];

  const defaultPlan = (context: ManagerContext): ManagerPlan | undefined => {
    const ready = context.workers.filter((worker) => worker.ready);
    if (ready.length === 0) return undefined;
    return {
      version: MANAGER_PLAN_VERSION,
      goal: context.goal,
      steps: ready.map((worker, index) => ({
        id: `s${index + 1}`,
        worker: worker.agentId,
        chat: 'new' as const,
        instruction: `Work on the goal as ${worker.label}.`,
        mode: 'ask' as const,
        depends_on: index === 0 ? [] : [`s${index}`],
      })),
    };
  };

  const defaultDecision = (context: ManagerDecisionContext): ManagerDecision => {
    const ids = context.plan.steps.map((step) => step.id);
    const after = context.lastReport === undefined ? -1 : ids.indexOf(context.lastReport.step_id);
    const nextId = ids[after + 1];
    return nextId === undefined
      ? { version: MANAGER_DECISION_VERSION, action: 'done', reason: 'Every step has been done.' }
      : { version: MANAGER_DECISION_VERSION, action: 'dispatch', reason: 'It is the next step.', step_id: nextId };
  };

  return {
    calls,
    async proposePlan(context, signal): Promise<ManagerResult<ManagerPlan>> {
      calls.push({ method: 'proposePlan', goal: context.goal });
      if (script.failWith !== undefined) return failure(script.failWith);
      if (signal?.aborted === true) return failure('unavailable');
      const reply = script.plans === undefined || script.plans.length === 0 ? defaultPlan(context) : next(script.plans, plans);
      plans += 1;
      if (reply === undefined) return { ok: false, kind: 'off_roster', code: 'off_roster_worker', reason: WORDS.off_roster };
      return validatePlanFor(context, reply);
    },
    async decideNext(context, signal): Promise<ManagerResult<ManagerDecision>> {
      calls.push({ method: 'decideNext', goal: context.goal });
      if (script.failWith !== undefined) return failure(script.failWith);
      if (signal?.aborted === true) return failure('unavailable');
      const reply = script.decisions === undefined || script.decisions.length === 0 ? defaultDecision(context) : next(script.decisions, decisions);
      decisions += 1;
      return validateDecisionFor(context, reply);
    },
  };
}
