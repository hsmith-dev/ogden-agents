/**
 * The Workbench's Changes use-case (AD-37, CAP-33, CAP-34; epic 8 entry 2's
 * contract, 8.3 to 8.7 and epic 27 build on it): the four views of a
 * folder's changes, one file's diff, stage, unstage and revert of a hunk or
 * a file, a chat's recorded turns, and a worktree chat's commit, all
 * through {@link VcsWorkingTreePort}. Core runs no git itself (AD-1).
 *
 * The folder is the project, or the chat's worktree when the request names
 * a chat that has one (`resolveWorkspaceRoot`). A hunk action and a commit
 * are refused ({@link AgentMidTurnError}) while any chat working in the
 * same folder is `working` or `waiting`, before the port is asked
 * anything. A commit is refused ({@link InvalidOperationError}) for a chat
 * without a worktree, and appends `session.worktree_committed` with counts
 * only. This turn reads the chat's `session.turn_changes_recorded` events.
 * No diff, path or file content is ever appended or logged here.
 *
 * Story 8.4: a chat's worktree is given to the port with its repo and
 * branch (`vcsFolderOf`), so git runs there only after the worktree check;
 * only paths `WorkspaceRelativePath` accepts and `isRefusedWorkspacePath`
 * allows are answered; the commit runs under `serializedByRepo(<project
 * folder>)`, with the snapshots, and nothing to commit is
 * {@link InvalidOperationError}.
 *
 * Story 8.5: a hunk action and a revert's undo run under the same
 * `serializedByRepo(<project folder>)`, with the mid-turn check inside it,
 * so no snapshot or commit of the repo runs between the check and the
 * write. The port's outcomes become errors: `outdated` is
 * {@link HunkOutdatedError} with the view's own sentence, `unsupported`
 * {@link InvalidOperationError}. Both are 501 while the port lacks them.
 */
import {
  AGENT_MID_TURN_MESSAGE,
  COMMIT_NEEDS_WORKTREE_MESSAGE,
  COMMIT_NOTHING_MESSAGE,
  HUNK_ACTIONS_NOT_AVAILABLE_MESSAGE,
  HUNK_CHANGED_SINCE_TEXT,
  HUNK_UNSUPPORTED_MESSAGE,
  ChangesQuery,
  CommitWorktreeRequest,
  FileDiffQuery,
  HUNK_OUTDATED_TEXT,
  HunkActionRequest,
  MAX_CHANGED_FILES,
  SessionId,
  UNDO_OUTDATED_TEXT,
  UndoHunkRequest,
  WorkspaceRelativePath,
  type ChangedFile,
  type ChangesResponse,
  type CommitWorktreeResponse,
  type FileDiffResponse,
  type HunkActionResponse,
  type Session,
  type SessionTurnChangesRecordedEvent,
  type TurnId,
  type TurnsResponse,
  type Workspace,
} from '@ogden-agents/shared';
import type { z } from 'zod';
import type { Entities } from './entities.js';
import { AgentMidTurnError, HunkOutdatedError, InvalidOperationError, NotFoundError, NotImplementedError, ValidationError } from './errors.js';
import { serializedByRepo } from './repo-serialization.js';
import type { SessionEvents } from './session-events.js';
import type { VcsChangesTarget, VcsHunkResult, VcsWorkingTreePort } from './vcs-port.js';
import { checkedWorkspacePath, isRefusedWorkspacePath } from './workspace-files.js';
import { resolveWorkspaceRoot, sessionFolder, vcsFolderOf, workspaceFolder } from './workspace-root.js';

export interface WorkspaceChanges {
  /** `ChangesQuery` → the view's changed files. {@link ValidationError}, {@link NotFoundError} (a foreign chat or turn). */
  changes(workspaceId: unknown, query: unknown): Promise<ChangesResponse>;
  /** `FileDiffQuery` → one file's hunks. {@link PathProtectedError} for a refused name, {@link NotFoundError} when it has no change there. */
  fileDiff(workspaceId: unknown, query: unknown): Promise<FileDiffResponse>;
  /** `HunkActionRequest` → the file as the view has it after. {@link AgentMidTurnError}, {@link HunkOutdatedError}, {@link NotFoundError}. */
  hunk(workspaceId: unknown, body: unknown): Promise<HunkActionResponse>;
  /** `UndoHunkRequest` → the file as the view has it after. {@link AgentMidTurnError}, {@link HunkOutdatedError}, {@link NotFoundError} (gone, used, or another folder's). */
  undo(workspaceId: unknown, body: unknown): Promise<HunkActionResponse>;
  /** The chat's recorded turns, newest first. */
  turns(workspaceId: unknown, sessionId: unknown): Promise<TurnsResponse>;
  /** `CommitWorktreeRequest` → the commit. {@link InvalidOperationError} without a worktree, {@link AgentMidTurnError}. */
  commit(workspaceId: unknown, sessionId: unknown, body: unknown): Promise<CommitWorktreeResponse>;
}

