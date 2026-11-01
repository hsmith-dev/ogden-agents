/**
 * Where work runs (CAP-35; epic 27 entry 2's contract, 27.3 to 27.8 build
 * on it): a chat's Location (this folder, its own worktree with its port,
 * or a remote machine), the hand-off between this folder and a worktree,
 * worktree retention (the install's cap, put-away copies) and Restore, and
 * one task tried by several agents. Routes are in `API_ROUTES`; the events
 * are in `events-where-work-runs.ts`. The words are EXPERIENCE.md's.
 *
 * Two user decisions of 2026-11-01 shape it: a chat's worktree is set at
 * creation and changed only by Hand off, recorded as `session.location_changed`
 * (AD-8 CAP-33 note); and beyond the user's cap the oldest idle chat worktree
 * is snapshotted and removed automatically, never mid-turn, and Restore
 * brings it back (AD-17 CAP-33 note's one exception).
 */
import { z } from 'zod';
import { ChatLocation } from './chat.js';
import { Session } from './entities.js';
import { AgentId } from './events-common.js';
import { PutAwayCause, TcpPort, TRIAL_AGENTS_MAX, TRIAL_AGENTS_MIN, TrialSessionIds, WorktreeRetentionKeep } from './events-where-work-runs.js';
import { RemoteMachineId, SessionId, TrialId, WorkspaceId, WorktreeSnapshotId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';

/** A chat worktree's branch, a name (never a path). */
const Branch = z.string().min(1).max(255);

/**
 * Where a chat works (`GET …/sessions/:sesId/location`): the project's own
 * folder; its own worktree (the branch, the copy's port when it has one,
 * and whether retention put the copy away); or a remote machine. No path.
 */
export const SessionLocation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('this_folder') }).strict(),
  z
    .object({
      kind: z.literal('worktree'),
      branch: Branch,
      /** The copy's own port (27.7), `null` when it has none. */
      port: TcpPort.nullable(),
      /** Retention put the copy away: the chat reads only, until Restore. */
      putAway: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('remote'), machineId: RemoteMachineId }).strict(),
]);
export type SessionLocation = z.infer<typeof SessionLocation>;

export const SessionLocationResponse = z.object({ location: SessionLocation });
export type SessionLocationResponse = z.infer<typeof SessionLocationResponse>;

/**
 * `POST …/sessions/:sesId/location` (27.4): moves an idle chat and its
 * uncommitted changes to `to`. 409 `agent_mid_turn` while it works or
 * waits, `handoff_conflict` when the other place has its own changes to the
 * same files, `invalid_operation` for a chat already there, a remote chat
 * or a build or planning session.
 */
export const HandOffRequest = z.object({ to: ChatLocation }).strict();
export type HandOffRequest = z.infer<typeof HandOffRequest>;

export const HandOffResponse = z.object({ session: Session });
export type HandOffResponse = z.infer<typeof HandOffResponse>;

/**
 * `DELETE …/sessions/:sesId` (Delete chat, 27.3) and `DELETE …/history`:
 * the body is optional. A chat's own worktree with uncommitted changes is
 * removed only with `discardUncommitted: true`, which the UI sends only
 * after a confirmation naming that; otherwise 409 `uncommitted_changes`.
 */
export const DeleteChatRequest = z.object({ discardUncommitted: z.boolean().default(false) }).strict();
export type DeleteChatRequest = z.infer<typeof DeleteChatRequest>;

/** What Delete chat did: whether the chat's copy is removed, and whether its branch is kept (it has commits of its own). No path. */
export const ChatDeletedResponse = z.object({ sessionId: SessionId, worktreeRemoved: z.boolean(), branchKept: z.boolean() }).strict();
export type ChatDeletedResponse = z.infer<typeof ChatDeletedResponse>;

/** How many chat worktrees the install keeps before it puts the oldest idle one away (EXPERIENCE.md's assumption, as Codex). */
export const WORKTREE_RETENTION_DEFAULT = 15;

/** `GET|PUT /api/v1/settings/worktree-retention` (27.6): one cap for the install, over every project's chat worktrees. */
export const WorktreeRetentionSetting = z.object({ keep: WorktreeRetentionKeep }).strict();
export type WorktreeRetentionSetting = z.infer<typeof WorktreeRetentionSetting>;

/** One put-away chat worktree: its chat, its branch, how many files its saved changes hold, why and when. No path. */
export const PutAwayWorktree = z
  .object({
    id: WorktreeSnapshotId,
    sessionId: SessionId,
    workspaceId: WorkspaceId,
    branch: Branch,
    files: z.number().int().nonnegative(),
    cause: PutAwayCause,
    putAwayAt: IsoUtcTimestamp,
  })
  .strict();
export type PutAwayWorktree = z.infer<typeof PutAwayWorktree>;

