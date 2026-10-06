/**
 * The stored runs and steps of the orchestration use-case (epic 15, story 15.13): reading a row, writing a step, moving a run along the
 * transition table, and bringing a run's mode to the project's own. Nothing here sends, asks a manager or names a user action.
 */
import {
  DEFAULT_ORCHESTRATION_MODE,
  type OrchestrationMode,
  OrchestrationRunId as OrchestrationRunIdSchema,
  ManagerStepId,
  OrchestrationRun,
  OrchestrationStep,
  canMoveRun,
  isRunOver,
  type OrchestrationRunState,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, eq } from 'drizzle-orm';
import { orchestrationRuns, orchestrationSteps } from './db/schema.js';
import { NotFoundError } from './errors.js';
import { readAutomaticConfirmed, readOrchestrationMode } from './workspace-settings.js';
import type { Base, RunRow, StepRow } from './orchestration-kernel.js';

export const isOpen = (state: string): boolean => state === 'awaiting_user' || state === 'running';
/** A run the user may still change (edit, skip, reorder): open, or paused for a card. */
export const isLive = (state: string): boolean => isOpen(state) || state === 'paused';

export const runOf = (row: RunRow): OrchestrationRun =>
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

export const stepOf = (row: StepRow): OrchestrationStep =>
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

export function createRows({ orm, events, now }: Pick<Base, 'orm' | 'events' | 'now'>) {
  /** The run row as it is stored now, or `undefined`. */
  const findRun = (runId: string): RunRow | undefined => orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).get();

  const requireRun = (workspaceId: WorkspaceId, runId: string): RunRow => {
    const id = OrchestrationRunIdSchema.safeParse(runId);
    const row = id.success ? findRun(id.data) : undefined;
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

  /** Changes columns of one step. */
  const updateStep = (runId: string, stepId: string, patch: Partial<StepRow>): void => {
    orm.update(orchestrationSteps).set(patch).where(and(eq(orchestrationSteps.runId, runId), eq(orchestrationSteps.stepId, stepId))).run();
  };

  /** Fails a step only if it is still dispatched (its worker was cut off), in one statement. */
  const failIfDispatched = (runId: string, stepId: string): void => {
    orm.update(orchestrationSteps).set({ state: 'failed' }).where(and(eq(orchestrationSteps.runId, runId), eq(orchestrationSteps.stepId, stepId), eq(orchestrationSteps.state, 'dispatched'))).run();
  };

  /**
   * Gives a step the mode approved but did not send back to the user: in the default mode only the user approves. One step, or every
   * step of the run. Returns whether any step changed. Call inside a transaction.
   */
  const returnToUser = (runId: string, stepId?: string): boolean => {
    let changed = false;
    for (const step of stepsOf(runId)) {
      if ((stepId !== undefined && step.stepId !== stepId) || step.state !== 'approved' || step.approvedBy !== 'mode') continue;
      updateStep(runId, step.stepId, { state: 'proposed', approvedBy: null });
      changed = true;
    }
    return changed;
  };

  /** Moves a run to `to` when the transition table allows it (the same state is no move). */
  const moveRun = (runId: string, to: OrchestrationRunState, stopReason?: OrchestrationRun['stopReason']): void => {
    const row = findRun(runId);
    if (row === undefined || row.state === to) return;
    // A paused run has no way to `finished`: it is waiting again first (the worker's card was answered, so it is not paused any more).
    if (row.state === 'paused' && to === 'finished') {
      orm.update(orchestrationRuns).set({ state: 'awaiting_user', updatedAt: now() }).where(eq(orchestrationRuns.id, runId)).run();
      row.state = 'awaiting_user';
    }
    if (!canMoveRun(row.state as OrchestrationRunState, to)) return;
    orm.update(orchestrationRuns).set({ state: to, stopReason: stopReason ?? row.stopReason, updatedAt: now() }).where(eq(orchestrationRuns.id, runId)).run();
  };

  /** The project's mode as the engine honours it: automatic only while the project's confirmation is on record (fail safe, never the other way). */
  const projectModeOf = (workspaceId: WorkspaceId): OrchestrationMode => {
    const mode = readOrchestrationMode(orm, workspaceId) ?? DEFAULT_ORCHESTRATION_MODE;
    return mode === 'automatic' && !readAutomaticConfirmed(orm, workspaceId) ? 'approve_each' : mode;
  };

  /**
   * The run with its mode brought to the project's own (15.8): the mode is the project's setting, read at each use, so switching it
   * back mid-run takes effect on the next step. Back to Approve each instruction, a step the mode approved but did not send waits for
   * the user again. `orchestration.mode_changed` records it. A run that is over keeps the mode it ended under.
   */
  const syncMode = (workspaceId: WorkspaceId, run: RunRow): RunRow => {
    const fresh = findRun(run.id) ?? run;
    if (isRunOver(fresh.state as OrchestrationRunState)) return fresh;
    const projectMode = projectModeOf(workspaceId);
    if (projectMode === fresh.mode) {
      // In the default mode only the user approves: what the mode approved and did not send waits for the user again (whatever left it so).
      if (projectMode === 'approve_each' && stepsOf(run.id).some((step) => step.state === 'approved' && step.approvedBy === 'mode')) events.transaction(() => returnToUser(run.id));
      return fresh;
    }
    events.transaction(() => {
      orm.update(orchestrationRuns).set({ mode: projectMode, updatedAt: now() }).where(eq(orchestrationRuns.id, run.id)).run();
      events.append({ type: 'orchestration.mode_changed', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], mode: projectMode, previous: fresh.mode as OrchestrationRun['mode'] } });
      if (projectMode === 'approve_each') returnToUser(run.id);
    });
    return findRun(run.id) ?? fresh;
  };

  return { findRun, requireRun, requireStep, stepsOf, updateStep, failIfDispatched, returnToUser, moveRun, projectModeOf, syncMode };
}

export type RowsApi = ReturnType<typeof createRows>;
