/**
 * The Orchestration use-case, tracer bullet (epic 15, story 15.3): the thinnest
 * path from a goal to a worker's chat and back.
 *
 * - {@link Orchestration.startRun}: the goal goes to the manager
 *   ({@link ManagerPort.proposePlan}); its validated plan is stored as
 *   `proposed` steps and the run waits for the user.
 * - {@link Orchestration.approveStep}: only the user's call approves a step
 *   (`approvedBy: user`); the manager never does.
 * - {@link Orchestration.dispatchStep}: refused in code (`StepNotApprovedError`)
 *   unless the step was approved. An approved instruction is sent through the
 *   chat's own `sendMessage` into a new worker chat, created with the worker's
 *   own default mode (never changed here), and marked in its transcript as
 *   sent by the manager (`origin: manager`).
 * - {@link Orchestration.getRun}: the stored run and, for each dispatched step,
 *   the worker chat's normalized state and a capped, masked report
 *   ({@link makeStatusReport}); the first read that finds the chat done or
 *   failed settles the step and appends `orchestration.result_read` once.
 *
 * Every use here calls core's Orchestration guard first. The roster (the
 * agents the install reports ready), the mode (approve each) and the limits
 * ({@link RUN_LIMITS}) are fixed in code for now; entries 5 to 9 replace
 * them, and the limits are not enforced yet. A manager's text is masked
 * before it is stored, evented or sent. The manager is a port; this file
 * names no model product and imports no shell, file or credential port.
 */
