/**
 * The run, its limits and the REST views of the orchestration contracts (epic 15, stories 15.3 to 15.12): the piece, the mode, a run's
 * states and transitions, the settings, the routing rules, the plan review, the dispatch refusals, the loop and the activity log. The manager
 * protocol they build on (plan, decision, status report, the checks) is `orchestration.ts`; builds and the reviewer's message are
 * `orchestration-build-review.ts`. Split out by story 15.13 without a change of behaviour.
 */
import { z } from 'zod';
import { RunDecision } from './build-runs.js';
import { RunOutcome, SessionState } from './entities.js';
import { AgentId } from './events-common.js';
import { OrchestrationRunId, RunId, SessionId, WorkspaceId } from './ids.js';
import { TeamRoster } from './team.js';
import { IsoUtcTimestamp } from './time.js';
import { block, line } from './orchestration-text.js';
import { DECISION_ACTIONS, MANAGER_LIMITS, ManagerBuildTicket, ManagerChatRef, ManagerInstruction, ManagerStatusReport, ManagerStepId, ROUTING_LIMITS, RoutingRuleId } from './orchestration.js';

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

/**
 * The bounds the user may set a run limit within (15.8): sane, not unlimited. Instructions cannot pass the most steps a plan may
 * have; a depth of five is already a long chain for a small manager; two hours is the longest a run may go without the user looking.
 */
export const ORCHESTRATION_LIMIT_BOUNDS = {
  maxInstructions: { min: 1, max: MANAGER_LIMITS.maxSteps },
  maxDepth: { min: 1, max: 5 },
  maxMinutes: { min: 1, max: 120 },
} as const;
const boundedLimit = (bounds: { min: number; max: number }, what: string) =>
  z
    .number()
    .int(`Use a whole number for ${what}.`)
    .min(bounds.min, `${what} must be at least ${bounds.min}.`)
    .max(bounds.max, `${what} can be at most ${bounds.max}.`);
/** The limits as the user may save them: each within its bounds. */
export const BoundedRunLimits = z.strictObject({
  maxInstructions: boundedLimit(ORCHESTRATION_LIMIT_BOUNDS.maxInstructions, 'The number of instructions'),
  maxDepth: boundedLimit(ORCHESTRATION_LIMIT_BOUNDS.maxDepth, 'The depth'),
  maxMinutes: boundedLimit(ORCHESTRATION_LIMIT_BOUNDS.maxMinutes, 'The time limit'),
});

/**
 * How deep a step is (15.8): a step that needs nothing is at depth 1, and any other is one deeper than the deepest step it needs, so a
 * run's depth is its longest chain of `depends_on`. (The loop, 15.9, adds no level: the manager can only choose among the plan's steps, so a
 * decision never nests deeper than the plan does.) A step that needs one not in the list is counted as if it did not.
 */
