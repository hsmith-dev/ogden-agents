/**
 * The Workbench's Changes (AD-37, CAP-33, CAP-34; epic v2 developer
 * experience, entry 2's contract for 8.3 to 8.7 and epic 27's worktree
 * chats): the four change views, one file's diff, hunk actions, a chat's
 * recorded turns and a worktree chat's commit. A diff, a file's content and
 * a path are only ever in a `GET` response (`Cache-Control: no-store`):
 * the two events here carry ids, counts and git object ids only, and are
 * strict, so nothing else can ride along (`events-workbench.ts`).
 */
import { z } from 'zod';
import { SessionId, TurnId } from './ids.js';
import { IsoUtcTimestamp } from './time.js';
import { WorkspaceRelativePath } from './workspace-files.js';

/** **This turn** (Ogden's snapshots at a turn's start and end), **Unstaged**, **Staged**, **Branch** (against its base). */
export const ChangesView = z.enum(['turn', 'unstaged', 'staged', 'branch']);
export type ChangesView = z.infer<typeof ChangesView>;

/** Each view's name in the view switch. */
export const CHANGES_VIEW_LABELS: Readonly<Record<ChangesView, string>> = { turn: 'This turn', unstaged: 'Unstaged', staged: 'Staged', branch: 'Branch' };

/** What happened to a file. */
export const FileChange = z.enum(['added', 'changed', 'deleted', 'renamed']);
export type FileChange = z.infer<typeof FileChange>;

/** The word shown for each change. */
export const FILE_CHANGE_WORDS: Readonly<Record<FileChange, string>> = { added: 'Added', changed: 'Changed', deleted: 'Deleted', renamed: 'Renamed' };

/** A file's diff over this many bytes is `tooLarge`: counts only, no hunks. */
export const MAX_DIFF_FILE_BYTES = 1024 * 1024;
/** The most changed files a view lists; the rest are left out and the answer says `truncated`. */
export const MAX_CHANGED_FILES = 1000;
/** How many files the diff viewer opens; the rest are listed collapsed. */
export const DIFF_FILES_OPEN = 20;

/** A git object id (a tree or a commit): 40 or 64 lower-case hex digits. */
export const GitObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, 'A git object id.');
export type GitObjectId = z.infer<typeof GitObjectId>;

/** A hunk's id as the port gives it: opaque, short, URL-safe. */
export const HunkId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'A hunk id.');
export type HunkId = z.infer<typeof HunkId>;

/** A count of lines or files. */
const Count = z.number().int().nonnegative();

