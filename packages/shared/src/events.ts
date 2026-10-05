import { z } from 'zod';
import { AgentId, AlwaysAllowScope, CautionLevel, MAX_PAGE_EVENTS, Seq, SERVER_STREAM, WhileWorking } from './events-common.js';
import { assigned, onSessionStream, onWorkspaceStream } from './events-envelope.js';
import {
  SettingsAgentDefaultModelChangedEvent,
  SettingsAgentDefaultModelChangedInput,
  SettingsDeveloperModeChangedEvent,
  SettingsDeveloperModeChangedInput,
  SettingsWhileWorkingChangedEvent,
  SettingsWhileWorkingChangedInput,
} from './events-settings.js';

export { SettingsAgentDefaultModelChangedEvent, SettingsDeveloperModeChangedEvent, SettingsWhileWorkingChangedEvent } from './events-settings.js';
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
import { ModelId, PermissionMode, Run, RunOutcome, Workspace } from './entities.js';
import { BmadPieces } from './bmad.js';
import {
  BmadSetupCompletedEvent,
  BmadSetupCompletedInput,
  BmadSetupFailedEvent,
  BmadSetupFailedInput,
  BmadSetupProgressEvent,
  BmadSetupProgressInput,
  BmadSetupStartedEvent,
  BmadSetupStartedInput,
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

const RunCreatedInput = z.object({
  type: z.literal('run.created'),
  ...onSessionStream,
  payload: z.object({ run: Run }),
});
export const RunCreatedEvent = RunCreatedInput.extend(assigned);
export type RunCreatedEvent = z.infer<typeof RunCreatedEvent>;

const RunOutcomeChangedInput = z.object({
  type: z.literal('run.outcome_changed'),
  ...onSessionStream,
  payload: z.object({ runId: RunId, outcome: RunOutcome, previous: RunOutcome }),
});
export const RunOutcomeChangedEvent = RunOutcomeChangedInput.extend(assigned);
export type RunOutcomeChangedEvent = z.infer<typeof RunOutcomeChangedEvent>;

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
  RunCreatedEvent,
  RunOutcomeChangedEvent,
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
  RunCreatedInput,
  RunOutcomeChangedInput,
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
]);
export type NewCoreEvent = z.infer<typeof NewCoreEvent>;

/** The input for one event type, e.g. `NewEventOf<'session.message_completed'>`. */
export type NewEventOf<T extends CoreEventType> = Extract<NewCoreEvent, { type: T }>;

// ---------------------------------------------------------------------------
// WebSocket messages.
// ---------------------------------------------------------------------------

/** Reply to a client `ping`; lets a client confirm the connection is alive. */
export const PongMessage = z.object({
  type: z.literal('pong'),
  at: IsoUtcTimestamp,
});
export type PongMessage = z.infer<typeof PongMessage>;

/**
 * Sent once after the backlog of each subscription (`subscribe_install`,
 * `subscribe_workspace`, or the legacy `subscribe`): every event of that
 * scope up to now has been delivered, and what follows is live. The UI waits for it before judging
 * state that a replayed backlog could briefly misstate (the version banner).
 */
export const CaughtUpMessage = z.object({
  type: z.literal('caught_up'),
  /**
   * Which subscription caught up (E2-R8): the install-level stream, or one
   * workspace. Absent for the legacy install-wide `subscribe`.
   */
  scope: z.union([z.literal('install'), WorkspaceId]).optional(),
  /** The oldest `seq` the window sent, or `null` when it sent none. */
  oldestSeq: Seq.nullable().optional(),
  /** Whether older events exist before the window (the UI offers "Show earlier"). */
  hasEarlier: z.boolean().optional(),
  /**
   * Story 2.10: a reconnect's `afterSeq` missed more than `MAX_PAGE_EVENTS`
   * events of this scope, so the server sent the scope's recent window
   * instead of the gap. The client replaces the scope's events and paging
   * cursors with that window. Absent on an exact catch-up.
   */
  reset: z.literal(true).optional(),
});
export type CaughtUpMessage = z.infer<typeof CaughtUpMessage>;

/** Why the server is stopping: Quit from the UI, or a restart for a newer version (AD-20). */
export const StopReason = z.enum(['quit', 'restart']);
export type StopReason = z.infer<typeof StopReason>;

/**
 * Sent to every connected client just before the server stops on purpose,
 * so every open tab shows the stopped state rather than reconnecting.
 */
export const ServerStoppingMessage = z.object({
  type: z.literal('server.stopping'),
  reason: StopReason,
});
export type ServerStoppingMessage = z.infer<typeof ServerStoppingMessage>;

/** The client message types that carry a request the server can refuse with `request_failed`. */
export const CLIENT_REQUEST_TYPES = ['subscribe_install', 'subscribe_workspace', 'unsubscribe_workspace', 'page_history'] as const;
export const ClientRequestType = z.enum(CLIENT_REQUEST_TYPES);
export type ClientRequestType = z.infer<typeof ClientRequestType>;

