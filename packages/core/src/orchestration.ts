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
  MAX_PAGE_EVENTS,
  ORCHESTRATION_RUNS_PAGE,
  OrchestrationRunId as OrchestrationRunIdSchema,
  ManagerStepId,
  OrchestrationRun,
  OrchestrationStep,
  OrchestrationStepView,
  OrchestrationRunView,
  RUN_LIMITS,
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
  redactSecrets,
  dispatchRefusalWords,
  type DispatchRefusalReason,
  MANAGER_LIMITS,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  type ManagerStatusView,
  type ManagerPlan,
  type ManagerStatusReport,
  type OrchestrationRunState,
  type OrchestrationStepState,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { orchestrationRuns, orchestrationSteps } from './db/schema.js';
import { AgentNotReadyError, BadOrderError, DispatchRefusedError, DriverIsTerminalError, ManagerFailedError, ManagerUnavailableError, NotFoundError, QueueFullError, RunNotOpenError, SessionBusyError, SessionNotIdleError, StepNotApprovedError, StepNotChangeableError, StepNotProposedError, UnknownAgentError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { OrchestrationFeature } from './orchestration-feature.js';
import type { ManagerContext, ManagerPort, ManagerRecord } from './manager-port.js';
import type { ManagerSource } from './manager-source.js';
import { isSubscription, type Team } from './team-roster.js';
import type { Chat } from './chat/types.js';
import { newId } from './ids.js';

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
  });

