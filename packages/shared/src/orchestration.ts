import { z } from 'zod';
import { SessionState } from './entities.js';
import { AgentId } from './events-common.js';
import { SessionId } from './ids.js';
import { TICKET_REF_PATTERN } from './planning-board.js';
import { redactSecrets } from './secret-patterns.js';
import { BAD_TEXT, block, line } from './orchestration-text.js';

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
  /** The most of the manager's answer an event keeps. */
  maxRecordChars: 4_000,
} as const;

/**
 * The reviewer's bounded question (15.10): the manager's question is at most `maxQuestionChars`, the summary of the reviewed step's
 * result that core adds is at most `maxResultChars`, and the whole message at most `maxMessageChars`.
 */
export const REVIEW_LIMITS = { maxQuestionChars: 600, maxResultChars: 1_500, maxMessageChars: 3_000 } as const;

/**
 * A build step the manager may propose (15.11): only a reference to a ticket and a short reason. Nothing about how to build: the person
 * chooses that in the Build dialog.
 */
export const BUILD_STEP_LIMITS = { maxReasonChars: 200, maxSummaryChars: 1_200 } as const;

/**
 * The user's routing rules (15.12): plain sentences about which kind of step goes to which worker, written by the person, at most
 * `maxRules` of them and `maxRuleChars` characters each. They reach the manager as capped, masked data and are only ever suggestions.
 */
export const ROUTING_LIMITS = { maxRules: 10, maxRuleChars: 300 } as const;

/**
 * The worker name a build step is stored under when Ogden is not told which agent builds (a stub). It is not an agent and is never sent
 * anything: builds run on the build runner's one agent (epic 5, until epic 8 widens them), which a plan never names.
 */
export const ORCHESTRATION_BUILD_WORKER = 'build';

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
  'step_not_available',
  'bad_review',
  'reviewer_not_rostered',
  'review_not_prerequisite',
  'reviewer_is_worker',
  'review_question_too_long',
  'build_field_forbidden',
  'build_ticket_unavailable',
  'duplicate_build_ticket',
  'unknown_rule',
] as const;
export const ManagerRefusalCode = z.enum(MANAGER_REFUSAL_CODES);
export type ManagerRefusalCode = z.infer<typeof ManagerRefusalCode>;

/** Why a manager call failed, in the kinds the user is told about (15.4 added `endpoint_missing`). */
export const MANAGER_FAILURE_KINDS = ['malformed', 'off_roster', 'too_large', 'too_slow', 'context_too_small', 'host_not_confirmed', 'endpoint_missing', 'unavailable'] as const;
export const ManagerFailureKind = z.enum(MANAGER_FAILURE_KINDS);
export type ManagerFailureKind = z.infer<typeof ManagerFailureKind>;

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
  step_not_available: 'The manager chose a step that cannot be sent now: it is not waiting, or a step it needs is not finished.',
  bad_review: 'A review step must name an earlier step to review, not itself and not another review, and it goes to a new chat.',
  reviewer_not_rostered: "A review step must go to this project's reviewer, and no reviewer is ready.",
  review_not_prerequisite: 'A review step must wait for the step it reviews.',
  reviewer_is_worker: 'The reviewer must be a different agent from the one that did the work.',
  review_question_too_long: `A question for the reviewer can be at most ${REVIEW_LIMITS.maxQuestionChars} characters.`,
  build_field_forbidden: 'A build step names only a ticket. How a build runs is for you to choose in the Build dialog, so the manager cannot name an agent, a mode, a sandbox or a flag.',
  build_ticket_unavailable: 'The manager asked for a build of a ticket that is not on the board or is not ready to build now.',
  duplicate_build_ticket: 'The manager asked for the same ticket to be built twice.',
  unknown_rule: 'The manager said a step followed a routing rule that does not exist.',
};

export type ManagerCheck<T> = { ok: true; value: T } | { ok: false; code: ManagerRefusalCode; reason: string };

const refuse = (code: ManagerRefusalCode): { ok: false; code: ManagerRefusalCode; reason: string } => ({ ok: false, code, reason: MANAGER_REFUSAL_REASONS[code] });

// ---- text rules (every string from a manager is untrusted) ----

const BAD_REFERENCE = 'bad_reference';

