/**
 * The Workbench's events (AD-37, AD-38; epic v2 developer experience, entry
 * 2): a chat turn's recorded snapshots, a worktree chat's commit, and a
 * project command's start and finish. Each payload is strict and carries
 * ids, git object ids, states, exit codes and counts only: never a file's
 * content, a diff, command output or a path. `events.ts` re-exports the
 * events; the `*Input` schemas stay internal to the event modules.
 */
import { z } from 'zod';
import { assigned, onSessionStream, onWorkspaceStream } from './events-envelope.js';
import { ProjectCommandRunId, SessionId, TurnId } from './ids.js';
import { ProjectCommandId, ProjectCommandRunState } from './project-commands.js';
import { GitObjectId } from './workbench-changes.js';

/** A count of lines or files. */
const Count = z.number().int().nonnegative();

export const SessionTurnChangesRecordedInput = z.object({
  type: z.literal('session.turn_changes_recorded'),
  ...onSessionStream,
  payload: z
    .object({
      sessionId: SessionId,
      turnId: TurnId,
      /** The tree Ogden snapshotted at the turn's start, kept in the data directory (AD-37). */
      startTree: GitObjectId,
      /** The tree at its end. */
      endTree: GitObjectId,
      files: Count,
      additions: Count,
      deletions: Count,
    })
    .strict(),
});
/** A turn's start and end snapshots were recorded (AD-37): This turn diffs between them. No path, no diff. */
export const SessionTurnChangesRecordedEvent = SessionTurnChangesRecordedInput.extend(assigned);
export type SessionTurnChangesRecordedEvent = z.infer<typeof SessionTurnChangesRecordedEvent>;

export const SessionWorktreeCommittedInput = z.object({
  type: z.literal('session.worktree_committed'),
  ...onSessionStream,
  payload: z
    .object({
      sessionId: SessionId,
      /** The chat's own branch (`ogden/chat/<ses_…>`). */
      branch: z.string().min(1).max(255),
      revision: GitObjectId,
      files: Count,
    })
    .strict(),
});
/** The user committed a worktree chat's changes on its own branch (AD-17 CAP-33 note): local, never pushed. No path, no message. */
export const SessionWorktreeCommittedEvent = SessionWorktreeCommittedInput.extend(assigned);
export type SessionWorktreeCommittedEvent = z.infer<typeof SessionWorktreeCommittedEvent>;

export const WorkspaceProjectCommandStartedInput = z.object({
  type: z.literal('workspace.project_command_started'),
  ...onWorkspaceStream,
  payload: z.object({ runId: ProjectCommandRunId, commandId: ProjectCommandId }).strict(),
});
/** A project command started (AD-38). No command text, no output. */
export const WorkspaceProjectCommandStartedEvent = WorkspaceProjectCommandStartedInput.extend(assigned);
export type WorkspaceProjectCommandStartedEvent = z.infer<typeof WorkspaceProjectCommandStartedEvent>;

export const WorkspaceProjectCommandFinishedInput = z.object({
  type: z.literal('workspace.project_command_finished'),
  ...onWorkspaceStream,
  payload: z
    .object({
      runId: ProjectCommandRunId,
      commandId: ProjectCommandId,
      state: ProjectCommandRunState.exclude(['running']),
      exitCode: z.number().int().nullable(),
      itemCount: z.number().int().nonnegative(),
    })
    .strict(),
});
/** A project command finished (AD-38): its state, exit code and how many failures; the output is fetched. */
export const WorkspaceProjectCommandFinishedEvent = WorkspaceProjectCommandFinishedInput.extend(assigned);
export type WorkspaceProjectCommandFinishedEvent = z.infer<typeof WorkspaceProjectCommandFinishedEvent>;

export const WorkspaceProjectCommandsChangedInput = z.object({
  type: z.literal('workspace.project_commands_changed'),
  ...onWorkspaceStream,
  payload: z.object({ count: Count }).strict(),
});
/** The project's declared commands were saved (AD-38; 8.9): how many there are now. No command text, no script. */
export const WorkspaceProjectCommandsChangedEvent = WorkspaceProjectCommandsChangedInput.extend(assigned);
export type WorkspaceProjectCommandsChangedEvent = z.infer<typeof WorkspaceProjectCommandsChangedEvent>;
