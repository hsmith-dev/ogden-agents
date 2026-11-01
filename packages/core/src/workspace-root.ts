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
import type { WorkspaceRoot } from './workspace-files-port.js';

export interface ResolvedWorkspaceRoot {
  workspace: Workspace;
  root: WorkspaceRoot;
  /** The chat named, when one was. */
  session: Session | undefined;
}

/** The workspace's real path (its stored path when it has none). */
export const workspaceFolder = (workspace: Workspace): string => workspace.realPath ?? workspace.path;

/** The folder a session works in: its worktree, else its project's folder. */
export const sessionFolder = (workspace: Workspace, session: Session): string => session.worktreePath ?? workspaceFolder(workspace);

/** The root of a request for `workspaceId` and (optionally) `session`, or {@link NotFoundError}. */
export function resolveWorkspaceRoot(entities: Pick<Entities, 'getWorkspace' | 'getSession'>, workspaceId: unknown, session?: unknown): ResolvedWorkspaceRoot {
  const id = WorkspaceId.safeParse(workspaceId);
  const workspace = id.success ? entities.getWorkspace(id.data) : undefined;
  if (workspace === undefined) throw new NotFoundError('workspace', 'requested');
  if (session === undefined || session === '') return { workspace, root: { path: workspaceFolder(workspace), kind: 'project' }, session: undefined };
  const sessionId = SessionId.safeParse(session);
  const found = sessionId.success ? entities.getSession(sessionId.data) : undefined;
  if (found === undefined || found.workspaceId !== workspace.id) throw new NotFoundError('session', 'requested');
  return {
    workspace,
    root: found.worktreePath === null ? { path: workspaceFolder(workspace), kind: 'project' } : { path: found.worktreePath, kind: 'chat_worktree' },
    session: found,
  };
}