/** `GET …/worktrees/put-away`: the project's put-away copies, newest first (Workspace settings lists them with Restore each). */
export const PutAwayWorktreesResponse = z.object({ worktrees: z.array(PutAwayWorktree) });
export type PutAwayWorktreesResponse = z.infer<typeof PutAwayWorktreesResponse>;

/** The ports a worktree's copy is given from, when the project sets none of its own (27.7). Probed free first. */
export const WORKTREE_PORT_RANGE = { first: 41_000, last: 41_999 } as const;

/** The longest task one trial takes. */
export const TRIAL_TEXT_MAX = 20_000;

/** `POST …/trials` (27.8): the task and 2 to 4 different agents, one worktree chat each. */
export const CreateTrialRequest = z
  .object({
    text: z.string().trim().min(1).max(TRIAL_TEXT_MAX),
    agentIds: z
      .array(AgentId)
      .min(TRIAL_AGENTS_MIN)
      .max(TRIAL_AGENTS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'Pick each agent once.'),
  })
  .strict();
export type CreateTrialRequest = z.infer<typeof CreateTrialRequest>;

/** One trial: its chats, one per agent, and the one kept (`null` until Keep this one). */
export const Trial = z
  .object({
    id: TrialId,
    workspaceId: WorkspaceId,
    sessionIds: TrialSessionIds,
    keptSessionId: SessionId.nullable(),
    createdAt: IsoUtcTimestamp,
  })
  .strict();
export type Trial = z.infer<typeof Trial>;

export const TrialResponse = z.object({ trial: Trial });
export type TrialResponse = z.infer<typeof TrialResponse>;

/** `POST …/trials/:tryId/keep`: keeps one of the trial's chats; the others' copies are put away (`not_kept`). */
export const KeepTrialRequest = z.object({ sessionId: SessionId }).strict();
export type KeepTrialRequest = z.infer<typeof KeepTrialRequest>;

// The words (EXPERIENCE.md, CAP-35). No em or en dashes.

/** The hand-off's menu item in a worktree chat, and its line. */
export const HANDOFF_TO_THIS_FOLDER_LABEL = 'Move to this folder';
export const HANDOFF_TO_THIS_FOLDER_DESCRIPTION = 'Brings this chat and its changes into the project folder.';
/** The hand-off's menu item in a this-folder chat, and its line. */
export const HANDOFF_TO_WORKTREE_LABEL = 'Move to its own worktree';
export const HANDOFF_TO_WORKTREE_DESCRIPTION = 'Takes this chat and its changes to a separate copy on its own branch.';
/** The hand-off's confirmation title (its sentence is the item's line). */
export const HANDOFF_CONFIRM_TITLE = 'Move this chat?';
/** The hand-off's confirm button. */
export const HANDOFF_CONFIRM_LABEL = 'Move';
/** A hand-off that couldn't finish (409 `invalid_operation`): nothing moved. */
export const HANDOFF_FAILED_TEXT = "This chat couldn't move. Its changes are where they were.";
/** The transcript's divider after a hand-off. */
export const handOffDividerText = (location: ChatLocation, branch: string | null): string =>
  location === 'this_folder' ? 'Moved to this folder' : branch === null ? 'Moved to its own worktree' : `Moved to its own worktree: ${branch}`;
/** A hand-off into this folder refused because it has its own changes to the same files (409 `handoff_conflict`). */
export const handOffConflictText = (files: number): string =>
  `This folder has its own changes to ${files} of the same files. Commit or set them aside first, then move.`;
/** The 409 `handoff_conflict` message (the server counts no files in it). */
export const HANDOFF_CONFLICT_MESSAGE = 'This folder has its own changes to some of the same files. Commit or set them aside first, then move.';
/** A hand-off to its own worktree refused because the chat's kept branch changed the same files (409 `handoff_conflict`). */
export const handOffWorktreeConflictText = (files: number): string =>
  `This chat's branch changed ${files} of the same files since, so its changes can't go there. Commit or set them aside first, then move.`;
/** A hand-off asked for while the agent works or waits. */
export const handOffMidTurnText = (agentName: string): string => `Move once ${agentName} has finished.`;
/** A hand-off refused (409 `agent_mid_turn`) because another chat working in the project folder holds it. */
export const HANDOFF_FOLDER_BUSY_TEXT = 'Move once the agents working in this folder have finished.';

/** A chat whose copy retention put away. */
export const WORKTREE_PUT_AWAY_TEXT = "This chat's copy was put away to save space.";
export const WORKTREE_RESTORE_LABEL = 'Restore';
export const WORKTREE_RESTORED_TEXT = 'Restored.';
export const WORKTREE_RESTORE_RETRY_LABEL = 'Try again';
/** Restore couldn't finish: the branch is gone. */
export const restoreBranchMissingText = (branch: string): string => `Restore couldn't finish: the branch ${branch} no longer exists. The saved changes are kept.`;
/** Restore couldn't finish: something else is where the copy goes. */
export const RESTORE_PATH_TAKEN_TEXT = "Restore couldn't finish: something else is where this chat's copy goes. The saved changes are kept.";
/** The 409 `restore_failed` message when the reason has no words of its own. */
export const RESTORE_FAILED_MESSAGE = "Restore couldn't finish. The saved changes are kept.";
/** The retention setting's label. */
export const worktreeRetentionLabel = (keep: number): string => `Keep the last ${keep} ${keep === 1 ? 'worktree' : 'worktrees'}`;

