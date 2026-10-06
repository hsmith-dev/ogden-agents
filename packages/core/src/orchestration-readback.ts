/**
 * Reading a run back (epic 15, story 15.13): for each sent step the worker chat's state and a masked, capped report, or the build run it
 * follows; the first read that finds a step finished or failed settles it once (`orchestration.result_read`), and a Deny of a worker's card
 * ends the step and the run. The read is the way the stored run reaches the page and the manager; it never decides what a manager says and
 * names none of the user's own actions.
 */
import {
  ORCHESTRATION_BUILD_WORKER,
  ORCHESTRATION_DENIED_RESULT,
  ORCHESTRATION_RUNS_PAGE,
  OrchestrationRunView,
  OrchestrationStepView,
  buildSummaryText,
  canMoveStep,
  isRunOver,
  makeStatusReport,
  type ManagerStatusReport,
  type OrchestrationBuildRunView,
  type OrchestrationRun,
  type OrchestrationRunState,
  type OrchestrationWaiting,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { desc, eq } from 'drizzle-orm';
import { orchestrationRuns } from './db/schema.js';
import { NotFoundError } from './errors.js';
import type { Base, Late, RunRow, StepRow } from './orchestration-kernel.js';
import type { BuildReadApi } from './orchestration-build-read.js';
import { buildEndOf } from './orchestration-build-read.js';
import type { LoopStateApi } from './orchestration-loop-state.js';
import type { ManagerIoApi } from './orchestration-manager-io.js';
import type { ReviewApi } from './orchestration-review.js';
import type { RunApi } from './orchestration-run.js';
import { isLive, isOpen, runOf, stepOf, type RowsApi } from './orchestration-rows.js';
import type { TranscriptApi } from './orchestration-transcript.js';

export function createReadBack(k: Base & Late & RowsApi & TranscriptApi & LoopStateApi & BuildReadApi & ManagerIoApi & ReviewApi & RunApi) {
  const { orm, events, chat, feature, planning, builder, findRun, requireRun, requireStep, stepsOf, updateStep, moveRun, syncMode, labels, lastReply, deniedSince, cutOffByRestart, loopOf, buildRunOf, reviewTargetOf, closeRunNow, disarm, cancelTurns } = k;

  /**
   * Settles a sent step once (the first read that sees it finished or failed): the step moves, `result_read` is appended with the report, and
   * the run goes on, finishes, or fails as the step says. Read again inside the transaction, so two reads never settle it twice. Returns
   * whether this call settled it.
   */
  const settleStep = (workspaceId: WorkspaceId, run: RunRow, stepId: string, to: 'done' | 'failed', report: ManagerStatusReport): boolean =>
    events.transaction(() => {
      const current = requireStep(run.id, stepId);
      if (current.state !== 'dispatched' || !canMoveStep('dispatched', to)) return false;
      updateStep(run.id, stepId, { state: to });
      events.append({ type: 'orchestration.result_read', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], report } });
      const runId = run.id as OrchestrationRun['id'];
      const states = stepsOf(run.id).map((other) => other.state);
      // A run the user stopped (or that ended another way) stays as it is: the step settles, the run is not moved again.
      const runNow = findRun(run.id);
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
            const runNow = findRun(run.id);
            if (current.state !== 'dispatched' || runNow === undefined || isRunOver(runNow.state as OrchestrationRunState)) return false;
            updateStep(run.id, step.stepId, { state: 'failed' });
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
    const fresh = findRun(run.id) ?? run;
    // A read that settled a step lets the run go on (the listener does the same when the worker's chat changes): its next decision, and the next step of an automatic run.
    if (settledAny && !quiet) void k.scheduleAdvance(workspaceId, run.id);
    else if (becameAutomatic && !quiet && fresh.mode === 'automatic') void k.scheduleAdvance(workspaceId, run.id);
    if (denial !== undefined) k.tell(workspaceId, run.id, denial.step, denial.report, 'denied');
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

  /** The project's runs, newest first. */
  const listRuns = async (workspaceId: WorkspaceId): Promise<OrchestrationRunView[]> => {
    feature.requireOrchestration(workspaceId);
    const rows = orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.workspaceId, workspaceId)).orderBy(desc(orchestrationRuns.createdAt), desc(orchestrationRuns.id)).limit(ORCHESTRATION_RUNS_PAGE).all();
    const names = await labels(workspaceId);
    const views: OrchestrationRunView[] = [];
    for (const row of rows) views.push(await readBack(workspaceId, row, names));
    return views;
  };

  /** One run of the project, its steps read back. {@link NotFoundError} for another project's or an unknown run. */
  const getRun = async (workspaceId: WorkspaceId, runId: string): Promise<OrchestrationRunView> => {
    feature.requireOrchestration(workspaceId);
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  return { settleStep, readBack, listRuns, getRun };
}

export type ReadBackApi = ReturnType<typeof createReadBack>;
