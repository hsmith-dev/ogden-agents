/**
 * The life of an orchestration run (epic 15, story 15.13): starting one from a goal (the manager's plan is stored as proposed steps), ending
 * one (a limit, a refusal, a Deny, an error or the user's Stop all go through {@link closeRun}), the limits and the time limit's timer, the
 * workers a close has to stop, and picking runs up after a restart. The user's own actions on a run (approve, edit, skip, reorder, Stop) are
 * `orchestration-actions.ts`; this file never names them.
 */
import {
  ORCHESTRATION_BUILD_WORKER,
  ORCHESTRATION_NO_MANAGER_MESSAGE,
  OrchestrationRun,
  RUN_LIMITS,
  RunLimits as RunLimitsSchema,
  StartOrchestrationRunRequest,
  isManagerBuildStep,
  isRunOver,
  redactSecrets,
  type OrchestrationRunState,
  type OrchestrationStopReason,
  type RunLimits,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { inArray } from 'drizzle-orm';
import { orchestrationRuns, orchestrationSteps } from './db/schema.js';
import { ManagerFailedError, ManagerUnavailableError, RunNotOpenError, ValidationError } from './errors.js';
import type { ManagerPort } from './manager-port.js';
import { newId } from './ids.js';
import type { Base, Late, RunRow, StepRow } from './orchestration-kernel.js';
import { NO_READY_WORKER, type ManagerIoApi } from './orchestration-manager-io.js';
import type { RowsApi } from './orchestration-rows.js';

export function createRun(k: Base & Late & RowsApi & ManagerIoApi) {
  const { orm, events, feature, chat, fixedManager, managers, team, runLimits, builder, planning, timers, now, requireRun, stepsOf, failIfDispatched, findRun, moveRun, projectModeOf, syncMode, statusOf, workerContext, noteReply, masked } = k;

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

  const disarm = (runId: string): void => {
    const timer = timers.get(runId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(runId);
  };

  /**
   * The closing itself, for a caller that is already inside a transaction (15.9: a Deny closes the run in the same one that fails its step):
   * the run is `stopped` (the user, a limit or a refusal) or `failed` with its reason and the `run_stopped` event; a step whose worker was
   * cut off did not finish, so it is failed.
   */
  const closeRunNow = (workspaceId: WorkspaceId, run: RunRow, to: 'stopped' | 'failed', reason: OrchestrationStopReason, inFlight: readonly StepRow[]): void => {
    moveRun(run.id, to, reason);
    for (const step of inFlight) failIfDispatched(run.id, step.stepId);
    events.append({ type: 'orchestration.run_stopped', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], reason } });
  };
  /**
   * Ends a run that is still open, in one transaction with the `run_stopped` event. Returns whether this call ended it. With `strict`, a run
   * that already ended is {@link RunNotOpenError} (the user's Stop); otherwise it is left as it is.
   */
  const closeRun = (workspaceId: WorkspaceId, run: RunRow, to: 'stopped' | 'failed', reason: OrchestrationStopReason, inFlight: readonly StepRow[], strict: boolean): boolean => {
    const ended = events.transaction(() => {
      const live = findRun(run.id);
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

  /**
   * Starts a run from the user's goal (`StartOrchestrationRunRequest`): asks the manager for a plan and stores it as proposed steps.
   * {@link ValidationError} for a bad goal, {@link ManagerUnavailableError} with no manager (nothing stored), {@link ManagerFailedError} when it
   * gave no usable plan (the run is kept, failed).
   */
  const startRun = async (workspaceId: WorkspaceId, request: unknown) => {
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
      return k.readBack(workspaceId, requireRun(workspaceId, runId));
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
    if (syncMode(workspaceId, requireRun(workspaceId, runId)).mode === 'automatic') await k.scheduleAdvance(workspaceId, runId);
    return k.readBack(workspaceId, requireRun(workspaceId, runId));
  };

  /**
   * Picks up every open run from its rows and events after a start (15.9): a run that was making its plan is closed (`restarted`), the
   * others re-arm (the time limit counts from the run's start), settle what finished, ask for a decision that was owed, and never send
   * an instruction that was already sent. Returns how many runs were picked up. The server calls it once, after it has its chat.
   */
  const resume = async (): Promise<number> => {
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
        void k.scheduleAdvance(workspaceId, row.id);
      } catch {
        // A run whose project is gone is not picked up.
      }
    }
    return picked;
  };

  return { limitsNow, limitsOf, workersInFlight, cancelTurns, disarm, closeRunNow, closeRun, startRun, resume };
}

export type RunApi = ReturnType<typeof createRun>;
