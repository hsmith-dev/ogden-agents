import { z } from 'zod';
import { SessionState } from './entities.js';
import { AgentId } from './events-common.js';
import { OrchestrationRunId, SessionId, WorkspaceId } from './ids.js';
import { redactSecrets } from './secret-patterns.js';
import { TeamRoster } from './team.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * The manager protocol and the orchestration contracts (epic 15, story 15.2;
 * CAP-22 and the AD-8 `orchestration.*` events are proposed through the spec
 * and architecture memlogs, never hand-edited). A manager is a tool-free model
 * that turns the goal and the state of the project into schema-checked JSON:
 * a plan of steps, one decision at a time, and (from Ogden to the manager) a
 * status report. Nothing here calls a model, dispatches anything or names a
 * model product.
 *
 * Every string a manager sends is untrusted data. It is bounded, free of
 * control characters, and where it names something (a step, a worker, a chat)
 * limited to the alphabet of that thing. The rules (no mode above Ask, no
 * Skip all, no build, no credential, a worker on the roster, a step in the
 * plan) live in {@link checkManagerPlan} and {@link checkManagerDecision},
 * which are code, not a prompt. The schemas are also exported as JSON
 * schema (the subset `structuredComplete` supports) for the server to ask
 * with; Ogden validates every answer itself.
 */

export const MANAGER_PLAN_VERSION = 'ogden.manager.plan.v1';
export const MANAGER_DECISION_VERSION = 'ogden.manager.decision.v1';
export const MANAGER_STATUS_VERSION = 'ogden.manager.status.v1';

/** The size and count caps of the protocol. A run's own limits are {@link RUN_LIMITS}. */
export const MANAGER_LIMITS = {
  maxSteps: 20,
  maxGoalChars: 500,
  maxInstructionChars: 4_000,
  maxStepIdChars: 40,
  maxReasonChars: 300,
  maxQuestionChars: 300,
  /** The most a manager's reply may be before Ogden stops reading it. */
  maxReplyBytes: 256 * 1024,
  /** The most of a worker's output a status report carries. */
  maxSummaryChars: 4_000,
} as const;

/** What the manager may decide next. `dispatch` still needs the user's approval in the default mode (enforced by core). */
export const DECISION_ACTIONS = ['dispatch', 'ask_user', 'done', 'stop'] as const;
export const DecisionAction = z.enum(DECISION_ACTIONS);
export type DecisionAction = z.infer<typeof DecisionAction>;

// ---- refusals ----

/** Why a manager's reply is refused, as a stable token (the first three also come from the port). */
export const MANAGER_REFUSAL_CODES = [
  'not_json',
  'too_large',
  'timeout',
  'wrong_version',
  'unknown_field',
  'missing_field',
  'forbidden_field',
  'forbidden_action',
  'mode_above_ask',
  'off_roster_worker',
  'empty_plan',
  'too_many_steps',
  'instruction_too_long',
  'duplicate_step_id',
  'unknown_dependency',
  'cyclic_dependency',
  'bad_text',
  'bad_reference',
  'unknown_step',
] as const;
export const ManagerRefusalCode = z.enum(MANAGER_REFUSAL_CODES);
export type ManagerRefusalCode = z.infer<typeof ManagerRefusalCode>;

/** Plain words for each refusal, as a user reads them. No dashes. */
export const MANAGER_REFUSAL_REASONS: Readonly<Record<ManagerRefusalCode, string>> = {
  not_json: 'The manager did not answer in JSON.',
  too_large: 'The manager sent back far more than a plan needs.',
  timeout: 'The manager took too long to answer.',
  wrong_version: 'The manager used a version of the plan format that Ogden does not know.',
  unknown_field: 'The manager added something the plan format does not have.',
  missing_field: 'The manager left out something the plan format needs.',
  forbidden_field: 'The manager asked for something it is never allowed to ask for, such as skipping permission checks or a secret.',
  forbidden_action: 'The manager asked Ogden to do something only you can start, such as a build or a command.',
  mode_above_ask: 'The manager asked for more freedom than Ask, and only you can give that.',
  off_roster_worker: 'The manager named an agent that is not on this team.',
  empty_plan: 'The manager sent a plan with no steps.',
  too_many_steps: 'The manager sent more steps than one run allows.',
  instruction_too_long: 'One of the instructions was longer than allowed.',
  duplicate_step_id: 'Two steps had the same id.',
  unknown_dependency: 'A step waits on a step that does not exist.',
  cyclic_dependency: 'The steps wait on each other in a circle.',
  bad_text: 'The manager sent text with characters that are not allowed.',
  bad_reference: 'The manager named a step or a chat in a way Ogden does not accept.',
  unknown_step: 'The manager chose a step that is not in the plan.',
};

