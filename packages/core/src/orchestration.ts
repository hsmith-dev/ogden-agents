/**
 * The Orchestration use-case (epic 15, stories 15.3 to 15.12; cut into modules by 15.13): a goal reaches the manager, its validated plan is
 * stored as proposed steps, the user approves them (or, under Dispatch automatically, core sends them within the run's limits), each approved
 * instruction is sent through the chat's own `sendMessage` into a worker chat marked as sent by the manager, and the worker's result is read
 * back masked and capped.
 *
 * This file is the public shape ({@link Orchestration}) and the assembly. The work is in the modules beside it, each taking the collaborators
 * and the modules before it (see `orchestration-kernel.ts`):
 * - `orchestration-rows`: the stored runs and steps, the run's transitions, the mode brought to the project's own;
 * - `orchestration-transcript`, `-loop-state`, `-build-read`: read only views of a worker's chat, a run's loop and a build run;
 * - `orchestration-manager-io`: the manager, the workers it may address, the plan and a decision as recorded;
 * - `orchestration-review`: the reviewer's message and where its result is looked at;
 * - `orchestration-run`: start a run, close a run, the limits, restart pick up;
 * - `orchestration-readback`, `-activity`: the page's read of a run and the project's activity log;
 * - `orchestration-dispatch`: sending one approved step;
 * - `orchestration-engine`: the automatic engine and the loop's decisions;
 * - `orchestration-actions`: the user's own actions (approve, edit, skip, reorder, Stop, answer, link a build);
 * - `orchestration-routing`: the routing rules.
 *
 * Every use calls core's Orchestration guard first, except Stop, which is never blockable. A manager's text is masked before it is stored,
 * evented or sent. The manager is a port; no module names a model product or imports a shell, file or credential port (architecture tests).
 */
import type { ManagerStatusView, OrchestrationActivityEntry, OrchestrationRunView, RoutingRule, WorkspaceId } from '@ogden-agents/shared';
import type { OrchestrationChat, OrchestrationOptions } from './orchestration-kernel.js';
import type { Base, Late } from './orchestration-kernel.js';
import { createActions } from './orchestration-actions.js';
import { createActivity } from './orchestration-activity.js';
import { createBuildRead } from './orchestration-build-read.js';
import { createDispatch } from './orchestration-dispatch.js';
import { createEngine } from './orchestration-engine.js';
import { createLoopState } from './orchestration-loop-state.js';
import { createManagerIo, NO_READY_WORKER } from './orchestration-manager-io.js';
import { createReadBack } from './orchestration-readback.js';
import { createReview } from './orchestration-review.js';
import { createRouting } from './orchestration-routing.js';
import { createRows } from './orchestration-rows.js';
import { createRun } from './orchestration-run.js';
import { createTranscript } from './orchestration-transcript.js';

export type { OrchestrationChat, OrchestrationOptions };
export { NO_READY_WORKER };

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

export function createOrchestration({ db, events, feature, chat, manager, managers, team, limits, clock, buildable, builder }: OrchestrationOptions): Orchestration {
  const nowMs = clock ?? Date.now;
  const base: Base = {
    orm: db.orm,
    events,
    feature,
    chat,
    fixedManager: manager,
    managers,
    team,
    buildable,
    builder,
    runLimits: limits,
    nowMs,
    now: () => new Date(nowMs()).toISOString(),
    sending: new Set(),
    planning: new Map(),
    timers: new Map(),
  };
  // The engine, the tell and the read-back call each other: these three are bound once they are made, and only called when a use runs.
  const late: Late = {
    scheduleAdvance: (workspaceId, runId) => engine.scheduleAdvance(workspaceId, runId),
    tell: (...args) => engine.tell(...args),
    readBack: (...args) => readback.readBack(...args),
  };
  const withRows = { ...base, ...late, ...createRows(base) };
  const withTranscript = { ...withRows, ...createTranscript(withRows) };
  const withLoop = { ...withTranscript, ...createLoopState(withTranscript) };
  const withBuilds = { ...withLoop, ...createBuildRead(withLoop) };
  const withManager = { ...withBuilds, ...createManagerIo(withBuilds) };
  const withReview = { ...withManager, ...createReview(withManager) };
  const withRun = { ...withReview, ...createRun(withReview) };
  const readback = createReadBack(withRun);
  const withReadBack = { ...withRun, ...readback };
  const withDispatch = { ...withReadBack, ...createDispatch(withReadBack) };
  const engine = createEngine(withDispatch);
  const withEngine = { ...withDispatch, ...engine };
  const actions = createActions(withEngine);
  const { startRun, resume } = withRun;
  const { statusOf } = withManager;
  const { listRuns, getRun } = readback;
  const { activity } = createActivity(withManager);
  const routing = createRouting({ orm: db.orm, events, feature });

  return {
    managerStatus(workspaceId) {
      feature.requireOrchestration(workspaceId);
      return statusOf(workspaceId);
    },
    startRun,
    listRuns,
    getRun,
    ...actions,
    activity,
    ...routing,
    resume,
    whenIdle: engine.whenIdle,
    dispatchStep: withDispatch.dispatchStep,
  };
}
