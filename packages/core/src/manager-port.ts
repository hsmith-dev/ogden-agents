/**
 * The port for the manager (epic 15, story 15.2): a tool-free model that
 * turns the goal and the state of the project into a plan, and then one
 * decision at a time. It has no shell, no files, no credentials and no way
 * to start a build or change a worker's mode; it returns schema-checked
 * JSON and nothing else (AD-1 note: a tool-free model client is not an agent
 * runtime). Story 15.4 builds the real adapter on `LocalModelPort`; this
 * story fixes the contract and a fake.
 *
 * Contract every implementation keeps:
 * - Methods never throw: a failure is a value with a kind and plain words.
 * - A value returned has passed {@link checkManagerPlan} or
 *   {@link checkManagerDecision} against the context given: every worker is a
 *   ready worker of `context.workers`, a decision's step is a step of the
 *   plan. An off roster or malformed reply is a failure, never a value.
 * - It reads only what the context holds. Worker text in the context is data
 *   (a capped, masked report), never instructions to the manager.
 * - It makes no change anywhere: dispatch is core's, after the user's approval.
 * - It does not name a model product.
 */
import {
  checkManagerDecision,
  checkManagerPlan,
  type ManagerDecision,
  type ManagerPlan,
  type ManagerRefusalCode,
  type ManagerStatusReport,
  type PermissionMode,
  type SessionState,
} from '@ogden-agents/shared';

/** A chat a worker already has, for the manager to continue. */
export interface ManagerWorkerChat {
  sessionId: string;
  state: SessionState;
}

/** One agent the manager may address, as core describes it to the manager. */
export interface ManagerWorker {
  agentId: string;
  /** The plain name the user knows it by. */
  label: string;
  /** Only a ready worker may be named in a plan. */
  ready: boolean;
  /** The permission modes the agent declares (the manager can still only ask for Ask). */
  modes: readonly PermissionMode[];
  chats: readonly ManagerWorkerChat[];
}

/** What core gives the manager each turn, already capped and masked (E15-R5). */
export interface ManagerContext {
  goal: string;
  /** A short summary of the project: its name and, when Board is on, its ticket titles and states. */
  projectSummary: string;
  workers: readonly ManagerWorker[];
  /** The last step's capped, masked report; absent before the first step. */
  lastReport?: ManagerStatusReport | undefined;
}

/** What the manager needs to decide the next step: the context and the plan it proposed. */
export interface ManagerDecisionContext extends ManagerContext {
  plan: ManagerPlan;
}

/** Why a manager call failed, in the kinds the user is told about. */
export const MANAGER_FAILURE_KINDS = ['malformed', 'off_roster', 'too_large', 'too_slow', 'context_too_small', 'host_not_confirmed', 'unavailable'] as const;
export type ManagerFailureKind = (typeof MANAGER_FAILURE_KINDS)[number];

export interface ManagerFailure {
  ok: false;
  kind: ManagerFailureKind;
  /** Plain words for the user. Never the model's text, a key or an address. */
  reason: string;
  /** The protocol rule behind a `malformed` or `off_roster` failure. */
  code?: ManagerRefusalCode | undefined;
}

export type ManagerResult<T> = { ok: true; value: T } | ManagerFailure;

export interface ManagerPort {
  /** A plan for the goal: validated, with every worker a ready worker. */
  proposePlan(context: ManagerContext, signal?: AbortSignal): Promise<ManagerResult<ManagerPlan>>;
  /** The next decision for a plan: validated, a dispatch naming a step of the plan. */
  decideNext(context: ManagerDecisionContext, signal?: AbortSignal): Promise<ManagerResult<ManagerDecision>>;
}

/** The kind of failure a refusal is told as. */
export function failureKindFor(code: ManagerRefusalCode): ManagerFailureKind {
  if (code === 'timeout') return 'too_slow';
  if (code === 'too_large') return 'too_large';
  if (code === 'off_roster_worker') return 'off_roster';
  return 'malformed';
}

/** The agent ids a plan may name: the context's ready workers. */
export const readyWorkerIds = (context: Pick<ManagerContext, 'workers'>): string[] => context.workers.filter((worker) => worker.ready).map((worker) => worker.agentId);

/** `value` as a plan for `context`, or the failure to return instead. The one check a manager's answer passes through. */
export function validatePlanFor(context: ManagerContext, value: unknown): ManagerResult<ManagerPlan> {
  const checked = checkManagerPlan(value, { roster: readyWorkerIds(context) });
  return checked.ok ? { ok: true, value: checked.value } : { ok: false, kind: failureKindFor(checked.code), code: checked.code, reason: checked.reason };
}

/** `value` as a decision for `context`'s plan, or the failure to return instead. */
export function validateDecisionFor(context: ManagerDecisionContext, value: unknown): ManagerResult<ManagerDecision> {
  const checked = checkManagerDecision(value, { planStepIds: context.plan.steps.map((step) => step.id) });
  return checked.ok ? { ok: true, value: checked.value } : { ok: false, kind: failureKindFor(checked.code), code: checked.code, reason: checked.reason };
}