export function stepDepths(steps: ReadonlyArray<{ stepId: string; dependsOn: readonly string[] }>): Map<string, number> {
  const needs = new Map(steps.map((step) => [step.stepId, step.dependsOn]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    // A step that (wrongly) needs itself through a loop is as deep as any limit: the plan check forbids it, this only keeps the count finite.
    if (visiting.has(id)) return Number.MAX_SAFE_INTEGER;
    visiting.add(id);
    let deepest = 0;
    for (const need of needs.get(id) ?? []) if (needs.has(need)) deepest = Math.max(deepest, depthOf(need));
    visiting.delete(id);
    const depth = deepest === Number.MAX_SAFE_INTEGER ? deepest : deepest + 1;
    depths.set(id, depth);
    return depth;
  };
  for (const step of steps) depthOf(step.stepId);
  return depths;
}

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
  // An edit of an approved step that was not sent puts it back to waiting: the old approval never covers new text.
  approved: ['dispatched', 'skipped', 'failed', 'proposed'],
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
export const ORCHESTRATION_STOP_REASONS = ['user', 'instruction_limit', 'depth_limit', 'time_limit', 'manager_refused', 'worker_error', 'permission_denied', 'dispatch_refused', 'manager_stopped', 'restarted'] as const;
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
  /** 15.10: the step whose result this step asks the reviewer about, or `null` for an ordinary step. */
  reviewOf: ManagerStepId.nullable().default(null),
  /**
   * 15.11: a proposed build. `ticketRef` is the ticket, `runId` the build run once the person started it in the Build dialog (and the page
   * told Ogden which run it was); `null` for an ordinary step. A build step has no worker chat: `worker` is the agent builds run on,
   * `chat` is `new`, `instruction` is the manager's short reason, and `sessionId` stays empty.
   */
  build: z.object({ ticketRef: ManagerBuildTicket, runId: RunId.nullable() }).nullable().default(null),
  /**
   * 15.12: the routing rule the manager said this step followed, as the rule read when the plan was made (its id and text), or `null`. Kept
   * with the step, so deleting or changing the rule later does not change what the plan said. A suggestion the person can see, never a rule
   * Ogden enforces.
   */
  rule: z.object({ id: RoutingRuleId, text: line(ROUTING_LIMITS.maxRuleChars) }).nullable().default(null),
});
export type OrchestrationStep = z.infer<typeof OrchestrationStep>;

// ---- settings and the one route ----

/**
 * Where the project's manager stands (15.4): `ready` (a model on an endpoint that is set up and, when it is on
 * another computer, confirmed), or why not. Plain words come from {@link MANAGER_STATE_WORDS}.
 */
export const MANAGER_STATES = ['ready', 'not_chosen', 'endpoint_missing', 'host_not_confirmed', 'test_failed'] as const;
export const ManagerState = z.enum(MANAGER_STATES);
export type ManagerState = z.infer<typeof ManagerState>;

export const MANAGER_STATE_WORDS: Readonly<Record<Exclude<ManagerState, 'ready'>, string>> = {
  not_chosen: "No manager is chosen yet. Choose a model for the manager in this project's settings.",
  endpoint_missing: "The server you chose for the manager is not set up any more. Choose a model for the manager again in this project's settings.",
  host_not_confirmed: 'You have not confirmed the server the manager runs on. Confirm it in Settings, under Agents, and try again.',
  test_failed: 'The manager model did not pass Test as a manager. Choose another model in this project\'s settings, or test it again in Settings, under Agents.',
};

/** The manager's state with the sentence to show. */
export const ManagerStatusView = z.object({
  state: ManagerState,
  /** Plain words. For `ready` it says where the manager runs (this computer or another one). */
  message: z.string().min(1).max(400),
});
export type ManagerStatusView = z.infer<typeof ManagerStatusView>;

/** A project's orchestration settings as read: the mode, the limits in force and the roster. */
export const OrchestrationSettings = z.object({
  mode: OrchestrationMode,
  limits: RunLimits,
  roster: TeamRoster,
  /** Whether a manager is ready for this project. Absent from older servers; read as not ready. */
  managerReady: z.boolean().optional(),
  /** Which state the project's manager is in, in plain words (15.4). Absent from older servers. */
  manager: ManagerStatusView.optional(),
});
export type OrchestrationSettings = z.infer<typeof OrchestrationSettings>;

/** `GET /api/v1/workspaces/:wsId/orchestration`: 409 `feature_off` while the Orchestration piece is off. */
export const OrchestrationSettingsResponse = z.object({ settings: OrchestrationSettings });
export type OrchestrationSettingsResponse = z.infer<typeof OrchestrationSettingsResponse>;

// ---- routing rules (15.12) ----

/** One rule as the project keeps it: its id and the person's sentence. */
export const RoutingRule = z.object({ id: RoutingRuleId, text: line(ROUTING_LIMITS.maxRuleChars) });
export type RoutingRule = z.infer<typeof RoutingRule>;