/**
 * One page of older history, the answer to `page_history` (E2-R8): events
 * before `beforeSeq`, oldest first. `hasMore` says whether still older ones exist.
 */
export const HistoryPageMessage = z.object({
  type: z.literal('history_page'),
  requestId: z.string().min(1).max(128),
  workspaceId: WorkspaceId,
  events: z.array(CoreEvent).max(MAX_PAGE_EVENTS),
  hasMore: z.boolean(),
});
export type HistoryPageMessage = z.infer<typeof HistoryPageMessage>;

/** The server could not do what a client message asked; `code` is one of the API's error codes. */
export const RequestFailedMessage = z.object({
  type: z.literal('request_failed'),
  for: ClientRequestType,
  requestId: z.string().min(1).max(128).optional(),
  workspaceId: WorkspaceId.optional(),
  code: ApiErrorCode,
  message: z.string().min(1),
});
export type RequestFailedMessage = z.infer<typeof RequestFailedMessage>;

/**
 * Every message the server may send over `/ws`: logged events, `pong`,
 * `caught_up`, `server.stopping`, `history_page` and `request_failed`.
 */
export const ServerMessage = z.discriminatedUnion('type', [
  ...CoreEvent.options,
  PongMessage,
  CaughtUpMessage,
  ServerStoppingMessage,
  HistoryPageMessage,
  RequestFailedMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** A client asking the server to answer with `pong`. */
export const PingMessage = z.object({
  type: z.literal('ping'),
});
export type PingMessage = z.infer<typeof PingMessage>;

/**
 * Deprecated (story 2.9): the web sends `subscribe_install` and
 * `subscribe_workspace` instead. Stream every event with `seq > afterSeq`,
 * then every new event live. Connecting and catching up are the same call: a
 * new client sends `0`, a reconnecting one sends the last `seq` it received.
 * Sending it again replaces the previous subscription. Still served.
 */
export const SubscribeMessage = z.object({
  type: z.literal('subscribe'),
  afterSeq: z.number().int().nonnegative(),
});
export type SubscribeMessage = z.infer<typeof SubscribeMessage>;

/**
 * Stream the install-level events (`workspaceId: null`: server, toolchain,
 * agents) and every `workspace.created` (so a project added in another tab
 * is seen) with `seq > afterSeq`, then live (E2-R8). Replaces an earlier
 * `subscribe_install`. A reconnect (`afterSeq > 0`) that missed more than
 * `MAX_PAGE_EVENTS` of them gets the newest {@link DEFAULT_WINDOW_EVENTS}
 * instead, and a `caught_up` with `reset: true` (story 2.10).
 */
export const SubscribeInstallMessage = z.object({
  type: z.literal('subscribe_install'),
  afterSeq: z.number().int().nonnegative(),
});
export type SubscribeInstallMessage = z.infer<typeof SubscribeInstallMessage>;

/**
 * Stream one workspace's events, then live (E2-R8). With `afterSeq` (a
 * reconnect) every event after it; without, only the most recent `window`
 * events (default {@link DEFAULT_WINDOW_EVENTS}). Older history is paged with
 * `page_history`. Ends with a `caught_up` naming the workspace. A reconnect
 * that missed more than `MAX_PAGE_EVENTS` events gets the window instead,
 * and a `caught_up` with `reset: true` (story 2.10).
 */
export const SubscribeWorkspaceMessage = z.object({
  type: z.literal('subscribe_workspace'),
  workspaceId: WorkspaceId,
  afterSeq: z.number().int().nonnegative().optional(),
  window: z.number().int().positive().max(MAX_PAGE_EVENTS).optional(),
});
export type SubscribeWorkspaceMessage = z.infer<typeof SubscribeWorkspaceMessage>;

/** Stop streaming one workspace's events. */
export const UnsubscribeWorkspaceMessage = z.object({
  type: z.literal('unsubscribe_workspace'),
  workspaceId: WorkspaceId,
});
export type UnsubscribeWorkspaceMessage = z.infer<typeof UnsubscribeWorkspaceMessage>;

/**
 * Asks for older history ("Show earlier"): up to `limit` events of the
 * workspace (or of one of its sessions) with `seq < beforeSeq`. Answered by
 * `history_page` with the same `requestId`, or `request_failed`.
 */
export const PageHistoryMessage = z.object({
  type: z.literal('page_history'),
  requestId: z.string().min(1).max(128),
  workspaceId: WorkspaceId,
  sessionId: SessionId.optional(),
  beforeSeq: Seq,
  limit: z.number().int().positive().max(MAX_PAGE_EVENTS),
});
export type PageHistoryMessage = z.infer<typeof PageHistoryMessage>;

/**
 * Every message a client may send over `/ws`. The legacy install-wide
 * `subscribe` is deprecated: it keeps working, but the web no longer sends it
 * (story 2.9).
 */
export const ClientMessage = z.discriminatedUnion('type', [
  PingMessage,
  SubscribeMessage,
  SubscribeInstallMessage,
  SubscribeWorkspaceMessage,
  UnsubscribeWorkspaceMessage,
  PageHistoryMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
