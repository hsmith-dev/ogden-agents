import { API_ROUTES, apiPath, PaneResponse, PanesResponse, type Pane, type PaneLayout, type PanePlacement } from '@ogden-agents/shared';
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
export async function openPane(wsId: string, size: { cols: number; rows: number }, placement?: PanePlacement, auth: Auth = tabAuth): Promise<Pane> {
  const body = placement === undefined ? size : { ...size, placement };
  return PaneResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePanes, { wsId }), postJson(body), "Ogden Agents couldn't open a terminal")).pane;
}

/** `PUT /api/v1/workspaces/:wsId/pane-layout`: the arrangement (ratios, tab names and order, the active tab). */
export async function arrangeLayout(wsId: string, layout: PaneLayout, auth: Auth = tabAuth): Promise<PanesResponse> {
  return PanesResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePaneLayout, { wsId }), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout }) }, "Ogden Agents couldn't save the layout"));
}

/** `PATCH /api/v1/workspaces/:wsId/panes/:paneId`: rename a pane. */
export async function renamePane(wsId: string, paneId: string, title: string, auth: Auth = tabAuth): Promise<Pane> {
  return PaneResponse.parse(await call(auth, apiPath(API_ROUTES.workspacePane, { wsId, paneId }), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) }, "Ogden Agents couldn't rename that terminal")).pane;
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

/** Opening, closing, renaming and arranging panes; each refreshes the list and layout. */
export function usePaneActions(wsId: string, auth: Auth = tabAuth) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: panesQueryKey(wsId) });
  const open = useMutation({ mutationFn: (input: { size: { cols: number; rows: number }; placement?: PanePlacement }) => openPane(wsId, input.size, input.placement, auth), onSettled: refresh });
  const close = useMutation({ mutationFn: (paneId: string) => closePane(wsId, paneId, auth), onSettled: refresh });
  const rename = useMutation({ mutationFn: (input: { paneId: string; title: string }) => renamePane(wsId, input.paneId, input.title, auth), onSettled: refresh });
  const arrange = useMutation({
    mutationFn: (layout: PaneLayout) => arrangeLayout(wsId, layout, auth),
    // The new arrangement shows at once; the server's answer replaces it.
    onMutate: (layout) => queryClient.setQueryData<PanesResponse>(panesQueryKey(wsId), (old) => (old === undefined ? old : { ...old, layout })),
    onSuccess: (response) => queryClient.setQueryData(panesQueryKey(wsId), response),
    onError: refresh,
  });
  return { open, close, rename, arrange };
}