export type ManagerCheck<T> = { ok: true; value: T } | { ok: false; code: ManagerRefusalCode; reason: string };

const refuse = (code: ManagerRefusalCode): { ok: false; code: ManagerRefusalCode; reason: string } => ({ ok: false, code, reason: MANAGER_REFUSAL_REASONS[code] });

// ---- text rules (every string from a manager is untrusted) ----

/** Control characters other than tab and line feed, and the invisible and direction controls that disguise text. */
const BAD_TEXT_CHARS = /(?![\t\n])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u;
/** The same, plus tab and line feed: a single line. */
const BAD_LINE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u;
/** Whether `text` is clean data: no control, format (tag characters, direction marks, zero width), separator, private or unassigned characters, lone surrogates included. */
const wellFormed = (text: string, pattern: RegExp): boolean => !pattern.test(text);
const BAD_TEXT = 'bad_text';
const BAD_REFERENCE = 'bad_reference';

const line = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => wellFormed(text, BAD_LINE_CHARS), BAD_TEXT)
    .refine((text) => text.trim() !== '', BAD_TEXT);
const block = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((text) => wellFormed(text, BAD_TEXT_CHARS), BAD_TEXT)
    .refine((text) => text.trim() !== '', BAD_TEXT);

/** A step's id inside one plan: letters, digits, `_` and `-`. */
export const ManagerStepId = z.string().min(1).max(MANAGER_LIMITS.maxStepIdChars).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, BAD_REFERENCE);
export type ManagerStepId = z.infer<typeof ManagerStepId>;

/** The chat a step goes to: `new`, or one of the project's chats by its id. Anything else is refused. */
export const NEW_CHAT = 'new';
export const ManagerChatRef = z.union([z.literal(NEW_CHAT), SessionId]);
export type ManagerChatRef = z.infer<typeof ManagerChatRef>;

// ---- the plan ----

/** The text fields, shared with the events so a stored string passes the same rules. */
export const ManagerGoal = line(MANAGER_LIMITS.maxGoalChars);
export const ManagerInstruction = block(MANAGER_LIMITS.maxInstructionChars);
export const ManagerReason = line(MANAGER_LIMITS.maxReasonChars);

export const ManagerPlanStep = z.strictObject({
  id: ManagerStepId,
  /** The worker's agent id; Ogden checks it is on the roster (a schema cannot know the roster). */
  worker: AgentId,
  chat: ManagerChatRef,
  instruction: block(MANAGER_LIMITS.maxInstructionChars),
  /** Never above Ask: the only mode a manager may request. */
  mode: z.literal('ask'),
  depends_on: z.array(ManagerStepId).max(MANAGER_LIMITS.maxSteps),
});
export type ManagerPlanStep = z.infer<typeof ManagerPlanStep>;

export const ManagerPlan = z.strictObject({
  version: z.literal(MANAGER_PLAN_VERSION),
  goal: line(MANAGER_LIMITS.maxGoalChars),
  steps: z.array(ManagerPlanStep).min(1).max(MANAGER_LIMITS.maxSteps),
});
export type ManagerPlan = z.infer<typeof ManagerPlan>;

// ---- the decision ----