/** A step's id inside one plan: letters, digits, `_` and `-`. */
export const ManagerStepId = z.string().min(1).max(MANAGER_LIMITS.maxStepIdChars).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, BAD_REFERENCE);
export type ManagerStepId = z.infer<typeof ManagerStepId>;

/**
 * A routing rule's id (15.12): `r` and a number. Ogden gives it when the rule is saved and it stays the rule's own, so a plan that names it
 * keeps meaning that rule. Whether it exists is checked in code against the project's rules.
 */
export const RoutingRuleId = z.string().regex(/^r[1-9][0-9]{0,3}$/, BAD_REFERENCE);
export type RoutingRuleId = z.infer<typeof RoutingRuleId>;

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
  /**
   * 15.10: the earlier step whose result this step asks the reviewer about. Optional, so every plan from before is still valid. Ogden checks
   * the rest in code: the worker is the roster's reviewer, the step is a prerequisite, the question is short.
   */
  review_of: ManagerStepId.optional(),
  /**
   * 15.12: the routing rule this step followed, by its id. Optional, so every plan from before is still valid. A suggestion only: Ogden
   * checks the id exists, and the roster, the vendor's terms and the mode are checked as before whatever the rule says.
   */
  rule: RoutingRuleId.optional(),
});
export type ManagerPlanStep = z.infer<typeof ManagerPlanStep>;

/** A ticket as a plan names it: the board's own reference (`2.3`), nothing else. */
export const ManagerBuildTicket = z.string().min(1).max(128).regex(TICKET_REF_PATTERN, BAD_REFERENCE);

/**
 * A build step (15.11): "Build ticket N", a proposal only. It carries the ticket and a short reason and nothing else: no worker, no chat, no
 * instruction, no mode, and no field that names a build driver, agent, sandbox or flag (the schema is strict, so any such field is refused).
 * Ogden checks the ticket against the board's tickets that are ready to build now; the person starts the build in the Build dialog.
 */
export const ManagerBuildStep = z.strictObject({
  id: ManagerStepId,
  build: z.strictObject({ ticket: ManagerBuildTicket }),
  reason: line(BUILD_STEP_LIMITS.maxReasonChars),
  depends_on: z.array(ManagerStepId).max(MANAGER_LIMITS.maxSteps),
  /** 15.12: the routing rule this step followed, as on a worker step. */
  rule: RoutingRuleId.optional(),
});
export type ManagerBuildStep = z.infer<typeof ManagerBuildStep>;

/** A step of a plan: an instruction for a worker, or a proposed build. */
export const ManagerAnyStep = z.union([ManagerPlanStep, ManagerBuildStep]);
export type ManagerAnyStep = z.infer<typeof ManagerAnyStep>;

/** Whether a plan's step is a proposed build (it has no worker or instruction). */
export const isManagerBuildStep = (step: ManagerAnyStep): step is ManagerBuildStep => 'build' in step;

