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

/** The most hunk ids a whole-file action names. */
export const MAX_HUNK_IDS = 1000;

/**
 * `POST …/changes/hunks`: one hunk's action (`hunkId`), or the whole
 * file's (`hunkIds`: every hunk id shown, so a file that changed since is
 * refused rather than applied as it is now). Refused (409
 * `agent_mid_turn`) while an agent works in the same folder, and (409
 * `hunk_outdated`) when the hunk, or the file's hunks, changed since. The
 * patch is the server's own diff: the client never sends one.
 */
export const HunkActionRequest = z
  .object({
    action: HunkAction,
    view: ChangesView,
    path: WorkspaceRelativePath,
    hunkId: HunkId.optional(),
    hunkIds: z.array(HunkId).min(1).max(MAX_HUNK_IDS).optional(),
    session: SessionId.optional(),
    turn: TurnId.optional(),
  })
  .strict()
  .refine((request) => HUNK_ACTIONS_BY_VIEW[request.view].includes(request.action), { message: "That view doesn't offer that action.", path: ['action'] })
  .refine((request) => request.turn === undefined || request.view === 'turn', { message: 'A turn is only for This turn.', path: ['turn'] })
  .refine((request) => request.view !== 'turn' || request.session !== undefined, { message: 'This turn needs a chat.', path: ['session'] })
  .refine((request) => (request.hunkId === undefined) !== (request.hunkIds === undefined), { message: 'Name one hunk, or every hunk of the file.', path: ['hunkIds'] });
export type HunkActionRequest = z.infer<typeof HunkActionRequest>;

/** A revert's undo: 32 lower-case hex digits, kept by the server for a short while (8.5). */
export const UndoId = z.string().regex(/^[0-9a-f]{32}$/, 'An undo id.');
export type UndoId = z.infer<typeof UndoId>;

/** How long a revert can be undone, and how many reverts are kept for it (in the server's memory only). */
export const UNDO_KEPT_MS = 30 * 60 * 1000;
export const MAX_UNDOS_KEPT = 50;

/** `POST …/changes/hunks` → this: the file as the view has it now (`null` when it has no changes left there), and a revert's undo. */
export const HunkActionResponse = z.object({ file: ChangedFile.nullable(), undo: UndoId.optional() });
export type HunkActionResponse = z.infer<typeof HunkActionResponse>;

/**
 * `POST …/changes/hunks/undo`: put back what the revert `undo` took, in the
 * same folder (`session`'s) and `path`, answered as `view` has the file
 * (This turn: the latest turn). 404 for an undo that is gone, used, or of
 * another folder or path; 409 `hunk_outdated` when the file was edited
 * since; 409 `agent_mid_turn`.
 */
export const UndoHunkRequest = z
  .object({ undo: UndoId, path: WorkspaceRelativePath, view: ChangesView, session: SessionId.optional() })
  .strict()
  .refine((request) => HUNK_ACTIONS_BY_VIEW[request.view].includes('revert'), { message: "That view doesn't offer revert.", path: ['view'] })
  .refine((request) => request.view !== 'turn' || request.session !== undefined, { message: 'This turn needs a chat.', path: ['session'] });
export type UndoHunkRequest = z.infer<typeof UndoHunkRequest>;

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
/**
 * The branch a Restore makes when the chat's branch moved (not only forward, or
 * its saved changes don't apply on the new commit) or is gone (user decision
 * 2026-11-01): `ogden/chat/<ses_…>-restored`, then `-restored-2`, `-restored-3`
 * when taken. It becomes the chat's branch (`session.location_changed`).
 */
export const restoredChatWorktreeBranch = (id: SessionId): string => `${chatWorktreeBranch(id)}-restored`;
/** `-restored`, `-restored-2`, … as Restore names them (never `-restored-1`, never a leading zero). */
const RESTORED_SUFFIX = /-restored(?:-(?:[2-9]|[1-9]\d{1,3}))?$/;
/** The chat id a chat worktree branch names (`ogden/chat/<ses_…>` or one of its Restore branches), or `undefined` for any other branch. */
export const chatOfWorktreeBranch = (branch: string): SessionId | undefined => {
  if (!branch.startsWith(CHAT_WORKTREE_BRANCH_PREFIX)) return undefined;
  const parsed = SessionId.safeParse(branch.slice(CHAT_WORKTREE_BRANCH_PREFIX.length).replace(RESTORED_SUFFIX, ''));
  return parsed.success ? parsed.data : undefined;
};
/** Whether `branch` is chat `id`'s own: `ogden/chat/<id>` or one of its Restore branches. */
export const isChatWorktreeBranchOf = (id: SessionId, branch: string): boolean => chatOfWorktreeBranch(branch) === id;