export interface WorkspaceChangesOptions {
  entities: Pick<Entities, 'getWorkspace' | 'getSession' | 'listSessions' | 'listSessionEvents'>;
  sessionEvents: Pick<SessionEvents, 'appendSessionEvent'>;
  port: VcsWorkingTreePort;
}

/** The parsed value, or {@link ValidationError} with the schema's issues. */
function parsed<S extends z.ZodType>(schema: S, value: unknown, message: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(message, result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
  return result.data;
}

/** Whether a path the port answered is one Ogden shows: a plain workspace-relative path with no refused name. */
const shownPath = (path: string): boolean => WorkspaceRelativePath.safeParse(path).success && !isRefusedWorkspacePath(path.split('/'));

/** Whether a changed file (and a renamed file's old path) may be shown. */
export const shownFile = (file: ChangedFile): boolean => shownPath(file.path) && (file.previousPath === undefined || shownPath(file.previousPath));

export function createWorkspaceChanges({ entities, sessionEvents, port }: WorkspaceChangesOptions): WorkspaceChanges {
  const recordedTurns = (session: Session): SessionTurnChangesRecordedEvent[] =>
    entities.listSessionEvents(session.id, ['session.turn_changes_recorded']).filter((event): event is SessionTurnChangesRecordedEvent => event.type === 'session.turn_changes_recorded');

  /** The port's target for a view: This turn's named turn (else the latest), `undefined` when the chat has recorded none. */
  const targetOf = (view: ChangesQuery['view'], session: Session | undefined, turn: TurnId | undefined): { target: VcsChangesTarget; turnId?: TurnId } | undefined => {
    if (view !== 'turn') return { target: { view } };
    // The schema makes This turn name a chat.
    const turns = recordedTurns(session!);
    const event = turn === undefined ? turns.at(-1) : turns.find((recorded) => recorded.payload.turnId === turn);
    if (event === undefined) {
      if (turn !== undefined) throw new NotFoundError('turn', 'requested');
      return undefined;
    }
    return { target: { view: 'turn', startTree: event.payload.startTree, endTree: event.payload.endTree }, turnId: event.payload.turnId };
  };

  /** {@link AgentMidTurnError} when a chat working in `folder` is working or waiting. */
  const refuseMidTurn = (workspace: Workspace, folder: string): void => {
    // A build works in its run's own worktree and a remote chat on its machine: neither is in this folder.
    const busy = entities
      .listSessions(workspace.id)
      .some((other) => other.kind !== 'build' && other.machineId === null && (other.state === 'working' || other.state === 'waiting') && sessionFolder(workspace, other) === folder);
    if (busy) throw new AgentMidTurnError(AGENT_MID_TURN_MESSAGE);
  };

  /** The port's outcome, or its refusal: `outdated` with `outdatedText`, `unsupported`, `not_found`. */
  const applied = (result: VcsHunkResult, outdatedText: string): void => {
    if (result.outcome === 'outdated') throw new HunkOutdatedError(outdatedText);
    if (result.outcome === 'unsupported') throw new InvalidOperationError(HUNK_UNSUPPORTED_MESSAGE);
    if (result.outcome === 'not_found') throw new NotFoundError('change', 'requested');
  };

  const sessionOf = (workspaceId: unknown, sessionId: unknown) => {
    if (!SessionId.safeParse(sessionId).success) throw new NotFoundError('session', 'requested');
    const resolved = resolveWorkspaceRoot(entities, workspaceId, sessionId);
    return { ...resolved, session: resolved.session! };
  };

  return {
    async changes(workspaceId, query) {
      const { workspace, session } = resolveWorkspaceRoot(entities, workspaceId, (query as { session?: unknown } | null | undefined)?.session);
      const { view, turn } = parsed(ChangesQuery, query, 'That is not a view of the changes.');
      const target = targetOf(view, session, turn);
      if (target === undefined) return { view, files: [], truncated: false };
      const found = await port.changedFiles(vcsFolderOf(workspace, session), target.target);
      const files = found.files.filter(shownFile);
      return {
        view,
        ...(found.base === undefined || view !== 'branch' ? {} : { base: found.base }),
        ...(target.turnId === undefined ? {} : { turn: target.turnId }),
        files: files.slice(0, MAX_CHANGED_FILES),
        truncated: found.truncated || files.length > MAX_CHANGED_FILES,
      };
    },

    async fileDiff(workspaceId, query) {
      const { workspace, session } = resolveWorkspaceRoot(entities, workspaceId, (query as { session?: unknown } | null | undefined)?.session);
      const path = checkedWorkspacePath((query as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const { view, turn } = parsed(FileDiffQuery, query, 'That is not a file of the changes.');
      const target = targetOf(view, session, turn);
      if (target === undefined) throw new NotFoundError('change', 'requested');
      const found = await port.fileDiff(vcsFolderOf(workspace, session), target.target, path);
      if (found === undefined || !shownFile(found.file)) throw new NotFoundError('change', 'requested');
      return { view, file: found.file, hunks: found.file.binary || found.file.tooLarge ? [] : found.hunks };
    },

    async hunk(workspaceId, body) {
      const applyHunk = port.applyHunk;
      // Without the port's hunk actions nothing is checked or asked.
      if (applyHunk === undefined) throw new NotImplementedError(HUNK_ACTIONS_NOT_AVAILABLE_MESSAGE);
      const { workspace, root, session } = resolveWorkspaceRoot(entities, workspaceId, (body as { session?: unknown } | null | undefined)?.session);
      const path = checkedWorkspacePath((body as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const request = parsed(HunkActionRequest, body, 'That is not a change Ogden can make.');
      const target = targetOf(request.view, session, request.turn);
      if (target === undefined) throw new NotFoundError('change', 'requested');
      const folder = vcsFolderOf(workspace, session);
      // One at a time per project, with the snapshots and the commit; the agent check inside, so none starts between.
      const result = await serializedByRepo(workspaceFolder(workspace), async () => {
        refuseMidTurn(workspace, root.path);
        return applyHunk.call(port, folder, { target: target.target, action: request.action, path, hunkId: request.hunkId, hunkIds: request.hunkIds });
      });
      applied(result, request.view === 'turn' ? HUNK_OUTDATED_TEXT : HUNK_CHANGED_SINCE_TEXT);
      const after = await port.fileDiff(folder, target.target, path);
      const undo = result.outcome === 'applied' && request.action === 'revert' ? result.undo : undefined;
      return { file: after === undefined || !shownFile(after.file) ? null : after.file, ...(undo === undefined ? {} : { undo }) };
    },

    async undo(workspaceId, body) {
      const undoRevert = port.undoRevert;
      if (undoRevert === undefined) throw new NotImplementedError(HUNK_ACTIONS_NOT_AVAILABLE_MESSAGE);
      const { workspace, root, session } = resolveWorkspaceRoot(entities, workspaceId, (body as { session?: unknown } | null | undefined)?.session);
      const path = checkedWorkspacePath((body as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const request = parsed(UndoHunkRequest, body, 'That is not a revert Ogden can undo.');
      const folder = vcsFolderOf(workspace, session);
      const result = await serializedByRepo(workspaceFolder(workspace), async () => {
        refuseMidTurn(workspace, root.path);
        return undoRevert.call(port, folder, { undo: request.undo, path, view: request.view });
      });
      applied(result, UNDO_OUTDATED_TEXT);
      const target = targetOf(request.view, session, undefined);
      const after = target === undefined ? undefined : await port.fileDiff(folder, target.target, path);
      return { file: after === undefined || !shownFile(after.file) ? null : after.file };
    },

    async turns(workspaceId, sessionId) {
      const { session } = sessionOf(workspaceId, sessionId);
      const turns = recordedTurns(session)
        .map((event) => ({ id: event.payload.turnId, sessionId: session.id, at: event.at, files: event.payload.files, additions: event.payload.additions, deletions: event.payload.deletions }))
        .reverse();
      return { turns };
    },

    async commit(workspaceId, sessionId, body) {
      const { workspace, session } = sessionOf(workspaceId, sessionId);
      const { message } = parsed(CommitWorktreeRequest, body, 'A commit needs a message.');
      if (session.worktreePath === null || session.branch === null) throw new InvalidOperationError(COMMIT_NEEDS_WORKTREE_MESSAGE);
      // The project folder is never the worktree, so only chats in this worktree can block it.
      if (session.worktreePath === workspaceFolder(workspace)) throw new InvalidOperationError(COMMIT_NEEDS_WORKTREE_MESSAGE);
      const worktreePath = session.worktreePath;
      // With the snapshots and the repo's other git work: one at a time per project.
      const committed = await serializedByRepo(workspaceFolder(workspace), async () => {
        refuseMidTurn(workspace, worktreePath);
        return port.commitAll(vcsFolderOf(workspace, session), message);
      });
      if (committed === 'nothing') throw new InvalidOperationError(COMMIT_NOTHING_MESSAGE);
      const { revision, files } = committed;
      sessionEvents.appendSessionEvent(session.id, { type: 'session.worktree_committed', payload: { sessionId: session.id, branch: session.branch, revision, files } });
      return { revision, files };
    },
  };
}
