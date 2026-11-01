/**
 * Where work runs (CAP-35; epic 27 entry 2's contract): a chat's hand-off
 * between this folder and its own worktree, a chat worktree put away by
 * retention and restored, a worktree's port, the retention setting, and a
 * task tried by several agents. Each payload is strict and carries ids,
 * states, branch names, ports and counts only: never a path, a file's
 * content or the task's text. `events.ts` re-exports the events; the
 * `*Input` schemas stay internal to the event modules.
 */
import { z } from 'zod';
import type { ChatLocation } from './chat.js';
import { SETTINGS_STREAM } from './events-common.js';
import { assigned, onSessionStream, onWorkspaceStream } from './events-envelope.js';
import { SessionId, TrialId, WorktreeSnapshotId } from './ids.js';

/** A count of files. */
const Count = z.number().int().nonnegative();
/** A chat worktree's branch (`ogden/chat/<ses_…>`): a name, never a path. */
const Branch = z.string().min(1).max(255);
/** A TCP port. */
export const TcpPort = z.number().int().min(1).max(65_535);

/**
 * The places a hand-off moves a chat between: `chat.ts`'s `ChatLocation`,
 * spelled here so the event modules import no request module.
 */
const HandOffLocation = z.enum(['this_folder', 'worktree'] as const satisfies readonly ChatLocation[]);

/** Why a chat worktree was put away: past the user's cap (retention), or a trial's copy not kept. */
export const PUT_AWAY_CAUSES = ['retention', 'not_kept'] as const;
export const PutAwayCause = z.enum(PUT_AWAY_CAUSES);
export type PutAwayCause = z.infer<typeof PutAwayCause>;

const onSettingsStream = { workspaceId: z.null(), streamId: z.literal(SETTINGS_STREAM) };

export const SessionLocationChangedInput = z.object({
  type: z.literal('session.location_changed'),
  ...onSessionStream,
  payload: z
    .object({
      sessionId: SessionId,
      /** Where the chat works from here on. */
      location: HandOffLocation,
      /** Where it worked before. */
      previous: HandOffLocation,
      /** The chat's branch in its new place: its own worktree's, or `null` in this folder. */
      branch: Branch.nullable(),
      /** How many files' uncommitted changes moved with it. */
      files: Count,
      /** Whether the agent restarts in the new folder on its own session (else it starts fresh with the history). */
      resumes: z.boolean(),
    })
    .strict(),
});
/**
 * The chat was handed off (user decision 2026-11-01; AD-8 CAP-33 note): its
 * worktree is set at creation and changed only by Hand off, recorded here in
 * the same transaction as the row, like `session.agent_changed`, so history
 * shows where each turn ran. No path.
 */
export const SessionLocationChangedEvent = SessionLocationChangedInput.extend(assigned);
export type SessionLocationChangedEvent = z.infer<typeof SessionLocationChangedEvent>;

export const SessionWorktreePutAwayInput = z.object({
  type: z.literal('session.worktree_put_away'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, snapshotId: WorktreeSnapshotId, cause: PutAwayCause, files: Count }).strict(),
});
/**
 * The chat's worktree was put away (AD-17 CAP-33 note's retention exception,
 * user decision 2026-11-01): its uncommitted changes snapshotted first (AD-37),
 * then its folder removed, its branch kept; never while an agent works or
 * waits in it. Restore brings it back. No path.
 */
export const SessionWorktreePutAwayEvent = SessionWorktreePutAwayInput.extend(assigned);
export type SessionWorktreePutAwayEvent = z.infer<typeof SessionWorktreePutAwayEvent>;

export const SessionWorktreeRestoredInput = z.object({
  type: z.literal('session.worktree_restored'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, snapshotId: WorktreeSnapshotId }).strict(),
});
/** A put-away chat worktree was brought back on its branch with its saved changes. */
export const SessionWorktreeRestoredEvent = SessionWorktreeRestoredInput.extend(assigned);
export type SessionWorktreeRestoredEvent = z.infer<typeof SessionWorktreeRestoredEvent>;

export const SessionPortAssignedInput = z.object({
  type: z.literal('session.port_assigned'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, port: TcpPort }).strict(),
});
/** A worktree chat's copy was given its own port (27.7). */
export const SessionPortAssignedEvent = SessionPortAssignedInput.extend(assigned);
export type SessionPortAssignedEvent = z.infer<typeof SessionPortAssignedEvent>;