export const ManagerPlan = z.strictObject({
  version: z.literal(MANAGER_PLAN_VERSION),
  goal: line(MANAGER_LIMITS.maxGoalChars),
  steps: z.array(ManagerAnyStep).min(1).max(MANAGER_LIMITS.maxSteps),
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

/** The plan's schema for steps that go to workers, as the server is asked with it when no build may be proposed (nothing is ready to build). */
const workPlanSchema = (): Readonly<Record<string, unknown>> => {
  const base = jsonSchemaOf(ManagerPlan) as { properties: { steps: { items?: unknown } } };
  base.properties.steps.items = jsonSchemaOf(ManagerPlanStep);
  return base;
};
export const MANAGER_PLAN_JSON_SCHEMA = workPlanSchema();

/**
 * The plan's schema when a build may be proposed (15.11: some ticket is ready to build). A step is one object with the fields of either kind,
 * only `id` and `depends_on` required (the subset has no `anyOf`), so the server's own check is looser here; Ogden's check refuses a step
 * that mixes the two, names anything more or leaves out what its kind needs. Nothing in it names how to build.
 */
const planWithBuildsSchema = (): Readonly<Record<string, unknown>> => {
  const base = jsonSchemaOf(ManagerPlan) as { properties: { steps: { items?: unknown } } };
  const work = jsonSchemaOf(ManagerPlanStep) as { properties: Record<string, unknown> };
  const build = jsonSchemaOf(ManagerBuildStep) as { properties: Record<string, unknown> };
  base.properties.steps.items = { type: 'object', properties: { ...work.properties, ...build.properties }, required: ['id', 'depends_on'], additionalProperties: false };
  return base;
};
export const MANAGER_PLAN_WITH_BUILDS_JSON_SCHEMA = planWithBuildsSchema();
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

/** Whether a step is a build step as far as its shape says: it holds a `build` object. A bare `build: "x"` is a worker step asking for something it may not (forbidden action). */
const isBuildShaped = (step: unknown): boolean => isRecord(step) && isRecord(step.build);

/**
 * The issues of `error` with a step's union opened up (15.11): a step that holds `build` is judged as a build step, any other as a worker
 * step, so the code names the problem of the kind the manager meant. `build` says the issue is inside a build step.
 */
function flattened(error: z.ZodError, value: unknown): Array<{ issue: z.core.$ZodIssue; path: PropertyKey[]; build: boolean }> {
  const out: Array<{ issue: z.core.$ZodIssue; path: PropertyKey[]; build: boolean }> = [];
  const walk = (issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[], build: boolean): void => {
    for (const issue of issues) {
      const path = [...prefix, ...issue.path];
      if (issue.code === 'invalid_union') {
        const here = valueAt(value, path).value;
        const isBuild = isBuildShaped(here);
        walk(issue.errors[isBuild ? 1 : 0] ?? issue.errors[0] ?? [], path, isBuild);
      } else {
        // Zod gives a lone failing branch's issues as they are, so whether this is a build step is read from the step itself.
        const step = path[0] === 'steps' && typeof path[1] === 'number' ? valueAt(value, ['steps', path[1]]).value : undefined;
        out.push({ issue, path, build: build || isBuildShaped(step) });
      }
    }
  };
  walk(error.issues, [], false);
  return out;
}

/** The one refusal that best names why `value` failed `error`'s schema: extra keys first, then the version, then the rest in order. */
function codeFor(error: z.ZodError, value: unknown): ManagerRefusalCode {
  let best: { rank: number; code: ManagerRefusalCode } | undefined;
  const consider = (rank: number, code: ManagerRefusalCode) => {
    if (best === undefined || rank < best.rank) best = { rank, code };
  };
  for (const { issue, path, build } of flattened(error, value)) {
    const last = path.at(-1);
    const here = valueAt(value, path);
    if (issue.code === 'unrecognized_keys') {
      // Anything extra on a build step (or inside its `build`) is a try at naming how to build: a secret-like key is the worse of the two.
      const codes = build ? issue.keys.map((key) => (FORBIDDEN_KEY.test(key) ? 'forbidden_field' : 'build_field_forbidden')) : issue.keys.map(extraKeyCode);
      consider(0, codes.find((code) => code === 'forbidden_field') ?? codes.find((code) => code === 'forbidden_action') ?? codes.find((code) => code === 'build_field_forbidden') ?? 'unknown_field');
    } else if (!here.found) consider(3, 'missing_field');
    else if (last === 'version') consider(1, 'wrong_version');
    else if (last === 'mode') consider(2, 'mode_above_ask');
    else if (last === 'action') consider(2, 'forbidden_action');
    else if (last === 'steps' && issue.code === 'too_big') consider(2, 'too_many_steps');
    else if (last === 'steps' && issue.code === 'too_small') consider(2, 'empty_plan');
    else if (last === 'instruction' && issue.code === 'too_big') consider(2, 'instruction_too_long');
    else if (issue.code === 'custom' && issue.message === BAD_TEXT) consider(2, 'bad_text');
    else if (last === 'worker' || last === 'goal' || last === 'reason' || last === 'question') consider(2, last === 'worker' ? 'bad_reference' : 'bad_text');
    else if (issue.message === BAD_REFERENCE || last === 'chat' || last === 'review_of' || last === 'rule' || last === 'id' || last === 'step_id' || path.at(-2) === 'depends_on') consider(2, 'bad_reference');
    else consider(3, 'missing_field');
  }
  return best?.code ?? 'missing_field';
}

export interface ManagerPlanCheckContext {
  /** The agent ids a worker may name: the project's ready workers. */
  roster: readonly string[];
  /** The chats each worker already has, by agent id. A step may name only `new` or one of its own worker's chats. Absent: none. */
  chats?: Readonly<Record<string, readonly string[]>> | undefined;
  /** The roster's reviewer (15.10): the agent id of a ready reviewer, or absent. Only a step with `review_of` may go to it as a review. */
  reviewer?: string | undefined;
  /**
   * The ticket refs on the board that are ready to build now (15.11), given by core. A build step may name only one of them; absent: none,
   * so no build step is valid.
   */
  buildable?: readonly string[] | undefined;
  /** The agent id builds run on (15.11), given by the server's wiring: a review of a build step must be by another agent where one is ready. Absent: not checked. */
  builder?: string | undefined;
  /** The ids of the project's routing rules (15.12). A step's `rule` may name only one of them; absent: none, so no step may name a rule. */
  rules?: readonly string[] | undefined;
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
  const work = parsed.data.steps.filter((step): step is ManagerPlanStep => !isManagerBuildStep(step));
  if (work.some((step) => !context.roster.includes(step.worker))) return refuse('off_roster_worker');
  if (work.some((step) => step.chat !== NEW_CHAT && !(context.chats?.[step.worker] ?? []).includes(step.chat))) return refuse('bad_reference');
  const problem = linkProblem(parsed.data);
  if (problem !== undefined) return refuse(problem);
  if (parsed.data.steps.some((step) => step.rule !== undefined && !(context.rules ?? []).includes(step.rule))) return refuse('unknown_rule');
  const buildProblem = buildStepProblem(parsed.data, context);
  if (buildProblem !== undefined) return refuse(buildProblem);
  const reviewProblem = reviewLinkProblem(parsed.data, context);
  if (reviewProblem !== undefined) return refuse(reviewProblem);
  return { ok: true, value: parsed.data };
}

/** The first problem with a plan's build steps (15.11), or `undefined`: each ticket must be ready to build now, and named once. */
function buildStepProblem(plan: ManagerPlan, context: ManagerPlanCheckContext): ManagerRefusalCode | undefined {
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (!isManagerBuildStep(step)) continue;
    if (!(context.buildable ?? []).includes(step.build.ticket)) return 'build_ticket_unavailable';
    if (seen.has(step.build.ticket)) return 'duplicate_build_ticket';
    seen.add(step.build.ticket);
  }
  return undefined;
}

/** The first problem with a plan's review steps (15.10), or `undefined`. */
function reviewLinkProblem(plan: ManagerPlan, context: ManagerPlanCheckContext): ManagerRefusalCode | undefined {
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  for (const step of plan.steps) {
    if (isManagerBuildStep(step) || step.review_of === undefined) continue;
    const reviewed = byId.get(step.review_of);
    // A review of a build step is the review page's question (15.11): the build has no worker chat, and its builder is the build runner's agent.
    if (reviewed === undefined || reviewed.id === step.id || (!isManagerBuildStep(reviewed) && reviewed.review_of !== undefined) || step.chat !== NEW_CHAT) return 'bad_review';
    if (context.reviewer === undefined || step.worker !== context.reviewer) return 'reviewer_not_rostered';
    if (!step.depends_on.includes(reviewed.id)) return 'review_not_prerequisite';
    // A different agent from the one that did the work, where another ready agent exists.
    const worker = isManagerBuildStep(reviewed) ? context.builder : reviewed.worker;
    if (worker === step.worker && context.roster.some((id) => id !== step.worker)) return 'reviewer_is_worker';
    if (step.instruction.length > REVIEW_LIMITS.maxQuestionChars) return 'review_question_too_long';
  }
  return undefined;
}

export interface ManagerDecisionCheckContext {
  /** The ids of the steps in the plan. A decision may only name one of them. */
  planStepIds: readonly string[];
  /**
   * The ids of the steps that may be sent now: still waiting, with every step they need done (15.9). When given, a `dispatch` may name only
   * one of them. Absent: any step of the plan (older callers).
   */
  dispatchable?: readonly string[] | undefined;
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
  if (action === 'dispatch' && context.dispatchable !== undefined && !context.dispatchable.includes(stepId!)) return refuse('step_not_available');
  return { ok: true, value: parsed.data };
}