/** The branch badge's tooltip (27.3): the branch is Ogden's and stays local. */
export const WORKTREE_BADGE_TOOLTIP_TEXT = 'Never pushed. Merge it yourself when ready.';
/** The branch badge's accessible name: it opens the Workbench rooted at the chat's copy. */
export const worktreeBadgeLabel = (branch: string): string => `Branch ${branch}. Open this chat's copy in the Workbench`;

/** Delete chat (27.3): the header menu's item, its confirmation and its refusals. */
export const DELETE_CHAT_LABEL = 'Delete chat';
export const DELETE_CHAT_CONFIRM_TITLE = 'Delete chat?';
/** The confirmation's one sentence: a plain chat, or a worktree chat (its copy goes with its uncommitted changes, so confirming sends `discardUncommitted`; its branch stays when it has commits). */
export const deleteChatConfirmText = (branch: string | null): string =>
  branch === null
    ? "Deletes this chat and its history. This can't be undone."
    : `Deletes this chat, its history and its copy of the project with any changes not committed, keeping the branch ${branch} if it has commits.`;
/** The fallback once the server said the copy has uncommitted changes (409 `uncommitted_changes`: a copy made since the dialog opened). */
export const DELETE_CHAT_UNCOMMITTED_TEXT = "This chat's copy has changes that aren't committed. Deleting it discards them.";
/** The confirm button once those changes are named. */
export const DELETE_AND_DISCARD_LABEL = 'Delete and discard changes';
/** The 409 `uncommitted_changes` message for Delete chat. */
export const UNCOMMITTED_CHANGES_MESSAGE = "This chat's copy has changes that aren't committed, so nothing was deleted.";
/** The 409 `uncommitted_changes` message for Delete history. */
export const HISTORY_UNCOMMITTED_CHANGES_MESSAGE = "A chat's copy in this project has changes that aren't committed, so nothing was deleted.";
/** The 409 `agent_mid_turn` message for Delete chat. */
export const DELETE_CHAT_MID_TURN_MESSAGE = 'This chat can be deleted once its agent has finished.';
/** The menu's reason while the agent works or waits, or the terminal drives. */
export const deleteChatBusyText = (agentName: string): string => `Delete this chat once ${agentName} has finished.`;
/** The menu's reason while the terminal drives the chat. */
export const DELETE_CHAT_TERMINAL_TEXT = 'Switch back to the chat first: the terminal is driving it.';
/** The 409 `invalid_operation` message: a build or planning session, or a chat an orchestration run names. */
export const DELETE_CHAT_NOT_DELETABLE_TEXT = 'Only a chat you started can be deleted on its own. Delete history removes the rest.';
/** The 409 `invalid_operation` message and the menu's reason for a chat on a remote machine. */
export const DELETE_CHAT_REMOTE_TEXT = "A chat on a remote machine can't be deleted on its own yet. Delete history removes it.";
/** Delete history's confirmation, with the copies sentence when any chat has its own worktree. */
export const deleteHistoryConfirmText = (name: string, worktrees: boolean): string =>
  worktrees
    ? `Deletes every chat in ${name} and their copies of the project with any changes not committed, keeping branches that have commits. This can't be undone.`
    : `Deletes every chat in ${name}. This can't be undone.`;
/** Delete history's confirmation once the server said a copy has uncommitted changes. */
export const DELETE_HISTORY_UNCOMMITTED_TEXT = "A chat's copy has changes that aren't committed. Deleting the history discards them.";

/** The branch badge's tooltip line when the copy has its own port. */
export const worktreePortText = (port: number): string => `Runs on port ${port} in this copy`;

/** Try with several agents. */
export const TRIAL_MENU_LABEL = 'Try with several agents...';
export const TRIAL_LINE_TEXT = "Each agent works in its own copy, so none sees the others' changes.";
export const TRIAL_START_LABEL = 'Start';
export const TRIAL_KEEP_LABEL = 'Keep this one';
export const trialKeepConfirmText = (agentName: string): string => `Keep ${agentName}'s result? The other copies are put away; you can restore them.`;
export const TRIAL_NOT_KEPT_TEXT = 'Not kept';
export const TRIAL_WAITING_TEXT = 'Waits for a free slot';
/** A trial chat's tooltip line in the sidebar. */
export const trialTooltipText = (task: string, index: number, count: number): string => `Try: ${task}, ${index} of ${count}`;
