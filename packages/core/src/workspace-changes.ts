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
 */
import {
  AGENT_MID_TURN_MESSAGE,
  COMMIT_NEEDS_WORKTREE_MESSAGE,
  ChangesQuery,
  CommitWorktreeRequest,
  FileDiffQuery,
  HUNK_OUTDATED_TEXT,
  HunkActionRequest,
  MAX_CHANGED_FILES,
  SessionId,
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
import { AgentMidTurnError, HunkOutdatedError, InvalidOperationError, NotFoundError, ValidationError } from './errors.js';
import type { SessionEvents } from './session-events.js';
import type { VcsChangesTarget, VcsWorkingTreePort } from './vcs-port.js';
import { checkedWorkspacePath } from './workspace-files.js';
import { resolveWorkspaceRoot, sessionFolder, workspaceFolder } from './workspace-root.js';

export interface WorkspaceChanges {
  /** `ChangesQuery` → the view's changed files. {@link ValidationError}, {@link NotFoundError} (a foreign chat or turn). */
  changes(workspaceId: unknown, query: unknown): Promise<ChangesResponse>;
  /** `FileDiffQuery` → one file's hunks. {@link PathProtectedError} for a refused name, {@link NotFoundError} when it has no change there. */
  fileDiff(workspaceId: unknown, query: unknown): Promise<FileDiffResponse>;
  /** `HunkActionRequest` → the file as the view has it after. {@link AgentMidTurnError}, {@link HunkOutdatedError}, {@link NotFoundError}. */
  hunk(workspaceId: unknown, body: unknown): Promise<HunkActionResponse>;
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

  const sessionOf = (workspaceId: unknown, sessionId: unknown) => {
    if (!SessionId.safeParse(sessionId).success) throw new NotFoundError('session', 'requested');
    const resolved = resolveWorkspaceRoot(entities, workspaceId, sessionId);
    return { ...resolved, session: resolved.session! };
  };

  return {
    async changes(workspaceId, query) {
      const { root, session } = resolveWorkspaceRoot(entities, workspaceId, (query as { session?: unknown } | null | undefined)?.session);
      const { view, turn } = parsed(ChangesQuery, query, 'That is not a view of the changes.');
      const target = targetOf(view, session, turn);
      if (target === undefined) return { view, files: [], truncated: false };
      const found = await port.changedFiles(root.path, target.target);
      return {
        view,
        ...(found.base === undefined || view !== 'branch' ? {} : { base: found.base }),
        ...(target.turnId === undefined ? {} : { turn: target.turnId }),
        files: found.files.slice(0, MAX_CHANGED_FILES),
        truncated: found.truncated || found.files.length > MAX_CHANGED_FILES,
      };
    },

    async fileDiff(workspaceId, query) {
      const { root, session } = resolveWorkspaceRoot(entities, workspaceId, (query as { session?: unknown } | null | undefined)?.session);
      const path = checkedWorkspacePath((query as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const { view, turn } = parsed(FileDiffQuery, query, 'That is not a file of the changes.');
      const target = targetOf(view, session, turn);
      if (target === undefined) throw new NotFoundError('change', 'requested');
      const found = await port.fileDiff(root.path, target.target, path);
      if (found === undefined) throw new NotFoundError('change', 'requested');
      return { view, file: found.file, hunks: found.file.binary || found.file.tooLarge ? [] : found.hunks };
    },

    async hunk(workspaceId, body) {
      const { workspace, root, session } = resolveWorkspaceRoot(entities, workspaceId, (body as { session?: unknown } | null | undefined)?.session);
      const path = checkedWorkspacePath((body as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const request = parsed(HunkActionRequest, body, 'That is not a change Ogden can make.');
      const target = targetOf(request.view, session, request.turn);
      if (target === undefined) throw new NotFoundError('change', 'requested');
      refuseMidTurn(workspace, root.path);
      const result = await port.applyHunk(root.path, { target: target.target, action: request.action, path, hunkId: request.hunkId });
      if (result === 'outdated') throw new HunkOutdatedError(HUNK_OUTDATED_TEXT);
      if (result === 'not_found') throw new NotFoundError('change', 'requested');
      const after = await port.fileDiff(root.path, target.target, path);
      return { file: after?.file ?? null };
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
      refuseMidTurn(workspace, session.worktreePath);
      const { revision, files } = await port.commitAll(session.worktreePath, message);
      sessionEvents.appendSessionEvent(session.id, { type: 'session.worktree_committed', payload: { sessionId: session.id, branch: session.branch, revision, files } });
      return { revision, files };
    },
  };
}
