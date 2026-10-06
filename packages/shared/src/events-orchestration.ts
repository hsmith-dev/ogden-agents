/**
 * Orchestration events (epic 15, story 15.2), re-exported from `events.ts`.
 * They record a run so it can be replayed and its activity log read (E15-R3a,
 * AD-8): who proposed what, who approved it, where it was sent and what came
 * back. All are on the workspace's stream. A manager's text (a plan, an edit,
 * a reason) is untrusted: core masks it (AD-16) before it is appended, and
 * the schemas bound it. The mode of a project and its roster change through
 * `workspace.settings_changed`; `orchestration.mode_changed` is the mode a
 * running run is under changing. The manager never approves: `by` is the
 * user or the team's mode. The AD-8 amendment that names these events is
 * proposed through the architecture memlog, not hand-edited.
 */
import { z } from 'zod';
import { AgentId } from './events-common.js';
import { assigned, onWorkspaceStream } from './events-envelope.js';
import { SessionId, OrchestrationRunId, RunId } from './ids.js';
import {
  Approver,
  DecisionOutcome,
  DispatchRefusalReason,
  ManagerDecision,
  ManagerFailureKind,
  ManagerBuildTicket,
  ManagerGoal,
  ManagerInstruction,
  ManagerReason,
  ManagerPlan,
  ManagerRefusalCode,
  ManagerStatusReport,
  ManagerStepId,
  MANAGER_LIMITS,
  OrchestrationMode,
  PauseReason,
  RunLimits,
  OrchestrationStopReason,
} from './orchestration.js';

const runId = { runId: OrchestrationRunId };
const step = { ...runId, stepId: ManagerStepId };

export const OrchestrationRunStartedInput = z.object({
  type: z.literal('orchestration.run_started'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, goal: ManagerGoal, mode: OrchestrationMode, limits: RunLimits }),
});
/** A run began with the user's goal, under the mode and limits in force. */
export const OrchestrationRunStartedEvent = OrchestrationRunStartedInput.extend(assigned);
export type OrchestrationRunStartedEvent = z.infer<typeof OrchestrationRunStartedEvent>;

export const OrchestrationPlanProposedInput = z.object({
  type: z.literal('orchestration.plan_proposed'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, plan: ManagerPlan }),
});
/** The manager's plan passed validation (the masked plan, so the run can be replayed). */
export const OrchestrationPlanProposedEvent = OrchestrationPlanProposedInput.extend(assigned);
export type OrchestrationPlanProposedEvent = z.infer<typeof OrchestrationPlanProposedEvent>;

export const OrchestrationStepProposedInput = z.object({
  type: z.literal('orchestration.step_proposed'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, decision: ManagerDecision.optional() }),
});
/** A step is shown as the next instruction, waiting for the user in the default mode. */
export const OrchestrationStepProposedEvent = OrchestrationStepProposedInput.extend(assigned);
export type OrchestrationStepProposedEvent = z.infer<typeof OrchestrationStepProposedEvent>;

export const OrchestrationStepApprovedInput = z.object({
  type: z.literal('orchestration.step_approved'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, by: Approver }),
});
/** A step was approved, by the user or by the team's automatic mode. Never by the manager. */
export const OrchestrationStepApprovedEvent = OrchestrationStepApprovedInput.extend(assigned);
export type OrchestrationStepApprovedEvent = z.infer<typeof OrchestrationStepApprovedEvent>;

export const OrchestrationStepEditedInput = z.object({
  type: z.literal('orchestration.step_edited'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, instruction: ManagerInstruction }),
});
/** The user changed an instruction before it was sent (the new text). The step waits for approval again, whatever it was. */
export const OrchestrationStepEditedEvent = OrchestrationStepEditedInput.extend(assigned);
export type OrchestrationStepEditedEvent = z.infer<typeof OrchestrationStepEditedEvent>;

export const OrchestrationStepSkippedInput = z.object({
  type: z.literal('orchestration.step_skipped'),
  ...onWorkspaceStream,
  payload: z.object(step),
});
/** The user skipped a step. */
export const OrchestrationStepSkippedEvent = OrchestrationStepSkippedInput.extend(assigned);
export type OrchestrationStepSkippedEvent = z.infer<typeof OrchestrationStepSkippedEvent>;