/** A project's rules, in the order the person put them, at most {@link ROUTING_LIMITS}. */
export const RoutingRules = z.array(RoutingRule).max(ROUTING_LIMITS.maxRules);
export type RoutingRules = z.infer<typeof RoutingRules>;

/** `GET` and `PUT /api/v1/workspaces/:wsId/orchestration/routing`: the rules, and the caps the screen shows. */
export const OrchestrationRoutingResponse = z.object({ rules: RoutingRules, maxRules: z.number().int(), maxRuleChars: z.number().int() });
export type OrchestrationRoutingResponse = z.infer<typeof OrchestrationRoutingResponse>;

/**
 * `PUT` body: the whole list in the order wanted. An item with the `id` of a rule the project has keeps that rule's id; any other item is a
 * new rule and gets one. Core holds each text to the rules (one clean line, no secret) and answers in plain words.
 */
export const SetOrchestrationRoutingRequest = z.object({ rules: z.array(z.object({ id: z.string().max(20).optional(), text: z.string().max(2_000) })).max(50) });
export type SetOrchestrationRoutingRequest = z.infer<typeof SetOrchestrationRoutingRequest>;

export const ORCHESTRATION_ROUTING_WORDS = {
  intro: 'Write, in plain words, which kind of work should go to which worker, for example "tests go to the first agent" or "reviews go to a different agent". The manager reads them as your wishes and may follow them. They are suggestions only: they never give a worker anything the team, its terms or the mode do not already allow, and you still approve every step.',
  none: 'No rules yet. The manager chooses on its own.',
  tooMany: `A project can have at most ${ROUTING_LIMITS.maxRules} rules. Take one out first.`,
  tooLong: `A rule can be at most ${ROUTING_LIMITS.maxRuleChars} characters.`,
  badText: 'A rule needs plain text on one line, with no hidden or control characters.',
  secret: 'That text looks like it holds a key or a secret. Take it out and try again.',
  followed: 'Followed your rule',
} as const;

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
/**
 * Where the person looks at the result a review step is about (15.10): epic 5's review page when the reviewed step's chat is a build run
 * (they approve and merge there, never from here), otherwise the worker chat that did the reviewed step.
 */
export const OrchestrationReviewTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('build_review'), ticketRef: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('worker_chat'), sessionId: SessionId }),
]);
export type OrchestrationReviewTarget = z.infer<typeof OrchestrationReviewTarget>;

/**
 * How a build step's run stands, read from the run (15.11): its outcome and what the person decided on the review page, and the counts of
 * the end checks. Never a diff or a file.
 */
export const OrchestrationBuildRunView = z.object({
  runId: RunId,
  outcome: RunOutcome,
  decision: RunDecision.nullable(),
  checks: z.object({ passed: z.number().int().min(0), failed: z.number().int().min(0), notRun: z.number().int().min(0) }).nullable(),
});
export type OrchestrationBuildRunView = z.infer<typeof OrchestrationBuildRunView>;

export const OrchestrationStepView = OrchestrationStep.extend({
  /** For a build step whose build was started: the run as it stands now (15.11). */
  buildRun: OrchestrationBuildRunView.nullable().optional(),
  /** For a review step whose reviewed step was sent: where to look at that result (15.10). */
  review: OrchestrationReviewTarget.nullable().optional(),
  /** The worker's name as the user knows it. */
  workerLabel: z.string(),
  /** The worker chat's normalized state, once the instruction was sent. */
  sessionState: SessionState.nullable(),
  /** A capped, secret-masked summary of the worker's last reply, once it was sent. */
  report: ManagerStatusReport.nullable(),
});
export type OrchestrationStepView = z.infer<typeof OrchestrationStepView>;

/**
 * What the manager decided last (15.9), as the page shows it: its action (or `unavailable` when it gave none), its masked reason, the step it
 * suggests, the question it asks, and `told` when it was only told what happened (a Deny or a refused dispatch) after the run had stopped.
 */
