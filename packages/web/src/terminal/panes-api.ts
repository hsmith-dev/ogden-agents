import { API_ROUTES, apiPath, PaneResponse, PanesResponse, type Pane } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/**
 * The terminal pane REST calls (epic 16, story 16.2), sent with this tab's
 * token, and the queries built on them. Every call is refused by the server
 * without Developer mode (403 `developer_mode_required`).
 */

export const panesQueryKey = (wsId: string) => ['panes', wsId] as const;

/** `GET /api/v1/workspaces/:wsId/panes`. */
export async function fetchPanes(wsId: string, auth: Auth = tabAuth): Promise<PanesResponse> {
  return PanesResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePanes, { wsId }), {}, "Ogden Agents couldn't load this project's terminals"));
}

/** `POST /api/v1/workspaces/:wsId/panes`: a new pane running the user's shell, started at `size`. */
export async function openPane(wsId: string, size: { cols: number; rows: number }, auth: Auth = tabAuth): Promise<Pane> {
  return PaneResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePanes, { wsId }), postJson(size), "Ogden Agents couldn't open a terminal")).pane;
}

/** `DELETE /api/v1/workspaces/:wsId/panes/:paneId`: closes the pane and stops what it runs. */
export async function closePane(wsId: string, paneId: string, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.workspacePane, { wsId, paneId }), { method: 'DELETE' }, "Ogden Agents couldn't close that terminal");
}

/** `POST /api/v1/workspaces/:wsId/panes/:paneId/restart`: Restart pane. */
export async function restartPane(wsId: string, paneId: string, size: { cols: number; rows: number }, auth: Auth = tabAuth): Promise<Pane> {
  return PaneResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePaneRestart, { wsId, paneId }), postJson(size), "Ogden Agents couldn't restart that terminal")).pane;
}

/** The project's panes. Off while Developer mode is (the server would refuse). */
export function usePanes(wsId: string, enabled: boolean, auth: Auth = tabAuth) {
  return useQuery({ queryKey: panesQueryKey(wsId), queryFn: () => fetchPanes(wsId, auth), enabled, retry: false });
}

/** Opening and closing a pane; each refreshes the list. */
export function usePaneActions(wsId: string, auth: Auth = tabAuth) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: panesQueryKey(wsId) });
  const open = useMutation({ mutationFn: (size: { cols: number; rows: number }) => openPane(wsId, size, auth), onSettled: refresh });
  const close = useMutation({ mutationFn: (paneId: string) => closePane(wsId, paneId, auth), onSettled: refresh });
  return { open, close };
}
