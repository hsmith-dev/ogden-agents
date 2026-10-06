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
  MANAGER_FAILURE_KINDS,
  checkManagerDecision,
  checkManagerPlan,
  type ManagerDecision,
  type ManagerFailureKind,
  type ManagerPlan,
  type ManagerRefusalCode,
  type ManagerStatusReport,
  type OrchestrationStepState,
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
  /**
   * The agent id of the project's reviewer when it is an agent that is ready (15.10). Only a plan step with `review_of` may go to it as a
   * review; absent means no review step is allowed.
   */
  reviewer?: string | undefined;
  /** The last step's capped, masked report; absent before the first step. */
  lastReport?: ManagerStatusReport | undefined;
}

/** What the manager needs to decide the next step: the context and the plan it proposed. */
export interface ManagerDecisionContext extends ManagerContext {
  plan: ManagerPlan;
  /**
   * Where each step of the plan stands (15.9). When given, a `dispatch` may name only a step still waiting (`proposed`) whose needed steps
   * are done, and the input says which steps those are. Absent: any step of the plan.
   */
  stepStates?: Readonly<Record<string, OrchestrationStepState>> | undefined;
  /** The user's answer to the manager's last question (15.9), masked: data for the manager, never instructions. */
  userAnswer?: string | undefined;
}

/** The steps a decision may send now: waiting, with every step they need done. */
export function dispatchableSteps(context: Pick<ManagerDecisionContext, 'plan' | 'stepStates'>): string[] | undefined {
  const states = context.stepStates;
  if (states === undefined) return undefined;
  return context.plan.steps.filter((step) => states[step.id] === 'proposed' && step.depends_on.every((id) => states[id] === 'done')).map((step) => step.id);
}

export { MANAGER_FAILURE_KINDS, type ManagerFailureKind };

/** What the user is told for each kind of failure. Plain words, no dashes; never the model's text, a key or an address. */
export const MANAGER_FAILURE_WORDS: Readonly<Record<ManagerFailureKind, string>> = {
  malformed: 'The manager did not answer in the shape Ogden needs.',
  off_roster: 'The manager named an agent that is not on this team.',
  too_large: 'The manager sent back far more than a plan needs.',
  too_slow: 'The manager took too long to answer.',
  context_too_small: "The manager's model cannot hold what it needs to read. Load it with a larger context in its server.",
  host_not_confirmed: 'You have not confirmed the server the manager runs on yet.',
  endpoint_missing: 'The server the manager runs on is not set up any more.',
  unavailable: 'The manager is not available right now.',
};

/**
 * What a call to the manager leaves for the event log (story 15.4): how it went and the manager's answer as masked,
 * capped JSON text. Core appends it as `orchestration.manager_replied`, because it knows the run. Never the prompt,
 * a key or an address.
 */
export interface ManagerRecord {
  call: 'plan' | 'decision';
  outcome: 'accepted' | 'refused';
  /** How the server was asked, from the strictest; `null` when it never answered. */
  asked: 'json_schema' | 'json_object' | 'prompt' | null;
  /** Whether Ogden asked again once, naming the rule that failed. */
  repaired: boolean;
  failure?: ManagerFailureKind | undefined;
  code?: ManagerRefusalCode | undefined;
  output?: string | undefined;
}

export interface ManagerFailure {
  ok: false;
  kind: ManagerFailureKind;
  /** Plain words for the user. Never the model's text, a key or an address. */
  reason: string;
  /** The protocol rule behind a `malformed` or `off_roster` failure. */
  code?: ManagerRefusalCode | undefined;
  /** For the event log; absent from a stub. */
  record?: ManagerRecord | undefined;
}

export type ManagerResult<T> = { ok: true; value: T; record?: ManagerRecord | undefined } | ManagerFailure;

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
  const checked = checkManagerPlan(value, { roster: readyWorkerIds(context), chats: Object.fromEntries(context.workers.map((worker) => [worker.agentId, worker.chats.map((chat) => chat.sessionId)])), reviewer: context.reviewer });
  return checked.ok ? { ok: true, value: checked.value } : { ok: false, kind: failureKindFor(checked.code), code: checked.code, reason: checked.reason };
}

/** `value` as a decision for `context`'s plan, or the failure to return instead. */
export function validateDecisionFor(context: ManagerDecisionContext, value: unknown): ManagerResult<ManagerDecision> {
  const checked = checkManagerDecision(value, { planStepIds: context.plan.steps.map((step) => step.id), dispatchable: dispatchableSteps(context) });
  return checked.ok ? { ok: true, value: checked.value } : { ok: false, kind: failureKindFor(checked.code), code: checked.code, reason: checked.reason };
}