export const OrchestrationStepsReorderedInput = z.object({
  type: z.literal('orchestration.steps_reordered'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, order: z.array(ManagerStepId).min(1).max(MANAGER_LIMITS.maxSteps) }),
});
/** The user put the steps in a new order (the whole order, every prerequisite still first). */
export const OrchestrationStepsReorderedEvent = OrchestrationStepsReorderedInput.extend(assigned);
export type OrchestrationStepsReorderedEvent = z.infer<typeof OrchestrationStepsReorderedEvent>;

export const OrchestrationStepDispatchedInput = z.object({
  type: z.literal('orchestration.step_dispatched'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, worker: AgentId, sessionId: SessionId }),
});
/** An approved instruction was sent into the worker's chat (the activity log's line: who, to which worker and chat). */
export const OrchestrationStepDispatchedEvent = OrchestrationStepDispatchedInput.extend(assigned);
export type OrchestrationStepDispatchedEvent = z.infer<typeof OrchestrationStepDispatchedEvent>;

export const OrchestrationDispatchRefusedInput = z.object({
  type: z.literal('orchestration.dispatch_refused'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, worker: AgentId, reason: DispatchRefusalReason, message: z.string().min(1).max(400) }),
});
/** An instruction was not sent: the worker or its chat could not take it (15.8). Nothing was created or sent. The plain words are core's. */
export const OrchestrationDispatchRefusedEvent = OrchestrationDispatchRefusedInput.extend(assigned);
export type OrchestrationDispatchRefusedEvent = z.infer<typeof OrchestrationDispatchRefusedEvent>;

export const OrchestrationResultReadInput = z.object({
  type: z.literal('orchestration.result_read'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, report: ManagerStatusReport }),
});
/** The worker's state and a capped, masked summary of its result were read back for the manager. */
export const OrchestrationResultReadEvent = OrchestrationResultReadInput.extend(assigned);
export type OrchestrationResultReadEvent = z.infer<typeof OrchestrationResultReadEvent>;

export const OrchestrationRunPausedInput = z.object({
  type: z.literal('orchestration.run_paused'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, reason: PauseReason }),
});
/** The run waits: for a worker's permission card, or for the user. */
export const OrchestrationRunPausedEvent = OrchestrationRunPausedInput.extend(assigned);
export type OrchestrationRunPausedEvent = z.infer<typeof OrchestrationRunPausedEvent>;

export const OrchestrationRunStoppedInput = z.object({
  type: z.literal('orchestration.run_stopped'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, reason: OrchestrationStopReason }),
});
/** The run was stopped: by the user, a limit, the manager's refusal, a worker error or a Deny. */
export const OrchestrationRunStoppedEvent = OrchestrationRunStoppedInput.extend(assigned);
export type OrchestrationRunStoppedEvent = z.infer<typeof OrchestrationRunStoppedEvent>;

export const OrchestrationRunFinishedInput = z.object({
  type: z.literal('orchestration.run_finished'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, reason: ManagerReason.optional() }),
});
/** The manager said the goal is done (its reason, masked). */
export const OrchestrationRunFinishedEvent = OrchestrationRunFinishedInput.extend(assigned);
export type OrchestrationRunFinishedEvent = z.infer<typeof OrchestrationRunFinishedEvent>;

export const OrchestrationModeChangedInput = z.object({
  type: z.literal('orchestration.mode_changed'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, mode: OrchestrationMode, previous: OrchestrationMode }),
});
/** The mode a run is under changed while it ran (the project's own setting changes through `workspace.settings_changed`). */
export const OrchestrationModeChangedEvent = OrchestrationModeChangedInput.extend(assigned);
export type OrchestrationModeChangedEvent = z.infer<typeof OrchestrationModeChangedEvent>;

export const OrchestrationManagerRepliedInput = z.object({
  type: z.literal('orchestration.manager_replied'),
  ...onWorkspaceStream,
  payload: z.object({
    ...runId,
    call: z.enum(['plan', 'decision']),
    outcome: z.enum(['accepted', 'refused']),
    /** How the server was asked, from the strictest; `null` when it never answered. */
    asked: z.enum(['json_schema', 'json_object', 'prompt']).nullable(),
    /** Whether Ogden asked again once, naming the rule that failed. */
    repaired: z.boolean(),
    /** For a refusal: the kind the user is told, and the rule behind it when there is one. */
    failure: ManagerFailureKind.optional(),
    code: ManagerRefusalCode.optional(),
    /** The manager's answer as masked JSON text (secrets masked, cut to {@link MANAGER_LIMITS.maxRecordChars}), so a run can be replayed. Absent when nothing parsed. Never the prompt. */
    output: z.string().max(MANAGER_LIMITS.maxRecordChars).optional(),
  }),
});
/** The manager answered a call (its masked answer and how the call went). Never the prompt, a key or an address. */
export const OrchestrationManagerRepliedEvent = OrchestrationManagerRepliedInput.extend(assigned);
export type OrchestrationManagerRepliedEvent = z.infer<typeof OrchestrationManagerRepliedEvent>;

