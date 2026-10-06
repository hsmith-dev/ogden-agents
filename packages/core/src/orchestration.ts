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
  canMoveRun,
  canMoveStep,
  makeStatusReport,
  redactSecrets,
  MANAGER_LIMITS,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  type ManagerStatusView,
  type ManagerPlan,
  type ManagerStatusReport,
  type OrchestrationRunState,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { orchestrationRuns, orchestrationSteps } from './db/schema.js';
import { ManagerFailedError, ManagerUnavailableError, NotFoundError, StepNotApprovedError, StepNotProposedError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { OrchestrationFeature } from './orchestration-feature.js';
import type { ManagerContext, ManagerPort, ManagerRecord } from './manager-port.js';
import type { ManagerSource } from './manager-source.js';
import type { Team } from './team-roster.js';
import type { Chat } from './chat/types.js';
import { newId } from './ids.js';

/** What the use-case needs of the chat: the same calls the chat page makes, nothing else. */
export type OrchestrationChat = Pick<Chat, 'chatAgents' | 'createChatSession' | 'sendMessage' | 'getSession'>;

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
  approveStep(workspaceId: WorkspaceId, runId: string, stepId: string): Promise<OrchestrationRunView>;
  /** Sends an approved step's instruction into a new worker chat. {@link StepNotApprovedError} for any step not approved, before anything is created. */
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
const REPLY_WINDOW = Math.min(MAX_PAGE_EVENTS, 200);

const isOpen = (state: string): boolean => state === 'awaiting_user' || state === 'running';

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

  /** The worker chat's last reply, as plain text: its newest finished agent message. */
  const lastReply = (workspaceId: WorkspaceId, sessionId: SessionId): string => {
    const page = events.readBefore(workspaceId, events.lastSeq() + 1, REPLY_WINDOW, sessionId);
    for (let at = page.events.length - 1; at >= 0; at--) {
      const event = page.events[at]!;
      if (event.type === 'session.message_completed' && event.payload.role === 'agent') return event.payload.content;
    }
    return '';
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
        report = makeStatusReport({ stepId: step.stepId, worker: step.worker, state: sessionState, text: lastReply(workspaceId, step.sessionId) });
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
      const addressable = rostered === undefined ? agents : agents.filter((agent) => rostered.some((worker) => worker.agentId === agent.agentId));
      const context: ManagerContext = {
        goal,
        projectSummary: 'A software project in the folder the user opened.',
        workers: addressable.map((agent) => ({
          agentId: agent.agentId,
          label: agent.displayName,
          ready: rostered === undefined ? agent.unavailable === undefined : (rostered.find((worker) => worker.agentId === agent.agentId)?.ready ?? false),
          modes: agent.permissionModes,
          chats: [],
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
      try {
        result = await manager.proposePlan(context);
      } catch {
        // The port promises not to throw; if one does, the run is closed, never left planning.
        result = { ok: false, kind: 'unavailable', reason: 'The manager is not available right now.' };
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

    async approveStep(workspaceId, runId, stepId) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      events.transaction(() => {
        const step = requireStep(run.id, stepId);
        const all = stepsOf(run.id);
        // Approval is the user's, never the manager's, and only while the run is open and what the step needs is done.
        const needsDone = stepOf(step).dependsOn.every((id) => all.find((other) => other.stepId === id)?.state === 'done');
        const open = isOpen(run.state);
        if (step.state !== 'proposed' || !canMoveStep('proposed', 'approved') || !needsDone || !open) throw new StepNotProposedError();
        orm.update(orchestrationSteps).set({ state: 'approved', approvedBy: 'user' }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, step.stepId))).run();
        events.append({ type: 'orchestration.step_approved', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, by: 'user' } });
      });
      return readBack(workspaceId, requireRun(workspaceId, runId));
    },

    async dispatchStep(workspaceId, runId, stepId) {
      feature.requireOrchestration(workspaceId);
      const run = requireRun(workspaceId, runId);
      const row = requireStep(run.id, stepId);
      // The rule that matters, in code: only a step the user approved is ever sent. Checked before anything is created.
      if (row.state !== 'approved' || row.approvedBy === null || !isOpen(run.state)) throw new StepNotApprovedError();
      const key = `${run.id}:${row.stepId}`;
      if (sending.has(key)) throw new StepNotApprovedError();
      sending.add(key);
      try {
        // The worker's own chat: created in its own default mode (this never sets one), then told the instruction as the manager's, at the user's approval.
        const session = await chat.createChatSession(workspaceId, { kind: 'chat', agentId: row.worker });
        // The run may have been closed while the chat was made: nothing is sent then.
        const again = requireRun(workspaceId, runId);
        const current = requireStep(run.id, row.stepId);
        if (current.state !== 'approved' || !isOpen(again.state)) throw new StepNotApprovedError();
        try {
          chat.sendMessage(workspaceId, session.id, row.instruction, { origin: 'manager' });
        } catch (error) {
          // The chat exists but did not take the instruction: the step is failed and says which chat, so a retry never sends twice.
          events.transaction(() => {
            orm.update(orchestrationSteps).set({ state: 'failed', sessionId: session.id }).where(and(eq(orchestrationSteps.runId, run.id), eq(orchestrationSteps.stepId, row.stepId))).run();
          });
          throw error;
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
