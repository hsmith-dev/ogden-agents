import { z } from 'zod';
import { AgentId, AlwaysAllowScope, CautionLevel, MAX_PAGE_EVENTS, Seq, SERVER_STREAM, WhileWorking } from './events-common.js';
import { assigned, onSessionStream, onWorkspaceStream } from './events-envelope.js';
import {
  SettingsAgentDefaultModelChangedEvent,
  SettingsAgentDefaultModelChangedInput,
  SettingsDeveloperModeChangedEvent,
  SettingsDeveloperModeChangedInput,
  SettingsWhileWorkingChangedEvent,
  SettingsTeamRosterDefaultChangedEvent,
  SettingsOrchestrationDefaultsChangedEvent,
  SettingsOrchestrationDefaultsChangedInput,
  SettingsUpdateNoticeChangedEvent,
  SettingsUpdateNoticeChangedInput,
  SettingsTerminalsChangedEvent,
  SettingsTerminalsChangedInput,
  AppUpdateAvailableEvent,
  AppUpdateAvailableInput,
  AppUpdateRequestedEvent,
  AppUpdateRequestedInput,
  SettingsWhileWorkingChangedInput,
  SettingsTeamRosterDefaultChangedInput,
} from './events-settings.js';

export { SettingsTerminalsChangedEvent } from './events-settings.js';
export { AppUpdateAvailableEvent, AppUpdateRequestedEvent, SettingsAgentDefaultModelChangedEvent, SettingsDeveloperModeChangedEvent, SettingsUpdateNoticeChangedEvent, SettingsWhileWorkingChangedEvent, SettingsTeamRosterDefaultChangedEvent, SettingsOrchestrationDefaultsChangedEvent } from './events-settings.js';
// Terminal pane events (epic 16): state only.
import * as panes from './events-panes.js';

export {
  TerminalLayoutChangedEvent, TerminalPaneClosedEvent, TerminalPaneExitedEvent, TerminalPaneOpenedEvent, TerminalPaneRenamedEvent, TerminalPaneStatusChangedEvent,
} from './events-panes.js';
// The Local model's endpoint events (epic 14 story 14.3).
import { SettingsLocalEndpointsChangedEvent, SettingsLocalEndpointsChangedInput } from './events-local.js';

export { LOCAL_ENDPOINT_CHANGES, SettingsLocalEndpointsChangedEvent } from './events-local.js';
// The orchestration events (epic 15 story 15.2).
import * as orch from './events-orchestration.js';

export {
  OrchestrationManagerRepliedEvent, OrchestrationModeChangedEvent, OrchestrationPlanProposedEvent, OrchestrationResultReadEvent, OrchestrationRunFinishedEvent, OrchestrationRunPausedEvent, OrchestrationRunStartedEvent,
  OrchestrationRunStoppedEvent, OrchestrationStepApprovedEvent, OrchestrationStepDispatchedEvent, OrchestrationStepEditedEvent, OrchestrationStepProposedEvent, OrchestrationStepSkippedEvent, OrchestrationStepsReorderedEvent, OrchestrationDispatchRefusedEvent,
  OrchestrationDecisionMadeEvent, OrchestrationQuestionAnsweredEvent, OrchestrationRunResumedEvent, OrchestrationBuildLinkedEvent, OrchestrationRoutingChangedEvent,
} from './events-orchestration.js';
// Build run events and the builds and notification settings events (stories 5.2, 5.3).
import * as runs from './events-runs.js';

