/**
 * Build run events (story 5.2's `run.created` and `run.outcome_changed`,
 * moved here and frozen with the rest by story 5.3 for epics 5 and 11),
 * re-exported from `events.ts`. Every addition is back-compatible: a field
 * added to a payload 5.2 stored is optional. A run's events share its
 * session's stream (the run view is the session view, AD-8) and travel on
 * the existing `/ws` workspace subscription; the queue's is the workspace's.
 * The builds and notification settings events never carry a webhook URL.
 */
import { z } from 'zod';
import { BlockedCode, RunDecision, RunQueueEntry } from './build-runs.js';
import { RunLimitSettings, WorkspaceBuildSettings } from './build-settings.js';
import { VerificationResult } from './build-verification.js';
import { Run, RunOutcome } from './entities.js';
import { SETTINGS_STREAM } from './events-common.js';
import { assigned, onSessionStream, onWorkspaceStream } from './events-envelope.js';
import { RunId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';

export const RunCreatedInput = z.object({
  type: z.literal('run.created'),
  ...onSessionStream,
  payload: z.object({ run: Run }),
});
/** A run was created with its `build` session: dispatched now, or waiting in the queue (`queuePosition`; 5.8). */
export const RunCreatedEvent = RunCreatedInput.extend(assigned);
export type RunCreatedEvent = z.infer<typeof RunCreatedEvent>;

export const RunOutcomeChangedInput = z.object({
  type: z.literal('run.outcome_changed'),
  ...onSessionStream,
  payload: z.object({
    runId: RunId,
    outcome: RunOutcome,
    previous: RunOutcome,
    reason: z.string().min(1).optional(),
    /** Why a `blocked` run is blocked (story 5.3). Absent in 5.2's events and for any other outcome. */
    blockedCode: BlockedCode.optional(),
  }),
});
/** A run's outcome changed (AD-8), with its plain reason and, when blocked, its code. */
export const RunOutcomeChangedEvent = RunOutcomeChangedInput.extend(assigned);
export type RunOutcomeChangedEvent = z.infer<typeof RunOutcomeChangedEvent>;

export const RunDispatchedInput = z.object({
  type: z.literal('run.dispatched'),
  ...onSessionStream,
  payload: z.object({
    runId: RunId,
    worktreePath: z.string().min(1),
    branch: z.string().min(1),
    baseRevision: z.string().min(1),
    sandbox: z.string().min(1),
    /** When core stops it as over its time limit (E5-R7). */
    deadline: IsoUtcTimestamp,
  }),
});
/** A queued (or retried) run left the queue: its worktree, branch and sandbox are set and its agent starts (5.8). */
export const RunDispatchedEvent = RunDispatchedInput.extend(assigned);
export type RunDispatchedEvent = z.infer<typeof RunDispatchedEvent>;

export const RunQueueChangedInput = z.object({
  type: z.literal('run.queue_changed'),
  ...onWorkspaceStream,
  payload: z.object({ queue: z.array(RunQueueEntry) }),
});
/** The workspace's queue now, in order (5.8): the board's Queued and the Runs tab follow it. */
export const RunQueueChangedEvent = RunQueueChangedInput.extend(assigned);
export type RunQueueChangedEvent = z.infer<typeof RunQueueChangedEvent>;

export const RunVerificationCompletedInput = z.object({
  type: z.literal('run.verification_completed'),
  ...onSessionStream,
  payload: z.object({ runId: RunId, verification: VerificationResult }),
});
/**
 * A run's verification finished (5.8, and Check again, 11.2): the three
 * checks, before the run may show as ready for review (AD-17). The run's
 * outcome follows in `run.outcome_changed`.
 */
export const RunVerificationCompletedEvent = RunVerificationCompletedInput.extend(assigned);
export type RunVerificationCompletedEvent = z.infer<typeof RunVerificationCompletedEvent>;

export const RunDecidedInput = z.object({
  type: z.literal('run.decided'),
  ...onSessionStream,
  payload: z.object({
    runId: RunId,
    decision: RunDecision,
    /** The merge commit, for `approved`. */
    mergeRevision: z.string().min(1).optional(),
  }),
});
/** The user approved (merged, the ticket `done`) or rejected a run on its review page (5.9). A note to the agent is never stored here. */
export const RunDecidedEvent = RunDecidedInput.extend(assigned);
export type RunDecidedEvent = z.infer<typeof RunDecidedEvent>;

export const WorkspaceBuildSettingsChangedInput = z.object({
  type: z.literal('workspace.build_settings_changed'),
  ...onWorkspaceStream,
  payload: z.object({ settings: WorkspaceBuildSettings, previous: WorkspaceBuildSettings }),
});
/** The project's build settings changed (its limit, 5.8; its test command, 11.2): they apply to the next dispatch and check. */
export const WorkspaceBuildSettingsChangedEvent = WorkspaceBuildSettingsChangedInput.extend(assigned);
export type WorkspaceBuildSettingsChangedEvent = z.infer<typeof WorkspaceBuildSettingsChangedEvent>;

const onSettingsStream = { workspaceId: z.null(), streamId: z.literal(SETTINGS_STREAM) };

export const SettingsRunLimitsChangedInput = z.object({
  type: z.literal('settings.run_limits_changed'),
  ...onSettingsStream,
  payload: z.object({ settings: RunLimitSettings, previous: RunLimitSettings }),
});
/** The install's run limits changed (5.8): they apply to the next dispatch. */
export const SettingsRunLimitsChangedEvent = SettingsRunLimitsChangedInput.extend(assigned);
export type SettingsRunLimitsChangedEvent = z.infer<typeof SettingsRunLimitsChangedEvent>;

export const SettingsNotificationsChangedInput = z.object({
  type: z.literal('settings.notifications_changed'),
  ...onSettingsStream,
  payload: z.object({
    /** How many webhooks there are now; never a URL or host (AD-16). */
    webhooks: z.number().int().nonnegative(),
    browserNotifications: z.boolean(),
  }),
});
/** The notification settings changed (11.4). Tabs refetch them; the event holds no address. */
export const SettingsNotificationsChangedEvent = SettingsNotificationsChangedInput.extend(assigned);
export type SettingsNotificationsChangedEvent = z.infer<typeof SettingsNotificationsChangedEvent>;
