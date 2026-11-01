import {
  API_ROUTES,
  apiPath,
  WORKSPACE_FILE_READ_FAILED,
  WORKSPACE_FOLDER_READ_FAILED,
  WORKSPACE_SEARCH_FAILED_TEXT,
  WorkspaceFileResponse,
  WorkspaceFolderResponse,
  WorkspaceSearchResponse,
  type WorkspaceSearchMode,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/**
 * The Workbench's Files calls (AD-36), sent with this tab's token. A file's
 * content is fetched each time it is shown and never kept once the viewer
 * closes (`gcTime: 0`); it never travels in an event.
 */

/** `?path=&session=` with only the values given (`''` for neither). */
function filesQuery(path: string, session: string | undefined): string {
  const params = new URLSearchParams();
  if (path !== '') params.set('path', path);
  if (session !== undefined) params.set('session', session);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** `GET /api/v1/workspaces/:wsId/files?path=&session=`: one folder (`''` the root), of the chat's worktree for `session`. */
export async function fetchWorkspaceFolder(wsId: string, path: string, session?: string, auth: Auth = tabAuth): Promise<WorkspaceFolderResponse> {
  const json = await call(auth, `${apiPath(API_ROUTES.workspaceFiles, { wsId })}${filesQuery(path, session)}`, {}, WORKSPACE_FOLDER_READ_FAILED);
  return WorkspaceFolderResponse.parse(json);
}

/** `GET /api/v1/workspaces/:wsId/files/content?path=&session=`: one file, read-only. */
export async function fetchWorkspaceFile(wsId: string, path: string, session?: string, auth: Auth = tabAuth): Promise<WorkspaceFileResponse> {
  const json = await call(auth, `${apiPath(API_ROUTES.workspaceFileContent, { wsId })}${filesQuery(path, session)}`, {}, WORKSPACE_FILE_READ_FAILED);
  return WorkspaceFileResponse.parse(json);
}

/** The query key of one folder's listing, shared by the tree and the viewer. */
export const workspaceFolderKey = (wsId: string, path: string, session?: string) => ['workspace-folder', wsId, path, session ?? ''] as const;

/**
 * One folder's listing (a folder row is listed when first opened, never when
 * protected). `reuse`: the viewer's look-up of its file's row takes the
 * tree's listing as it is, never asking for it again on mount. `session`:
 * the chat's worktree (8.2's root), when it has one.
 */
export function useWorkspaceFolder(wsId: string, path: string, { reuse = false, session }: { reuse?: boolean; session?: string | undefined } = {}) {
  return useQuery({ queryKey: workspaceFolderKey(wsId, path, session), queryFn: () => fetchWorkspaceFolder(wsId, path, session), retry: false, ...(reuse ? { refetchOnMount: false } : {}) });
}

/** One file's content; only while `enabled` (never for a protected row). */
export function useWorkspaceFile(wsId: string, path: string, enabled: boolean, session?: string) {
  return useQuery({ queryKey: ['workspace-file', wsId, path, session ?? ''], queryFn: () => fetchWorkspaceFile(wsId, path, session), enabled, retry: false, staleTime: 0, gcTime: 0 });
}

/** What the Search panel asks for (8.8). */
export interface WorkspaceSearchParams {
  q: string;
  mode: WorkspaceSearchMode;
  matchCase: boolean;
  regex: boolean;
  session?: string | undefined;
}

/**
 * `GET /api/v1/workspaces/:wsId/files/search?q=&mode=&matchCase=&regex=&session=`
 * (8.8): `mode`, `matchCase` and `regex` only when not their defaults.
 * `signal` cancels it (the server then stops searching).
 */
export async function fetchWorkspaceSearch(wsId: string, { q, mode, matchCase, regex, session }: WorkspaceSearchParams, signal?: AbortSignal, auth: Auth = tabAuth): Promise<WorkspaceSearchResponse> {
  const params = new URLSearchParams({ q });
  if (mode !== 'text') params.set('mode', mode);
  if (matchCase) params.set('matchCase', 'true');
  if (regex) params.set('regex', 'true');
  if (session !== undefined) params.set('session', session);
  const json = await call(auth, `${apiPath(API_ROUTES.workspaceFileSearch, { wsId })}?${params}`, signal === undefined ? {} : { signal }, WORKSPACE_SEARCH_FAILED_TEXT);
  return WorkspaceSearchResponse.parse(json);
}

/**
 * The Search panel's results, only while `q` is not empty. A new query
 * cancels the last one's request; results are never kept once the panel
 * stops showing them (`gcTime: 0`), and a refusal (501 included) is the
 * query's error, never retried.
 */
export function useWorkspaceSearch(wsId: string, params: WorkspaceSearchParams) {
  return useQuery({
    queryKey: ['workspace-search', wsId, params.q, params.mode, params.matchCase, params.regex, params.session ?? ''],
    queryFn: ({ signal }) => fetchWorkspaceSearch(wsId, params, signal),
    enabled: params.q !== '',
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * The command palette's file-name search (8.11): the project root's names
 * (a worktree chat's, for `session`, 8.12) matching `q`, only while
 * `enabled` and `q` is not empty. A new `q` (or
 * `enabled` going false) cancels the request in flight, since the query left
 * behind is removed at once (`gcTime: 0`) and its signal was handed to
 * fetch. Never retried, and never kept: while the next answer loads there
 * are no files.
 */
export function usePaletteFileSearch(wsId: string | undefined, q: string, enabled: boolean, session?: string) {
  return useQuery({
    queryKey: ['palette-files', wsId ?? '', session ?? '', q],
    queryFn: ({ signal }) => fetchWorkspaceSearch(wsId!, { q, mode: 'names', matchCase: false, regex: false, ...(session === undefined ? {} : { session }) }, signal),
    enabled: enabled && wsId !== undefined && q !== '',
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
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
