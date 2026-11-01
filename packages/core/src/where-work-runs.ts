/**
 * Where work runs (CAP-35; epic 27 entry 2's contract only, 27.3 to 27.8
 * implement it): the use-cases the routes call and the port probe an
 * adapter provides. A chat's place, its hand-off, worktree retention and
 * Restore, a worktree's port, and one task tried by several agents. Git is
 * only ever {@link VcsChatWorktreePort}'s; no route and no core module runs
 * it. Inputs from a route are `unknown` and parsed against the shared
 * schemas; every method refuses a project of another install (404) and a
 * session of another project (404).
 *
 * The rules every implementation keeps:
 * - Never mid-turn: a hand-off, a put-away (retention or a trial's not
 *   kept copies) and a Restore refuse a chat that is `working` or `waiting`
 *   (`AgentMidTurnError`, 409 `agent_mid_turn`); the sweep skips it.
 * - Snapshot first: a chat worktree is removed only after its uncommitted
 *   changes are snapshotted into AD-37's store in the data directory, and
 *   never if that fails; Restore brings them back on the kept branch.
 * - A chat's worktree changes only by Hand off, through
 *   `Entities.setSessionWorktree`, which records `session.location_changed`
 *   (user decision 2026-11-01, AD-8 CAP-33 note).
 * - Events carry ids, states, branches, ports and counts only.
 */
import type {
  HandOffResponse,
  PutAwayCause,
  PutAwayWorktree,
  PutAwayWorktreesResponse,
  SessionId,
  SessionLocationResponse,
  TrialResponse,
  WorktreeRetentionSetting,
} from '@ogden-agents/shared';
import type { VcsChatWorktreePort } from './vcs-port.js';

/** A chat's place and its hand-off (27.3 to 27.5). */
export interface ChatLocations {
  /** Where the chat works: this folder, its worktree (branch, port, whether put away) or its remote machine. */
  location(workspaceId: unknown, sessionId: unknown): Promise<SessionLocationResponse>;
  /**
   * Moves an idle chat and its uncommitted changes to `HandOffRequest.to`
   * (27.4): `VcsChatWorktreePort.moveChanges`, then
   * `Entities.setSessionWorktree`, then the agent restarts in the new folder,
   * resuming its own session when it can. `HandOffConflictError` when the
   * target has its own changes to the same files; `InvalidOperationError`
   * when the chat is already there, is remote, or is not a chat.
   */
  handOff(workspaceId: unknown, sessionId: unknown, body: unknown): Promise<HandOffResponse>;
}

/**
 * Worktree retention and Restore (27.6; AD-17 CAP-33 note's one exception,
 * user decision 2026-11-01). The cap is the install's (default
 * `WORKTREE_RETENTION_DEFAULT`), counted over every project's chat
 * worktrees that are not put away.
 */
export interface WorktreeRetention {
  setting(): Promise<WorktreeRetentionSetting>;
  /** Changes the cap, appending `settings.worktree_retention_changed`; then {@link enforce}. */
  setSetting(body: unknown): Promise<WorktreeRetentionSetting>;
  /** The project's put-away chat worktrees, newest first. */
  listPutAway(workspaceId: unknown): Promise<PutAwayWorktreesResponse>;
  /**
   * Puts one chat's worktree away: `VcsChatWorktreePort.putAway` (snapshot,
   * then remove, branch kept), appending `session.worktree_put_away`. Refused
   * mid-turn. Called by {@link enforce} and by a trial's Keep this one.
   */
  putAway(sessionId: SessionId, cause: PutAwayCause): Promise<PutAwayWorktree>;
  /**
   * Brings a put-away chat worktree back on its branch with its saved
   * changes, appending `session.worktree_restored`. `RestoreFailedError`
   * (`branch_missing`, `path_taken`) keeps the snapshot; refused mid-turn.
   */
  restore(workspaceId: unknown, sessionId: unknown): Promise<SessionLocationResponse>;
  /**
   * The sweep: while more chat worktrees exist than the cap, puts away the
   * oldest idle one (`retention`), never one whose chat works or waits.
   * What it put away.
   */
  enforce(): Promise<PutAwayWorktree[]>;
}

/** A worktree's own port (27.7): given from `WORKTREE_PORT_RANGE` unless the project sets its own, probed free first. */
export interface WorktreePorts {
  /** Gives the chat's worktree a free port, appending `session.port_assigned`; `null` when none is free. Its existing one when it has one. */
  assign(sessionId: SessionId): Promise<number | null>;
  /** Gives the chat's port back, appending `session.port_released`; nothing when it has none. */
  release(sessionId: SessionId): Promise<void>;
  /** The chat's port, or `null`. */
  portOf(sessionId: SessionId): number | null;
}

/** Whether a port on this computer is free (27.7's adapter listens on `127.0.0.1`; tests use the memory stub, never the real network). */
export interface PortProbePort {
  isFree(port: number): Promise<boolean>;
}

/** One task tried by several agents (27.8), each in its own worktree chat. */
export interface Trials {
  /** Parses `CreateTrialRequest`; one worktree chat per agent, appending `workspace.trial_started`. */
  start(workspaceId: unknown, body: unknown): Promise<TrialResponse>;
  get(workspaceId: unknown, trialId: unknown): Promise<TrialResponse>;
  /** Keeps one chat (`KeepTrialRequest`); the others' copies are put away (`not_kept`), appending `workspace.trial_kept`. Refused mid-turn. */
  keep(workspaceId: unknown, trialId: unknown, body: unknown): Promise<TrialResponse>;
}

/** The ports 27.4 to 27.8 build these use-cases over. */
export interface WhereWorkRunsPorts {
  vcs: VcsChatWorktreePort;
  portProbe: PortProbePort;
}