export const SessionPortReleasedInput = z.object({
  type: z.literal('session.port_released'),
  ...onSessionStream,
  payload: z.object({ sessionId: SessionId, port: TcpPort }).strict(),
});
/** A worktree chat's port was given back (its copy put away, moved or removed). */
export const SessionPortReleasedEvent = SessionPortReleasedInput.extend(assigned);
export type SessionPortReleasedEvent = z.infer<typeof SessionPortReleasedEvent>;

/** The fewest and most chat worktrees the retention setting keeps. */
export const WORKTREE_RETENTION_MIN = 1;
export const WORKTREE_RETENTION_MAX = 100;
/** How many chat worktrees one setting keeps, across every project of the install. */
export const WorktreeRetentionKeep = z.number().int().min(WORKTREE_RETENTION_MIN).max(WORKTREE_RETENTION_MAX);

export const SettingsWorktreeRetentionChangedInput = z.object({
  type: z.literal('settings.worktree_retention_changed'),
  ...onSettingsStream,
  payload: z.object({ keep: WorktreeRetentionKeep, previous: WorktreeRetentionKeep }).strict(),
});
/** The install's chat worktree cap changed (Settings, Projects: Keep the last N worktrees). */
export const SettingsWorktreeRetentionChangedEvent = SettingsWorktreeRetentionChangedInput.extend(assigned);
export type SettingsWorktreeRetentionChangedEvent = z.infer<typeof SettingsWorktreeRetentionChangedEvent>;

/** The fewest and most agents one trial runs. */
export const TRIAL_AGENTS_MIN = 2;
export const TRIAL_AGENTS_MAX = 4;
/** A trial's chats, one per agent. */
export const TrialSessionIds = z.array(SessionId).min(TRIAL_AGENTS_MIN).max(TRIAL_AGENTS_MAX);

export const WorkspaceTrialStartedInput = z.object({
  type: z.literal('workspace.trial_started'),
  ...onWorkspaceStream,
  payload: z.object({ trialId: TrialId, sessionIds: TrialSessionIds }).strict(),
});
/** One task was started with several agents, each in its own worktree chat (27.8). No task text. */
export const WorkspaceTrialStartedEvent = WorkspaceTrialStartedInput.extend(assigned);
export type WorkspaceTrialStartedEvent = z.infer<typeof WorkspaceTrialStartedEvent>;

export const WorkspaceTrialKeptInput = z.object({
  type: z.literal('workspace.trial_kept'),
  ...onWorkspaceStream,
  payload: z
    .object({
      trialId: TrialId,
      sessionId: SessionId,
      /** The others whose copies were put away (`not_kept`, restorable). */
      putAway: z.array(SessionId).max(TRIAL_AGENTS_MAX - 1),
      /** The others deleted (Delete chat). */
      removed: z.array(SessionId).max(TRIAL_AGENTS_MAX - 1),
      /** The others that couldn't go safely and stay as they were. */
      left: z.array(SessionId).max(TRIAL_AGENTS_MAX - 1),
    })
    .strict(),
});
/** The user kept one trial chat; each other one was put away (`not_kept`, restorable), deleted, or left as it was. No task text. */
export const WorkspaceTrialKeptEvent = WorkspaceTrialKeptInput.extend(assigned);
export type WorkspaceTrialKeptEvent = z.infer<typeof WorkspaceTrialKeptEvent>;

export const WorkspaceChatDeletedInput = z.object({
  type: z.literal('workspace.chat_deleted'),
  ...onWorkspaceStream,
  payload: z
    .object({
      sessionId: SessionId,
      /** Whether the chat's own worktree is being removed with it (a plain chat, or a copy outside Ogden's folder, is `false`). */
      worktreeRemoved: z.boolean(),
      /** Whether its branch `ogden/chat/<ses>` is kept: it has commits not merged into the checked-out branch (or nothing was removed). */
      branchKept: z.boolean(),
    })
    .strict(),
});
/**
 * One chat was deleted (Delete chat, 27.3): its row and its stream's events
 * went in the same transaction as this event, on the workspace's stream (the
 * chat's own is gone). Clients drop that chat's events and list it no more.
 * No path.
 */
export const WorkspaceChatDeletedEvent = WorkspaceChatDeletedInput.extend(assigned);
export type WorkspaceChatDeletedEvent = z.infer<typeof WorkspaceChatDeletedEvent>;