export const DECISION_OUTCOMES = [...DECISION_ACTIONS, 'unavailable'] as const;
export const DecisionOutcome = z.enum(DECISION_OUTCOMES);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;
export const OrchestrationDecisionView = z.object({
  action: DecisionOutcome,
  reason: z.string().min(1).max(400),
  stepId: ManagerStepId.optional(),
  question: z.string().max(MANAGER_LIMITS.maxQuestionChars).optional(),
  told: z.enum(['denied', 'refused']).optional(),
  at: IsoUtcTimestamp,
});
export type OrchestrationDecisionView = z.infer<typeof OrchestrationDecisionView>;

/**
 * Why a live run is waiting, plainly (15.9): a worker's permission card nobody has answered (the user answers on the worker's own card),
 * a question from the manager, or a worker the restart cut off in the middle of its turn.
 */
export const OrchestrationWaiting = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('permission_card'), stepId: ManagerStepId, sessionId: SessionId }),
  z.object({ kind: z.literal('question'), question: z.string().min(1).max(MANAGER_LIMITS.maxQuestionChars) }),
  z.object({ kind: z.literal('interrupted'), stepId: ManagerStepId, sessionId: SessionId }),
  /** 15.11: an automatic run is at a proposed build, which only the person starts, in the Build dialog. */
  z.object({ kind: z.literal('build'), stepId: ManagerStepId, ticketRef: ManagerBuildTicket }),
]);
export type OrchestrationWaiting = z.infer<typeof OrchestrationWaiting>;

export const OrchestrationRunView = z.object({
  run: OrchestrationRun,
  steps: z.array(OrchestrationStepView),
  /** Why the run waits, when it does (15.9). Absent from older servers. */
  waiting: OrchestrationWaiting.nullable().optional(),
  /** The manager's latest decision after the latest result (15.9), or what it said when told of a Deny or a refusal. */
  decision: OrchestrationDecisionView.nullable().optional(),
  /** The manager is working out the next decision right now (15.9); the user may still act meanwhile. */
  thinking: z.boolean().optional(),
});
export type OrchestrationRunView = z.infer<typeof OrchestrationRunView>;

/** `POST …/orchestration/runs`, `GET …/runs/:runId` and each step action. */
export const OrchestrationRunResponse = z.object({ run: OrchestrationRunView });
export type OrchestrationRunResponse = z.infer<typeof OrchestrationRunResponse>;

/** `GET …/orchestration/runs`: the project's runs, newest first (at most {@link ORCHESTRATION_RUNS_PAGE}). */
export const OrchestrationRunsResponse = z.object({ runs: z.array(OrchestrationRunView) });
export type OrchestrationRunsResponse = z.infer<typeof OrchestrationRunsResponse>;
export const ORCHESTRATION_RUNS_PAGE = 20;

/** Plain words for the tracer's states and refusals. No dashes. */
export const ORCHESTRATION_NO_MANAGER_MESSAGE = MANAGER_STATE_WORDS.not_chosen;
export const ORCHESTRATION_STEP_NOT_APPROVED_MESSAGE = 'This instruction has not been approved, so it was not sent.';
export const ORCHESTRATION_STEP_NOT_PROPOSED_MESSAGE = 'This instruction is not waiting for your approval, or a step it needs is not finished yet.';
export const ORCHESTRATION_MANAGER_MARK = 'Sent by the manager, approved by you';

// ---- the plan review (15.6) ----

/** What the user types to change an instruction. The same text rules as a manager's instruction apply, and a secret in it is refused. */
export const EditOrchestrationStepRequest = z.object({
  instruction: z
    .string()
    .transform((text) => text.replace(/\r\n?/g, '\n').trim())
    .pipe(ManagerInstruction),
});
export type EditOrchestrationStepRequest = z.infer<typeof EditOrchestrationStepRequest>;