export {
  RunCreatedEvent, RunDecidedEvent, RunDispatchedEvent, RunOutcomeChangedEvent, RunQueueChangedEvent, RunVerificationCompletedEvent,
  SettingsNotificationsChangedEvent, SettingsRunLimitsChangedEvent, WorkspaceBuildSettingsChangedEvent,
} from './events-runs.js';
import {
  PermissionRequestedEvent,
  PermissionRequestedInput,
  PermissionResolvedEvent,
  PermissionResolvedInput,
  SessionAgentChangedEvent,
  SessionAgentChangedInput,
  SessionAgentStartedEvent,
  SessionAgentStartedInput,
  SessionAgentStartingEvent,
  SessionAgentStartingInput,
  SessionCheckInEvent,
  SessionCheckInInput,
  SessionDocumentWrittenEvent,
  SessionDocumentWrittenInput,
  SessionCreatedEvent,
  SessionCreatedInput,
  SessionDriverChangedEvent,
  SessionDriverChangedInput,
  SessionMessageCompletedEvent,
  SessionMessageCompletedInput,
  SessionMessageDeltaEvent,
  SessionMessageDeltaInput,
  SessionMessageQueuedEvent,
  SessionMessageQueuedInput,
  SessionModelChangedEvent,
  SessionModelChangedInput,
  SessionQueueChangedEvent,
  SessionQueueChangedInput,
  SessionTurnInterruptedEvent,
  SessionTurnInterruptedInput,
  SessionPermissionModeChangedEvent,
  SessionPermissionModeChangedInput,
  SessionRenamedEvent,
  SessionRenamedInput,
  SessionResumedEvent,
  SessionResumedInput,
  SessionStateChangedEvent,
  SessionStateChangedInput,
  SessionToolCallEvent,
  SessionToolCallInput,
  SessionToolCallUpdatedEvent,
  SessionToolCallUpdatedInput,
} from './events-session.js';
import { ModelId, PermissionMode, Workspace } from './entities.js';
import { BmadPieces } from './bmad.js';
import { OrchestrationMode } from './orchestration.js';
import { TeamRoster } from './team.js';
import {
  BmadSetupCompletedEvent,
  BmadSetupCompletedInput,
  BmadSetupFailedEvent,
  BmadSetupFailedInput,
  BmadSetupProgressEvent,
  BmadSetupProgressInput,
  BmadSetupStartedEvent,
  BmadSetupStartedInput,
  LookBackOfferDismissedEvent,
  LookBackOfferDismissedInput,
  RetrospectiveChangedEvent,
  RetrospectiveChangedInput,
  TicketChangedEvent,
  TicketChangedInput,
  WorkspaceBmadScriptsTrustedEvent,
  WorkspaceBmadScriptsTrustedInput,
} from './events-planning.js';
import {
  AgentAuthChangedEvent,
  AgentAuthChangedInput,
  AgentInstallCompletedEvent,
  AgentInstallCompletedInput,
  AgentInstallFailedEvent,
  AgentInstallFailedInput,
  AgentInstallProgressEvent,
  AgentInstallProgressInput,
  AgentInstallStartedEvent,
  AgentInstallStartedInput,
  AgentUninstalledEvent,
  AgentUninstalledInput,
  ToolchainInstallCompletedEvent,
  ToolchainInstallCompletedInput,
  ToolchainInstallFailedEvent,
  ToolchainInstallFailedInput,
  ToolchainInstallProgressEvent,
  ToolchainInstallProgressInput,
  ToolchainInstallStartedEvent,
  ToolchainInstallStartedInput,
} from './events-install.js';
import { ApiErrorCode } from './errors.js';
import { PermissionRuleId, RunId, SessionId, WorkspaceId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * The event log contract (AD-5) and the wire contract for the events
 * WebSocket (`/ws`).
 *
 * Every event core appends is a `CoreEvent`: the envelope
 * `{ id, seq, workspaceId, streamId, type, at, payload }` with a per-type
 * payload. `seq` is assigned by the database and increases strictly across the
 * install. `workspaceId` is `null` only for install-level events such as
 * `server.started`.
 *
 * Every message the server sends is a `ServerMessage`; every message a client
 * sends must parse as a `ClientMessage`. Anything else is rejected.
 */

// The common parts and the session and permission events live in sibling
// modules (story 10.8), and epic 4's events too (entry 4.12); every public
// name is exported from here as before.
export * from './events-common.js';
export {
  SessionCreatedEvent,
  SessionStateChangedEvent,
  SessionDriverChangedEvent,
  MessageId,
  MessageRole,
  SessionMessageDeltaEvent,
  SessionMessageCompletedEvent,
  SessionToolCallEvent,
  SessionToolCallUpdatedEvent,
  ResumedVia,
  SessionResumedEvent,
  SessionMessageQueuedEvent,
  QueuedMessage,
  QueueChangeCause,
  SessionQueueChangedEvent,
  SessionTurnInterruptedEvent,
  SessionCheckInEvent,
  SessionDocumentWrittenEvent,
  SessionAgentStartingEvent,
  SessionAgentStartedEvent,
  SessionAgentChangedEvent,
  MAX_HANDOFF_BRIEF_CHARS,
  PERMISSION_MODE_CHANGE_CAUSES,
  PermissionModeChangeCause,
  SessionPermissionModeChangedEvent,
  SessionRenamedEvent,
  MODEL_CHANGE_CAUSES,
  ModelChangeCause,
  SessionModelChangedEvent,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
} from './events-session.js';
// Epic 4's events (entry 4.12).
export {
  WorkspaceBmadScriptsTrustedEvent,
  LookBackOfferDismissedEvent,
  RetrospectiveChangedEvent,
  TicketChangedEvent,
  BmadSetupStartedEvent,
  BmadSetupProgressEvent,
  BmadSetupCompletedEvent,
  BmadSetupFailedEvent,
} from './events-planning.js';

// Install-level toolchain and agent setup events (story 6.9).
export {
  ToolchainInstallStartedEvent,
  ToolchainInstallProgressEvent,
  ToolchainInstallCompletedEvent,
  ToolchainInstallFailedEvent,
  AgentInstallStartedEvent,
  AgentInstallProgressEvent,
  AgentInstallCompletedEvent,
  AgentInstallFailedEvent,
  AgentUninstalledEvent,
  AgentAuthChangedEvent,
} from './events-install.js';

// ---------------------------------------------------------------------------
// Event types. Each is defined once without the core-assigned fields (what a
// caller asks core to append) and once as the stored envelope.
// ---------------------------------------------------------------------------

const ServerStartedInput = z.object({
  type: z.literal('server.started'),
  workspaceId: z.null(),
  streamId: z.literal(SERVER_STREAM),
  payload: z.object({ version: z.string().min(1) }),
});
/** Appended once each time the server has bound its port. */
export const ServerStartedEvent = ServerStartedInput.extend(assigned);
export type ServerStartedEvent = z.infer<typeof ServerStartedEvent>;

const WorkspaceCreatedInput = z.object({
  type: z.literal('workspace.created'),
  ...onWorkspaceStream,
  payload: z.object({ workspace: Workspace }),
});
/** A new workspace row was created (AD-2). */
export const WorkspaceCreatedEvent = WorkspaceCreatedInput.extend(assigned);
export type WorkspaceCreatedEvent = z.infer<typeof WorkspaceCreatedEvent>;

const WorkspaceHistoryDeletedInput = z.object({
  type: z.literal('workspace.history_deleted'),
  ...onWorkspaceStream,
  payload: z.object({
    deletedEvents: z.number().int().nonnegative(),
    deletedSessions: z.number().int().nonnegative(),
    deletedRuns: z.number().int().nonnegative(),
  }),
});
/**
 * A workspace's events, sessions and runs were deleted; the workspace itself
 * remains. Clients drop everything they hold for that workspace.
 */
export const WorkspaceHistoryDeletedEvent = WorkspaceHistoryDeletedInput.extend(assigned);
export type WorkspaceHistoryDeletedEvent = z.infer<typeof WorkspaceHistoryDeletedEvent>;

const WorkspacePermissionRuleAddedInput = z.object({
  type: z.literal('workspace.permission_rule_added'),
  ...onWorkspaceStream,
  payload: z.object({ ruleId: PermissionRuleId, scope: AlwaysAllowScope }),
});
/** An always-allow rule was stored for the workspace (E2-R3). */
export const WorkspacePermissionRuleAddedEvent = WorkspacePermissionRuleAddedInput.extend(assigned);
export type WorkspacePermissionRuleAddedEvent = z.infer<typeof WorkspacePermissionRuleAddedEvent>;

const WorkspacePermissionRuleRemovedInput = z.object({
  type: z.literal('workspace.permission_rule_removed'),
  ...onWorkspaceStream,
  payload: z.object({ ruleId: PermissionRuleId }),
});
/** An always-allow rule was undone. */
export const WorkspacePermissionRuleRemovedEvent = WorkspacePermissionRuleRemovedInput.extend(assigned);
export type WorkspacePermissionRuleRemovedEvent = z.infer<typeof WorkspacePermissionRuleRemovedEvent>;

const WorkspaceSettingsChangedInput = z.object({
  type: z.literal('workspace.settings_changed'),
  ...onWorkspaceStream,
  payload: z.object({
    /** The caution level now (unchanged when only the pieces changed). */
    cautionLevel: CautionLevel,
    previous: CautionLevel,
    /**
     * The BMad pieces now and before (story 10.1), present when they changed.
     * Optional, so the `{ cautionLevel, previous }` events 0.2.0 stored still
     * parse and replay (E10-R7).
     */
    bmadPieces: BmadPieces.optional(),
    previousBmadPieces: BmadPieces.optional(),
    /**
     * The project's default agent now and before (epic 6 contract, 6.3;
     * appended from entry 6), present when it changed. `null`: the
     * install's default. Optional, so every earlier event still parses.
     */
    defaultAgentId: AgentId.nullable().optional(),
    previousDefaultAgentId: AgentId.nullable().optional(),
    /**
     * The mode new chats start in, now and before (default permission mode),
     * present when it changed; why (`user`, or `developer_mode_off`, which
     * drops a Skip all default to Ask); and `skipAllConfirmed` when the user
     * confirmed Skip all's warning for this project. All optional, so every
     * earlier event still parses (AD-5).
     */
    defaultPermissionMode: PermissionMode.optional(),
    previousDefaultPermissionMode: PermissionMode.optional(),
    defaultPermissionModeCause: z.enum(['user', 'developer_mode_off']).optional(),
    skipAllConfirmed: z.literal(true).optional(),
    /**
     * The project's default model per agent now and before (story 11),
     * present when they changed. An agent missing from it uses the install's
     * default for that agent. Optional, so every earlier event still parses.
     */
    defaultModels: z.record(AgentId, ModelId).optional(),
    previousDefaultModels: z.record(AgentId, ModelId).optional(),
    /**
     * The project's own choice of what a message sent while the agent works
     * does, now and before (send now or wait), present when it changed.
     * `null`: the app-wide choice. Optional, so every earlier event still parses.
     */
    whileWorking: WhileWorking.nullable().optional(),
    previousWhileWorking: WhileWorking.nullable().optional(),
    /**
     * Whether the Orchestration piece is on, the project's orchestration mode and roster, now and before (epic 15
     * story 15.2), present when they changed; `orchestrationAutomaticConfirmed`
     * when the user confirmed the switch to automatic dispatch. Optional, so
     * every earlier event still parses.
     */
    orchestrationEnabled: z.boolean().optional(),
    previousOrchestrationEnabled: z.boolean().optional(),
    orchestrationMode: OrchestrationMode.optional(),
    previousOrchestrationMode: OrchestrationMode.optional(),
    orchestrationRoster: TeamRoster.optional(),
    previousOrchestrationRoster: TeamRoster.optional(),
    orchestrationAutomaticConfirmed: z.literal(true).optional(),
  }),
});
/**
 * The workspace's settings changed: its caution level (E2-R4), which applies
 * to requests not yet shown, or its BMad pieces (CAP-19, AD-22).
 */
export const WorkspaceSettingsChangedEvent = WorkspaceSettingsChangedInput.extend(assigned);
export type WorkspaceSettingsChangedEvent = z.infer<typeof WorkspaceSettingsChangedEvent>;

const WorkspaceBmadOfferDismissedInput = z.object({
  type: z.literal('workspace.bmad_offer_dismissed'),
  ...onWorkspaceStream,
  payload: z.object({}),
});
/**
 * The user answered the "already uses BMad Method" offer with Not now
 * (story 10.3): core keeps it per project and the offer never shows again
 * for it. Appended once; a second Not now changes nothing.
 */
export const WorkspaceBmadOfferDismissedEvent = WorkspaceBmadOfferDismissedInput.extend(assigned);
export type WorkspaceBmadOfferDismissedEvent = z.infer<typeof WorkspaceBmadOfferDismissedEvent>;

/** Every event core may append (grows with later stories). Nothing unschematized is emitted. */
export const CoreEvent = z.discriminatedUnion('type', [
  ServerStartedEvent,
  WorkspaceCreatedEvent,
  WorkspaceHistoryDeletedEvent,
  WorkspacePermissionRuleAddedEvent,
  WorkspacePermissionRuleRemovedEvent,
  WorkspaceSettingsChangedEvent,
  WorkspaceBmadOfferDismissedEvent,
  WorkspaceBmadScriptsTrustedEvent,
  LookBackOfferDismissedEvent,
  RetrospectiveChangedEvent,
  TicketChangedEvent,
  BmadSetupStartedEvent,
  BmadSetupProgressEvent,
  BmadSetupCompletedEvent,
  BmadSetupFailedEvent,
  SessionCreatedEvent,
  SessionStateChangedEvent,
  SessionDriverChangedEvent,
  SessionPermissionModeChangedEvent,
  SessionRenamedEvent,
  SessionModelChangedEvent,
  SessionMessageDeltaEvent,
  SessionMessageCompletedEvent,
  SessionToolCallEvent,
  SessionToolCallUpdatedEvent,
  SessionResumedEvent,
  SessionMessageQueuedEvent,
  SessionQueueChangedEvent,
  SessionTurnInterruptedEvent,
  SessionCheckInEvent,
  SessionDocumentWrittenEvent,
  SessionAgentStartingEvent,
  SessionAgentStartedEvent,
  SessionAgentChangedEvent,
  PermissionRequestedEvent,
  PermissionResolvedEvent,
  runs.RunCreatedEvent, runs.RunOutcomeChangedEvent, runs.RunDispatchedEvent, runs.RunQueueChangedEvent,
  runs.RunVerificationCompletedEvent, runs.RunDecidedEvent, runs.WorkspaceBuildSettingsChangedEvent,
  ToolchainInstallStartedEvent,
  ToolchainInstallProgressEvent,
  ToolchainInstallCompletedEvent,
  ToolchainInstallFailedEvent,
  AgentInstallStartedEvent,
  AgentInstallProgressEvent,
  AgentInstallCompletedEvent,
  AgentInstallFailedEvent,
  AgentUninstalledEvent,
  AgentAuthChangedEvent,
  SettingsDeveloperModeChangedEvent,
  SettingsAgentDefaultModelChangedEvent,
  SettingsWhileWorkingChangedEvent,
  SettingsTeamRosterDefaultChangedEvent,
  SettingsOrchestrationDefaultsChangedEvent,
  runs.SettingsRunLimitsChangedEvent,
  runs.SettingsNotificationsChangedEvent,
  SettingsLocalEndpointsChangedEvent,
  orch.OrchestrationRunStartedEvent, orch.OrchestrationPlanProposedEvent, orch.OrchestrationStepProposedEvent, orch.OrchestrationStepApprovedEvent, orch.OrchestrationStepEditedEvent, orch.OrchestrationStepSkippedEvent, orch.OrchestrationStepsReorderedEvent,
  orch.OrchestrationStepDispatchedEvent, orch.OrchestrationDispatchRefusedEvent, orch.OrchestrationResultReadEvent, orch.OrchestrationRunPausedEvent, orch.OrchestrationRunStoppedEvent, orch.OrchestrationRunFinishedEvent, orch.OrchestrationModeChangedEvent, orch.OrchestrationManagerRepliedEvent,
  orch.OrchestrationDecisionMadeEvent, orch.OrchestrationQuestionAnsweredEvent, orch.OrchestrationRunResumedEvent, orch.OrchestrationBuildLinkedEvent, orch.OrchestrationRoutingChangedEvent,
  SettingsUpdateNoticeChangedEvent,
  SettingsTerminalsChangedEvent,
  AppUpdateAvailableEvent,
  AppUpdateRequestedEvent,
  panes.TerminalPaneOpenedEvent, panes.TerminalPaneStatusChangedEvent, panes.TerminalPaneExitedEvent, panes.TerminalPaneClosedEvent, panes.TerminalPaneRenamedEvent, panes.TerminalLayoutChangedEvent,
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
export type CoreEventType = CoreEvent['type'];

/** What a caller asks core to append: an event without `id`, `seq` and `at`. */
export const NewCoreEvent = z.discriminatedUnion('type', [
  ServerStartedInput,
  WorkspaceCreatedInput,
  WorkspaceHistoryDeletedInput,
  WorkspacePermissionRuleAddedInput,
  WorkspacePermissionRuleRemovedInput,
  WorkspaceSettingsChangedInput,
  WorkspaceBmadOfferDismissedInput,
  WorkspaceBmadScriptsTrustedInput,
  LookBackOfferDismissedInput,
  RetrospectiveChangedInput,
  TicketChangedInput,
  BmadSetupStartedInput,
  BmadSetupProgressInput,
  BmadSetupCompletedInput,
  BmadSetupFailedInput,
  SessionCreatedInput,
  SessionStateChangedInput,
  SessionDriverChangedInput,
  SessionPermissionModeChangedInput,
  SessionRenamedInput,
  SessionModelChangedInput,
  SessionMessageDeltaInput,
  SessionMessageCompletedInput,
  SessionToolCallInput,
  SessionToolCallUpdatedInput,
  SessionResumedInput,
  SessionMessageQueuedInput,
  SessionQueueChangedInput,
  SessionTurnInterruptedInput,
  SessionCheckInInput,
  SessionDocumentWrittenInput,
  SessionAgentStartingInput,
  SessionAgentStartedInput,
  SessionAgentChangedInput,
  PermissionRequestedInput,
  PermissionResolvedInput,
  runs.RunCreatedInput, runs.RunOutcomeChangedInput, runs.RunDispatchedInput, runs.RunQueueChangedInput,
  runs.RunVerificationCompletedInput, runs.RunDecidedInput, runs.WorkspaceBuildSettingsChangedInput,
  ToolchainInstallStartedInput,
  ToolchainInstallProgressInput,
  ToolchainInstallCompletedInput,
  ToolchainInstallFailedInput,
  AgentInstallStartedInput,
  AgentInstallProgressInput,
  AgentInstallCompletedInput,
  AgentInstallFailedInput,
  AgentUninstalledInput,
  AgentAuthChangedInput,
  SettingsDeveloperModeChangedInput,
  SettingsAgentDefaultModelChangedInput,
  SettingsWhileWorkingChangedInput,
  SettingsTeamRosterDefaultChangedInput,
  SettingsOrchestrationDefaultsChangedInput,
  runs.SettingsRunLimitsChangedInput,
  runs.SettingsNotificationsChangedInput,
  SettingsLocalEndpointsChangedInput,
  ...orch.ORCHESTRATION_INPUTS,
  SettingsUpdateNoticeChangedInput,
  SettingsTerminalsChangedInput,
  AppUpdateAvailableInput,
  AppUpdateRequestedInput,
  panes.TerminalPaneOpenedInput, panes.TerminalPaneStatusChangedInput, panes.TerminalPaneExitedInput, panes.TerminalPaneClosedInput, panes.TerminalPaneRenamedInput, panes.TerminalLayoutChangedInput,
]);
export type NewCoreEvent = z.infer<typeof NewCoreEvent>;

/** The input for one event type, e.g. `NewEventOf<'session.message_completed'>`. */
export type NewEventOf<T extends CoreEventType> = Extract<NewCoreEvent, { type: T }>;
