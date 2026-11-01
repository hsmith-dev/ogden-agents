import {
  API_ROUTES,
  apiPath,
  PutAwayWorktreesResponse,
  RestoreWorktreeResponse,
  WORKTREE_RESTORED_TEXT,
  worktreeRestoredText,
  WorktreeRetentionSetting,
  type PutAwayWorktree,
  type RestoreWorktreeResponse as RestoreWorktreeResponseType,
  type WorktreeRetentionSetting as WorktreeRetentionSettingType,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/**
 * Worktree retention (epic 27, 27.6): the install's cap (Settings, Projects,
 * Worktrees), a project's put-away copies and Restore. The server keeps and
 * enforces them; every tab follows a change through
 * `settings.worktree_retention_changed`, `session.worktree_put_away` and
 * `session.worktree_restored`.
 */

export const worktreeRetentionQueryKey = ['worktree-retention'] as const;
export const putAwayWorktreesQueryKey = (wsId: string) => ['put-away-worktrees', wsId] as const;

async function fetchWorktreeRetention(auth: Auth = tabAuth): Promise<WorktreeRetentionSettingType> {
  return WorktreeRetentionSetting.parse(await call(auth, API_ROUTES.worktreeRetention, {}, "Ogden Agents couldn't load the worktree setting"));
}

export async function saveWorktreeRetention(keep: number, auth: Auth = tabAuth): Promise<WorktreeRetentionSettingType> {
  return WorktreeRetentionSetting.parse(await call(auth, API_ROUTES.worktreeRetention, { ...postJson({ keep }), method: 'PUT' }, "Ogden Agents couldn't save the worktree setting"));
}

async function fetchPutAwayWorktrees(wsId: string, auth: Auth = tabAuth): Promise<PutAwayWorktree[]> {
  return PutAwayWorktreesResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePutAwayWorktrees, { wsId }), {}, "Ogden Agents couldn't load the put-away copies")).worktrees;
}

/** Restore: the copy back with its saved changes, and where it went; a `ChatApiError` (`restore_failed`, its sentence) when it couldn't. */
async function restoreWorktree(wsId: string, sesId: string, auth: Auth = tabAuth): Promise<RestoreWorktreeResponseType> {
  return RestoreWorktreeResponse.parse(await call(auth, apiPath(API_ROUTES.sessionWorktreeRestore, { wsId, sesId }), postJson({}), "Ogden Agents couldn't restore this chat's copy"));
}

/** The install's cap, following every change. */
export function useWorktreeRetention(auth: Auth = tabAuth) {
  useEventInvalidation((event) => (event.type === 'settings.worktree_retention_changed' ? [worktreeRetentionQueryKey] : []));
  return useQuery({ queryKey: worktreeRetentionQueryKey, queryFn: () => fetchWorktreeRetention(auth), retry: false });
}

/** The project's put-away copies, newest first, following each put-away, Restore and deleted chat. */
export function usePutAwayWorktrees(wsId: string, { enabled = true, auth = tabAuth }: { enabled?: boolean; auth?: Auth } = {}) {
  useEventInvalidation((event) =>
    event.workspaceId === wsId && (event.type === 'session.worktree_put_away' || event.type === 'session.worktree_restored' || event.type === 'workspace.chat_deleted' || event.type === 'workspace.history_deleted')
      ? [putAwayWorktreesQueryKey(wsId)]
      : [],
  );
  return useQuery({ queryKey: putAwayWorktreesQueryKey(wsId), queryFn: () => fetchPutAwayWorktrees(wsId, auth), retry: false, enabled });
}

/** Restore's plain sentence for where the copy went: "Restored.", on its branch's newer commit, or on a new branch (user decision 2026-11-01). */
export function restoredText({ location, restored }: RestoreWorktreeResponseType): string {
  return location.kind === 'worktree' ? worktreeRestoredText(restored, location.branch) : WORKTREE_RESTORED_TEXT;
}

/** Restore, then the list and the chat's session read again; the sentence for where the copy went. */
export function useRestoreWorktree(wsId: string, auth: Auth = tabAuth) {
  const queryClient = useQueryClient();
  return async (sesId: string): Promise<string> => {
    const text = restoredText(await restoreWorktree(wsId, sesId, auth));
    await queryClient.invalidateQueries({ queryKey: putAwayWorktreesQueryKey(wsId) });
    return text;
  };
}