/** The whole new order of the plan's steps, by step id: every step once. */
export const ReorderOrchestrationStepsRequest = z.object({ order: z.array(ManagerStepId).min(1).max(MANAGER_LIMITS.maxSteps) });
export type ReorderOrchestrationStepsRequest = z.infer<typeof ReorderOrchestrationStepsRequest>;

/** Plain words for the plan review's refusals. No dashes. */
export const ORCHESTRATION_STEP_NOT_CHANGEABLE_MESSAGE = 'This step cannot be changed any more. It was already sent, finished or skipped, or the run has ended.';
export const ORCHESTRATION_RUN_NOT_OPEN_MESSAGE = 'This run has already ended.';
export const ORCHESTRATION_EDIT_SECRET_MESSAGE = 'That text looks like it holds a key or a secret. Take it out and try again.';
export const ORCHESTRATION_EDIT_BAD_TEXT_MESSAGE = 'That text is empty, too long, or has characters that are not allowed.';
export const ORCHESTRATION_ORDER_WORDS = {
  not_every_step: 'The new order must list every step once.',
  sent_step_moved: 'A step that was already sent cannot move.',
  prerequisite: (step: string, needs: string): string => `Step ${step} needs step ${needs} first, so it cannot come before it.`,
} as const;

// ---- dispatch refusals and the worker's terms (15.7) ----

/**
 * Why an approved instruction was not sent. Each is checked in code before any chat is made, so a refusal
 * leaves every chat as it was. The manager is told the same plain words as a result (`dispatch_refused`).
 */
export const DISPATCH_REFUSAL_REASONS = [
  'worker_not_on_team',
  'worker_not_ready',
  'worker_signed_out',
  'trust_not_given',
  'interactive_only',
  'approve_each_only',
  'not_the_reviewer',
  'chat_gone',
  'chat_not_a_chat',
  'chat_other_agent',
  'chat_busy',
  'driver_is_terminal',
] as const;
export const DispatchRefusalReason = z.enum(DISPATCH_REFUSAL_REASONS);
export type DispatchRefusalReason = z.infer<typeof DispatchRefusalReason>;

/** The plain words for each refusal, naming the worker the user knows. No dashes. */
export const dispatchRefusalWords = (reason: DispatchRefusalReason, worker: string): string => {
  switch (reason) {
    case 'worker_not_on_team':
      return `${worker} is not on this project's team any more, so the instruction was not sent. Choose a worker in the project settings under Orchestration.`;
    case 'worker_not_ready':
      return `${worker} is not ready, so the instruction was not sent.`;
    case 'worker_signed_out':
      return `${worker} is signed out, so the instruction was not sent. Sign in to ${worker} in Settings, under Agents.`;
    case 'trust_not_given':
      return `You have not trusted this project for ${worker}, so the instruction was not sent. Trust the project first.`;
    case 'interactive_only':
      return `${worker} is never given instructions by a manager, so nothing was sent.`;
    case 'approve_each_only':
      return `${worker} signs in with your account, so it only takes instructions you approve one by one. Nothing was sent.`;
    case 'not_the_reviewer':
      return `${worker} is not this project's reviewer for this step any more, so the question was not sent. Check the reviewer in the project settings under Orchestration.`;
    case 'chat_gone':
      return 'The chat this step names is not in this project any more, so nothing was sent.';
    case 'chat_not_a_chat':
      return 'The step names something that is not an ordinary chat, so nothing was sent.';
    case 'chat_other_agent':
      return `The chat this step names is not one of ${worker}'s, so nothing was sent.`;
    case 'chat_busy':
      return `The chat this step names is busy or finished, so nothing was sent. It must be idle to take an instruction.`;
    case 'driver_is_terminal':
      return 'The terminal is driving the chat this step names, so nothing was sent. Switch the chat back to the chat view first.';
  }
};

// ---- the mode, the confirmation, the limits and the activity log (15.8) ----