/** Hunk actions and Commit while an agent works in the same folder (disabled). */
export const agentMidTurnText = (agentName: string): string => `${agentName} is working in this folder. Wait for it to finish, or stop it.`;
/** An agent started between the click and the action: nothing changed. */
export const agentStartedHereText = (agentName: string): string => `${agentName} started working here, so nothing was changed.`;
/** The 409 `agent_mid_turn` message (the server names no agent). */
export const AGENT_MID_TURN_MESSAGE = 'An agent is working in this folder, so nothing was changed. Wait for it to finish, or stop it.';
/** A This turn hunk edited again since the turn (409 `hunk_outdated`). */
export const HUNK_OUTDATED_TEXT = "Changed again since this turn, so it can't be reverted here.";
/** An Unstaged or Staged hunk (or file) that changed since it was shown (409 `hunk_outdated`); the diffs are read again. */
export const HUNK_CHANGED_SINCE_TEXT = 'This change was edited since it was shown, so nothing was changed. Here it is as it is now.';
/** An Undo whose file was edited since the revert (409 `hunk_outdated`). */
export const UNDO_OUTDATED_TEXT = 'This file was edited since the revert, so nothing was put back.';
/** An Undo that is gone: used, too old, or lost when Ogden restarted (404). */
export const UNDO_GONE_TEXT = "Ogden can't undo that revert any more.";
/** Every `hunk_outdated` message the server sends. */
export const HUNK_OUTDATED_MESSAGES: readonly string[] = [HUNK_OUTDATED_TEXT, HUNK_CHANGED_SINCE_TEXT, UNDO_OUTDATED_TEXT];
/** A hunk action on a binary, too large, link or submodule file, or one under a linked folder (409 `invalid_operation`). */
export const HUNK_UNSUPPORTED_MESSAGE = 'Ogden can only stage or revert lines of a plain text file.';
/** A hunk action or Undo that failed otherwise. */
export const HUNK_ACTION_FAILED = "Ogden Agents couldn't change that.";
/** Each action's button. */
export const HUNK_ACTION_LABELS: Readonly<Record<HunkAction, string>> = { stage: 'Stage', unstage: 'Unstage', revert: 'Revert' };
/** The first letter of a hunk's range in lower case, inside a sentence ("lines 40 to 46"). */
const inSentence = (range: string): string => `${range.charAt(0).toLowerCase()}${range.slice(1)}`;
/** A hunk's button's accessible name: "Stage lines 40 to 46" (`range` as the hunk's header has it, "Lines 40 to 46"). */
export const hunkActionName = (action: HunkAction, range: string): string => `${HUNK_ACTION_LABELS[action]} ${inSentence(range)}`;
/** A file's button's accessible name: "Revert all of cart.css". */
export const fileActionName = (action: HunkAction, name: string): string => `${HUNK_ACTION_LABELS[action]} all of ${name}`;
/** After a revert, with its Undo: "Reverted lines 40 to 46 in cart.css." (a whole file: "Reverted all of cart.css."). */
export const revertedText = (name: string, range?: string): string => (range === undefined ? `Reverted all of ${name}.` : `Reverted ${inSentence(range)} in ${name}.`);
/** In place of a This turn hunk's Revert once it was reverted while the panel is open (the snapshots still show it). */
export const HUNK_REVERTED_LABEL = 'Reverted';
/** After an Undo. */
export const PUT_BACK_TEXT = 'Put back.';
export const UNDO_LABEL = 'Undo';
/** A diff over {@link MAX_DIFF_FILE_BYTES}. */
export const DIFF_TOO_LARGE_TEXT = 'This change is too large to show here.';
/** A binary file in a diff. */
export const DIFF_BINARY_TEXT = 'Binary file changed';
/** Revert's one confirmation: its title, its consequence, and both as one line (8.5: undoable right after, while Changes is open). */
export const REVERT_CONFIRM_TITLE = 'Revert this change?';
export const REVERT_CONFIRM_DESCRIPTION = 'These lines go back to how they were. You can undo it right after, while Changes is open.';
export const REVERT_CONFIRM_TEXT = `${REVERT_CONFIRM_TITLE} ${REVERT_CONFIRM_DESCRIPTION}`;
/** The worktree chat's commit button and its line. */
export const COMMIT_WORKTREE_LABEL = 'Commit these changes';
export const WORKTREE_NEVER_PUSHED_TEXT = 'Never pushed. Merge it yourself when ready.';
/** Commit asked of a chat without a worktree of its own (409 `invalid_operation`). */
export const COMMIT_NEEDS_WORKTREE_MESSAGE = 'Only a chat that works in its own copy can commit here.';
/** Commit asked with nothing changed in the worktree (409 `invalid_operation`). */
export const COMMIT_NOTHING_MESSAGE = 'There are no changes to commit.';
/** The project's `.git` file points at no standard linked worktree or submodule, so the views and Commit refuse (409 `invalid_operation`; user decision 2026-11-01, AD-37). */
export const GIT_POINTER_UNUSUAL_MESSAGE = "Ogden can't read this project's git: its .git file points somewhere unusual.";
/** A hunk action or Undo on a port without them (501 `not_implemented`). */
export const HUNK_ACTIONS_NOT_AVAILABLE_MESSAGE = "Ogden Agents can't stage, unstage or revert a change yet.";
/** The Workbench's Changes panel (story 8.4). */
export const WORKBENCH_CHANGES_LABEL = 'Changes';
/** The view switch's accessible name. */
export const CHANGES_VIEW_SWITCH_LABEL = 'Changes view';
/** The turn picker's label. */
export const CHANGES_TURN_PICKER_LABEL = 'Turn';
/** The latest turn in the turn picker. */
export const CHANGES_LATEST_TURN_LABEL = 'Latest turn';
/** This turn for a chat that has recorded no turn yet. */
export const CHANGES_NO_TURNS_TEXT = 'No turns recorded yet. Ogden records a turn once the agent finishes one in a project that uses git.';
/** The screen-reader lines while a view's files, then their diffs, load. */
export const CHANGES_LOADING_TEXT = 'Loading the changes';
export const CHANGES_DIFFS_LOADING_TEXT = 'Loading the diffs';
/** A view or a file's diff that couldn't be read. */
export const CHANGES_READ_FAILED = "Ogden Agents couldn't read the changes.";
export const CHANGES_TURNS_READ_FAILED = "Ogden Agents couldn't read this chat's turns.";
export const COMMIT_FAILED = "Ogden Agents couldn't commit the changes.";
/** Under a view listing more files than the viewer opens (it fetches the first {@link CHANGES_DIFFS_FETCHED}). */
export const CHANGES_DIFFS_FETCHED = 100;
export const changesMoreFilesText = (shown: number): string => `Only the first ${shown} files are shown here.`;
/** The commit message field and the commit's result. */
export const COMMIT_MESSAGE_LABEL = 'Commit message';
export const committedText = (files: number): string => `Committed ${files} ${files === 1 ? 'file' : 'files'} on this chat's branch.`;
/** The end of a turn that changed files (the chat's Changed row) and its link. */
export const turnChangedText = (files: number, additions: number, deletions: number): string => `Changed ${files} ${files === 1 ? 'file' : 'files'} +${additions} -${deletions}`;
export const REVIEW_CHANGES_LABEL = 'Review changes';
/** A turn in the picker: its time and counts. */
export const turnPickerText = (time: string, files: number): string => `${time}, ${files} ${files === 1 ? 'file' : 'files'}`;
/** Side by side below `lg`. */
export const SIDE_BY_SIDE_NARROW_TEXT = 'Side by side needs a wider window.';
/** Each view with no changes (Branch names its base). */
export function changesEmptyText(view: ChangesView, base = 'main'): string {
  if (view === 'turn') return 'No changes in this turn.';
  if (view === 'unstaged') return 'No unstaged changes.';
  if (view === 'staged') return 'Nothing staged.';
  return `This branch matches ${base}.`;
}
