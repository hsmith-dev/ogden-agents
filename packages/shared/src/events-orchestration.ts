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
import { SessionId, OrchestrationRunId } from './ids.js';
import {
  Approver,
  ManagerDecision,
  ManagerGoal,
  ManagerInstruction,
  ManagerReason,
  ManagerPlan,
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
/** The user changed an instruction before it was sent (the masked new text). */
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

export const OrchestrationStepDispatchedInput = z.object({
  type: z.literal('orchestration.step_dispatched'),
  ...onWorkspaceStream,
  payload: z.object({ ...step, worker: AgentId, sessionId: SessionId }),
});
/** An approved instruction was sent into the worker's chat (the activity log's line: who, to which worker and chat). */
export const OrchestrationStepDispatchedEvent = OrchestrationStepDispatchedInput.extend(assigned);
export type OrchestrationStepDispatchedEvent = z.infer<typeof OrchestrationStepDispatchedEvent>;

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

/** Every orchestration event's input, for `NewCoreEvent`. */
export const ORCHESTRATION_INPUTS = [
  OrchestrationRunStartedInput,
  OrchestrationPlanProposedInput,
  OrchestrationStepProposedInput,
  OrchestrationStepApprovedInput,
  OrchestrationStepEditedInput,
  OrchestrationStepSkippedInput,
  OrchestrationStepDispatchedInput,
  OrchestrationResultReadInput,
  OrchestrationRunPausedInput,
  OrchestrationRunStoppedInput,
  OrchestrationRunFinishedInput,
  OrchestrationModeChangedInput,
] as const;