/** One changed file in a view. */
export const ChangedFile = z.object({
  path: WorkspaceRelativePath,
  /** A renamed file's old path. */
  previousPath: WorkspaceRelativePath.optional(),
  change: FileChange,
  additions: Count,
  deletions: Count,
  /** A binary file: no hunks, "Binary file changed". */
  binary: z.boolean(),
  /** A diff over {@link MAX_DIFF_FILE_BYTES}: counts only, no hunks. */
  tooLarge: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

/** One line of a hunk: unchanged context, added or removed, with its line numbers on each side. */
export const DiffLine = z.object({
  kind: z.enum(['context', 'add', 'remove']),
  text: z.string(),
  oldLine: z.number().int().positive().optional(),
  newLine: z.number().int().positive().optional(),
});
export type DiffLine = z.infer<typeof DiffLine>;

/** One hunk: its ranges on each side (as a unified diff's `@@` line) and its lines. */
export const DiffHunk = z.object({
  id: HunkId,
  oldStart: Count,
  oldLines: Count,
  newStart: Count,
  newLines: Count,
  lines: z.array(DiffLine),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

/** `GET …/changes?view=&session=&turn=`, as the server reads it. `turn` needs `view: turn`; `view: turn` needs a `session`. */
export const ChangesQuery = z
  .object({ view: ChangesView, session: SessionId.optional(), turn: TurnId.optional() })
  .strict()
  .refine((query) => query.turn === undefined || query.view === 'turn', { message: 'A turn is only for This turn.', path: ['turn'] })
  .refine((query) => query.view !== 'turn' || query.session !== undefined, { message: 'This turn needs a chat.', path: ['session'] });
export type ChangesQuery = z.infer<typeof ChangesQuery>;

/** `GET …/changes` → this: the view's changed files. */
export const ChangesResponse = z.object({
  view: ChangesView,
  /** The branch Branch compares with (`main`), when the view is Branch. */
  base: z.string().min(1).max(255).optional(),
  /** The turn This turn shows, when there is one. */
  turn: TurnId.optional(),
  files: z.array(ChangedFile),
  /** Over {@link MAX_CHANGED_FILES}: some files are not listed. */
  truncated: z.boolean(),
});
export type ChangesResponse = z.infer<typeof ChangesResponse>;

/** `GET …/changes/file?view=&path=&session=&turn=`. */
export const FileDiffQuery = z
  .object({ view: ChangesView, path: WorkspaceRelativePath, session: SessionId.optional(), turn: TurnId.optional() })
  .strict()
  .refine((query) => query.turn === undefined || query.view === 'turn', { message: 'A turn is only for This turn.', path: ['turn'] })
  .refine((query) => query.view !== 'turn' || query.session !== undefined, { message: 'This turn needs a chat.', path: ['session'] });
export type FileDiffQuery = z.infer<typeof FileDiffQuery>;

/** `GET …/changes/file` → this: one file's hunks (none when it is binary or too large). */
export const FileDiffResponse = z.object({
  view: ChangesView,
  file: ChangedFile,
  hunks: z.array(DiffHunk),
});
export type FileDiffResponse = z.infer<typeof FileDiffResponse>;

/** Stage (Unstaged), unstage (Staged), revert (This turn and Unstaged). */
export const HunkAction = z.enum(['stage', 'unstage', 'revert']);
export type HunkAction = z.infer<typeof HunkAction>;

/** The actions each view offers (Branch none: the build's branch is not edited from here). */
export const HUNK_ACTIONS_BY_VIEW: Readonly<Record<ChangesView, readonly HunkAction[]>> = { turn: ['revert'], unstaged: ['stage', 'revert'], staged: ['unstage'], branch: [] };

/**
 * `POST …/changes/hunks`: one hunk's action, or the whole file's when
 * `hunkId` is absent. Refused (409 `agent_mid_turn`) while an agent works
 * in the same folder, and (409 `hunk_outdated`) when the hunk changed since.
 */
export const HunkActionRequest = z
  .object({
    action: HunkAction,
    view: ChangesView,
    path: WorkspaceRelativePath,
    hunkId: HunkId.optional(),
    session: SessionId.optional(),
    turn: TurnId.optional(),
  })
  .strict()
  .refine((request) => HUNK_ACTIONS_BY_VIEW[request.view].includes(request.action), { message: "That view doesn't offer that action.", path: ['action'] })
  .refine((request) => request.turn === undefined || request.view === 'turn', { message: 'A turn is only for This turn.', path: ['turn'] })
  .refine((request) => request.view !== 'turn' || request.session !== undefined, { message: 'This turn needs a chat.', path: ['session'] });
export type HunkActionRequest = z.infer<typeof HunkActionRequest>;

/** `POST …/changes/hunks` → this: the file as the view has it now (`null` when it has no changes left there). */
export const HunkActionResponse = z.object({ file: ChangedFile.nullable() });
export type HunkActionResponse = z.infer<typeof HunkActionResponse>;

/** One recorded turn of a chat, for the turn picker. */
export const TurnSummary = z.object({
  id: TurnId,
  sessionId: SessionId,
  /** When the turn's end was recorded. */
  at: IsoUtcTimestamp,
  files: Count,
  additions: Count,
  deletions: Count,
});
export type TurnSummary = z.infer<typeof TurnSummary>;

/** `GET …/sessions/:sesId/turns` → this: the chat's recorded turns, newest first. */
export const TurnsResponse = z.object({ turns: z.array(TurnSummary) });
export type TurnsResponse = z.infer<typeof TurnsResponse>;

/** The longest commit message. */
export const MAX_COMMIT_MESSAGE_CHARS = 2000;

/** `POST …/sessions/:sesId/worktree/commit`: commit everything in the chat's worktree, on its own branch, never pushed. */
export const CommitWorktreeRequest = z.object({ message: z.string().trim().min(1).max(MAX_COMMIT_MESSAGE_CHARS) }).strict();
export type CommitWorktreeRequest = z.infer<typeof CommitWorktreeRequest>;

/** The commit made and how many files it holds. */
export const CommitWorktreeResponse = z.object({ revision: GitObjectId, files: Count });
export type CommitWorktreeResponse = z.infer<typeof CommitWorktreeResponse>;

/** Where every chat worktree's branch lives (AD-17 CAP-33 note). */
export const CHAT_WORKTREE_BRANCH_PREFIX = 'ogden/chat/';
/** The branch of the chat `id`'s worktree: `ogden/chat/<ses_…>`. */
export const chatWorktreeBranch = (id: SessionId): string => `${CHAT_WORKTREE_BRANCH_PREFIX}${id}`;

/** Hunk actions and Commit while an agent works in the same folder (disabled). */
export const agentMidTurnText = (agentName: string): string => `${agentName} is working in this folder. Wait for it to finish, or stop it.`;
/** An agent started between the click and the action: nothing changed. */
export const agentStartedHereText = (agentName: string): string => `${agentName} started working here, so nothing was changed.`;
/** The 409 `agent_mid_turn` message (the server names no agent). */
export const AGENT_MID_TURN_MESSAGE = 'An agent is working in this folder, so nothing was changed. Wait for it to finish, or stop it.';
/** A This turn hunk edited again since the turn (409 `hunk_outdated`). */
export const HUNK_OUTDATED_TEXT = "Changed again since this turn, so it can't be reverted here.";
/** A diff over {@link MAX_DIFF_FILE_BYTES}. */
export const DIFF_TOO_LARGE_TEXT = 'This change is too large to show here.';
/** A binary file in a diff. */
export const DIFF_BINARY_TEXT = 'Binary file changed';
/** Revert's one confirmation. */
export const REVERT_CONFIRM_TEXT = "Revert this change? These lines go back to how they were. Ogden can't undo this.";
/** The worktree chat's commit button and its line. */
export const COMMIT_WORKTREE_LABEL = 'Commit these changes';
export const WORKTREE_NEVER_PUSHED_TEXT = 'Never pushed. Merge it yourself when ready.';
/** Commit asked of a chat without a worktree of its own (409 `invalid_operation`). */
export const COMMIT_NEEDS_WORKTREE_MESSAGE = 'Only a chat that works in its own copy can commit here.';
/** Side by side below `lg`. */
export const SIDE_BY_SIDE_NARROW_TEXT = 'Side by side needs a wider window.';
/** Each view with no changes (Branch names its base). */
export function changesEmptyText(view: ChangesView, base = 'main'): string {
  if (view === 'turn') return 'No changes in this turn.';
  if (view === 'unstaged') return 'No unstaged changes.';
  if (view === 'staged') return 'Nothing staged.';
  return `This branch matches ${base}.`;
}