/** What the user is asked, once for a project, before it may dispatch automatically. Plain words, no dashes. */
export const ORCHESTRATION_AUTOMATIC_CONFIRM_TITLE = 'Dispatch automatically in this project?';
export const ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS =
  'The manager will send each instruction to your agents on its own, without asking you each time. It stops at the first problem, when it reaches the limits below, or when you press Stop. Your agents still ask you before they run a command or change a file. An agent that signs in with your account, or a chat that runs without asking you first, still waits for you to approve each instruction. You will not be asked again in this project.';
export const ORCHESTRATION_AUTOMATIC_CONFIRM_BUTTON = 'Dispatch automatically';

/** A new project starts on Approve each instruction whatever the install default says, until the user confirms automatic for that project. */
export const ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE =
  'New projects are set to dispatch automatically by default, but each project starts on Approve each instruction until you confirm Dispatch automatically for it here.';

/** The install's default for new projects' mode, and the limits of every run (15.8). Install-level, kept beside the defaults for new projects. */
export const OrchestrationDefaults = z.object({ mode: OrchestrationMode, limits: RunLimits });
export type OrchestrationDefaults = z.infer<typeof OrchestrationDefaults>;
export const OrchestrationDefaultsResponse = z.object({ defaults: OrchestrationDefaults });
export type OrchestrationDefaultsResponse = z.infer<typeof OrchestrationDefaultsResponse>;

/**
 * `PUT /api/v1/settings/orchestration`: the default mode and/or the limits. Making Dispatch automatically the default needs
 * `confirm: true` (`confirmation_required`) every time it is set, and a limit outside its bounds is refused (400). What is left out is kept.
 */
export const UpdateOrchestrationDefaultsRequest = z
  .strictObject({
    mode: OrchestrationMode.optional(),
    limits: BoundedRunLimits.partial().optional(),
    confirm: z.boolean().optional(),
  })
  .refine((request) => request.mode !== undefined || (request.limits !== undefined && Object.keys(request.limits).length > 0), 'Choose a setting to change.');
export type UpdateOrchestrationDefaultsRequest = z.infer<typeof UpdateOrchestrationDefaultsRequest>;

/** The plain sentence for a stop reason (what the page says when a run has ended without finishing). No dashes. */
export function orchestrationStopWords(reason: OrchestrationStopReason, limits: RunLimits): string {
  switch (reason) {
    case 'user':
      return 'You stopped this run. Nothing more will be approved or sent. A worker that was in the middle of a turn was asked to stop; its chat is still there.';
    case 'instruction_limit':
      return `The run stopped because it sent ${limits.maxInstructions} instructions, the limit. Nothing more was sent.`;
    case 'depth_limit':
      return `The run stopped before a step that is more than ${limits.maxDepth} steps deep, the limit. Nothing more was sent.`;
    case 'time_limit':
      return `The run stopped because it ran for ${limits.maxMinutes} minutes, the limit. Nothing more was sent, and a worker still going was asked to stop.`;
    case 'manager_refused':
      return 'The manager did not give a usable plan, so the run stopped.';
    case 'worker_error':
      return 'A worker hit an error, so the run stopped.';
    case 'permission_denied':
      return "A permission request in a worker's chat was denied, so that step ended and the run stopped. The manager was told.";
    case 'dispatch_refused':
      return 'The run stopped because an instruction could not be sent. The activity log says why. The manager was told.';
    case 'manager_stopped':
      return 'The manager decided to stop the run. Nothing more was sent.';
    case 'restarted':
      return 'Ogden Agents was restarted while the manager was making the plan, so the run stopped. Start it again.';
  }
}

/** What a step that waits for the user in a run that dispatches automatically says: its agent signs in with the user's account, or its chat runs without asking. */
export const ORCHESTRATION_NEEDS_YOUR_APPROVAL = 'This step needs your approval before it is sent: its agent signs in with your account, or its chat runs without asking you first. The run waits for you.';

/** What the transcript says under an instruction the mode sent on its own (the user did not approve that one). */
export const ORCHESTRATION_MANAGER_AUTO_MARK = 'Sent by the manager automatically';

