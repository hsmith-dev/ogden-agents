import { z } from 'zod';
import { AgentId } from './events-common.js';
import { RunId, SessionId, WorkspaceId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * The entity model (AD-8): Workspace, then Session, then Event; a Run exists
 * only on a `build` session. Session state, run outcome and ticket status are
 * three separate things, and ticket status is never stored here (AD-10).
 */

/** A session's normalized state (AD-4). `waiting` means waiting on the user. */
export const SESSION_STATES = ['working', 'waiting', 'idle', 'done', 'error'] as const;
export const SessionState = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof SessionState>;

/** Who drives a session: the chat UI or the terminal (AD-6). */
export const SESSION_DRIVERS = ['ui', 'terminal'] as const;
export const SessionDriver = z.enum(SESSION_DRIVERS);
export type SessionDriver = z.infer<typeof SessionDriver>;

/**
 * A chat's permission mode (story: each chat has a permission mode). `ask`:
 * every request the agent sends shows a card under the workspace's caution
 * level and Always-allow rules (where every chat starts). `auto`: the agent's
 * own auto mode approves what it judges safe and asks, through the cards,
 * about the rest. `skip_all`: the agent skips its permission checks; only in
 * Developer mode, after a confirmation. Changed only by core, each change a
 * `session.permission_mode_changed` event. An agent declares which it offers.
 */
export const PERMISSION_MODES = ['ask', 'auto', 'skip_all'] as const;
export const PermissionMode = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof PermissionMode>;

/**
 * How much each mode asks, strictest first: a higher rank asks less. A move to
 * a lower rank is a move to a stricter mode.
 */
export const PERMISSION_MODE_RANK: Readonly<Record<PermissionMode, number>> = { ask: 0, auto: 2, skip_all: 3 };

/** The modes' names as the UI shows them. */
export const PERMISSION_MODE_LABELS: Readonly<Record<PermissionMode, string>> = { ask: 'Ask', auto: 'Auto', skip_all: 'Skip all' };

/** What a session is for (AD-8). */
export const SESSION_KINDS = ['chat', 'planning', 'build'] as const;
export const SessionKind = z.enum(SESSION_KINDS);
export type SessionKind = z.infer<typeof SessionKind>;

/** A run's outcome (AD-8). */
export const RUN_OUTCOMES = ['running', 'verified', 'failed', 'blocked', 'stopped'] as const;
export const RunOutcome = z.enum(RUN_OUTCOMES);
export type RunOutcome = z.infer<typeof RunOutcome>;

/** A ticket ref as BMAD writes it (e.g. `2.3`). Only the ref is stored (AD-10). */
export const TicketRef = z.string().min(1);
export type TicketRef = z.infer<typeof TicketRef>;

/**
 * Agent- or CLI-specific identifiers for a session (AD-9), e.g.
 * `{ "claude-code.session": "…" }`. Never used as keys or in URLs.
 */
export const AdapterRefs = z.record(z.string().min(1), z.string());
export type AdapterRefs = z.infer<typeof AdapterRefs>;

/** One repo root (AD-2). `path` is canonical: the real path, case-folded on case-insensitive filesystems. */
export const Workspace = z.object({
  id: WorkspaceId,
  path: z.string().min(1),
  /**
   * The real path as the filesystem spells it, not case-folded: where agents
   * run. Absent only in `workspace.created` events written before story 2.2.
   */
  realPath: z.string().min(1).optional(),
  createdAt: IsoUtcTimestamp,
});
export type Workspace = z.infer<typeof Workspace>;

export const Session = z.object({
  id: SessionId,
  workspaceId: WorkspaceId,
  kind: SessionKind,
  state: SessionState,
  driver: SessionDriver,
  /**
   * The chat's permission mode. Absent in `session.created` events and rows
   * from before it existed: they read as `ask`.
   */
  permissionMode: PermissionMode.default('ask'),
  /**
   * The session's agent (epic 6, E6-R1): set at creation, and changed only
   * when the user continues the chat with another agent (handoff,
   * `session.agent_changed`). Absent only in `session.created` events and rows
   * from before agents could be chosen; those sessions are the install's
   * original agent, which the server fills in every session it answers.
   */
  agentId: AgentId.optional(),
  title: z.string().nullable(),
  adapterRefs: AdapterRefs,
  createdAt: IsoUtcTimestamp,
  updatedAt: IsoUtcTimestamp,
});
export type Session = z.infer<typeof Session>;

export const Run = z.object({
  id: RunId,
  sessionId: SessionId,
  workspaceId: WorkspaceId,
  ticketRef: TicketRef,
  worktreePath: z.string().nullable(),
  sandbox: z.string().nullable(),
  deadline: IsoUtcTimestamp.nullable(),
  outcome: RunOutcome,
  createdAt: IsoUtcTimestamp,
  updatedAt: IsoUtcTimestamp,
});
export type Run = z.infer<typeof Run>;
