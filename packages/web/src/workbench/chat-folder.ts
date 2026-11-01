/**
 * A chat's folder in the web (core's `sessionFolder`, `workspace-root.ts`;
 * the epic 8 sweep, 8.12): its worktree when it has one, else its project's
 * folder. A Workbench request names the chat (`session`) only so the server
 * roots it at that worktree; every surface that roots files, search,
 * changes or editor opens at a chat reads the folder through here.
 */
import { useQuery } from '@tanstack/react-query';
import type { Session, Workspace } from '@ogden-agents/shared';
import { fetchSession } from '@/chat/chat-api';

/** The chat query's key (the chat page, its name, Commit and the palette share it). */
export const sessionKey = (wsId: string, sesId: string) => ['session', wsId, sesId] as const;

/** A chat's own worktree, or `null` when it works in its project's folder. */
export const chatWorktree = (session: Pick<Session, 'worktreePath'> | undefined): string | null => session?.worktreePath ?? null;

/** The folders an agent's absolute path in this chat may start with: its worktree, else the project's path and real path. */
export function chatRoots(session: Pick<Session, 'worktreePath'> | undefined, workspace: Pick<Workspace, 'path' | 'realPath'> | undefined): string[] {
  const worktree = chatWorktree(session);
  if (worktree !== null) return [worktree];
  if (workspace === undefined) return [];
  return [workspace.path, ...(workspace.realPath === undefined ? [] : [workspace.realPath])];
}

/** `sesId` when that chat works in a worktree of its own (a Workbench request then names it), else `undefined`. */
export function useWorktreeChat(wsId: string | undefined, sesId: string | undefined, enabled: boolean): string | undefined {
  const session = useQuery({
    queryKey: sessionKey(wsId ?? '', sesId ?? ''),
    queryFn: () => fetchSession(wsId!, sesId!),
    enabled: enabled && wsId !== undefined && sesId !== undefined,
    retry: false,
  });
  return sesId !== undefined && chatWorktree(session.data?.session) !== null ? sesId : undefined;
}