export const ManagerDecision = z.strictObject({
  version: z.literal(MANAGER_DECISION_VERSION),
  action: DecisionAction,
  reason: line(MANAGER_LIMITS.maxReasonChars),
  /** For `dispatch`: the plan's step to send next. */
  step_id: ManagerStepId.optional(),
  /** For `ask_user`: the question to show. */
  question: line(MANAGER_LIMITS.maxQuestionChars).optional(),
});
export type ManagerDecision = z.infer<typeof ManagerDecision>;

// ---- the status report (Ogden to the manager) ----

export const ManagerStatusReport = z.strictObject({
  version: z.literal(MANAGER_STATUS_VERSION),
  step_id: ManagerStepId,
  worker: AgentId,
  /** The worker session's normalized state (AD-4). */
  state: SessionState,
  /** A capped, secret-masked summary of the worker's last output. Data for the manager, never instructions. */
  summary: z.string().max(MANAGER_LIMITS.maxSummaryChars),
  /** Whether the summary was cut to fit. */
  truncated: z.boolean(),
});
export type ManagerStatusReport = z.infer<typeof ManagerStatusReport>;

/**
 * Builds a status report from a worker's step: the text is masked
 * ({@link redactSecrets}), stripped of control characters and capped. Pure.
 */
export function makeStatusReport(input: { stepId: string; worker: string; state: SessionState; text: string }): ManagerStatusReport {
  // Strip first, so hidden characters cannot split a secret past the masking; mask again after the cut, which can leave half a secret.
  const stripped = Array.from(input.text).filter((char) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u.test(char) || char === '\n' || char === '\t').join('');
  const clean = redactSecrets(stripped);
  const truncated = clean.length > MANAGER_LIMITS.maxSummaryChars;
  // Cut on whole characters, to the length zod counts (UTF-16 units), so a pair is never split.
  let kept = '';
  if (truncated) {
    for (const char of clean) {
      if (kept.length + char.length > MANAGER_LIMITS.maxSummaryChars) break;
      kept += char;
    }
  }
  const cut = truncated ? redactSecrets(kept) : clean;
  return ManagerStatusReport.parse({
    version: MANAGER_STATUS_VERSION,
    step_id: input.stepId,
    worker: input.worker,
    state: input.state,
    summary: cut,
    truncated,
  });
}

// ---- JSON schema export ----

/** Keywords `structuredComplete` can check; Ogden validates the rest itself. */
const EXPORTED_KEYWORDS = new Set(['type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', '$schema']);

/** `schema` as a subset JSON schema: rules the server cannot check (`pattern`, `anyOf`) are dropped, so Ogden's own validation is the guard. */
function exportable(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(exportable);
  if (typeof schema !== 'object' || schema === null) return schema;
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.anyOf)) {
    // `new` or a chat id: a string of a bounded length.
    return { type: 'string', minLength: 1, maxLength: 80 };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!EXPORTED_KEYWORDS.has(key)) continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, exportable(sub)]));
    } else if (key === 'items') out[key] = exportable(value);
    else out[key] = value;
  }
  return out;
}

const jsonSchemaOf = (schema: z.ZodType): Readonly<Record<string, unknown>> => exportable(z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' })) as Record<string, unknown>;

export const MANAGER_PLAN_JSON_SCHEMA = jsonSchemaOf(ManagerPlan);
export const MANAGER_DECISION_JSON_SCHEMA = jsonSchemaOf(ManagerDecision);
export const MANAGER_STATUS_JSON_SCHEMA = jsonSchemaOf(ManagerStatusReport);

// ---- the rules a schema cannot say ----

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A key that asks for what a manager may never have: skipping checks, a secret, a credential. */
const FORBIDDEN_KEY = /skip[_-]?all|api[_-]?key|secret|token|password|credential|bearer|authorization/i;
/** A key that asks Ogden to do something: a command, a build, a tool. */
const ACTION_KEY = /^(kind|type|run|exec|command|cmd|shell|build|start_build|tool|tools)$/i;

/** The refusal an extra key deserves. */
function extraKeyCode(key: string): ManagerRefusalCode {
  if (FORBIDDEN_KEY.test(key)) return 'forbidden_field';
  if (ACTION_KEY.test(key)) return 'forbidden_action';
  return 'unknown_field';
}

const valueAt = (root: unknown, path: readonly PropertyKey[]): { found: boolean; value?: unknown } => {
  let current: unknown = root;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') {
      if (key >= current.length) return { found: false };
      current = current[key];
    } else if (isRecord(current) && typeof key === 'string' && Object.hasOwn(current, key)) current = current[key];
    else return { found: false };
  }
  // A key holding `undefined` (not possible in JSON) counts as missing.
  return { found: current !== undefined, value: current };
};