export function createOrchestration({ db, events, feature, chat, manager: fixedManager, managers, team }: OrchestrationOptions): Orchestration {
  const { orm } = db;
  const now = () => new Date().toISOString();
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
    if (!canMoveRun(row.state as OrchestrationRunState, to)) return;
    orm.update(orchestrationRuns).set({ state: to, stopReason: stopReason ?? row.stopReason, updatedAt: now() }).where(eq(orchestrationRuns.id, runId)).run();
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
  const lastReply = (workspaceId: WorkspaceId, sessionId: SessionId, instruction: string): string => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    let reply = '';
    const calls = new Map<string, string>();
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'session.message_completed') {
        if (event.payload.role === 'agent') {
          if (reply === '') reply = event.payload.content;
        } else if (event.payload.origin === 'manager' && event.payload.content === instruction) break;
      } else if (event.type === 'session.tool_call' || event.type === 'session.tool_call_updated') {
        // Newest first: the first time a call is seen is its latest status.
        if (!calls.has(event.payload.toolCallId)) calls.set(event.payload.toolCallId, `${event.payload.title.replace(/\s+/g, ' ').trim().slice(0, 80)} (${event.payload.status})`);
      }
    }
    const shown = [...calls.values()].slice(0, TOOL_CALLS_SHOWN).reverse();
    const tools = shown.length === 0 ? '' : `Tool calls${calls.size > shown.length ? ` (the last ${shown.length} of ${calls.size})` : ''}: ${shown.join('; ')}`.slice(0, TOOL_CALLS_CHARS);
    return tools === '' ? reply : reply === '' ? tools : `${tools}\n\n${reply}`;
  };

  /** Reads back every dispatched step: its chat's state and a masked, capped report; settles a finished one once. */
  const readBack = async (workspaceId: WorkspaceId, run: RunRow, known?: Map<string, string>): Promise<OrchestrationRunView> => {
    const names = known ?? (await labels(workspaceId));
    const views: OrchestrationStepView[] = [];
    for (const row of stepsOf(run.id)) {
      let step = stepOf(row);
      let sessionState: OrchestrationStepView['sessionState'] = null;
      let report: ManagerStatusReport | null = null;
      if (step.sessionId !== null) {
        try {
          sessionState = chat.getSession(workspaceId, step.sessionId).state;
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
          // The chat is gone (its history was deleted): the step reads as failed.
          sessionState = 'error';
        }
        report = makeStatusReport({ stepId: step.stepId, worker: step.worker, state: sessionState, text: lastReply(workspaceId, step.sessionId, step.instruction) });
        const finished = sessionState === 'idle' || sessionState === 'done';
        if (step.state === 'dispatched' && (finished || sessionState === 'error')) {
          const to = finished ? 'done' : 'failed';
          const settled = events.transaction(() => {
            // Read again inside the transaction: a concurrent read may have settled it, and the event goes once.
            const current = requireStep(run.id, step.stepId);
            if (current.state !== 'dispatched' || !canMoveStep('dispatched', to)) return false;
            orm.update(orchestrationSteps).set({ state: to }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
            events.append({ type: 'orchestration.result_read', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], report: report! } });
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
          if (settled) step = { ...step, state: to };
        }
      }
      views.push(OrchestrationStepView.parse({ ...step, workerLabel: names.get(step.worker) ?? step.worker, sessionState, report }));
    }
    const fresh = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get() ?? run;
    return OrchestrationRunView.parse({ run: runOf(fresh), steps: views });
  };

  /** The worker's own chats the manager may continue: plain chats the terminal does not drive that are idle, newest first, a few. */
  const ownChats = (workspaceId: WorkspaceId, agentId: string) =>
    chat
      .listSessions(workspaceId)
      .filter((session) => session.kind === 'chat' && session.agentId === agentId && session.driver === 'ui' && session.state === 'idle')
      .reverse()
      .slice(0, CHATS_OFFERED)
      .map((session) => ({ sessionId: session.id, state: session.state }));

  /**
   * Whether `row`'s worker can be given an instruction now, checked before any chat is made. Plain refusals ({@link DispatchRefusedError}):
   * not on the team any more, its vendor allows only a person, it signs in with the user's account and the instruction was not
   * approved by the user one by one, not signed in, project not trusted, or not ready. The worker's own readiness is read again here: the
   * plan was checked when it was proposed, and the roster, the sign in or the mode may have changed since.
   */
  const requireWorkerReady = async (workspaceId: WorkspaceId, run: RunRow, row: StepRow): Promise<string> => {
    const { agents } = await chat.chatAgents(workspaceId);
    const agent = agents.find((candidate) => candidate.agentId === row.worker);
    const label = agent?.displayName ?? row.worker;
    const refuse = (reason: DispatchRefusalReason): never => {
      throw new DispatchRefusedError(reason, dispatchRefusalWords(reason, label));
    };
    if (agent === undefined) return refuse('worker_not_on_team');
    const rostered = team === undefined ? undefined : (await team.workers(workspaceId)).find((worker) => worker.agentId === row.worker);
    if (team !== undefined && rostered === undefined) return refuse('worker_not_on_team');
    // The vendor's terms, in code: an agent only a person may drive is never sent an instruction, and a subscription agent only takes the user's own approval.
    if (agent.interactiveOnly !== undefined) return refuse('interactive_only');
    if (isSubscription(agent) && (run.mode === 'automatic' || row.approvedBy !== 'user')) return refuse('approve_each_only');
    if (agent.unavailable !== undefined) return refuse(reasonOf(agent.unavailable.code));
    if (rostered !== undefined && !rostered.ready) return refuse('worker_not_ready');
    return label;
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
    if (session.driver === 'terminal') return refuse('driver_is_terminal');
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

  const masked = (plan: ManagerPlan): ManagerPlan => ({ ...plan, goal: redactSecrets(plan.goal), steps: plan.steps.map((step) => ({ ...step, instruction: redactSecrets(step.instruction) })) });

  return {
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

      const { agents } = await chat.chatAgents(workspaceId);
      // Only the rostered workers (15.5): the project's worker and its reviewer when that is an agent. Without a roster, every agent.
      const rostered = team === undefined ? undefined : await team.workers(workspaceId);
      const addressable = rostered === undefined ? agents : rostered.flatMap((worker) => agents.filter((agent) => agent.agentId === worker.agentId));
      const context: ManagerContext = {
        goal,
        projectSummary: 'A software project in the folder the user opened.',
        workers: addressable.map((agent) => ({
          agentId: agent.agentId,
          label: agent.displayName,
          ready: rostered === undefined ? agent.unavailable === undefined : (rostered.find((worker) => worker.agentId === agent.agentId)?.ready ?? false),
          modes: agent.permissionModes,
          chats: ownChats(workspaceId, agent.agentId),
        })),
      };
      if (team !== undefined && !context.workers.some((worker) => worker.ready)) throw new ManagerUnavailableError(NO_READY_WORKER);
      const runId = newId('orc') as OrchestrationRun['id'];
      const at = now();
      events.transaction(() => {
        orm.insert(orchestrationRuns).values({ id: runId, workspaceId, goal, state: 'planning', mode: DEFAULT_ORCHESTRATION_MODE, limits: JSON.stringify(RUN_LIMITS), stopReason: null, createdAt: at, updatedAt: at }).run();
        events.append({ type: 'orchestration.run_started', workspaceId, streamId: workspaceId, payload: { runId, goal, mode: DEFAULT_ORCHESTRATION_MODE, limits: RUN_LIMITS } });
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
      events.transaction(() => {
        noteReply(workspaceId, runId, result.record);
        plan.steps.forEach((step, position) => {
          orm
            .insert(orchestrationSteps)
            .values({ runId, stepId: step.id, position, worker: step.worker, chat: step.chat, instruction: step.instruction, dependsOn: JSON.stringify(step.depends_on), state: 'proposed', approvedBy: null, sessionId: null })
            .run();
        });
        moveRun(runId, 'awaiting_user');
        events.append({ type: 'orchestration.plan_proposed', workspaceId, streamId: workspaceId, payload: { runId, plan } });
        for (const step of plan.steps) events.append({ type: 'orchestration.step_proposed', workspaceId, streamId: workspaceId, payload: { runId, stepId: step.id } });
      });
      return readBack(workspaceId, requireRun(workspaceId, runId));
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
        if (step.state !== 'proposed' || !canMoveStep('proposed', 'approved') || !needsDone || !open || !sameText) throw new StepNotProposedError();
        orm.update(orchestrationSteps).set({ state: 'approved', approvedBy: 'user' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        events.append({ type: 'orchestration.step_approved', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, by: 'user' } });
      });
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
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || !isLive(live.state) || (step.state !== 'proposed' && step.state !== 'approved')) throw new StepNotChangeableError();
        if (step.instruction === text) return;
        // Whatever it was, the step waits for the user again: an approval never covers text the user had not approved.
        orm.update(orchestrationSteps).set({ instruction: text, state: 'proposed', approvedBy: null }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        events.append({ type: 'orchestration.step_edited', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, instruction: text } });
      });
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
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async stopRun(workspaceId, runId) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      // Worker turns still going are found before the run is closed (the chat states are read, not changed).
      const inFlight = stepsOf(run.id)
        .filter((step) => step.state === 'dispatched' && step.sessionId !== null)
        .filter((step) => {
          try {
            const state = chat.getSession(workspaceId, step.sessionId as SessionId).state;
            return state === 'working' || state === 'waiting';
          } catch {
            return false;
          }
        });
      events.transaction(() => {
        const live = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, run.id)).get();
        if (live === undefined || isRunOver(live.state as OrchestrationRunState)) throw new RunNotOpenError();
        moveRun(run.id, 'stopped', 'user');
        // A step whose worker was cut off did not finish: it is failed, not done.
        for (const step of inFlight) orm.update(orchestrationSteps).set({ state: 'failed' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId), eq(orchestrationSteps.state, 'dispatched'))).run();
        events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason: 'user' } });
      });
      // The manager call in flight is abandoned, and each worker turn in flight is asked to stop. A turn that ended on its own meanwhile is no error.
      planning.get(run.id)?.abort();
      for (const step of inFlight) {
        try {
          chat.cancel(workspaceId, step.sessionId as SessionId);
        } catch {
          // Not busy any more, or the chat is gone: nothing left to stop.
        }
      }
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async dispatchStep(workspaceId, runId, stepId) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      const row = requireStep(run.id, stepId);
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
        const label = await requireWorkerReady(workspaceId, run, row);
        const named = row.chat === 'new' ? undefined : row.chat;
        if (named !== undefined) requireChatReady(workspaceId, row, named, label);
        // The run may have been stopped, or the step edited, while the worker was checked: nothing is created then.
        const stillApproved = (): StepRow => {
          const again = requireRun(workspaceId, runId);
          const current = requireStep(run.id, row.stepId);
          // What is sent is the text the user approved: an edit meanwhile sent the step back to waiting, and a changed text is never sent.
          if (current.state !== 'approved' || current.approvedBy === null || current.instruction !== row.instruction || !isOpen(again.state)) throw new StepNotApprovedError();
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
          const sent = chat.sendMessage(workspaceId, session.id, current.instruction, { origin: 'manager' });
          if (sent.queued) {
            // The chat took it to wait behind a turn that was still ending: it is not an instruction at once, so it is taken back.
            try {
              chat.removeQueuedMessage(workspaceId, session.id, sent.messageId);
            } catch {
              // It was sent meanwhile; the step then reads back like any other.
            }
            throw new DispatchRefusedError('chat_busy', dispatchRefusalWords('chat_busy', label));
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
          if (named !== undefined && refusal !== undefined) throw refusal;
          // A chat made for this step exists but did not take the instruction (or nobody can tell): the step is failed and says which chat, so a retry never sends twice.
          events.transaction(() => {
            orm.update(orchestrationSteps).set({ state: 'failed', sessionId: session.id }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, row.stepId))).run();
          });
          leaveUnsent();
          throw refusal ?? error;
        }
        events.transaction(() => {
          orm.update(orchestrationSteps).set({ state: 'dispatched', sessionId: session.id }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, row.stepId))).run();
          moveRun(run.id, 'running');
          events.append({ type: 'orchestration.step_dispatched', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: row.stepId, worker: row.worker, sessionId: session.id } });
        });
      } finally {
        sending.delete(key);
      }
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },
  };
}
