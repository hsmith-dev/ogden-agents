/**
 * The engine of a run (epic 15, stories 15.8, 15.9 and 15.13): core itself looks at a run when something happened (a worker's chat changed,
 * the project's mode changed, a read settled a step, the user changed the plan, the time limit came). `scheduleAdvance` is the only way in,
 * run one at a time per run; each pass re-reads everything (the project's mode, the piece, the run, the steps, the events), so a pass that is
 * late or repeated does nothing wrong. It pauses the run while a worker waits on a permission card, asks the manager for the decision a result
 * is owed, and, in automatic mode, sends the next step within the run's limits, stopping at the first refusal, error, Deny or limit with a
 * plain reason. The manager has no way to call it; this file names no settings mutator, never the user's own actions and never a way to
 * answer a permission card (an architecture test).
 */
import {
  OrchestrationRun,
  canMoveRun,
  canMoveStep,
  isRunOver,
  makeStatusReport,
  orchestrationRefusedResult,
  stepDepths,
  type ManagerDecision,
  type ManagerStatusReport,
  type OrchestrationRunState,
  type OrchestrationStopReason,
  type RunLimits,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, eq } from 'drizzle-orm';
import { orchestrationRuns, orchestrationSteps } from './db/schema.js';
import { DispatchRefusedError, NotFoundError, OrchestrationOffError, StepNotApprovedError } from './errors.js';
import { dispatchableSteps, MANAGER_FAILURE_WORDS, type ManagerDecisionContext, type ManagerPort } from './manager-port.js';
import { isSubscription } from './team-roster.js';
import { readDefaultPermissionMode } from './workspace-settings.js';
import type { Base, RunRow, StepRow } from './orchestration-kernel.js';
import type { DispatchApi } from './orchestration-dispatch.js';
import type { LoopState, LoopStateApi } from './orchestration-loop-state.js';
import type { ManagerIoApi } from './orchestration-manager-io.js';
import type { ReadBackApi } from './orchestration-readback.js';
import type { RunApi } from './orchestration-run.js';
import { isLive, isOpen, stepOf, type RowsApi } from './orchestration-rows.js';
import type { TranscriptApi } from './orchestration-transcript.js';

export function createEngine(k: Base & RowsApi & TranscriptApi & LoopStateApi & ManagerIoApi & RunApi & ReadBackApi & DispatchApi) {
  const { orm, events, feature, chat, nowMs, planning, timers, findRun, requireRun, requireStep, stepsOf, updateStep, returnToUser, moveRun, syncMode, managerOf, noteReply, workerContext, planOfRows, statesOf, decisionRecord, loopOf, cutOffByRestart, limitsOf, workersInFlight, cancelTurns, disarm, closeRunNow, closeRun, readBack, dispatchStep } = k;

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
  /** Lets an open run look again after the user changed it (not awaited; a pass re-reads everything). */
  const kick = (workspaceId: WorkspaceId, runId: string): void => {
    const row = findRun(runId);
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
      const live = findRun(runId);
      if (live === undefined || live.mode !== 'automatic' || !isOpen(live.state)) return false;
      const step = requireStep(runId, stepId);
      // The mode never approves a build (15.11): only the person's own start in the Build dialog moves it.
      if (step.buildRef !== null || step.state !== 'proposed' || !canMoveStep('proposed', 'approved')) return false;
      updateStep(runId, stepId, { state: 'approved', approvedBy: 'mode' });
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
    const live = findRun(run.id);
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
      const live = findRun(run.id);
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
      await dispatchStep(workspaceId, run.id, next.stepId);
    } catch (error) {
      if (error instanceof OrchestrationOffError) return;
      if (error instanceof StepNotApprovedError) {
        // A step the mode approved that can no longer be sent by the mode (the project went back to Approve each instruction): it is the user's again.
        const handedBack = events.transaction(() => {
          requireStep(run.id, next.stepId);
          return returnToUser(run.id, next.stepId);
        });
        if (handedBack) waitForUser(workspaceId, run, next.stepId);
        return;
      }
      if (error instanceof DispatchRefusedError && error.reason === 'approve_each_only') {
        // The worker turned out to be one only the user may send to: the step is the user's again.
        events.transaction(() => {
          requireStep(run.id, next.stepId);
          returnToUser(run.id, next.stepId);
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

  return { scheduleAdvance, kick, tell, whenIdle: async (): Promise<void> => {
    while (pending.size > 0) await Promise.allSettled([...pending]);
  } };
}

export type EngineApi = ReturnType<typeof createEngine>;