/** The one refusal that best names why `value` failed `error`'s schema: extra keys first, then the version, then the rest in order. */
function codeFor(error: z.ZodError, value: unknown): ManagerRefusalCode {
  let best: { rank: number; code: ManagerRefusalCode } | undefined;
  const consider = (rank: number, code: ManagerRefusalCode) => {
    if (best === undefined || rank < best.rank) best = { rank, code };
  };
  for (const issue of error.issues) {
    const path = issue.path;
    const last = path.at(-1);
    const here = valueAt(value, path);
    if (issue.code === 'unrecognized_keys') {
      const codes = issue.keys.map(extraKeyCode);
      consider(0, codes.find((code) => code === 'forbidden_field') ?? codes.find((code) => code === 'forbidden_action') ?? 'unknown_field');
    } else if (!here.found) consider(3, 'missing_field');
    else if (last === 'version') consider(1, 'wrong_version');
    else if (last === 'mode') consider(2, 'mode_above_ask');
    else if (last === 'action') consider(2, 'forbidden_action');
    else if (last === 'steps' && issue.code === 'too_big') consider(2, 'too_many_steps');
    else if (last === 'steps' && issue.code === 'too_small') consider(2, 'empty_plan');
    else if (last === 'instruction' && issue.code === 'too_big') consider(2, 'instruction_too_long');
    else if (issue.code === 'custom' && issue.message === BAD_TEXT) consider(2, 'bad_text');
    else if (last === 'worker' || last === 'goal' || last === 'reason' || last === 'question') consider(2, last === 'worker' ? 'bad_reference' : 'bad_text');
    else if (issue.message === BAD_REFERENCE || last === 'chat' || last === 'id' || last === 'step_id' || path.at(-2) === 'depends_on') consider(2, 'bad_reference');
    else consider(3, 'missing_field');
  }
  return best?.code ?? 'missing_field';
}

export interface ManagerPlanCheckContext {
  /** The agent ids a worker may name: the project's ready workers. */
  roster: readonly string[];
  /** The chats each worker already has, by agent id. A step may name only `new` or one of its own worker's chats. Absent: none. */
  chats?: Readonly<Record<string, readonly string[]>> | undefined;
}

/** Whether any string inside `value` holds a secret (masking would change it): a manager never names one, so such a reply is refused. */
function holdsSecret(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return redactSecrets(value) !== value;
  if (depth > 6 || typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((each) => holdsSecret(each, depth + 1));
}

/** The first problem with how a plan's steps link to each other, or `undefined`. */
function linkProblem(plan: ManagerPlan): ManagerRefusalCode | undefined {
  const links = new Map<string, readonly string[]>();
  for (const step of plan.steps) {
    if (links.has(step.id)) return 'duplicate_step_id';
    links.set(step.id, step.depends_on);
  }
  for (const needs of links.values()) if (needs.some((id) => !links.has(id))) return 'unknown_dependency';
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return false;
    if (state.get(id) === 'open') return true;
    state.set(id, 'open');
    for (const next of links.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 'done');
    return false;
  };
  for (const id of links.keys()) if (visit(id)) return 'cyclic_dependency';
  return undefined;
}

/**
 * Checks one parsed manager plan against the protocol and the roster: the
 * schema first (versions, fields, caps, Ask only, text rules), then the
 * rules a schema cannot say (a worker on the roster, ids unique, every
 * dependency a step, no circle). Pure. The value returned is a copy that
 * holds only the schema's fields.
 */