/** One line of the activity log (15.8), read from the events: an instruction that was sent, or one that was refused. */
export const OrchestrationActivityEntry = z.object({
  at: IsoUtcTimestamp,
  runId: OrchestrationRunId,
  stepId: ManagerStepId,
  kind: z.enum(['sent', 'refused']),
  worker: AgentId,
  workerLabel: z.string().min(1).max(120),
  /** The chat it was sent to; null for a refused one. */
  sessionId: SessionId.nullable(),
  /** Whether it went to a chat made for it, or to one the plan named. */
  chat: z.enum(['new', 'existing']),
  /** Who approved it: the user, or the mode. Null for a refused one. */
  approvedBy: Approver.nullable(),
  /** The start of the instruction, masked. */
  instruction: z.string().max(200),
  /** Where it stands: sent and the worker is on it, finished, failed, refused or stopped. */
  result: z.enum(['working', 'finished', 'failed', 'refused', 'stopped', 'denied']),
  /** Plain words: why it was refused, or the start of the worker's reply (masked). Empty when there is nothing to say. */
  note: z.string().max(300),
});
export type OrchestrationActivityEntry = z.infer<typeof OrchestrationActivityEntry>;

/** `GET /api/v1/workspaces/:wsId/orchestration/activity`: the newest entries first, with the run's instruction counter (no money anywhere). */
export const OrchestrationActivityResponse = z.object({
  entries: z.array(OrchestrationActivityEntry),
});
export type OrchestrationActivityResponse = z.infer<typeof OrchestrationActivityResponse>;
export const ORCHESTRATION_ACTIVITY_PAGE = 100;

// ---- the loop (15.9) ----

/** What the user types to answer the manager's question: a sentence or two, folded to one line. Masked and kept as data for the manager. */
export const AnswerOrchestrationQuestionRequest = z.object({
  answer: z
    .string()
    .transform((text) => text.replace(/\s+/g, ' ').trim())
    .pipe(line(MANAGER_LIMITS.maxGoalChars)),
});
export type AnswerOrchestrationQuestionRequest = z.infer<typeof AnswerOrchestrationQuestionRequest>;

export const ORCHESTRATION_NO_QUESTION_MESSAGE = 'The manager is not asking you anything right now.';
export const ORCHESTRATION_ANSWER_BAD_TEXT_MESSAGE = 'Write your answer in a sentence or two, up to 500 characters.';
export const ORCHESTRATION_ANSWER_SECRET_MESSAGE = ORCHESTRATION_EDIT_SECRET_MESSAGE;

/** What the page says while a worker's permission card waits: the user answers on the worker's own card, never here. */
export const ORCHESTRATION_WAITING_CARD_WORDS = "A worker is waiting for your answer on its permission card, so the run is paused. Answer the card in the worker's chat and the run goes on.";
export const ORCHESTRATION_WAITING_INTERRUPTED_WORDS = 'Ogden Agents was restarted while a worker was in the middle of its turn. Nothing was sent again. Open its chat to let it continue, or stop the run.';
/** What the page says when the manager gave no usable next decision and the run waits for the user's own pick. */
export const ORCHESTRATION_DECISION_UNAVAILABLE_WORDS = 'The manager could not suggest the next step, so the choice is yours.';

/** What the told manager's reply is shown as, when the run had already stopped. */
export const ORCHESTRATION_TOLD_WORDS = { denied: 'The manager was told the permission was denied.', refused: 'The manager was told the instruction could not be sent.' } as const;

/** What a worker's summary says for a step a Deny or a refusal ended: Ogden's own words, handed to the manager as the step's result. */
export const ORCHESTRATION_DENIED_RESULT = 'Ogden: the user denied a permission request for this step, so the step ended before it finished.';
export const orchestrationRefusedResult = (words: string): string => `Ogden: the instruction was not sent. ${words}`;