import {
  DEFAULT_ORCHESTRATION_MODE,
  type OrchestrationMode,
  MAX_PAGE_EVENTS,
  ORCHESTRATION_RUNS_PAGE,
  OrchestrationRunId as OrchestrationRunIdSchema,
  ManagerStepId,
  OrchestrationRun,
  OrchestrationStep,
  OrchestrationStepView,
  OrchestrationRunView,
  OrchestrationActivityEntry,
  ORCHESTRATION_ACTIVITY_PAGE,
  RunLimits as RunLimitsSchema,
  RUN_LIMITS,
  stepDepths,
  AnswerOrchestrationQuestionRequest,
  ORCHESTRATION_ANSWER_BAD_TEXT_MESSAGE,
  ORCHESTRATION_ANSWER_SECRET_MESSAGE,
  ORCHESTRATION_DENIED_RESULT,
  orchestrationRefusedResult,
  OrchestrationDecisionView,
  OrchestrationWaiting,
  MANAGER_PLAN_VERSION,
  type DecisionOutcome,
  StartOrchestrationRunRequest,
  EditOrchestrationStepRequest,
  ReorderOrchestrationStepsRequest,
  ORCHESTRATION_EDIT_BAD_TEXT_MESSAGE,
  ORCHESTRATION_EDIT_SECRET_MESSAGE,
  ORCHESTRATION_ORDER_WORDS,
  isRunOver,
  canMoveRun,
  canMoveStep,
  makeStatusReport,
  ManagerStatusReport as ManagerStatusReportSchema,
  redactSecrets,
  dispatchRefusalWords,
  type DispatchRefusalReason,
  MANAGER_LIMITS,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  ORCHESTRATION_REVIEW_QUESTION_TOO_LONG_MESSAGE,
  REVIEW_LIMITS,
  buildReviewMessage,
  buildSummaryText,
  blockedSentence,
  CHECKPOINT_BLOCKED_CODES,
  isManagerBuildStep,
  isReviewMessageFor,
  LinkOrchestrationBuildRequest,
  ORCHESTRATION_BUILD_WORKER,
  ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE,
  type OrchestrationBuildRunView,
  type ManagerAnyStep,
  type RoutingRule,
  type OrchestrationReviewTarget,
  type ManagerStatusView,
  type ManagerDecision,
  type ManagerPlan,
  type ManagerStatusReport,
  type OrchestrationRunState,
  type OrchestrationStopReason,
  type OrchestrationStepState,
  type RunLimits,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { events as eventsTable, orchestrationRuns, orchestrationSteps, runs as runsTable } from './db/schema.js';
import { readAutomaticConfirmed, readDefaultPermissionMode, readOrchestrationMode } from './workspace-settings.js';
import { AgentNotReadyError, BadOrderError, DispatchRefusedError, DriverIsTerminalError, ManagerFailedError, ManagerUnavailableError, NoQuestionPendingError, NotFoundError, OrchestrationOffError, QueueFullError, RunNotOpenError, SessionBusyError, SessionNotIdleError, StepNotApprovedError, StepNotChangeableError, StepNotProposedError, UnknownAgentError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { OrchestrationFeature } from './orchestration-feature.js';
import { cleanForManager } from './manager-input.js';
import { checkRoutingRequest, readRoutingRules, sameRules, writeRoutingRules } from './orchestration-routing.js';
import { dispatchableSteps, MANAGER_FAILURE_WORDS, type ManagerContext, type ManagerDecisionContext, type ManagerPort, type ManagerRecord } from './manager-port.js';
import { RESTARTED_REASON } from './chat/constants.js';
import type { ManagerSource } from './manager-source.js';
import { isSubscription, type Team } from './team-roster.js';
import type { Chat } from './chat/types.js';
import { newId } from './ids.js';
import type { BuildableTickets } from './orchestration-builds.js';

/** What the use-case needs of the chat: the same calls the chat page makes, nothing else. */
export type OrchestrationChat = Pick<Chat, 'chatAgents' | 'createChatSession' | 'sendMessage' | 'getSession' | 'listSessions' | 'renameSession' | 'removeQueuedMessage' | 'cancel'>;

export interface Orchestration {
  /** Where the project's manager stands, in plain words: ready, or why not (15.4). */
  managerStatus(workspaceId: WorkspaceId): ManagerStatusView;
  /**
   * Starts a run from the user's goal (`StartOrchestrationRunRequest`): asks the
   * manager for a plan and stores it as proposed steps. {@link ValidationError}
   * for a bad goal, {@link ManagerUnavailableError} with no manager (nothing stored),
   * {@link ManagerFailedError} when it gave no usable plan (the run is kept, failed).
   */
  startRun(workspaceId: WorkspaceId, request: unknown): Promise<OrchestrationRunView>;
  /** The project's runs, newest first. */
  listRuns(workspaceId: WorkspaceId): Promise<OrchestrationRunView[]>;
  /** One run of the project, its steps read back. {@link NotFoundError} for another project's or an unknown run. */
  getRun(workspaceId: WorkspaceId, runId: string): Promise<OrchestrationRunView>;
  /** The user approves one proposed step whose needed steps are done. {@link StepNotProposedError} otherwise. */
  approveStep(workspaceId: WorkspaceId, runId: string, stepId: string, expectedInstruction?: string): Promise<OrchestrationRunView>;
  /**
   * The user changes a waiting or approved step's instruction (15.6). The text passes the manager's text rules and holds no
   * secret ({@link ValidationError}); the step is back to waiting, so it needs a fresh approval. {@link StepNotChangeableError}
   * once it was sent, finished or skipped or the run ended. The same text is no change.
   */
  editStep(workspaceId: WorkspaceId, runId: string, stepId: string, request: unknown): Promise<OrchestrationRunView>;
  /** The user skips a waiting or approved step (15.6): it is never sent and the steps that need it wait. {@link StepNotChangeableError} otherwise. */
  skipStep(workspaceId: WorkspaceId, runId: string, stepId: string): Promise<OrchestrationRunView>;
  /**
   * The user puts the steps in a new order (15.6): every step once, each after its prerequisites, steps already sent where they
   * are. {@link BadOrderError} (plain reason) otherwise and nothing changes; {@link RunNotOpenError} for an ended run.
   */
  reorderSteps(workspaceId: WorkspaceId, runId: string, request: unknown): Promise<OrchestrationRunView>;
  /**
   * Stop (15.6): the run ends `stopped` (reason `user`); nothing more is approved, edited or sent, a manager call in flight is
   * abandoned and a worker turn in flight is cancelled. {@link RunNotOpenError} for a run that already ended.
   */
  stopRun(workspaceId: WorkspaceId, runId: string): Promise<OrchestrationRunView>;
  /**
   * Sends an approved step's instruction into a new worker chat, or into the worker's own idle chat the step names (15.7).
   * {@link StepNotApprovedError} for any step not approved, and {@link DispatchRefusedError} (plain words, a reason token) when the
   * worker or the chat cannot take it: both before anything is created or sent, so every chat is as it was.
   */
  dispatchStep(workspaceId: WorkspaceId, runId: string, stepId: string): Promise<OrchestrationRunView>;
  /**
   * Every instruction that was sent or refused in the project, newest first, read from the events (15.8): who approved it, which worker and
   * chat, when, and how it stands. No money, only what was sent.
   */
  activity(workspaceId: WorkspaceId): Promise<OrchestrationActivityEntry[]>;
  /**
   * The user tells the plan which build the Build dialog started for a build step (15.11). Starts nothing: the build already exists. The run
   * must be a build of the step's ticket in this project, started after this orchestration run began and not linked to another step
   * ({@link ValidationError} otherwise); the step must still be waiting with what it needs done ({@link StepNotProposedError}) in an open run
   * ({@link RunNotOpenError}). From then on the step follows the build run.
   */
  linkBuild(workspaceId: WorkspaceId, runId: string, stepId: string, request: unknown): Promise<OrchestrationRunView>;
  /**
   * The project's routing rules (15.12): the person's plain sentences about which kind of work goes to which worker, in their order, each
   * with the id a plan names when a step followed it.
   */
  getRouting(workspaceId: WorkspaceId): RoutingRule[];
  /**
   * The person saves the whole list of rules (15.12). At most 10, each one clean line of at most
   * 300 characters holding no secret ({@link ValidationError} in plain words otherwise, nothing stored).
   * Items that name an existing rule's id keep it; the rest are new rules. A change appends `orchestration.routing_changed` (ids only).
   * Deleting a rule takes it out of the next manager input. Returns the rules as stored.
   */
  setRouting(workspaceId: WorkspaceId, request: unknown): RoutingRule[];
  /**
   * The user answers the manager's question (15.9). The answer is masked, kept as `orchestration.question_answered` and goes to the manager
   * as data with the next decision. {@link NoQuestionPendingError} when the run is not waiting for an answer, {@link RunNotOpenError} for an
   * ended run, {@link ValidationError} for bad text or a secret.
   */
  answerQuestion(workspaceId: WorkspaceId, runId: string, request: unknown): Promise<OrchestrationRunView>;
  /**
   * Picks up every open run from its rows and events after a start (15.9): a run that was making its plan is closed (`restarted`), the
   * others re-arm (the time limit counts from the run's start), settle what finished, ask for a decision that was owed, and never send
   * an instruction that was already sent. Returns how many runs were picked up. The server calls it once, after it has its chat.
   */
  resume(): Promise<number>;
  /**
   * Resolves when no automatic dispatch is pending (15.8). A test awaits it after a worker finishes; the server never needs it.
   */
  whenIdle(): Promise<void>;
}

export interface OrchestrationOptions {
  db: Pick<Database, 'orm'>;
  events: EventLog;
  feature: OrchestrationFeature;
  chat: OrchestrationChat;
  /** A manager used for every project (a test's stub). It wins over {@link managers}. */
  manager?: ManagerPort | undefined;
  /** The manager of each project, read from its roster (the real one, 15.4). Absent with no `manager`: no project has one. */
  managers?: ManagerSource | undefined;
  /** The project's team roster (15.5): the manager addresses only its rostered workers. Absent: every agent the install lists. */
  team?: Team | undefined;
  /** The limits a new run is given (15.8: the install's setting). Absent: {@link RUN_LIMITS}. */
  limits?: (() => RunLimits) | undefined;
  /** The time in milliseconds, for a run's time limit (a test's fake clock). Absent: the real clock. */
  clock?: (() => number) | undefined;
  /** The board's tickets ready to build now (15.11), a read only list. Absent: none, so the manager cannot propose a build. */
  buildable?: BuildableTickets | undefined;
  /** The agent id builds run on (15.11), from the server's wiring: core names none. Used to name a build step's worker and to keep a build's reviewer another agent. */
  builder?: string | undefined;
}

/** The words when the project's team has no worker that can be given an instruction now. */
export const NO_READY_WORKER = 'No worker on this project\'s team is ready. Choose a worker, or sign in to one, in the project settings under Orchestration.';

/** How much of a session's newest events are read for its last reply. */
const REPLY_WINDOW = Math.min(MAX_PAGE_EVENTS, 500);
/** How many tool calls the read-back names, and the most characters of them. */
const TOOL_CALLS_SHOWN = 10;
const TOOL_CALLS_CHARS = 800;
/** How many of a worker's own idle chats the manager is told about. */
const CHATS_OFFERED = 5;

/** The refusal for an agent the install says cannot start a chat now. */
const reasonOf = (code: string): DispatchRefusalReason => (code === 'agent_signed_out' ? 'worker_signed_out' : code === 'project_not_trusted' ? 'trust_not_given' : 'worker_not_ready');

const isOpen = (state: string): boolean => state === 'awaiting_user' || state === 'running';
/** A run the user may still change (edit, skip, reorder): open, or paused for a card. */
const isLive = (state: string): boolean => isOpen(state) || state === 'paused';

type RunRow = typeof orchestrationRuns.$inferSelect;
type StepRow = typeof orchestrationSteps.$inferSelect;

const runOf = (row: RunRow): OrchestrationRun =>
  OrchestrationRun.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    goal: row.goal,
    state: row.state,
    mode: row.mode,
    limits: JSON.parse(row.limits) as unknown,
    stopReason: row.stopReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const stepOf = (row: StepRow): OrchestrationStep =>
  OrchestrationStep.parse({
    runId: row.runId,
    stepId: row.stepId,
    position: row.position,
    worker: row.worker,
    chat: row.chat,
    instruction: row.instruction,
    dependsOn: JSON.parse(row.dependsOn) as unknown,
    state: row.state,
    approvedBy: row.approvedBy,
    sessionId: row.sessionId,
    reviewOf: row.reviewOf,
    build: row.buildRef === null ? null : { ticketRef: row.buildRef, runId: row.buildRunId },
    rule: row.ruleId === null || row.ruleText === null ? null : { id: row.ruleId, text: row.ruleText },
  });

/** Whether `content` is the instruction a step sent: the text itself, or for a review step the message core built from its question. */
const sentAs = (content: string, instruction: string, reviewed: boolean): boolean => content === instruction || (reviewed && isReviewMessageFor(content, instruction.slice(0, REVIEW_LIMITS.maxQuestionChars)));

export function createOrchestration({ db, events, feature, chat, manager: fixedManager, managers, team, limits: runLimits, clock, buildable, builder }: OrchestrationOptions): Orchestration {
  const { orm } = db;
  const nowMs = clock ?? Date.now;
  const now = () => new Date(nowMs()).toISOString();
  /** Steps being sent right now: a second dispatch of the same step is refused, not raced. */
  const sending = new Set<string>();
  /** The manager call of each run still planning, so Stop can abandon it. */
  const planning = new Map<string, AbortController>();

  const requireRun = (workspaceId: WorkspaceId, runId: string): RunRow => {
    const id = OrchestrationRunIdSchema.safeParse(runId);
    const row = id.success ? orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, id.data)).get() : undefined;
    if (row === undefined || row.workspaceId !== workspaceId) throw new NotFoundError('orchestration run', runId);
    return row;
  };
  const requireStep = (runId: string, stepId: string): StepRow => {
    const id = ManagerStepId.safeParse(stepId);
    const row = id.success ? orm.select().from(orchestrationSteps).where(and(eq(orchestrationSteps.runId, runId), eq(orchestrationSteps.stepId, id.data))).get() : undefined;
    if (row === undefined) throw new NotFoundError('orchestration step', stepId);
    return row;
  };
  const stepsOf = (runId: string): StepRow[] => orm.select().from(orchestrationSteps).where(eq(orchestrationSteps.runId, runId)).orderBy(orchestrationSteps.position).all();

  /** Moves a run to `to` when the transition table allows it (the same state is no move). */
  const moveRun = (runId: string, to: OrchestrationRunState, stopReason?: OrchestrationRun['stopReason']): void => {
    const row = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).get();
    if (row === undefined || row.state === to) return;
    // A paused run has no way to `finished`: it is waiting again first (the worker's card was answered, so it is not paused any more).
    if (row.state === 'paused' && to === 'finished') {
      orm.update(orchestrationRuns).set({ state: 'awaiting_user', updatedAt: now() }).where(eq(orchestrationRuns.id, runId)).run();
      row.state = 'awaiting_user';
    }
    if (!canMoveRun(row.state as OrchestrationRunState, to)) return;
    orm.update(orchestrationRuns).set({ state: to, stopReason: stopReason ?? row.stopReason, updatedAt: now() }).where(eq(orchestrationRuns.id, runId)).run();
  };

  /**
   * The run with its mode brought to the project's own (15.8): the mode is the project's setting, read at each use, so switching it
   * back mid-run takes effect on the next step. Back to Approve each instruction, a step the mode approved but did not send waits for
   * the user again. `orchestration.mode_changed` records it. A run that is over keeps the mode it ended under.
   */
  const syncMode = (workspaceId: WorkspaceId, run: RunRow): RunRow => {
    const fresh = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get() ?? run;
    if (isRunOver(fresh.state as OrchestrationRunState)) return fresh;
    const projectMode = projectModeOf(workspaceId);
    /** In the default mode only the user approves: what the mode approved and did not send waits for the user again (whatever left it so). */
    const returnToUser = (): void => {
      for (const step of stepsOf(run.id)) {
        if (step.state === 'approved' && step.approvedBy === 'mode') orm.update(orchestrationSteps).set({ state: 'proposed', approvedBy: null }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
      }
    };
    if (projectMode === fresh.mode) {
      if (projectMode === 'approve_each' && stepsOf(run.id).some((step) => step.state === 'approved' && step.approvedBy === 'mode')) events.transaction(returnToUser);
      return fresh;
    }
    events.transaction(() => {
      orm.update(orchestrationRuns).set({ mode: projectMode, updatedAt: now() }).where(eq(orchestrationRuns.id, run.id)).run();
      events.append({ type: 'orchestration.mode_changed', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], mode: projectMode, previous: fresh.mode as OrchestrationRun['mode'] } });
      if (projectMode === 'approve_each') returnToUser();
    });
    return orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get() ?? fresh;
  };

  /** The project's mode as the engine honours it: automatic only while the project's confirmation is on record (fail safe, never the other way). */
  const projectModeOf = (workspaceId: WorkspaceId): OrchestrationMode => {
    const mode = readOrchestrationMode(orm, workspaceId) ?? DEFAULT_ORCHESTRATION_MODE;
    return mode === 'automatic' && !readAutomaticConfirmed(orm, workspaceId) ? 'approve_each' : mode;
  };

  const labels = async (workspaceId: WorkspaceId): Promise<Map<string, string>> => {
    try {
      const { agents } = await chat.chatAgents(workspaceId);
      return new Map(agents.map((agent) => [agent.agentId, agent.displayName]));
    } catch {
      return new Map();
    }
  };

  /**
   * What the worker did for one instruction: the tool calls after it (the newest few, with their last status) and its newest
   * finished reply after it, as plain text for {@link makeStatusReport}, which masks and caps it. The instruction is found by its
   * text among the chat's newest events; a chat that was used before the instruction shows only what came after it.
   */
  const lastReply = (workspaceId: WorkspaceId, sessionId: SessionId, instruction: string, reused: boolean, reviewed = false): string => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    let reply = '';
    let found = false;
    const calls = new Map<string, string>();
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'session.message_completed') {
        if (event.payload.role === 'agent') {
          if (reply === '') reply = event.payload.content;
        } else if ((event.payload.origin === 'manager' || event.payload.origin === 'manager_auto') && sentAs(event.payload.content, instruction, reviewed)) {
          found = true;
          break;
        }
      } else if (event.type === 'session.tool_call' || event.type === 'session.tool_call_updated') {
        // Newest first: the first time a call is seen is its latest status.
        if (!calls.has(event.payload.toolCallId)) calls.set(event.payload.toolCallId, `${redactSecrets(event.payload.title).replace(/\s+/g, ' ').trim().slice(0, 80)} (${event.payload.status})`);
      }
    }
    // A chat the user used before: if the instruction is not in the window, nothing of it is the worker's result (never the user's own history).
    if (reused && !found) return '';
    const shown = [...calls.values()].slice(0, TOOL_CALLS_SHOWN).reverse();
    const tools = shown.length === 0 ? '' : `Tool calls${calls.size > shown.length ? ` (the last ${shown.length} of ${calls.size})` : ''}: ${shown.join('; ')}`.slice(0, TOOL_CALLS_CHARS);
    return tools === '' ? reply : reply === '' ? tools : `${tools}\n\n${reply}`;
  };

  /**
   * Whether a worker's permission card was Denied during this instruction (15.9): the title of the denied tool call (possibly empty), or
   * `undefined`. Read from the worker session's own `permission.resolved` events since the manager's instruction, so it survives a restart.
   * A card that was cancelled (the worker was stopped) is not a Deny.
   */
  const deniedSince = (workspaceId: WorkspaceId, sessionId: SessionId, instruction: string, reused: boolean, reviewed = false): { title: string } | undefined => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    const denied: string[] = [];
    const titles = new Map<string, string>();
    let found = false;
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'permission.resolved') {
        if (event.payload.decision === 'deny' && event.payload.by !== 'cancelled') denied.push(event.payload.requestId);
      } else if (event.type === 'permission.requested') titles.set(event.payload.requestId, event.payload.toolCall.title);
      else if (event.type === 'session.message_completed' && event.payload.role !== 'agent' && (event.payload.origin === 'manager' || event.payload.origin === 'manager_auto') && sentAs(event.payload.content, instruction, reviewed)) {
        found = true;
        break;
      }
    }
    if ((reused && !found) || denied.length === 0) return undefined;
    return { title: redactSecrets(titles.get(denied[0]!) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) };
  };

  /** Whether the worker's chat was left idle because Ogden Agents restarted in the middle of its turn (its newest state change says so). */
  const cutOffByRestart = (workspaceId: WorkspaceId, sessionId: SessionId): boolean => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, 60, sessionId);
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'session.state_changed') return event.payload.state === 'idle' && event.payload.resumable === true && event.payload.reason === RESTARTED_REASON;
    }
    return false;
  };

  /**
   * Where a run's loop stands, read from its events (15.9): the events are the log, so this is the same after a restart. After a step's
   * result a decision is owed (carrying the capped report and, after a question, the user's answer); a decision made clears it.
   */
  interface LoopState {
    owed: { after: string | null; report: ManagerStatusReport | null; answer: string | null } | null;
    /** The latest decision since the latest result (or what the manager said when only told), as the page shows it. */
    decision: OrchestrationDecisionView | null;
    /** The step the latest result was about, and its report. */
    lastAfter: string | null;
    lastReport: ManagerStatusReport | null;
  }
  const loopOf = (workspaceId: WorkspaceId, runId: string): LoopState => {
    const rows = orm
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.streamId, workspaceId), inArray(eventsTable.type, ['orchestration.result_read', 'orchestration.decision_made', 'orchestration.question_answered']), sql`json_extract(${eventsTable.payload}, '$.runId') = ${runId}`))
      .orderBy(asc(eventsTable.seq))
      .all();
    const state: LoopState = { owed: null, decision: null, lastAfter: null, lastReport: null };
    let askedAfter: string | null = null;
    for (const row of rows) {
      if (row.type === 'orchestration.result_read') {
        const report = ManagerStatusReportSchema.safeParse((row.payload as { report?: unknown }).report);
        // Only a step that finished asks for a decision; a failed or denied one ended the run.
        if (!report.success || (report.data.state !== 'idle' && report.data.state !== 'done')) continue;
        state.lastAfter = report.data.step_id;
        state.lastReport = report.data;
        state.owed = { after: report.data.step_id, report: report.data, answer: null };
        state.decision = null;
      } else if (row.type === 'orchestration.decision_made') {
        const payload = row.payload as { after?: string | null; action?: string; reason?: string; stepId?: string; question?: string; told?: 'denied' | 'refused' };
        const view = OrchestrationDecisionView.safeParse({ action: payload.action, reason: payload.reason, stepId: payload.stepId, question: payload.question, told: payload.told, at: row.at });
        if (!view.success) continue;
        state.decision = view.data;
        // What the manager said when only told does not answer what is owed (the run had ended).
        if (payload.told === undefined) {
          state.owed = null;
          askedAfter = payload.after ?? null;
        }
      } else if (row.type === 'orchestration.question_answered') {
        if (state.owed === null && state.decision?.action === 'ask_user') {
          state.owed = { after: askedAfter, report: state.lastReport, answer: (row.payload as { answer?: string }).answer ?? '' };
          state.decision = null;
        }
      }
    }
    return state;
  };

  /** The manager of this project now, or `undefined` when none is ready (a test's fixed manager wins). */
  const managerOf = (workspaceId: WorkspaceId): ManagerPort | undefined => fixedManager ?? (statusOf(workspaceId).state === 'ready' ? managers?.managerFor(workspaceId) : undefined);

  /**
   * Where the person looks at the result a review step is about (15.10): epic 5's review page when the reviewed step's chat is a build run
   * (the ticket's review, where they approve and merge), else the worker chat that did it; `null` while the reviewed step was not sent.
   * Read only: this never decides anything on a run.
   */
  const reviewTargetOf = (runId: string, reviewedStepId: string): OrchestrationReviewTarget | null => {
    const reviewed = orm.select().from(orchestrationSteps).where(and(eq(orchestrationSteps.runId, runId), eq(orchestrationSteps.stepId, reviewedStepId))).get();
    // A build step (15.11) is looked at on the review page of its ticket, once the build was started; it has no worker chat.
    if (reviewed !== undefined && reviewed.buildRef !== null) return reviewed.buildRunId === null ? null : { kind: 'build_review', ticketRef: reviewed.buildRef };
    if (reviewed === undefined || reviewed.sessionId === null) return null;
    const build = orm.select({ ticketRef: runsTable.ticketRef }).from(runsTable).where(eq(runsTable.sessionId, reviewed.sessionId)).get();
    return build === undefined ? { kind: 'worker_chat', sessionId: reviewed.sessionId as SessionId } : { kind: 'build_review', ticketRef: build.ticketRef };
  };

  /**
   * Settles a sent step once (the first read that sees it finished or failed): the step moves, `result_read` is appended with the report, and
   * the run goes on, finishes, or fails as the step says. Read again inside the transaction, so two reads never settle it twice. Returns
   * whether this call settled it.
   */
  const settleStep = (workspaceId: WorkspaceId, run: RunRow, stepId: string, to: 'done' | 'failed', report: ManagerStatusReport): boolean =>
    events.transaction(() => {
      const current = requireStep(run.id, stepId);
      if (current.state !== 'dispatched' || !canMoveStep('dispatched', to)) return false;
      orm.update(orchestrationSteps).set({ state: to }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, stepId))).run();
      events.append({ type: 'orchestration.result_read', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], report } });
      const runId = run.id as OrchestrationRun['id'];
      const states = stepsOf(run.id).map((other) => other.state);
      // A run the user stopped (or that ended another way) stays as it is: the step settles, the run is not moved again.
      const runNow = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
      if (runNow === undefined || isRunOver(runNow.state as OrchestrationRunState)) return true;
      if (to === 'failed') {
        // A failed step is final and nothing is retried yet, so the run stops here, plainly.
        moveRun(run.id, 'failed', 'worker_error');
        events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId, reason: 'worker_error' } });
      } else if (states.every((state) => state === 'done' || state === 'skipped')) {
        moveRun(run.id, 'finished');
        events.append({ type: 'orchestration.run_finished', workspaceId, streamId: workspaceId, payload: { runId } });
      } else if (!states.includes('dispatched')) moveRun(run.id, 'awaiting_user');
      return true;
    });

  // ---- builds the manager proposed (15.11): read only here; a build is started only by the user, in the Build dialog ----

  /** The latest end checks of a build run: counts only (never output), or `null` when none ran. */
  const checksOf = (workspaceId: WorkspaceId, sessionId: SessionId): OrchestrationBuildRunView['checks'] => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type !== 'run.verification_completed') continue;
      const results = event.payload.verification.checks.map((check) => check.result);
      return { passed: results.filter((result) => result === 'pass').length, failed: results.filter((result) => result === 'fail').length, notRun: results.filter((result) => result === 'not_run').length };
    }
    return null;
  };

  /** A build run as the page and the manager read it, or `undefined` when it is not a run of this ticket in this project. */
  const buildRunOf = (workspaceId: WorkspaceId, ticketRef: string, buildRunId: string): { view: OrchestrationBuildRunView; blockedCode: string | null; reason: string | null } | undefined => {
    const row = orm.select().from(runsTable).where(eq(runsTable.id, buildRunId)).get();
    if (row === undefined || row.workspaceId !== workspaceId || row.ticketRef !== ticketRef) return undefined;
    // Only Ogden's own sentence for a blocked build: a stored reason may hold the build agent's words, which the manager never reads.
    const reason = row.outcome === 'blocked' && row.blockedCode !== null ? blockedSentence(row.blockedCode) : null;
    return {
      view: { runId: row.id as OrchestrationBuildRunView['runId'], outcome: row.outcome, decision: row.decision, checks: checksOf(workspaceId, row.sessionId as SessionId) },
      blockedCode: row.blockedCode,
      reason,
    };
  };

  /**
   * How a step follows its build run: still going (running, or paused at the plan's own checkpoint, which only the user continues), done
   * (the build ended verified, waiting for the user's review: nothing is merged), or failed (failed, stopped, or blocked for another reason).
   */
  const buildEndOf = (outcome: OrchestrationBuildRunView['outcome'], blockedCode: string | null): 'running' | 'done' | 'failed' => {
    if (outcome === 'running') return 'running';
    if (outcome === 'verified') return 'done';
    if (outcome === 'blocked' && blockedCode !== null && (CHECKPOINT_BLOCKED_CODES as readonly string[]).includes(blockedCode)) return 'running';
    return 'failed';
  };

  /** Reads back every dispatched step: its chat's state and a masked, capped report; settles a finished one once. */
  const readBack = async (workspaceId: WorkspaceId, given: RunRow, known?: Map<string, string>, quiet = false): Promise<OrchestrationRunView> => {
    const run = syncMode(workspaceId, given);
    const becameAutomatic = run.mode === 'automatic' && given.mode !== 'automatic' && isOpen(run.state);
    const names = known ?? (await labels(workspaceId));
    const views: OrchestrationStepView[] = [];
    let settledAny = false;
    let waiting: OrchestrationWaiting | null = null;
    let denial: { step: StepRow; report: ManagerStatusReport } | undefined;
    for (const row of stepsOf(run.id)) {
      let step = stepOf(row);
      let sessionState: OrchestrationStepView['sessionState'] = null;
      let report: ManagerStatusReport | null = null;
      const sid = step.sessionId;
      if (sid !== null) {
        try {
          sessionState = chat.getSession(workspaceId, sid).state;
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
          // The chat is gone (its history was deleted): the step reads as failed.
          sessionState = 'error';
        }
        report = makeStatusReport({ stepId: step.stepId, worker: step.worker, state: sessionState, text: lastReply(workspaceId, sid, step.instruction, step.chat !== 'new', step.reviewOf !== null) });
        const live = step.state === 'dispatched' && !isRunOver(run.state as OrchestrationRunState);
        // A Deny of one of the worker's permission cards ends this step (15.9), whatever the worker does next: the run stops and the manager is told.
        const denied = live && sessionState !== 'error' ? deniedSince(workspaceId, sid, step.instruction, step.chat !== 'new', step.reviewOf !== null) : undefined;
        if (denied !== undefined) {
          const summary = `${ORCHESTRATION_DENIED_RESULT}${denied.title === '' ? '' : ` The request was: ${denied.title}.`}`;
          const deniedReport = makeStatusReport({ stepId: step.stepId, worker: step.worker, state: 'error', text: summary });
          const ended = events.transaction(() => {
            const current = requireStep(run.id, step.stepId);
            const runNow = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
            if (current.state !== 'dispatched' || runNow === undefined || isRunOver(runNow.state as OrchestrationRunState)) return false;
            orm.update(orchestrationSteps).set({ state: 'failed' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
            events.append({ type: 'orchestration.result_read', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], report: deniedReport } });
            closeRunNow(workspaceId, run, 'stopped', 'permission_denied', []);
            return true;
          });
          if (ended) {
            disarm(run.id);
            // The worker was told "no" and may be trying something else: its turn ends with the step.
            if (sessionState === 'working') cancelTurns(workspaceId, [row]);
            denial = { step: row, report: deniedReport };
            step = { ...step, state: 'failed' };
            report = deniedReport;
            settledAny = true;
          }
        }
        const cutOff = step.state === 'dispatched' && (sessionState === 'idle' || sessionState === 'done') && cutOffByRestart(workspaceId, sid);
        const finished = (sessionState === 'idle' || sessionState === 'done') && !cutOff;
        if (step.state === 'dispatched' && cutOff) waiting ??= { kind: 'interrupted', stepId: step.stepId, sessionId: sid };
        if (step.state === 'dispatched' && sessionState === 'waiting') waiting ??= { kind: 'permission_card', stepId: step.stepId, sessionId: sid };
        if (step.state === 'dispatched' && (finished || sessionState === 'error')) {
          const to = finished ? 'done' : 'failed';
          if (settleStep(workspaceId, run, step.stepId, to, report)) {
            step = { ...step, state: to };
            settledAny = true;
          }
        }
      }
      // 15.11: a build step follows the build run the person started in the Build dialog, read from the run itself.
      let buildRun: OrchestrationBuildRunView | null = null;
      if (sid === null && step.build?.runId != null) {
        const found = buildRunOf(workspaceId, step.build.ticketRef, step.build.runId);
        buildRun = found?.view ?? null;
        // A run that is gone (its records were removed) reads as a build that failed.
        const end = found === undefined ? 'failed' : buildEndOf(found.view.outcome, found.blockedCode);
        report = makeStatusReport({
          stepId: step.stepId,
          worker: builder ?? ORCHESTRATION_BUILD_WORKER,
          state: end === 'done' ? 'done' : end === 'failed' ? 'error' : 'working',
          text: found === undefined ? 'Ogden: the build run is gone, so the build counts as failed.' : buildSummaryText({ ticketRef: step.build.ticketRef, outcome: found.view.outcome, decision: found.view.decision, checks: found.view.checks, reason: found.reason }),
        });
        if (step.state === 'dispatched' && end !== 'running' && settleStep(workspaceId, run, step.stepId, end, report)) {
          step = { ...step, state: end };
          settledAny = true;
        }
      }
      views.push(OrchestrationStepView.parse({ ...step, workerLabel: names.get(step.worker) ?? step.worker, sessionState, report, buildRun, review: step.reviewOf === null ? null : reviewTargetOf(run.id, step.reviewOf) }));
    }
    const fresh = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get() ?? run;
    // A read that settled a step lets the run go on (the listener does the same when the worker's chat changes): its next decision, and the next step of an automatic run.
    if (settledAny && !quiet) void scheduleAdvance(workspaceId, run.id);
    else if (becameAutomatic && !quiet && fresh.mode === 'automatic') void scheduleAdvance(workspaceId, run.id);
    if (denial !== undefined) tell(workspaceId, run.id, denial.step, denial.report, 'denied');
    const loop = loopOf(workspaceId, run.id);
    // A question the manager asked and the user has not answered (the run is live and waits for them).
    if (waiting === null && isLive(fresh.state) && loop.decision?.action === 'ask_user' && loop.owed === null && loop.decision.question !== undefined) waiting = { kind: 'question', question: loop.decision.question };
    // 15.11: an automatic run at a proposed build waits for the user, who starts it in the Build dialog (it starts nothing on its own).
    if (waiting === null && isLive(fresh.state) && fresh.mode === 'automatic' && loop.owed === null && !planning.has(fresh.id) && loop.decision?.action !== 'ask_user') {
      const rowsNow = stepsOf(run.id);
      if (!rowsNow.some((row) => row.state === 'dispatched')) {
        const chosen = loop.decision?.action === 'dispatch' && loop.decision.stepId !== undefined ? rowsNow.find((row) => row.stepId === loop.decision!.stepId) : undefined;
        const next = chosen ?? rowsNow.find((row) => row.state === 'proposed' || row.state === 'approved');
        if (next !== undefined && next.buildRef !== null && next.state === 'proposed' && stepOf(next).dependsOn.every((id) => rowsNow.find((row) => row.stepId === id)?.state === 'done')) waiting = { kind: 'build', stepId: next.stepId, ticketRef: next.buildRef };
      }
    }
    return OrchestrationRunView.parse({ run: runOf(fresh), steps: views, waiting: isLive(fresh.state) ? waiting : null, decision: loop.decision, thinking: isLive(fresh.state) && planning.has(fresh.id) });
  };

  /** The worker's own chats the manager may continue: plain chats the terminal does not drive that are idle, newest first, a few. */
  const ownChats = (workspaceId: WorkspaceId, agentId: string) => {
    // A chat made for a step whose send failed is left empty and is never offered back.
    const unsent = new Set(orm.select({ sessionId: orchestrationSteps.sessionId }).from(orchestrationSteps).where(eq(orchestrationSteps.state, 'failed')).all().map((row) => row.sessionId));
    return chat
      .listSessions(workspaceId)
      .filter((session) => !unsent.has(session.id) && session.kind === 'chat' && session.agentId === agentId && session.driver === 'ui' && session.state === 'idle')
      .reverse()
      .slice(0, CHATS_OFFERED)
      .map((session) => ({ sessionId: session.id, state: session.state }));
  };

  /**
   * Whether `row`'s worker can be given an instruction now, checked before any chat is made. Plain refusals ({@link DispatchRefusedError}):
   * not on the team any more, its vendor allows only a person, it signs in with the user's account and the instruction was not
   * approved by the user one by one, not signed in, project not trusted, or not ready. The worker's own readiness is read again here: the
   * plan was checked when it was proposed, and the roster, the sign in or the mode may have changed since.
   */
  const requireWorkerReady = async (workspaceId: WorkspaceId, row: StepRow): Promise<string> => {
    const { agents } = await chat.chatAgents(workspaceId);
    const agent = agents.find((candidate) => candidate.agentId === row.worker);
    const label = agent?.displayName ?? row.worker;
    const refuse = (reason: DispatchRefusalReason): never => {
      throw new DispatchRefusedError(reason, dispatchRefusalWords(reason, label));
    };
    if (agent === undefined) return refuse('worker_not_on_team');
    const rostered = team === undefined ? undefined : (await team.workers(workspaceId)).find((worker) => worker.agentId === row.worker);
    if (team !== undefined && rostered === undefined) return refuse('worker_not_on_team');
    // The vendor's terms, in code: an agent only a person may drive is never sent an instruction, and a subscription agent only takes the
    // user's own approval of that instruction, in either mode (an automatic run waits for the user at such a step, 15.8).
    if (agent.interactiveOnly !== undefined) return refuse('interactive_only');
    if (isSubscription(agent) && row.approvedBy !== 'user') return refuse('approve_each_only');
    if (agent.unavailable !== undefined) return refuse(reasonOf(agent.unavailable.code));
    if (rostered !== undefined && !rostered.ready) return refuse('worker_not_ready');
    return label;
  };

  /**
   * The message a review step sends (15.10), built here from the manager's question and the reviewed step's result, never by the manager:
   * checked first that the worker is still the project's reviewer and, where another agent is ready, a different agent from the one that did
   * the reviewed work ({@link DispatchRefusedError} `not_the_reviewer`, before anything is created). The summary is the reviewed step's own
   * capped, masked report with paths scrubbed and code and diff hunks left out ({@link buildReviewMessage}); nothing else of it goes.
   */
  const reviewMessageFor = async (workspaceId: WorkspaceId, run: RunRow, row: StepRow, label: string): Promise<string> => {
    const refuse = (): never => {
      throw new DispatchRefusedError('not_the_reviewer', dispatchRefusalWords('not_the_reviewer', label));
    };
    const reviewer = team === undefined ? undefined : await team.reviewer(workspaceId);
    if (team === undefined || reviewer?.agentId !== row.worker) return refuse();
    const reviewed = stepsOf(run.id).find((other) => other.stepId === row.reviewOf);
    const reviewedBuild = reviewed !== undefined && reviewed.buildRef !== null;
    if (reviewed === undefined || reviewed.state !== 'done' || (reviewed.sessionId === null && !reviewedBuild)) throw new StepNotApprovedError();
    // The plan check's rules again, so a row written another way is never built into a message.
    if (row.chat !== 'new' || reviewed.reviewOf !== null || !stepOf(row).dependsOn.includes(reviewed.stepId)) return refuse();
    if (reviewed.worker === row.worker && (await team.workers(workspaceId)).some((worker) => worker.ready && worker.agentId !== row.worker)) return refuse();
    const names = await labels(workspaceId);
    // The reviewed step's own words, not yet cut: code and diffs are left out first, so they cannot fill the room the prose needs.
    // A build step's result is Ogden's own summary of the run (outcome and check counts), never the agent's output, files or the diff.
    const found = reviewedBuild && reviewed.buildRunId !== null ? buildRunOf(workspaceId, reviewed.buildRef!, reviewed.buildRunId) : undefined;
    if (reviewedBuild && found === undefined) throw new StepNotApprovedError();
    const text = found !== undefined ? buildSummaryText({ ticketRef: reviewed.buildRef!, outcome: found.view.outcome, decision: found.view.decision, checks: found.view.checks, reason: found.reason }) : lastReply(workspaceId, reviewed.sessionId as SessionId, reviewed.instruction, reviewed.chat !== 'new', reviewed.reviewOf !== null);
    return buildReviewMessage({ question: row.instruction, reviewedStep: reviewed.stepId, reviewedBy: cleanForManager(names.get(reviewed.worker) ?? reviewed.worker).slice(0, 60), resultText: cleanForManager(text) });
  };

  /** Whether the chat a step names can take an instruction now (read as it is, no await): the worker's own, a plain chat, idle, not in the terminal. */
  const requireChatReady = (workspaceId: WorkspaceId, row: StepRow, chatId: string, label: string): SessionId => {
    const refuse = (reason: DispatchRefusalReason): never => {
      throw new DispatchRefusedError(reason, dispatchRefusalWords(reason, label));
    };
    let session: ReturnType<OrchestrationChat['getSession']>;
    try {
      session = chat.getSession(workspaceId, chatId as SessionId);
    } catch (error) {
      if (error instanceof NotFoundError) return refuse('chat_gone');
      throw error;
    }
    if (session.kind !== 'chat') return refuse('chat_not_a_chat');
    if (session.agentId !== row.worker) return refuse('chat_other_agent');
    if (session.driver !== 'ui') return refuse('driver_is_terminal');
    if (session.state !== 'idle') return refuse('chat_busy');
    return session.id;
  };

  /** The plan with every manager string masked (AD-16), for the store and the event. */
  const NO_MANAGER: ManagerStatusView = { state: 'not_chosen', message: ORCHESTRATION_NO_MANAGER_MESSAGE };
  const statusOf = (workspaceId: WorkspaceId): ManagerStatusView => (fixedManager !== undefined ? { state: 'ready', message: 'The manager is ready.' } : (managers?.status(workspaceId) ?? NO_MANAGER));

  /** Appends what a manager call left for the log (its masked answer and how it went), when it left anything. */
  const noteReply = (workspaceId: WorkspaceId, runId: OrchestrationRun['id'], record: ManagerRecord | undefined): void => {
    if (record === undefined) return;
    const output = record.output === undefined ? undefined : redactSecrets(record.output).slice(0, MANAGER_LIMITS.maxRecordChars);
    events.append({
      type: 'orchestration.manager_replied',
      workspaceId,
      streamId: workspaceId,
      payload: {
        runId,
        call: record.call,
        outcome: record.outcome,
        asked: record.asked,
        repaired: record.repaired,
        ...(record.failure === undefined ? {} : { failure: record.failure }),
        ...(record.code === undefined ? {} : { code: record.code }),
        ...(output === undefined ? {} : { output }),
      },
    });
  };

  const masked = (plan: ManagerPlan): ManagerPlan => ({ ...plan, goal: redactSecrets(plan.goal), steps: plan.steps.map((step): ManagerAnyStep => (isManagerBuildStep(step) ? { ...step, reason: redactSecrets(step.reason) } : { ...step, instruction: redactSecrets(step.instruction) })) });

  // ---- Stop, the limits and the activity log (15.8) ----

  /** The limits a new run is given: the install's setting when it is within the bounds, else the defaults. */
  const limitsNow = (): RunLimits => {
    const given = RunLimitsSchema.safeParse(runLimits?.());
    return given.success ? given.data : { ...RUN_LIMITS };
  };
  const limitsOf = (run: RunRow): RunLimits => {
    try {
      return RunLimitsSchema.parse(JSON.parse(run.limits));
    } catch {
      return { ...RUN_LIMITS };
    }
  };

  /** The steps whose worker is in the middle of a turn, read before a run is closed (the chat states are read, not changed). */
  const workersInFlight = (workspaceId: WorkspaceId, run: RunRow): StepRow[] =>
    stepsOf(run.id)
      .filter((step) => step.state === 'dispatched' && step.sessionId !== null)
      .filter((step) => {
        try {
          const state = chat.getSession(workspaceId, step.sessionId as SessionId).state;
          return state === 'working' || state === 'waiting';
        } catch {
          return false;
        }
      });

  /** Asks each worker turn to stop. A turn that ended on its own meanwhile, or a chat that is gone, is no error. */
  const cancelTurns = (workspaceId: WorkspaceId, steps: readonly StepRow[]): void => {
    for (const step of steps) {
      try {
        chat.cancel(workspaceId, step.sessionId as SessionId);
      } catch {
        // Not busy any more, or the chat is gone: nothing left to stop.
      }
    }
  };

  /** The timers that look at an automatic run's time limit while its worker is busy: unref'd, so they never keep the server alive. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const disarm = (runId: string): void => {
    const timer = timers.get(runId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(runId);
  };

  /**
   * Ends a run that is still open: `stopped` (the user, a limit or a refusal) or `failed`, with its reason, in one transaction with the
   * `run_stopped` event; a step whose worker was cut off did not finish, so it is failed. Returns whether this call ended it. With
   * `strict`, a run that already ended is {@link RunNotOpenError} (the user's Stop); otherwise it is left as it is.
   */
  /** The closing itself, for a caller that is already inside a transaction (15.9: a Deny closes the run in the same one that fails its step). */
  const closeRunNow = (workspaceId: WorkspaceId, run: RunRow, to: 'stopped' | 'failed', reason: OrchestrationStopReason, inFlight: readonly StepRow[]): void => {
    moveRun(run.id, to, reason);
    for (const step of inFlight) orm.update(orchestrationSteps).set({ state: 'failed' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId), eq(orchestrationSteps.state, 'dispatched'))).run();
    events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason } });
  };
  const closeRun = (workspaceId: WorkspaceId, run: RunRow, to: 'stopped' | 'failed', reason: OrchestrationStopReason, inFlight: readonly StepRow[], strict: boolean): boolean => {
    const ended = events.transaction(() => {
      const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
      if (live === undefined || isRunOver(live.state as OrchestrationRunState)) {
        if (strict) throw new RunNotOpenError();
        return false;
      }
      closeRunNow(workspaceId, run, to, reason, inFlight);
      return true;
    });
    if (ended) disarm(run.id);
    return ended;
  };

  /** Records a refused dispatch as an event (15.8). Best effort: the refusal itself is what the caller gets. */
  const noteRefusal = (workspaceId: WorkspaceId, runId: string, row: StepRow, error: DispatchRefusedError): void => {
    try {
      events.append({
        type: 'orchestration.dispatch_refused',
        workspaceId,
        streamId: workspaceId,
        payload: { runId: runId as OrchestrationRun['id'], stepId: row.stepId, worker: row.worker, reason: error.reason, message: error.message.slice(0, 400) },
      });
    } catch {
      // A damaged database is not this call's to report.
    }
  };

  /** The activity log: every instruction sent or refused, newest first, read from the events and the steps they point at. */
  const activityOf = async (workspaceId: WorkspaceId): Promise<OrchestrationActivityEntry[]> => {
    const rows = orm
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.streamId, workspaceId), inArray(eventsTable.type, ['orchestration.step_approved', 'orchestration.step_dispatched', 'orchestration.dispatch_refused'])))
      .orderBy(desc(eventsTable.seq))
      .limit(ORCHESTRATION_ACTIVITY_PAGE * 4)
      .all()
      .reverse();
    const names = await labels(workspaceId);
    const approvers = new Map<string, 'user' | 'mode'>();
    const entries: OrchestrationActivityEntry[] = [];
    for (const row of rows) {
      const payload = row.payload as { runId?: string; stepId?: string; worker?: string; sessionId?: string; by?: 'user' | 'mode'; message?: string };
      if (payload.runId === undefined || payload.stepId === undefined) continue;
      const key = `${payload.runId}:${payload.stepId}`;
      if (row.type === 'orchestration.step_approved') {
        if (payload.by !== undefined) approvers.set(key, payload.by);
        continue;
      }
      const step = orm.select().from(orchestrationSteps).where(and(eq(orchestrationSteps.runId, payload.runId), eq(orchestrationSteps.stepId, payload.stepId))).get();
      const run = step === undefined ? undefined : orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, payload.runId)).get();
      if (step === undefined || run === undefined || run.workspaceId !== workspaceId) continue;
      const worker = payload.worker ?? step.worker;
      const refused = row.type === 'orchestration.dispatch_refused';
      let result: OrchestrationActivityEntry['result'] = 'refused';
      if (!refused) {
        if (step.state === 'done') result = 'finished';
        else if (step.state === 'failed') result = run.stopReason === 'permission_denied' ? 'denied' : run.stopReason !== null && run.stopReason !== 'worker_error' ? 'stopped' : 'failed';
        else result = 'working';
      }
      const parsed = OrchestrationActivityEntry.safeParse({
        at: row.at,
        runId: payload.runId,
        stepId: payload.stepId,
        kind: refused ? 'refused' : 'sent',
        worker,
        workerLabel: names.get(worker) ?? worker,
        sessionId: refused ? null : (payload.sessionId ?? null),
        chat: step.chat === 'new' ? 'new' : 'existing',
        approvedBy: refused ? null : (approvers.get(key) ?? null),
        instruction: redactSecrets(step.instruction).replace(/\s+/g, ' ').trim().slice(0, 200),
        result,
        note: refused ? redactSecrets(payload.message ?? '').slice(0, 300) : '',
      });
      if (parsed.success) entries.push(parsed.data);
    }
    return entries.reverse().slice(0, ORCHESTRATION_ACTIVITY_PAGE);
  };

  // ---- Dispatch automatically (15.8) and the loop (15.9) ----

  /**
   * Core itself looks at a run when something happened (a worker's chat changed, the project's mode changed, a read settled a step, the user
   * changed the plan, the time limit came): `scheduleAdvance` is the only way in, run one at a time per run. Each pass re-reads everything (the
   * project's mode, the piece, the run, the steps, the events), so a pass that is late or repeated does nothing wrong. It pauses the run while a
   * worker waits on a permission card, asks the manager for the decision a result is owed, and, in automatic mode, sends the next step within
   * the run's limits, stopping at the first refusal, error, Deny or limit with a plain reason. The manager has no way to call it; it names no
   * settings mutator, never the user's own actions and never a way to answer a permission card (an architecture test).
   */
  const chains = new Map<string, Promise<void>>();
  const pending = new Set<Promise<void>>();
  const asked = new Set<string>();
  const track = (work: Promise<void>): void => {
    pending.add(work);
    void work.then(() => pending.delete(work));
  };
  const scheduleAdvance = (workspaceId: WorkspaceId, runId: string): Promise<void> => {
    const next = (chains.get(runId) ?? Promise.resolve()).then(() => advanceOnce(workspaceId, runId)).catch(() => undefined);
    chains.set(runId, next);
    pending.add(next);
    void next.then(() => {
      pending.delete(next);
      if (chains.get(runId) === next) chains.delete(runId);
    });
    return next;
  };
  const advanceNow = scheduleAdvance;
  /** Lets an open run look again after the user changed it (not awaited; a pass re-reads everything). */
  const kick = (workspaceId: WorkspaceId, runId: string): void => {
    const row = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).get();
    if (row !== undefined && isLive(row.state)) void scheduleAdvance(workspaceId, runId);
  };

  const timeUp = (run: RunRow, limits: RunLimits): boolean => nowMs() - Date.parse(run.createdAt) >= limits.maxMinutes * 60_000;
  const armTimer = (workspaceId: WorkspaceId, run: RunRow, limits: RunLimits): void => {
    if (timers.has(run.id)) return;
    const wait = Date.parse(run.createdAt) + limits.maxMinutes * 60_000 - nowMs() + 1_000;
    const timer = setTimeout(() => {
      timers.delete(run.id);
      void scheduleAdvance(workspaceId, run.id);
    }, Math.min(Math.max(wait, 1_000), 2_147_000_000));
    (timer as { unref?: () => void }).unref?.();
    timers.set(run.id, timer);
  };

  /** The mode approves one step (the user's own approval is never replaced: only a step still waiting, in a run that is automatic and open). */
  const approveByMode = (workspaceId: WorkspaceId, runId: string, stepId: string): boolean =>
    events.transaction(() => {
      const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).get();
      if (live === undefined || live.mode !== 'automatic' || !isOpen(live.state)) return false;
      const step = requireStep(runId, stepId);
      // The mode never approves a build (15.11): only the person's own start in the Build dialog moves it.
      if (step.buildRef !== null || step.state !== 'proposed' || !canMoveStep('proposed', 'approved')) return false;
      orm.update(orchestrationSteps).set({ state: 'approved', approvedBy: 'mode' }).where(and(eq(orchestrationSteps.runId, runId), eq(orchestrationSteps.stepId, stepId))).run();
      events.append({ type: 'orchestration.step_approved', workspaceId, streamId: workspaceId, payload: { runId: runId as OrchestrationRun['id'], stepId, by: 'mode' } });
      return true;
    });

  /** The run waits for the user (a step only they may approve, or one that needs a step that was skipped); said once per step. */
  const waitForUser = (workspaceId: WorkspaceId, run: RunRow, stepId: string): void => {
    const key = `${run.id}:${stepId}`;
    events.transaction(() => {
      moveRun(run.id, 'awaiting_user');
      if (!asked.has(key)) {
        asked.add(key);
        events.append({ type: 'orchestration.run_paused', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'awaiting_user' } });
      }
    });
  };

  /** One pass, with an unexpected failure ending the run plainly instead of leaving it open with nothing happening. */
  const advanceOnce = async (workspaceId: WorkspaceId, runId: string): Promise<void> => {
    try {
      await advancePass(workspaceId, runId);
    } catch (error) {
      if (error instanceof OrchestrationOffError || error instanceof NotFoundError) return;
      try {
        closeRun(workspaceId, requireRun(workspaceId, runId), 'failed', 'worker_error', [], false);
      } catch {
        // The run or the database is gone: nothing left to close.
      }
    }
  };

  /** Whether the chat a step would go to is in a mode other than Ask: a named chat's own mode, or the project's default for a new chat. */
  const runsWithoutAsking = async (workspaceId: WorkspaceId, step: StepRow): Promise<boolean> => {
    if (step.chat === 'new') return (readDefaultPermissionMode(orm, workspaceId)?.mode ?? 'ask') !== 'ask';
    try {
      return (chat.getSession(workspaceId, step.chat as SessionId).permissionMode ?? 'ask') !== 'ask';
    } catch {
      // A chat that is gone is refused by the dispatch itself, with its own words.
      return false;
    }
  };

  // ---- the manager's next decision (15.9) ----

  /** What the manager is given each turn about the workers: who is ready, their modes and their own idle chats (the same as at the start of a run). */
  const workerContext = async (workspaceId: WorkspaceId, goal: string, withBuildable = false): Promise<ManagerContext> => {
    const { agents } = await chat.chatAgents(workspaceId);
    // Only the rostered workers (15.5): the project's worker and its reviewer when that is an agent. Without a roster, every agent.
    const rostered = team === undefined ? undefined : await team.workers(workspaceId);
    const addressable = rostered === undefined ? agents : rostered.flatMap((worker) => agents.filter((agent) => agent.agentId === worker.agentId));
    // 15.10: the roster's reviewer, when it is an agent that is ready now: the only one a review step may go to.
    const reviewer = team === undefined ? undefined : await team.reviewer(workspaceId);
    const reviewerId = reviewer?.ready === true && addressable.some((agent) => agent.agentId === reviewer.agentId) ? reviewer.agentId : undefined;
    // 15.11: the tickets a build may be proposed for, asked only when a plan is being made (a decision cannot add steps).
    const tickets = withBuildable && buildable !== undefined ? await buildable(workspaceId) : [];
    // 15.12: the person's routing rules, read now, only when a plan is being made. A rule deleted a moment ago is not here.
    const rules = withBuildable ? (readRoutingRules(orm, workspaceId) ?? []) : [];
    return {
      goal,
      ...(rules.length === 0 ? {} : { rules }),
      ...(reviewerId === undefined ? {} : { reviewer: reviewerId }),
      ...(tickets.length === 0 ? {} : { buildable: tickets.map((ticket) => ({ ref: ticket.ref, title: ticket.title })) }),
      ...(builder === undefined ? {} : { builder }),
      projectSummary: 'A software project in the folder the user opened.',
      workers: addressable.map((agent) => ({
        agentId: agent.agentId,
        label: agent.displayName,
        ready: rostered === undefined ? agent.unavailable === undefined : (rostered.find((worker) => worker.agentId === agent.agentId)?.ready ?? false),
        modes: agent.permissionModes,
        chats: ownChats(workspaceId, agent.agentId),
      })),
    };
  };

  /** The plan as it stands (the stored steps, their text masked when they were kept), for the manager to decide on. */
  const planOfRows = (run: RunRow, rows: readonly StepRow[]): ManagerPlan => ({
    version: MANAGER_PLAN_VERSION,
    goal: run.goal,
    steps: rows.map((row) => {
      const step = stepOf(row);
      if (step.build !== null) return { id: step.stepId, build: { ticket: step.build.ticketRef }, reason: step.instruction, depends_on: step.dependsOn };
      return { id: step.stepId, worker: step.worker, chat: step.chat, instruction: step.instruction, mode: 'ask' as const, depends_on: step.dependsOn, ...(step.reviewOf === null ? {} : { review_of: step.reviewOf }) };
    }),
  });
  const statesOf = (rows: readonly StepRow[]): Record<string, OrchestrationStepState> => Object.fromEntries(rows.map((row) => [row.stepId, row.state as OrchestrationStepState]));

  const decisionRecord = (decision: ManagerDecision | undefined, words: string): { action: DecisionOutcome; reason: string; stepId?: string; question?: string } => {
    if (decision === undefined) return { action: 'unavailable', reason: redactSecrets(words).slice(0, 400) };
    return {
      action: decision.action,
      reason: redactSecrets(decision.reason).slice(0, MANAGER_LIMITS.maxReasonChars),
      ...(decision.step_id === undefined ? {} : { stepId: decision.step_id }),
      ...(decision.question === undefined ? {} : { question: redactSecrets(decision.question).slice(0, MANAGER_LIMITS.maxQuestionChars) }),
    };
  };

  /**
   * Asks the manager what comes next after a result (15.9). The run reads as thinking meanwhile (the view says so; the user can still approve,
   * edit or skip, because the suggestion is only a suggestion) and Stop abandons the call. The decision is
   * checked in code (a step of the plan, still waiting, its needs done) and recorded; then: `dispatch` marks the step as the manager's next
   * suggestion (in the default mode the user still approves it; the automatic engine takes it), `ask_user` shows the question and the run
   * waits, `done` finishes the run, `stop` stops it. No usable decision: the user chooses (default mode), or an automatic run stops.
   */
  const askForDecision = async (workspaceId: WorkspaceId, run: RunRow, rows: readonly StepRow[], owed: NonNullable<LoopState['owed']>): Promise<void> => {
    const runId = run.id as OrchestrationRun['id'];
    const manager = managerOf(workspaceId);
    const thinking = new AbortController();
    planning.set(run.id, thinking);
    let result: Awaited<ReturnType<ManagerPort['decideNext']>>;
    try {
      const base = await workerContext(workspaceId, run.goal);
      const context: ManagerDecisionContext = {
        ...base,
        plan: planOfRows(run, rows),
        stepStates: statesOf(rows),
        ...(owed.report === null ? {} : { lastReport: owed.report }),
        ...(owed.answer === null || owed.answer === '' ? {} : { userAnswer: owed.answer }),
      };
      result = manager === undefined ? { ok: false, kind: 'unavailable', reason: MANAGER_FAILURE_WORDS.unavailable } : await manager.decideNext(context, thinking.signal);
    } catch {
      // The port promises not to throw; if one does, it is no usable decision.
      result = { ok: false, kind: 'unavailable', reason: MANAGER_FAILURE_WORDS.unavailable };
    } finally {
      planning.delete(run.id);
    }
    const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
    if (live === undefined || isRunOver(live.state as OrchestrationRunState)) {
      // Stopped while the manager thought: whatever it answered is kept in the log only.
      events.transaction(() => noteReply(workspaceId, runId, result.record));
      return;
    }
    const fresh = stepsOf(run.id);
    // The user may have sent another step while the manager thought: with a worker on a step, the answer is only logged (its result owes the next decision).
    if (fresh.some((step) => step.state === 'dispatched')) {
      events.transaction(() => noteReply(workspaceId, runId, result.record));
      return;
    }
    let decision: ManagerDecision | undefined = result.ok ? result.value : undefined;
    // The plan may have changed while the manager thought (the user skipped, edited or sent a step): a step it chose must still be one that can
    // be sent. If not, its answer is only logged and it is asked again.
    if (decision?.action === 'dispatch' && !(dispatchableSteps({ plan: planOfRows(run, fresh), stepStates: statesOf(fresh) })?.includes(decision.step_id ?? '') ?? false)) {
      events.transaction(() => noteReply(workspaceId, runId, result.record));
      void scheduleAdvance(workspaceId, run.id);
      return;
    }
    const words = result.ok ? '' : result.reason;
    const record = decisionRecord(decision, words);
    // The user may have switched the mode while the manager thought: what it is now decides what a failed decision means.
    const automatic = live.mode === 'automatic';
    events.transaction(() => {
      noteReply(workspaceId, runId, result.record);
      events.append({ type: 'orchestration.decision_made', workspaceId, streamId: workspaceId, payload: { runId, after: owed.after, ...record } });
      if (decision === undefined) moveRun(run.id, 'awaiting_user');
      else if (decision.action === 'dispatch') moveRun(run.id, 'awaiting_user');
      else if (decision.action === 'ask_user') {
        moveRun(run.id, 'awaiting_user');
        events.append({ type: 'orchestration.run_paused', workspaceId, streamId: workspaceId, payload: { runId, reason: 'awaiting_user' } });
      } else if (decision.action === 'done') {
        moveRun(run.id, 'finished');
        events.append({ type: 'orchestration.run_finished', workspaceId, streamId: workspaceId, payload: { runId, reason: record.reason } });
      } else closeRunNow(workspaceId, run, 'stopped', 'manager_stopped', []);
    });
    if (decision === undefined && automatic) closeRun(workspaceId, run, 'stopped', 'manager_refused', [], false);
    else if (decision === undefined || decision.action === 'done' || decision.action === 'stop') disarm(run.id);
    else if (decision.action === 'dispatch' && automatic) void scheduleAdvance(workspaceId, run.id);
  };

  /**
   * Tells the manager what ended a step the run could not go on from (15.9): a Deny of a worker's permission card, or an instruction that
   * could not be sent. The run has already stopped, so the answer changes nothing; it is kept in the log (`told`) and shown, so the user can
   * read what the manager thought. Best effort and never blocking Stop.
   */
  const tell = (workspaceId: WorkspaceId, runId: string, step: StepRow, report: ManagerStatusReport, kind: 'denied' | 'refused'): void => {
    track(
      (async () => {
        const manager = managerOf(workspaceId);
        if (manager === undefined) return;
        const run = requireRun(workspaceId, runId);
        const rows = stepsOf(runId);
        const context: ManagerDecisionContext = { ...(await workerContext(workspaceId, run.goal)), plan: planOfRows(run, rows), stepStates: statesOf(rows), lastReport: report };
        const result = await manager.decideNext(context);
        const id = runId as OrchestrationRun['id'];
        const record = decisionRecord(result.ok ? result.value : undefined, result.ok ? '' : result.reason);
        events.transaction(() => {
          noteReply(workspaceId, id, result.record);
          events.append({ type: 'orchestration.decision_made', workspaceId, streamId: workspaceId, payload: { runId: id, after: step.stepId, ...record, told: kind } });
        });
      })().catch(() => undefined),
    );
  };

  /** A worker waits on a permission card: the run is paused until the user answers it on the worker's own card (never answered here). */
  const pauseForCard = (workspaceId: WorkspaceId, run: RunRow): void => {
    events.transaction(() => {
      const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
      if (live === undefined || live.state === 'paused' || !canMoveRun(live.state as OrchestrationRunState, 'paused')) return;
      moveRun(run.id, 'paused');
      events.append({ type: 'orchestration.run_paused', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'permission_card' } });
    });
  };

  const advancePass = async (workspaceId: WorkspaceId, runId: string): Promise<void> => {
    let run: RunRow;
    try {
      run = requireRun(workspaceId, runId);
      // With the piece switched off nothing is sent on its own; Stop still works.
      if (!feature.enabled(workspaceId)) return;
    } catch {
      return;
    }
    run = syncMode(workspaceId, run);
    if (!isLive(run.state)) return;
    // What the workers finished is settled first (a step done, a Deny ends its step, the run finished when none is left).
    await readBack(workspaceId, run, undefined, true);
    run = syncMode(workspaceId, requireRun(workspaceId, runId));
    if (!isLive(run.state)) return;
    const automatic = run.mode === 'automatic';
    const limits = limitsOf(run);
    if (automatic && !timeUp(run, limits)) armTimer(workspaceId, run, limits);
    let rows = stepsOf(run.id);
    const halt = (reason: OrchestrationStopReason, inFlight: readonly StepRow[] = []): void => {
      if (closeRun(workspaceId, run, 'stopped', reason, inFlight, false)) cancelTurns(workspaceId, inFlight);
    };
    const dispatched = rows.filter((step) => step.state === 'dispatched');
    if (dispatched.length > 0) {
      // A worker is on a step: nothing more goes until it is done, unless the run has run out of time (then its turn is asked to stop).
      // A build the person started runs in its own time (their build limit, Runs to stop it): the plan's clock never ends the run under it.
      if (automatic && timeUp(run, limits) && dispatched.some((step) => step.sessionId !== null)) return halt('time_limit', workersInFlight(workspaceId, run));
      // A worker waiting on a permission card pauses the run; the user answers on that card, and the run goes on once it is answered.
      // A build step has no worker chat (15.11): it follows its build run, which the user runs and stops in the Runs tab.
      const states = dispatched.filter((step) => step.sessionId !== null).map((step) => {
        try {
          return { step, state: chat.getSession(workspaceId, step.sessionId as SessionId).state };
        } catch {
          return { step, state: 'error' as const };
        }
      });
      if (states.some((entry) => entry.state === 'waiting')) return pauseForCard(workspaceId, run);
      if (states.some((entry) => (entry.state === 'idle' || entry.state === 'done') && cutOffByRestart(workspaceId, entry.step.sessionId as SessionId))) {
        // The restart cut a worker off in the middle of its turn: nothing is sent again; the user lets it continue in its chat, or stops the run.
        waitForUser(workspaceId, run, dispatched[0]!.stepId);
        return;
      }
      if (run.state === 'paused') {
        events.transaction(() => {
          moveRun(run.id, 'running');
          events.append({ type: 'orchestration.run_resumed', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'card_answered' } });
        });
      }
      return;
    }
    if (run.state === 'paused') {
      events.transaction(() => {
        moveRun(run.id, 'awaiting_user');
        events.append({ type: 'orchestration.run_resumed', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'card_answered' } });
      });
    }
    // A failed step with the run still open (the process ended between the two writes) ends the run, as a worker's error does.
    if (rows.some((step) => step.state === 'failed')) {
      closeRun(workspaceId, run, 'failed', 'worker_error', [], false);
      return;
    }
    // The decision a result is owed. A suggestion that cannot be followed any more (its step was skipped or taken), or that the manager could
    // not make before the project went automatic, is asked for again.
    const loop = loopOf(workspaceId, run.id);
    let owed = loop.owed;
    if (owed === null && loop.decision !== null && loop.decision.told === undefined) {
      const chosen = loop.decision.stepId === undefined ? undefined : rows.find((step) => step.stepId === loop.decision!.stepId);
      const stale = loop.decision.action === 'dispatch' && (chosen === undefined || (chosen.state !== 'proposed' && chosen.state !== 'approved'));
      if (stale || (loop.decision.action === 'unavailable' && automatic)) owed = { after: loop.lastAfter, report: loop.lastReport, answer: null };
    }
    const remaining = rows.filter((step) => step.state === 'proposed' || step.state === 'approved');
    // Nothing the manager could choose: every step left is the user's to send or waits on a step that was skipped. Then there is nothing to ask,
    // and the run waits for the user (the engine below says so in automatic mode).
    const choosable = dispatchableSteps({ plan: planOfRows(run, rows), stepStates: statesOf(rows) }) ?? [];
    if (owed !== null && remaining.length > 0 && choosable.length === 0) owed = null;
    if (owed !== null) {
      if (remaining.length === 0) {
        // Nothing is left for the manager to choose: the plan is done.
        events.transaction(() => {
          moveRun(run.id, 'finished');
          events.append({ type: 'orchestration.run_finished', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'] } });
        });
        return;
      }
      if (automatic && timeUp(run, limits)) return halt('time_limit');
      if (automatic && rows.filter((step) => step.sessionId !== null).length >= limits.maxInstructions) return halt('instruction_limit');
      await askForDecision(workspaceId, run, rows, owed);
      return;
    }
    if (!automatic) return;
    // The manager's question waits for the user's own answer.
    if (loop.decision?.action === 'ask_user') return;
    rows = stepsOf(run.id);
    // The step the manager chose (or, before any result, the first one that waits).
    const chosen = loop.decision?.action === 'dispatch' && loop.decision.stepId !== undefined ? rows.find((step) => step.stepId === loop.decision!.stepId) : undefined;
    const next = chosen ?? rows.find((step) => step.state === 'proposed' || step.state === 'approved');
    if (next === undefined) return;
    if (timeUp(run, limits)) return halt('time_limit');
    // A step the user approved is the user's to send (their own Send button); only what the mode approved, or still waits, is sent here.
    if (next.state === 'approved' && next.approvedBy === 'user') return;
    // A proposed build is only ever started by the user, in the Build dialog, in either mode: the run waits at it and starts nothing (15.11).
    if (next.buildRef !== null) return waitForUser(workspaceId, run, next.stepId);
    if (rows.filter((step) => step.sessionId !== null).length >= limits.maxInstructions) return halt('instruction_limit');
    if ((stepDepths(rows.map((step) => ({ stepId: step.stepId, dependsOn: stepOf(step).dependsOn }))).get(next.stepId) ?? 1) > limits.maxDepth) return halt('depth_limit');
    // A step that needs one that is not done (one the user skipped) waits for the user, as in the default mode.
    if (stepOf(next).dependsOn.some((id) => rows.find((other) => other.stepId === id)?.state !== 'done')) return waitForUser(workspaceId, run, next.stepId);
    // An agent that signs in with the user's account takes only instructions the user approves one by one: the run waits at that step.
    const { agents } = await chat.chatAgents(workspaceId);
    const agent = agents.find((candidate) => candidate.agentId === next.worker);
    if (next.state === 'proposed' && agent !== undefined && isSubscription(agent)) return waitForUser(workspaceId, run, next.stepId);
    // The mode never sends into a chat that runs without asking the user: the worker's own cards are the user's last say (a named chat's mode, or
    // the mode a new chat of the project starts in). The user's own approval of that step is still theirs to give.
    if (next.state === 'proposed' && (await runsWithoutAsking(workspaceId, next))) return waitForUser(workspaceId, run, next.stepId);
    if (next.state === 'proposed' && !approveByMode(workspaceId, run.id, next.stepId)) return;
    try {
      await api.dispatchStep(workspaceId, run.id, next.stepId);
    } catch (error) {
      if (error instanceof OrchestrationOffError) return;
      if (error instanceof StepNotApprovedError) {
        // A step the mode approved that can no longer be sent by the mode (the project went back to Approve each instruction): it is the user's again.
        const handedBack = events.transaction(() => {
          const step = requireStep(run.id, next.stepId);
          if (step.state !== 'approved' || step.approvedBy !== 'mode') return false;
          orm.update(orchestrationSteps).set({ state: 'proposed', approvedBy: null }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, next.stepId))).run();
          return true;
        });
        if (handedBack) waitForUser(workspaceId, run, next.stepId);
        return;
      }
      if (error instanceof DispatchRefusedError && error.reason === 'approve_each_only') {
        // The worker turned out to be one only the user may send to: the step is the user's again.
        events.transaction(() => {
          const step = requireStep(run.id, next.stepId);
          if (step.state === 'approved' && step.approvedBy === 'mode') orm.update(orchestrationSteps).set({ state: 'proposed', approvedBy: null }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, next.stepId))).run();
        });
        return waitForUser(workspaceId, run, next.stepId);
      }
      // The first refusal or error stops the run (a refusal is already an event; the stop is its own). The manager is told of a refusal as a result.
      if (error instanceof DispatchRefusedError) {
        if (closeRun(workspaceId, run, 'stopped', 'dispatch_refused', [], false)) tell(workspaceId, run.id, next, makeStatusReport({ stepId: next.stepId, worker: next.worker, state: 'error', text: orchestrationRefusedResult(error.message) }), 'refused');
      } else closeRun(workspaceId, run, 'failed', 'worker_error', [], false);
      return;
    }
    // Look again: the worker may already be done, and the step after it goes next.
    void scheduleAdvance(workspaceId, run.id);
  };

  // A worker's chat going quiet or waiting, a card being answered or the project's mode changing, lets a run go on, pause, or go back to asking the user.
  events.subscribe(events.lastSeq(), (event) => {
    try {
      const dispatchedOn = (sessionId: string): Array<{ runId: string }> => orm.select({ runId: orchestrationSteps.runId }).from(orchestrationSteps).where(and(eq(orchestrationSteps.sessionId, sessionId), eq(orchestrationSteps.state, 'dispatched'))).all();
      if (event.type === 'session.state_changed' && (event.payload.state !== 'working' || event.payload.previous === 'waiting')) {
        for (const step of dispatchedOn(event.payload.sessionId)) if (event.workspaceId !== null) void scheduleAdvance(event.workspaceId, step.runId);
      } else if (event.type === 'run.outcome_changed') {
        // A build the plan follows ended or changed (15.11): the run looks again.
        const linked = orm.select({ runId: orchestrationSteps.runId }).from(orchestrationSteps).where(and(eq(orchestrationSteps.buildRunId, event.payload.runId), eq(orchestrationSteps.state, 'dispatched'))).all();
        for (const step of linked) if (event.workspaceId !== null) void scheduleAdvance(event.workspaceId, step.runId);
      } else if (event.type === 'permission.resolved' && event.payload.decision === 'deny') {
        for (const step of dispatchedOn(event.payload.sessionId)) if (event.workspaceId !== null) void scheduleAdvance(event.workspaceId, step.runId);
      } else if (event.type === 'workspace.settings_changed' && (event.payload.orchestrationMode !== undefined || event.payload.orchestrationEnabled === true)) {
        for (const live of orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.workspaceId, event.workspaceId)).all()) {
          if (!isRunOver(live.state as OrchestrationRunState)) void scheduleAdvance(event.workspaceId, live.id);
        }
      }
    } catch {
      // A listener never throws into the one who appended.
    }
  });

  const api: Orchestration = {
    managerStatus(workspaceId) {
      feature.requireOrchestration(workspaceId);
      return statusOf(workspaceId);
    },

    async startRun(workspaceId, request) {
      feature.requireOrchestration(workspaceId);
      const parsed = StartOrchestrationRunRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError('Write the goal in a sentence or two, up to 500 characters.', parsed.error.issues);
      // The goal is the user's own text; a secret pasted into it is masked before anything keeps or sends it.
      const goal = redactSecrets(parsed.data.goal);
      const status = statusOf(workspaceId);
      const manager = fixedManager ?? (status.state === 'ready' ? managers?.managerFor(workspaceId) : undefined);
      if (manager === undefined) throw new ManagerUnavailableError(status.state === 'ready' ? ORCHESTRATION_NO_MANAGER_MESSAGE : status.message);

      const context = await workerContext(workspaceId, goal, true);
      if (team !== undefined && !context.workers.some((worker) => worker.ready)) throw new ManagerUnavailableError(NO_READY_WORKER);
      const runId = newId('orc') as OrchestrationRun['id'];
      const at = now();
      // The run goes under the project's own mode and the install's limits as they are now (15.8); a later change of the mode reaches the run itself.
      const mode = projectModeOf(workspaceId);
      const limits = limitsNow();
      events.transaction(() => {
        orm.insert(orchestrationRuns).values({ id: runId, workspaceId, goal, state: 'planning', mode, limits: JSON.stringify(limits), stopReason: null, createdAt: at, updatedAt: at }).run();
        events.append({ type: 'orchestration.run_started', workspaceId, streamId: workspaceId, payload: { runId, goal, mode, limits } });
      });

      let result: Awaited<ReturnType<ManagerPort['proposePlan']>>;
      // Stop can abandon the call while the manager thinks; the run is already `stopped` then.
      const thinking = new AbortController();
      planning.set(runId, thinking);
      try {
        result = await manager.proposePlan(context, thinking.signal);
      } catch {
        // The port promises not to throw; if one does, the run is closed, never left planning.
        result = { ok: false, kind: 'unavailable', reason: 'The manager is not available right now.' };
      } finally {
        planning.delete(runId);
      }
      if (requireRun(workspaceId, runId).state === 'stopped') {
        // The user pressed Stop while the manager was working: whatever it answered is kept in the log only, no step is made.
        events.transaction(() => noteReply(workspaceId, runId, result.record));
        return readBack(workspaceId, requireRun(workspaceId, runId));
      }
      if (!result.ok) {
        events.transaction(() => {
          noteReply(workspaceId, runId, result.record);
          moveRun(runId, 'failed', 'manager_refused');
          events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId, reason: 'manager_refused' } });
        });
        throw new ManagerFailedError(redactSecrets(result.reason).slice(0, 300));
      }
      const plan = masked(result.value);
      // The rule a step followed, as it was when the plan was asked for (the rules the manager was given), kept with the step.
      const ruleOf = (id: string | undefined): { ruleId: string; ruleText: string } | { ruleId: null; ruleText: null } => {
        const found = id === undefined ? undefined : context.rules?.find((rule) => rule.id === id);
        return found === undefined ? { ruleId: null, ruleText: null } : { ruleId: found.id, ruleText: found.text };
      };
      events.transaction(() => {
        noteReply(workspaceId, runId, result.record);
        plan.steps.forEach((step, position) => {
          // A build step has no worker chat and no instruction: the agent builds run on is its worker in name only, the chat is nothing, the reason is its text.
          const values = isManagerBuildStep(step)
            ? { worker: builder ?? ORCHESTRATION_BUILD_WORKER, chat: 'new', instruction: step.reason, reviewOf: null, buildRef: step.build.ticket }
            : { worker: step.worker, chat: step.chat, instruction: step.instruction, reviewOf: step.review_of ?? null, buildRef: null };
          orm
            .insert(orchestrationSteps)
            .values({ runId, stepId: step.id, position, ...values, ...ruleOf(step.rule), dependsOn: JSON.stringify(step.depends_on), state: 'proposed', approvedBy: null, sessionId: null, buildRunId: null })
            .run();
        });
        moveRun(runId, 'awaiting_user');
        events.append({ type: 'orchestration.plan_proposed', workspaceId, streamId: workspaceId, payload: { runId, plan } });
        for (const step of plan.steps) events.append({ type: 'orchestration.step_proposed', workspaceId, streamId: workspaceId, payload: { runId, stepId: step.id } });
      });
      // Under Dispatch automatically the run begins at once: core sends the first step itself, within the run's limits.
      if (syncMode(workspaceId, requireRun(workspaceId, runId)).mode === 'automatic') await advanceNow(workspaceId, runId);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    getRouting(workspaceId) {
      feature.requireOrchestration(workspaceId);
      return readRoutingRules(orm, workspaceId) ?? [];
    },

    setRouting(workspaceId, request) {
      feature.requireOrchestration(workspaceId);
      return events.transaction(() => {
        const current = readRoutingRules(orm, workspaceId) ?? [];
        const next = checkRoutingRequest(request, current);
        if (!sameRules(current, next)) {
          writeRoutingRules(orm, workspaceId, next);
          events.append({ type: 'orchestration.routing_changed', workspaceId, streamId: workspaceId, payload: { ruleIds: next.map((rule) => rule.id), previousRuleIds: current.map((rule) => rule.id) } });
        }
        return next;
      });
    },

    async listRuns(workspaceId) {
      feature.requireOrchestration(workspaceId);
      const rows = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.workspaceId, workspaceId)).orderBy(desc(orchestrationRuns.createdAt), desc(orchestrationRuns.id)).limit(ORCHESTRATION_RUNS_PAGE).all();
      const names = await labels(workspaceId);
      const views: OrchestrationRunView[] = [];
      for (const row of rows) views.push(await readBack(workspaceId, row, names));
      return views;
    },

    async getRun(workspaceId, runId) {
      feature.requireOrchestration(workspaceId);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async approveStep(workspaceId, runId, stepId, expectedInstruction) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      events.transaction(() => {
        const step = requireStep(run.id, stepId);
        const all = stepsOf(run.id);
        // Approval is the user's, never the manager's, and only while the run is open and what the step needs is done.
        const needsDone = stepOf(step).dependsOn.every((id) => all.find((other) => other.stepId === id)?.state === 'done');
        const open = isOpen(orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get()?.state ?? run.state);
        // When the page says which text the user read, a step edited since (another tab) is not approved: the user approves what they saw.
        const sameText = expectedInstruction === undefined || expectedInstruction === step.instruction;
        // A build step is not approved like an instruction: the person starts it in the Build dialog and the plan follows (15.11).
        if (step.buildRef !== null || step.state !== 'proposed' || !canMoveStep('proposed', 'approved') || !needsDone || !open || !sameText) throw new StepNotProposedError();
        orm.update(orchestrationSteps).set({ state: 'approved', approvedBy: 'user' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        events.append({ type: 'orchestration.step_approved', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, by: 'user' } });
      });
      // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
      kick(workspaceId, runId);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async editStep(workspaceId, runId, stepId, request) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      const parsed = EditOrchestrationStepRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError(ORCHESTRATION_EDIT_BAD_TEXT_MESSAGE, parsed.error.issues);
      // The same rule as the manager's text: a secret is refused, not quietly changed, so the user sees what is kept.
      if (redactSecrets(parsed.data.instruction) !== parsed.data.instruction) throw new ValidationError(ORCHESTRATION_EDIT_SECRET_MESSAGE, []);
      const text = parsed.data.instruction;
      events.transaction(() => {
        const step = requireStep(run.id, stepId);
        // A build step has a short reason and nothing to edit: it is a reference to a ticket (15.11).
        if (step.buildRef !== null) throw new StepNotChangeableError();
        // A question for the reviewer stays bounded (15.10), whoever writes it.
        if (step.reviewOf !== null && text.length > REVIEW_LIMITS.maxQuestionChars) throw new ValidationError(ORCHESTRATION_REVIEW_QUESTION_TOO_LONG_MESSAGE, []);
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || !isLive(live.state) || (step.state !== 'proposed' && step.state !== 'approved')) throw new StepNotChangeableError();
        if (step.instruction === text) return;
        // Whatever it was, the step waits for the user again: an approval never covers text the user had not approved.
        orm.update(orchestrationSteps).set({ instruction: text, state: 'proposed', approvedBy: null }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        events.append({ type: 'orchestration.step_edited', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, instruction: text } });
      });
      // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
      kick(workspaceId, runId);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async skipStep(workspaceId, runId, stepId) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      events.transaction(() => {
        const step = requireStep(run.id, stepId);
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || !isLive(live.state) || !canMoveStep(step.state as OrchestrationStepState, 'skipped')) throw new StepNotChangeableError();
        // A skipped step is never sent. The steps that need it keep waiting: approving one needs every prerequisite done.
        orm.update(orchestrationSteps).set({ state: 'skipped' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        const id = run.id as OrchestrationRun['id'];
        events.append({ type: 'orchestration.step_skipped', workspaceId, streamId: workspaceId, payload: { runId: id, stepId: step.stepId } });
        // Nothing left to do: the run is finished.
        if (canMoveRun(live.state as OrchestrationRunState, 'finished') && stepsOf(run.id).every((other) => other.state === 'done' || other.state === 'skipped')) {
          moveRun(run.id, 'finished');
          events.append({ type: 'orchestration.run_finished', workspaceId, streamId: workspaceId, payload: { runId: id } });
        }
      });
      // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
      kick(workspaceId, runId);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async reorderSteps(workspaceId, runId, request) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      const parsed = ReorderOrchestrationStepsRequest.safeParse(request);
      if (!parsed.success) throw new BadOrderError(ORCHESTRATION_ORDER_WORDS.not_every_step);
      const order = parsed.data.order;
      events.transaction(() => {
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || !isLive(live.state)) throw new RunNotOpenError();
        const current = stepsOf(run.id);
        const known = new Set(current.map((step) => step.stepId));
        if (order.length !== current.length || new Set(order).size !== order.length || !order.every((id) => known.has(id))) throw new BadOrderError(ORCHESTRATION_ORDER_WORDS.not_every_step);
        // A step that was already sent keeps its place.
        const sent = (state: string) => state === 'dispatched' || state === 'done' || state === 'failed';
        current.forEach((step, at) => {
          if (sent(step.state) && order[at] !== step.stepId) throw new BadOrderError(ORCHESTRATION_ORDER_WORDS.sent_step_moved);
        });
        // Every step comes after every step it needs.
        const at = new Map(order.map((id, index) => [id, index]));
        for (const step of current) {
          for (const need of stepOf(step).dependsOn) {
            if ((at.get(need) ?? 0) > (at.get(step.stepId) ?? 0)) throw new BadOrderError(ORCHESTRATION_ORDER_WORDS.prerequisite(step.stepId, need));
          }
        }
        if (order.every((id, index) => current[index]!.stepId === id)) return;
        order.forEach((id, position) => {
          orm.update(orchestrationSteps).set({ position }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, id))).run();
        });
        events.append({ type: 'orchestration.steps_reordered', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], order } });
      });
      // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
      kick(workspaceId, runId);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async stopRun(workspaceId, runId) {
      // Stop is never blockable (15.8): it does not ask the Orchestration piece's guard, so it works with the piece switched off. It still
      // reaches only a run of this project (an unknown project or run is not found).
      const run = requireRun(workspaceId, runId);
      const inFlight = workersInFlight(workspaceId, run);
      closeRun(workspaceId, run, 'stopped', 'user', inFlight, true);
      // The manager call in flight is abandoned, and each worker turn in flight is asked to stop.
      planning.get(run.id)?.abort();
      cancelTurns(workspaceId, inFlight);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async activity(workspaceId) {
      feature.requireOrchestration(workspaceId);
      return activityOf(workspaceId);
    },

    async linkBuild(workspaceId, runId, stepId, request) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      const parsed = LinkOrchestrationBuildRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError(ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE, parsed.error.issues);
      events.transaction(() => {
        const step = requireStep(run.id, stepId);
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || !isOpen(live.state)) throw new RunNotOpenError();
        const all = stepsOf(run.id);
        const needsDone = stepOf(step).dependsOn.every((id) => all.find((other) => other.stepId === id)?.state === 'done');
        if (step.buildRef === null || step.state !== 'proposed' || !canMoveStep('proposed', 'approved') || !canMoveStep('approved', 'dispatched') || !needsDone) throw new StepNotProposedError();
        // The run must be the build the person started for this ticket here: a run of this project, of this ticket, begun after this plan,
        // and not the run of another step. Nothing is started and nothing is decided by this.
        const build = orm.select().from(runsTable).where(eq(runsTable.id, parsed.data.runId)).get();
        const taken = orm.select({ stepId: orchestrationSteps.stepId }).from(orchestrationSteps).where(eq(orchestrationSteps.buildRunId, parsed.data.runId)).get();
        if (build === undefined || build.workspaceId !== workspaceId || build.ticketRef !== step.buildRef || !(Date.parse(build.createdAt) >= Date.parse(live.createdAt)) || taken !== undefined) {
          throw new ValidationError(ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE, []);
        }
        orm.update(orchestrationSteps).set({ state: 'dispatched', approvedBy: 'user', buildRunId: build.id }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        moveRun(run.id, 'running');
        events.append({ type: 'orchestration.build_linked', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, ticketRef: step.buildRef, buildRunId: build.id as OrchestrationBuildRunView['runId'] } });
      });
      // A build that already ended settles at once; the run goes on from its result.
      void scheduleAdvance(workspaceId, run.id);
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async answerQuestion(workspaceId, runId, request) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      const parsed = AnswerOrchestrationQuestionRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError(ORCHESTRATION_ANSWER_BAD_TEXT_MESSAGE, parsed.error.issues);
      // The same rule as an edit: a secret is refused, not quietly changed, so the user sees what is kept.
      if (redactSecrets(parsed.data.answer) !== parsed.data.answer) throw new ValidationError(ORCHESTRATION_ANSWER_SECRET_MESSAGE, []);
      events.transaction(() => {
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || !isLive(live.state)) throw new RunNotOpenError();
        // Only a question the manager asked and the user has not answered: the answer goes once.
        const loop = loopOf(workspaceId, run.id);
        if (loop.decision?.action !== 'ask_user' || loop.owed !== null || stepsOf(run.id).some((step) => step.state === 'dispatched')) throw new NoQuestionPendingError();
        events.append({ type: 'orchestration.question_answered', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], answer: parsed.data.answer } });
      });
      // The answer is data for the manager's next decision.
      void scheduleAdvance(workspaceId, run.id);
      return readBack(workspaceId, requireRun(workspaceId, runId), undefined, true);
    },

    async resume() {
      let picked = 0;
      const open = orm.select().from(orchestrationRuns).where(inArray(orchestrationRuns.state, ['planning', 'awaiting_user', 'running', 'paused'])).all();
      for (const row of open) {
        const workspaceId = row.workspaceId as WorkspaceId;
        try {
          if (!feature.enabled(workspaceId)) continue;
          if (row.state === 'planning') {
            // The manager was making the plan when the app stopped: nothing was stored, nothing was sent, so the run ends plainly. A run that
            // already holds a plan was asking for its next decision: it goes back to waiting and the decision is asked for again.
            if (stepsOf(row.id).length === 0) {
              closeRun(workspaceId, row, 'failed', 'restarted', [], false);
              continue;
            }
            events.transaction(() => moveRun(row.id, 'awaiting_user'));
          }
          events.append({ type: 'orchestration.run_resumed', workspaceId, streamId: workspaceId, payload: { runId: row.id as OrchestrationRun['id'], reason: 'restart' } });
          picked += 1;
          // Settles what finished, asks for a decision that was owed, re-arms the time limit (counted from the run's start) and goes on; an
          // instruction already sent is never sent again, because only a step still waiting or approved by the mode is ever dispatched.
          void scheduleAdvance(workspaceId, row.id);
        } catch {
          // A run whose project is gone is not picked up.
        }
      }
      return picked;
    },

    whenIdle: async () => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },

    async dispatchStep(workspaceId, runId, stepId) {
      feature.requireOrchestration(workspaceId);
      // The mode is the project's own as it is now: a run switched back to Approve each instruction no longer takes the mode's approvals.
      const run = syncMode(workspaceId, requireRun(workspaceId, runId));
      const row = requireStep(run.id, stepId);
      // No orchestration path sends a build (15.11): it is started only in the Build dialog, whoever asks and in either mode.
      if (row.buildRef !== null) throw new StepNotApprovedError();
      // The rule that matters, in code: only a step the user approved is ever sent. Checked before anything is created.
      if (row.state !== 'approved' || row.approvedBy === null || !isOpen(run.state)) throw new StepNotApprovedError();
      // In the default mode only the user's own approval counts, and what a step needs must be done (belt and braces: approval checked both).
      if (run.mode === 'approve_each' && row.approvedBy !== 'user') throw new StepNotApprovedError();
      const needs = stepOf(row).dependsOn;
      if (needs.some((id) => stepsOf(run.id).find((other) => other.stepId === id)?.state !== 'done')) throw new StepNotApprovedError();
      const key = `${run.id}:${row.stepId}`;
      if (sending.has(key)) throw new StepNotApprovedError();
      sending.add(key);
      try {
        // Everything that can be refused is checked before a chat is made, so a refusal leaves every chat as it was (15.7).
        const label = await requireWorkerReady(workspaceId, row);
        // A review step sends the manager's question with a capped, masked summary of the reviewed result, built here (15.10).
        const message = row.reviewOf === null ? row.instruction : await reviewMessageFor(workspaceId, run, row, label);
        const named = row.chat === 'new' ? undefined : row.chat;
        if (named !== undefined) requireChatReady(workspaceId, row, named, label);
        // The run may have been stopped, or the step edited, while the worker was checked: nothing is created then.
        const stillApproved = (): StepRow => {
          const again = syncMode(workspaceId, requireRun(workspaceId, runId));
          const current = requireStep(run.id, row.stepId);
          // What is sent is the text the user approved: an edit meanwhile sent the step back to waiting, and a changed text is never sent.
          if (current.state !== 'approved' || current.approvedBy === null || current.instruction !== row.instruction || !isOpen(again.state)) throw new StepNotApprovedError();
          if (again.mode === 'approve_each' && current.approvedBy !== 'user') throw new StepNotApprovedError();
          return current;
        };
        stillApproved();
        // The worker's own chat, in its own mode: a new one is created with the worker's default (this never sets one), an existing one keeps the mode it is in.
        let session: { id: SessionId };
        if (named !== undefined) session = { id: named as SessionId };
        else {
          try {
            session = await chat.createChatSession(workspaceId, { kind: 'chat', agentId: row.worker });
          } catch (error) {
            if (error instanceof AgentNotReadyError) throw new DispatchRefusedError(reasonOf(error.code), dispatchRefusalWords(reasonOf(error.code), label));
            if (error instanceof UnknownAgentError) throw new DispatchRefusedError('worker_not_on_team', dispatchRefusalWords('worker_not_on_team', label));
            throw error;
          }
        }
        const made = named === undefined;
        /** A chat made for this step that did not get its instruction: named so it is not mistaken for work, never sent into twice. */
        const leaveUnsent = (): void => {
          if (!made) return;
          try {
            chat.renameSession(workspaceId, session.id, `Not sent: step ${row.stepId}`);
          } catch {
            // The name is a courtesy; the step records the chat.
          }
        };
        let current: StepRow;
        try {
          current = stillApproved();
        } catch (error) {
          leaveUnsent();
          throw error;
        }
        if (named !== undefined) requireChatReady(workspaceId, row, named, label);
        try {
          const sent = chat.sendMessage(workspaceId, session.id, current.reviewOf === null ? current.instruction : message, { origin: current.approvedBy === 'mode' ? 'manager_auto' : 'manager' });
          if (sent.queued) {
            // The chat took it to wait behind a turn that was still ending: it is not an instruction at once, so it is taken back.
            let taken = true;
            try {
              chat.removeQueuedMessage(workspaceId, session.id, sent.messageId);
            } catch {
              // It was sent meanwhile: it counts as sent, and the step reads back like any other.
              taken = false;
            }
            if (taken) throw new DispatchRefusedError('chat_busy', dispatchRefusalWords('chat_busy', label));
          }
        } catch (error) {
          const refusal =
            error instanceof DispatchRefusedError
              ? error
              : error instanceof DriverIsTerminalError
                ? new DispatchRefusedError('driver_is_terminal', dispatchRefusalWords('driver_is_terminal', label))
                : error instanceof SessionNotIdleError || error instanceof SessionBusyError || error instanceof QueueFullError
                  ? new DispatchRefusedError('chat_busy', dispatchRefusalWords('chat_busy', label))
                  : undefined;
          // The worker's own chat took nothing: whatever the reason, the step and the chat are left as they were.
          if (named !== undefined) throw refusal ?? error;
          // A chat made for this step exists but did not take the instruction (or nobody can tell): the step is failed and says which chat, so a retry never sends twice.
          events.transaction(() => {
            orm.update(orchestrationSteps).set({ state: 'failed', sessionId: session.id }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, row.stepId))).run();
            // As a worker's own error does at read-back: a failed step is final, so the run stops here, plainly.
            const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
            if (live !== undefined && !isRunOver(live.state as OrchestrationRunState)) {
              moveRun(run.id, 'failed', 'worker_error');
              events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'worker_error' } });
            }
          });
          leaveUnsent();
          throw refusal ?? error;
        }
        events.transaction(() => {
          orm.update(orchestrationSteps).set({ state: 'dispatched', sessionId: session.id }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, row.stepId))).run();
          moveRun(run.id, 'running');
          events.append({ type: 'orchestration.step_dispatched', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: row.stepId, worker: row.worker, sessionId: session.id } });
        });
      } catch (error) {
        // A refused dispatch leaves an event (15.8), so a restart and the activity log still show it, and the plain words with it.
        if (error instanceof DispatchRefusedError) noteRefusal(workspaceId, run.id, row, error);
        throw error;
      } finally {
        sending.delete(key);
      }
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },
  };
  return api;
}