export const OrchestrationDecisionMadeInput = z.object({
  type: z.literal('orchestration.decision_made'),
  ...onWorkspaceStream,
  payload: z.object({
    ...runId,
    /** The step whose result led to the decision; `null` when none did. */
    after: ManagerStepId.nullable(),
    /** What the manager chose, or `unavailable` when it gave no usable decision. */
    action: DecisionOutcome,
    /** The manager's reason, masked (or Ogden's plain words for `unavailable`). */
    reason: z.string().min(1).max(400),
    stepId: ManagerStepId.optional(),
    question: z.string().min(1).max(MANAGER_LIMITS.maxQuestionChars).optional(),
    /** Set when the run had already ended (a Deny, a refused dispatch) and the manager was only told: its answer changes nothing. */
    told: z.enum(['denied', 'refused']).optional(),
  }),
});
/** The manager decided what comes next after a result (15.9). A run's loop state is read back from these events. */
export const OrchestrationDecisionMadeEvent = OrchestrationDecisionMadeInput.extend(assigned);
export type OrchestrationDecisionMadeEvent = z.infer<typeof OrchestrationDecisionMadeEvent>;

export const OrchestrationQuestionAnsweredInput = z.object({
  type: z.literal('orchestration.question_answered'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, answer: ManagerGoal }),
});
/** The user answered the manager's question (their words, masked). It goes to the manager as data on the next decision. */
export const OrchestrationQuestionAnsweredEvent = OrchestrationQuestionAnsweredInput.extend(assigned);
export type OrchestrationQuestionAnsweredEvent = z.infer<typeof OrchestrationQuestionAnsweredEvent>;

export const OrchestrationRunResumedInput = z.object({
  type: z.literal('orchestration.run_resumed'),
  ...onWorkspaceStream,
  payload: z.object({ ...runId, reason: z.enum(['card_answered', 'restart']) }),
});
/** A paused run goes on: the worker's card was answered, or the app restarted and the run was picked up from its events. */
export const OrchestrationRunResumedEvent = OrchestrationRunResumedInput.extend(assigned);
export type OrchestrationRunResumedEvent = z.infer<typeof OrchestrationRunResumedEvent>;

export const OrchestrationBuildLinkedInput = z.object({
  type: z.literal('orchestration.build_linked'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, ticketRef: ManagerBuildTicket, buildRunId: RunId }),
});
/**
 * The person started a build in the Build dialog and the plan's build step now follows that run (15.11). It is the person's own action:
 * the step was never approved or sent by the manager, and no event of this run starts a build.
 */
export const OrchestrationBuildLinkedEvent = OrchestrationBuildLinkedInput.extend(assigned);
export type OrchestrationBuildLinkedEvent = z.infer<typeof OrchestrationBuildLinkedEvent>;

/** Every orchestration event's input, for `NewCoreEvent`. */
export const ORCHESTRATION_INPUTS = [
  OrchestrationRunStartedInput,
  OrchestrationPlanProposedInput,
  OrchestrationStepProposedInput,
  OrchestrationStepApprovedInput,
  OrchestrationStepEditedInput,
  OrchestrationStepSkippedInput,
  OrchestrationStepsReorderedInput,
  OrchestrationStepDispatchedInput,
  OrchestrationDispatchRefusedInput,
  OrchestrationResultReadInput,
  OrchestrationRunPausedInput,
  OrchestrationRunStoppedInput,
  OrchestrationRunFinishedInput,
  OrchestrationModeChangedInput,
  OrchestrationManagerRepliedInput,
  OrchestrationDecisionMadeInput,
  OrchestrationQuestionAnsweredInput,
  OrchestrationRunResumedInput,
  OrchestrationBuildLinkedInput,
] as const;
