/**
 * The user's own actions on a run (epic 15, stories 15.6, 15.9, 15.11 and 15.13): approve, edit, skip, reorder, Stop, answer the manager's
 * question, and tell the plan which build the Build dialog started. Only the user's routes call these (an architecture test): no other
 * orchestration module, and no manager code, names them. Each one checks its rule in code, changes the stored plan in one transaction with
 * its event, and then lets the engine look at the run again.
 */
import {
  AnswerOrchestrationQuestionRequest,
  EditOrchestrationStepRequest,
  LinkOrchestrationBuildRequest,
  ORCHESTRATION_ANSWER_BAD_TEXT_MESSAGE,
  ORCHESTRATION_ANSWER_SECRET_MESSAGE,
  ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE,
  ORCHESTRATION_EDIT_BAD_TEXT_MESSAGE,
  ORCHESTRATION_EDIT_SECRET_MESSAGE,
  ORCHESTRATION_ORDER_WORDS,
  REVIEW_LIMITS,
  ORCHESTRATION_REVIEW_QUESTION_TOO_LONG_MESSAGE,
  ReorderOrchestrationStepsRequest,
  canMoveRun,
  canMoveStep,
  redactSecrets,
  type OrchestrationBuildRunView,
  type OrchestrationRun,
  type OrchestrationRunState,
  type OrchestrationStepState,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { orchestrationSteps, runs as runsTable } from './db/schema.js';
import { BadOrderError, NoQuestionPendingError, RunNotOpenError, StepNotChangeableError, StepNotProposedError, ValidationError } from './errors.js';
import type { Base } from './orchestration-kernel.js';
import type { EngineApi } from './orchestration-engine.js';
import type { LoopStateApi } from './orchestration-loop-state.js';
import type { Orchestration } from './orchestration.js';
import type { ReadBackApi } from './orchestration-readback.js';
import type { RunApi } from './orchestration-run.js';
import { isLive, isOpen, stepOf, type RowsApi } from './orchestration-rows.js';

export function createActions(k: Base & RowsApi & LoopStateApi & RunApi & ReadBackApi & EngineApi) {
  const { orm, events, feature, planning, findRun, requireRun, requireStep, stepsOf, updateStep, moveRun, loopOf, workersInFlight, closeRun, cancelTurns, readBack, kick, scheduleAdvance } = k;

  const approveStep: Orchestration['approveStep'] = async (workspaceId, runId, stepId, expectedInstruction) => {
    feature.requireOrchestration(workspaceId);
    const run = requireRun(workspaceId, runId);
    events.transaction(() => {
      const step = requireStep(run.id, stepId);
      const all = stepsOf(run.id);
      // Approval is the user's, never the manager's, and only while the run is open and what the step needs is done.
      const needsDone = stepOf(step).dependsOn.every((id) => all.find((other) => other.stepId === id)?.state === 'done');
      const open = isOpen(findRun(run.id)?.state ?? run.state);
      // When the page says which text the user read, a step edited since (another tab) is not approved: the user approves what they saw.
      const sameText = expectedInstruction === undefined || expectedInstruction === step.instruction;
      // A build step is not approved like an instruction: the person starts it in the Build dialog and the plan follows (15.11).
      if (step.buildRef !== null || step.state !== 'proposed' || !canMoveStep('proposed', 'approved') || !needsDone || !open || !sameText) throw new StepNotProposedError();
      updateStep(run.id, step.stepId, { state: 'approved', approvedBy: 'user' });
      events.append({ type: 'orchestration.step_approved', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, by: 'user' } });
    });
    // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
    kick(workspaceId, runId);
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  const editStep: Orchestration['editStep'] = async (workspaceId, runId, stepId, request) => {
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
      const live = findRun(run.id);
      if (live === undefined || !isLive(live.state) || (step.state !== 'proposed' && step.state !== 'approved')) throw new StepNotChangeableError();
      if (step.instruction === text) return;
      // Whatever it was, the step waits for the user again: an approval never covers text the user had not approved.
      updateStep(run.id, step.stepId, { instruction: text, state: 'proposed', approvedBy: null });
      events.append({ type: 'orchestration.step_edited', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, instruction: text } });
    });
    // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
    kick(workspaceId, runId);
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  const skipStep: Orchestration['skipStep'] = async (workspaceId, runId, stepId) => {
    feature.requireOrchestration(workspaceId);
    const run = requireRun(workspaceId, runId);
    events.transaction(() => {
      const step = requireStep(run.id, stepId);
      const live = findRun(run.id);
      if (live === undefined || !isLive(live.state) || !canMoveStep(step.state as OrchestrationStepState, 'skipped')) throw new StepNotChangeableError();
      // A skipped step is never sent. The steps that need it keep waiting: approving one needs every prerequisite done.
      updateStep(run.id, step.stepId, { state: 'skipped' });
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
  };

  const reorderSteps: Orchestration['reorderSteps'] = async (workspaceId, runId, request) => {
    feature.requireOrchestration(workspaceId);
    const run = requireRun(workspaceId, runId);
    const parsed = ReorderOrchestrationStepsRequest.safeParse(request);
    if (!parsed.success) throw new BadOrderError(ORCHESTRATION_ORDER_WORDS.not_every_step);
    const order = parsed.data.order;
    events.transaction(() => {
      const live = findRun(run.id);
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
        updateStep(run.id, id, { position });
      });
      events.append({ type: 'orchestration.steps_reordered', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], order } });
    });
    // Under Dispatch automatically what the user changed may let the run go on (a skipped step, an edited one, a new order).
    kick(workspaceId, runId);
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  const stopRun: Orchestration['stopRun'] = async (workspaceId, runId) => {
    // Stop is never blockable (15.8): it does not ask the Orchestration piece's guard, so it works with the piece switched off. It still
    // reaches only a run of this project (an unknown project or run is not found).
    const run = requireRun(workspaceId, runId);
    const inFlight = workersInFlight(workspaceId, run);
    closeRun(workspaceId, run, 'stopped', 'user', inFlight, true);
    // The manager call in flight is abandoned, and each worker turn in flight is asked to stop.
    planning.get(run.id)?.abort();
    cancelTurns(workspaceId, inFlight);
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  const linkBuild: Orchestration['linkBuild'] = async (workspaceId, runId, stepId, request) => {
    feature.requireOrchestration(workspaceId);
    const run = requireRun(workspaceId, runId);
    const parsed = LinkOrchestrationBuildRequest.safeParse(request);
    if (!parsed.success) throw new ValidationError(ORCHESTRATION_BUILD_NOT_THIS_TICKET_MESSAGE, parsed.error.issues);
    events.transaction(() => {
      const step = requireStep(run.id, stepId);
      const live = findRun(run.id);
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
      updateStep(run.id, step.stepId, { state: 'dispatched', approvedBy: 'user', buildRunId: build.id });
      moveRun(run.id, 'running');
      events.append({ type: 'orchestration.build_linked', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], stepId: step.stepId, ticketRef: step.buildRef, buildRunId: build.id as OrchestrationBuildRunView['runId'] } });
    });
    // A build that already ended settles at once; the run goes on from its result.
    void scheduleAdvance(workspaceId, run.id);
    return readBack(workspaceId, requireRun(workspaceId, runId));
  };

  const answerQuestion: Orchestration['answerQuestion'] = async (workspaceId, runId, request) => {
    feature.requireOrchestration(workspaceId);
    const run = requireRun(workspaceId, runId);
    const parsed = AnswerOrchestrationQuestionRequest.safeParse(request);
    if (!parsed.success) throw new ValidationError(ORCHESTRATION_ANSWER_BAD_TEXT_MESSAGE, parsed.error.issues);
    // The same rule as an edit: a secret is refused, not quietly changed, so the user sees what is kept.
    if (redactSecrets(parsed.data.answer) !== parsed.data.answer) throw new ValidationError(ORCHESTRATION_ANSWER_SECRET_MESSAGE, []);
    events.transaction(() => {
      const live = findRun(run.id);
      if (live === undefined || !isLive(live.state)) throw new RunNotOpenError();
      // Only a question the manager asked and the user has not answered: the answer goes once.
      const loop = loopOf(workspaceId, run.id);
      if (loop.decision?.action !== 'ask_user' || loop.owed !== null || stepsOf(run.id).some((step) => step.state === 'dispatched')) throw new NoQuestionPendingError();
      events.append({ type: 'orchestration.question_answered', workspaceId, streamId: workspaceId, payload: { runId: run.id as OrchestrationRun['id'], answer: parsed.data.answer } });
    });
    // The answer is data for the manager's next decision.
    void scheduleAdvance(workspaceId, run.id);
    return readBack(workspaceId, requireRun(workspaceId, runId), undefined, true);
  };
  return { approveStep, editStep, skipStep, reorderSteps, stopRun, linkBuild, answerQuestion };
}

