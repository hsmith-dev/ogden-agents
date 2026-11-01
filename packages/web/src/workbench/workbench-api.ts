import { API_ROUTES, apiPath, WORKSPACE_FILE_READ_FAILED, WORKSPACE_FOLDER_READ_FAILED, WorkspaceFileResponse, WorkspaceFolderResponse } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/**
 * The Workbench's Files calls (AD-36), sent with this tab's token. A file's
 * content is fetched each time it is shown and never kept once the viewer
 * closes (`gcTime: 0`); it never travels in an event.
 */

/** `GET /api/v1/workspaces/:wsId/files?path=`: one folder (`''` the root). */
export async function fetchWorkspaceFolder(wsId: string, path: string, auth: Auth = tabAuth): Promise<WorkspaceFolderResponse> {
  const query = path === '' ? '' : `?${new URLSearchParams({ path }).toString()}`;
  const json = await call(auth, `${apiPath(API_ROUTES.workspaceFiles, { wsId })}${query}`, {}, WORKSPACE_FOLDER_READ_FAILED);
  return WorkspaceFolderResponse.parse(json);
}

/** `GET /api/v1/workspaces/:wsId/files/content?path=`: one file, read-only. */
export async function fetchWorkspaceFile(wsId: string, path: string, auth: Auth = tabAuth): Promise<WorkspaceFileResponse> {
  const json = await call(auth, `${apiPath(API_ROUTES.workspaceFileContent, { wsId })}?${new URLSearchParams({ path }).toString()}`, {}, WORKSPACE_FILE_READ_FAILED);
  return WorkspaceFileResponse.parse(json);
}

/** The query key of one folder's listing, shared by the tree and the viewer. */
export const workspaceFolderKey = (wsId: string, path: string) => ['workspace-folder', wsId, path] as const;

/**
 * One folder's listing (a folder row is listed when first opened, never when
 * protected). `reuse`: the viewer's look-up of its file's row takes the
 * tree's listing as it is, never asking for it again on mount.
 */
export function useWorkspaceFolder(wsId: string, path: string, { reuse = false }: { reuse?: boolean } = {}) {
  return useQuery({ queryKey: workspaceFolderKey(wsId, path), queryFn: () => fetchWorkspaceFolder(wsId, path), retry: false, ...(reuse ? { refetchOnMount: false } : {}) });
}

/** One file's content; only while `enabled` (never for a protected row). */
export function useWorkspaceFile(wsId: string, path: string, enabled: boolean) {
  return useQuery({ queryKey: ['workspace-file', wsId, path], queryFn: () => fetchWorkspaceFile(wsId, path), enabled, retry: false, staleTime: 0, gcTime: 0 });
}

/** The folder that holds `path` (`''` for a root entry). */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Every folder above `path`, outermost first (`a/b/c.ts` → `a`, `a/b`). */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}
