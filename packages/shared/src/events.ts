import { z } from 'zod';
import { Run, RunOutcome, Session, SessionDriver, SessionState, Workspace } from './entities.js';
import { EventId, RunId, SessionId, WorkspaceId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';
import { ToolchainErrorCode, ToolName, ToolSource } from './toolchain.js';

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

/** Install-wide position in the event log, assigned by SQLite. */
export const Seq = z.number().int().positive();
export type Seq = z.infer<typeof Seq>;

/** The stream of install-level events (those with `workspaceId: null`). */
export const SERVER_STREAM = 'server';

/** The stream of toolchain events (install-level: `workspaceId: null`). */
export const TOOLCHAIN_STREAM = 'toolchain';

/** Fields core fills in when it appends an event. */
const assigned = {
  id: EventId,
  seq: Seq,
  at: IsoUtcTimestamp,
};

/** Workspace-level events use the workspace's stream. */
const onWorkspaceStream = { workspaceId: WorkspaceId, streamId: WorkspaceId };
/** Session and run events share the session's stream: the run view is the session view (AD-8). */
const onSessionStream = { workspaceId: WorkspaceId, streamId: SessionId };

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

const SessionCreatedInput = z.object({
  type: z.literal('session.created'),
  ...onSessionStream,
  payload: z.object({ session: Session }),
});
export const SessionCreatedEvent = SessionCreatedInput.extend(assigned);
export type SessionCreatedEvent = z.infer<typeof SessionCreatedEvent>;

const SessionStateChangedInput = z.object({
  type: z.literal('session.state_changed'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, state: SessionState, previous: SessionState }),
});
/** A session's normalized state changed (AD-4). */
export const SessionStateChangedEvent = SessionStateChangedInput.extend(assigned);
export type SessionStateChangedEvent = z.infer<typeof SessionStateChangedEvent>;

const SessionDriverChangedInput = z.object({
  type: z.literal('session.driver_changed'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, driver: SessionDriver, previous: SessionDriver }),
});
/** A session's driver changed (AD-6). */
export const SessionDriverChangedEvent = SessionDriverChangedInput.extend(assigned);
export type SessionDriverChangedEvent = z.infer<typeof SessionDriverChangedEvent>;

/** Identifies one message within a session's stream. */
export const MessageId = z.string().min(1);
export type MessageId = z.infer<typeof MessageId>;

export const MessageRole = z.enum(['user', 'agent']);
export type MessageRole = z.infer<typeof MessageRole>;

const SessionMessageDeltaInput = z.object({
  type: z.literal('session.message_delta'),
  ...onSessionStream,
  payload: z.object({ messageId: MessageId, role: MessageRole, text: z.string() }),
});
/**
 * A chunk of a message still being written. Pruned once the message's
 * `session.message_completed` has been appended (AD-5).
 */
export const SessionMessageDeltaEvent = SessionMessageDeltaInput.extend(assigned);
export type SessionMessageDeltaEvent = z.infer<typeof SessionMessageDeltaEvent>;

const SessionMessageCompletedInput = z.object({
  type: z.literal('session.message_completed'),
  ...onSessionStream,
  payload: z.object({ messageId: MessageId, role: MessageRole, content: z.string() }),
});
/** A finished message with its full content; it replaces that message's deltas. */
export const SessionMessageCompletedEvent = SessionMessageCompletedInput.extend(assigned);
export type SessionMessageCompletedEvent = z.infer<typeof SessionMessageCompletedEvent>;

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

const onToolchainStream = { workspaceId: z.null(), streamId: z.literal(TOOLCHAIN_STREAM) };

const ToolchainInstallStartedInput = z.object({
  type: z.literal('toolchain.install_started'),
  ...onToolchainStream,
  payload: z.object({ tool: ToolName, version: z.string().min(1) }),
});
/** The user clicked Install and the download began (story 1.8). */
export const ToolchainInstallStartedEvent = ToolchainInstallStartedInput.extend(assigned);
export type ToolchainInstallStartedEvent = z.infer<typeof ToolchainInstallStartedEvent>;

