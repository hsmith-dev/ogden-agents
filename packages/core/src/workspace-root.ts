/**
 * Which folder a Workbench request is rooted at (AD-36, AD-37; epic 8
 * entry 2): the workspace's real path, or, when the request names a chat
 * (`session`) that has a `worktreePath` (AD-8 CAP-33 note), that worktree.
 * A session that is unknown, malformed or of another project is
 * {@link NotFoundError}, exactly as an unknown project is: neither says
 * which.
 */
import { SessionId, WorkspaceId, type Session, type Workspace } from '@ogden-agents/shared';
import type { Entities } from './entities.js';
import { NotFoundError } from './errors.js';
import type { VcsFolder } from './vcs-port.js';
import type { WorkspaceRoot } from './workspace-files-port.js';

export interface ResolvedWorkspaceRoot {
  workspace: Workspace;
  root: WorkspaceRoot;
  /** The chat named, when one was. */
  session: Session | undefined;
}

/** The workspace's real path (its stored path when it has none). */
export const workspaceFolder = (workspace: Workspace): string => workspace.realPath ?? workspace.path;

/**
 * The folder a chat works in: its worktree, else its project's folder. The
 * one rule every epic 8 root follows (files, search, changes, hunks, turn
 * snapshots, Problems links and Open in editor), through
 * {@link resolveWorkspaceRoot} and {@link vcsFolderOf}.
 */
export const sessionFolder = (workspace: Workspace, session: Session | undefined): string => session?.worktreePath ?? workspaceFolder(workspace);

/** A request body's or query's `session`, unparsed (checked by {@link resolveWorkspaceRoot}). */
export const namedSession = (value: unknown): unknown => (value as { session?: unknown } | null | undefined)?.session;

/**
 * The folder git runs in for `session` (else the project): a chat's
 * worktree names the project's real path and the chat's branch, so the
 * adapter checks the worktree and pins git's folders before it runs there.
 */
export function vcsFolderOf(workspace: Workspace, session: Session | undefined): VcsFolder {
  // Only a worktree with its branch is pinned; anything less runs in the project, never an unchecked folder.
  if (session === undefined || session.worktreePath === null || session.branch === null) return { path: workspaceFolder(workspace) };
  return { path: sessionFolder(workspace, session), worktree: { repoPath: workspaceFolder(workspace), branch: session.branch } };
}

/** The root of a request for `workspaceId` and (optionally) `session`, or {@link NotFoundError}. */
export function resolveWorkspaceRoot(entities: Pick<Entities, 'getWorkspace' | 'getSession'>, workspaceId: unknown, session?: unknown): ResolvedWorkspaceRoot {
  const id = WorkspaceId.safeParse(workspaceId);
  const workspace = id.success ? entities.getWorkspace(id.data) : undefined;
  if (workspace === undefined) throw new NotFoundError('workspace', 'requested');
  if (session === undefined || session === '') return { workspace, root: { path: sessionFolder(workspace, undefined), kind: 'project' }, session: undefined };
  const sessionId = SessionId.safeParse(session);
  const found = sessionId.success ? entities.getSession(sessionId.data) : undefined;
  if (found === undefined || found.workspaceId !== workspace.id) throw new NotFoundError('session', 'requested');
  return {
    workspace,
    root: { path: sessionFolder(workspace, found), kind: found.worktreePath === null ? 'project' : 'chat_worktree' },
    session: found,
  };
}