export function checkManagerPlan(value: unknown, context: ManagerPlanCheckContext): ManagerCheck<ManagerPlan> {
  const parsed = ManagerPlan.safeParse(value);
  if (!parsed.success) return refuse(codeFor(parsed.error, value));
  if (holdsSecret(parsed.data)) return refuse('forbidden_field');
  if (parsed.data.steps.some((step) => !context.roster.includes(step.worker))) return refuse('off_roster_worker');
  if (parsed.data.steps.some((step) => step.chat !== NEW_CHAT && !(context.chats?.[step.worker] ?? []).includes(step.chat))) return refuse('bad_reference');
  const problem = linkProblem(parsed.data);
  if (problem !== undefined) return refuse(problem);
  return { ok: true, value: parsed.data };
}

export interface ManagerDecisionCheckContext {
  /** The ids of the steps in the plan. A decision may only name one of them. */
  planStepIds: readonly string[];
}

/**
 * Checks one parsed manager decision: the schema, then that `dispatch` names
 * a step of the plan (the id is data from the model, never trusted by
 * itself) and `ask_user` carries a question. Pure.
 */
export function checkManagerDecision(value: unknown, context: ManagerDecisionCheckContext): ManagerCheck<ManagerDecision> {
  const parsed = ManagerDecision.safeParse(value);
  if (!parsed.success) return refuse(codeFor(parsed.error, value));
  if (holdsSecret(parsed.data)) return refuse('forbidden_field');
  const { action, step_id: stepId, question } = parsed.data;
  if (action === 'dispatch' && stepId === undefined) return refuse('missing_field');
  // Whatever the action, a step the decision names must be a step of the plan.
  if (stepId !== undefined && !context.planStepIds.includes(stepId)) return refuse('unknown_step');
  if (action === 'ask_user' && question === undefined) return refuse('missing_field');
  return { ok: true, value: parsed.data };
}

// ---- the piece ----

/**
 * Orchestration is an opt-in piece, off by default for every project (AD-22
 * style; epic 15). It is not a BMad Method piece, so it is not in
 * `BMAD_PIECES`: it has its own switch, `orchestrationEnabled`, kept by core
 * on the workspace row and changed only through the workspace settings
 * use-case. It needs no other piece and runs none of the project's scripts.
 */
export const ORCHESTRATION_PIECE = {
  label: 'Orchestration',
  sentence: 'Let a manager model plan the work and tell your other agents what to do, with you approving each instruction.',
} as const;

/** `feature_off` (409) from an orchestration route whose project has the piece off. */
export const ORCHESTRATION_OFF_MESSAGE = "Orchestration is off in this project. Turn it on in the project's settings to use it.";
/** `feature_unavailable` (409): turning Orchestration on in an install that does not ship it yet. */
export const ORCHESTRATION_UNAVAILABLE_MESSAGE = "Orchestration isn't in this version of Ogden Agents yet, so it can't be turned on.";

// ---- the mode, the limits, the run ----

/** Who approves an instruction: the user for each one (the default), or the team's mode dispatches them within the run's limits. */
export const ORCHESTRATION_MODES = ['approve_each', 'automatic'] as const;
export const OrchestrationMode = z.enum(ORCHESTRATION_MODES);
export type OrchestrationMode = z.infer<typeof OrchestrationMode>;
export const DEFAULT_ORCHESTRATION_MODE: OrchestrationMode = 'approve_each';

/** What the user reads for each mode. */
export const ORCHESTRATION_MODE_INFO: Readonly<Record<OrchestrationMode, { label: string; sentence: string }>> = {
  approve_each: { label: 'Approve each instruction', sentence: 'You see every instruction and approve, edit or skip it before an agent gets it.' },
  automatic: { label: 'Dispatch automatically', sentence: 'The manager sends each instruction on its own, within limits. You can stop it at any time.' },
};

/** The message refusing a switch to automatic that the user did not confirm (400 `confirmation_required`). */
export const AUTOMATIC_NEEDS_CONFIRMATION = 'Confirm that you want the manager to send instructions without asking you each time.';