const ToolchainInstallProgressInput = z.object({
  type: z.literal('toolchain.install_progress'),
  ...onToolchainStream,
  payload: z.object({
    tool: ToolName,
    bytes: z.number().int().nonnegative(),
    total: z.number().int().positive().nullable(),
  }),
});
/** Bytes downloaded so far (throttled); `total` is `null` when the server did not say. */
export const ToolchainInstallProgressEvent = ToolchainInstallProgressInput.extend(assigned);
export type ToolchainInstallProgressEvent = z.infer<typeof ToolchainInstallProgressEvent>;

const ToolchainInstallCompletedInput = z.object({
  type: z.literal('toolchain.install_completed'),
  ...onToolchainStream,
  payload: z.object({ tool: ToolName, version: z.string().min(1), source: ToolSource }),
});
/** The private copy is verified, unpacked and ready. */
export const ToolchainInstallCompletedEvent = ToolchainInstallCompletedInput.extend(assigned);
export type ToolchainInstallCompletedEvent = z.infer<typeof ToolchainInstallCompletedEvent>;

const ToolchainInstallFailedInput = z.object({
  type: z.literal('toolchain.install_failed'),
  ...onToolchainStream,
  payload: z.object({
    tool: ToolName,
    code: ToolchainErrorCode,
    reason: z.string().min(1),
    canInstall: z.boolean(),
  }),
});
/** The install failed; nothing half-installed is left behind. `reason` is plain words, no secrets. */
export const ToolchainInstallFailedEvent = ToolchainInstallFailedInput.extend(assigned);
export type ToolchainInstallFailedEvent = z.infer<typeof ToolchainInstallFailedEvent>;

/** Every event core may append (grows with later stories). Nothing unschematized is emitted. */
export const CoreEvent = z.discriminatedUnion('type', [
  ServerStartedEvent,
  WorkspaceCreatedEvent,
  WorkspaceHistoryDeletedEvent,
  SessionCreatedEvent,
  SessionStateChangedEvent,
  SessionDriverChangedEvent,
  SessionMessageDeltaEvent,
  SessionMessageCompletedEvent,
  RunCreatedEvent,
  RunOutcomeChangedEvent,
  ToolchainInstallStartedEvent,
  ToolchainInstallProgressEvent,
  ToolchainInstallCompletedEvent,
  ToolchainInstallFailedEvent,
]);
export type CoreEvent = z.infer<typeof CoreEvent>;
export type CoreEventType = CoreEvent['type'];

/** What a caller asks core to append: an event without `id`, `seq` and `at`. */
export const NewCoreEvent = z.discriminatedUnion('type', [
  ServerStartedInput,
  WorkspaceCreatedInput,
  WorkspaceHistoryDeletedInput,
  SessionCreatedInput,
  SessionStateChangedInput,
  SessionDriverChangedInput,
  SessionMessageDeltaInput,
  SessionMessageCompletedInput,
  RunCreatedInput,
  RunOutcomeChangedInput,
  ToolchainInstallStartedInput,
  ToolchainInstallProgressInput,
  ToolchainInstallCompletedInput,
  ToolchainInstallFailedInput,
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
 * Sent once after the backlog of a `subscribe`: every event up to now has been
 * delivered, and what follows is live. The UI waits for it before judging
 * state that a replayed backlog could briefly misstate (the version banner).
 */
export const CaughtUpMessage = z.object({
  type: z.literal('caught_up'),
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

/** Every message the server may send over `/ws`: logged events, `pong`, `caught_up` and `server.stopping`. */
export const ServerMessage = z.discriminatedUnion('type', [...CoreEvent.options, PongMessage, CaughtUpMessage, ServerStoppingMessage]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** A client asking the server to answer with `pong`. */
export const PingMessage = z.object({
  type: z.literal('ping'),
});
export type PingMessage = z.infer<typeof PingMessage>;

/**
 * Stream every event with `seq > afterSeq`, then every new event live
 * (AD-5). Connecting and catching up are the same call: a new client sends
 * `0`, a reconnecting one sends the last `seq` it received. Sending it again
 * replaces the previous subscription.
 */
export const SubscribeMessage = z.object({
  type: z.literal('subscribe'),
  afterSeq: z.number().int().nonnegative(),
});
export type SubscribeMessage = z.infer<typeof SubscribeMessage>;

/** Every message a client may send over `/ws`. */
export const ClientMessage = z.discriminatedUnion('type', [PingMessage, SubscribeMessage]);
export type ClientMessage = z.infer<typeof ClientMessage>;
