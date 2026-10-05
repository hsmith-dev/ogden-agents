/**
 * The WebSocket protocol's messages (moved from `events.ts` in epic 7's
 * sweep, which had grown past 600 lines): what the server sends and what a
 * client may send. They carry {@link CoreEvent}s, so they sit beside it,
 * exported from the package index under the same names.
 */
import { z } from 'zod';
import { MAX_PAGE_EVENTS, Seq, SERVER_STREAM } from './events-common.js';
import { ApiErrorCode } from './errors.js';
import { SessionId, WorkspaceId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';
import { CoreEvent } from './events.js';

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