/** The user's defaults for a run's hard limits (E15-R3a): safety limits, not budgets. */
export const RUN_LIMITS = { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } as const;
export const RunLimits = z.strictObject({
  maxInstructions: z.number().int().min(1).max(MANAGER_LIMITS.maxSteps),
  maxDepth: z.number().int().min(1).max(10),
  maxMinutes: z.number().int().min(1).max(240),
});
export type RunLimits = z.infer<typeof RunLimits>;

/** A run's state. `stopped` and `finished` and `failed` are final. */
export const ORCHESTRATION_RUN_STATES = ['planning', 'awaiting_user', 'running', 'paused', 'stopped', 'finished', 'failed'] as const;
export const OrchestrationRunState = z.enum(ORCHESTRATION_RUN_STATES);
export type OrchestrationRunState = z.infer<typeof OrchestrationRunState>;

export const ORCHESTRATION_RUN_TRANSITIONS: Readonly<Record<OrchestrationRunState, readonly OrchestrationRunState[]>> = {
  planning: ['awaiting_user', 'running', 'stopped', 'finished', 'failed'],
  awaiting_user: ['running', 'planning', 'paused', 'stopped', 'finished', 'failed'],
  running: ['planning', 'awaiting_user', 'paused', 'stopped', 'finished', 'failed'],
  paused: ['running', 'awaiting_user', 'planning', 'stopped', 'failed'],
  stopped: [],
  finished: [],
  failed: [],
};

/** A step's state: proposed, then approved (by the user, or by the automatic mode) or skipped; then dispatched; then done or failed. */
export const ORCHESTRATION_STEP_STATES = ['proposed', 'approved', 'skipped', 'dispatched', 'done', 'failed'] as const;
export const OrchestrationStepState = z.enum(ORCHESTRATION_STEP_STATES);
export type OrchestrationStepState = z.infer<typeof OrchestrationStepState>;

export const ORCHESTRATION_STEP_TRANSITIONS: Readonly<Record<OrchestrationStepState, readonly OrchestrationStepState[]>> = {
  proposed: ['approved', 'skipped'],
  approved: ['dispatched', 'skipped', 'failed'],
  skipped: [],
  dispatched: ['done', 'failed'],
  done: [],
  failed: [],
};

/** Whether a run may go from `from` to `to`. */
export const canMoveRun = (from: OrchestrationRunState, to: OrchestrationRunState): boolean => ORCHESTRATION_RUN_TRANSITIONS[from].includes(to);
/** Whether a step may go from `from` to `to`. */
export const canMoveStep = (from: OrchestrationStepState, to: OrchestrationStepState): boolean => ORCHESTRATION_STEP_TRANSITIONS[from].includes(to);
/** Whether a run is over. */
export const isRunOver = (state: OrchestrationRunState): boolean => ORCHESTRATION_RUN_TRANSITIONS[state].length === 0;

/** Who approved a step. The manager never does. */
export const APPROVERS = ['user', 'mode'] as const;
export const Approver = z.enum(APPROVERS);
export type Approver = z.infer<typeof Approver>;

/** Why a run stopped. */
export const ORCHESTRATION_STOP_REASONS = ['user', 'instruction_limit', 'depth_limit', 'time_limit', 'manager_refused', 'worker_error', 'permission_denied'] as const;
export const OrchestrationStopReason = z.enum(ORCHESTRATION_STOP_REASONS);
export type OrchestrationStopReason = z.infer<typeof OrchestrationStopReason>;

/** Why a run waits. */
export const PAUSE_REASONS = ['permission_card', 'awaiting_user'] as const;
export const PauseReason = z.enum(PAUSE_REASONS);
export type PauseReason = z.infer<typeof PauseReason>;

/** One orchestration run: a goal, the mode and limits it runs under, and its state. */
export const OrchestrationRun = z.object({
  id: OrchestrationRunId,
  workspaceId: WorkspaceId,
  goal: line(MANAGER_LIMITS.maxGoalChars),
  state: OrchestrationRunState,
  mode: OrchestrationMode,
  limits: RunLimits,
  stopReason: OrchestrationStopReason.nullable(),
  createdAt: IsoUtcTimestamp,
  updatedAt: IsoUtcTimestamp,
});
export type OrchestrationRun = z.infer<typeof OrchestrationRun>;

/** One step of a run's plan. */
export const OrchestrationStep = z.object({
  runId: OrchestrationRunId,
  stepId: ManagerStepId,
  position: z.number().int().min(0),
  worker: AgentId,
  chat: ManagerChatRef,
  instruction: block(MANAGER_LIMITS.maxInstructionChars),
  dependsOn: z.array(ManagerStepId),
  state: OrchestrationStepState,
  approvedBy: Approver.nullable(),
  /** The chat the instruction was sent to, once dispatched. */
  sessionId: SessionId.nullable(),
});
export type OrchestrationStep = z.infer<typeof OrchestrationStep>;

// ---- settings and the one route ----

/** A project's orchestration settings as read: the mode, the limits in force and the roster. */
export const OrchestrationSettings = z.object({
  mode: OrchestrationMode,
  limits: RunLimits,
  roster: TeamRoster,
  /** Whether a manager is set up in this install. Absent from older servers; read as not set up. */
  managerReady: z.boolean().optional(),
});
export type OrchestrationSettings = z.infer<typeof OrchestrationSettings>;

/** `GET /api/v1/workspaces/:wsId/orchestration`: 409 `feature_off` while the Orchestration piece is off. */
export const OrchestrationSettingsResponse = z.object({ settings: OrchestrationSettings });
export type OrchestrationSettingsResponse = z.infer<typeof OrchestrationSettingsResponse>;

// ---- the tracer's runs over REST (15.3) ----

/** What the user types to start a run: one line, as long as a manager's goal may be. Whitespace and line breaks are folded to single spaces. */
export const StartOrchestrationRunRequest = z.object({
  goal: z
    .string()
    .transform((text) => text.replace(/\s+/g, ' ').trim())
    .pipe(line(MANAGER_LIMITS.maxGoalChars)),
});
export type StartOrchestrationRunRequest = z.infer<typeof StartOrchestrationRunRequest>;

/** One step as the Orchestrate page shows it: the stored step, the worker's name, and what came back once it was sent. */
export const OrchestrationStepView = OrchestrationStep.extend({
  /** The worker's name as the user knows it. */
  workerLabel: z.string(),
  /** The worker chat's normalized state, once the instruction was sent. */
  sessionState: SessionState.nullable(),
  /** A capped, secret-masked summary of the worker's last reply, once it was sent. */
  report: ManagerStatusReport.nullable(),
});
export type OrchestrationStepView = z.infer<typeof OrchestrationStepView>;

export const OrchestrationRunView = z.object({ run: OrchestrationRun, steps: z.array(OrchestrationStepView) });
export type OrchestrationRunView = z.infer<typeof OrchestrationRunView>;

/** `POST …/orchestration/runs`, `GET …/runs/:runId` and each step action. */
export const OrchestrationRunResponse = z.object({ run: OrchestrationRunView });
export type OrchestrationRunResponse = z.infer<typeof OrchestrationRunResponse>;

/** `GET …/orchestration/runs`: the project's runs, newest first (at most {@link ORCHESTRATION_RUNS_PAGE}). */
export const OrchestrationRunsResponse = z.object({ runs: z.array(OrchestrationRunView) });
export type OrchestrationRunsResponse = z.infer<typeof OrchestrationRunsResponse>;
export const ORCHESTRATION_RUNS_PAGE = 20;

/** Plain words for the tracer's states and refusals. No dashes. */
export const ORCHESTRATION_NO_MANAGER_MESSAGE = 'There is no manager yet. A manager model comes with a later update, so a plan cannot be made here yet.';
export const ORCHESTRATION_STEP_NOT_APPROVED_MESSAGE = 'This instruction has not been approved, so it was not sent.';
export const ORCHESTRATION_STEP_NOT_PROPOSED_MESSAGE = 'This instruction is not waiting for your approval, or a step it needs is not finished yet.';
export const ORCHESTRATION_MANAGER_MARK = 'Sent by the manager, approved by you';
