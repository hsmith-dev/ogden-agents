/**
 * Generic developer CLI tools (CAP-25, story: generic developer CLI tools
 * detect, install, and sandbox-gate): the install-wide catalog, naming and
 * removing a custom tool, a confirmed real install, and a project's
 * unattended-build allowlist.
 */
import { API_ROUTES, apiPath, DevToolsAllowlistResponse, DevToolsResponse, DevToolStatus, type AddDevToolRequest, type DevToolUnattendedAllowance } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

const CATALOG_KEY = ['dev-tools'];
const allowlistKey = (wsId: string) => ['dev-tools-allowlist', wsId];

/** `GET /api/v1/dev-tools`. */
export async function fetchDevTools(auth: Auth = tabAuth): Promise<DevToolsResponse['tools']> {
  const json = await call(auth, API_ROUTES.devTools, {}, "Ogden Agents couldn't check your developer tools");
  return DevToolsResponse.parse(json).tools;
}

/** `POST /api/v1/dev-tools`: names a tool Ogden doesn't ship (the generic, extensible path). */
export async function addDevTool(request: AddDevToolRequest, auth: Auth = tabAuth): Promise<DevToolStatus> {
  const json = await call(auth, API_ROUTES.devTools, postJson(request), "That tool couldn't be added");
  return DevToolStatus.parse(json);
}

/** `DELETE /api/v1/dev-tools/:toolId`: removes a tool the user named. */
export async function removeDevTool(toolId: string, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.devTool, { toolId }), { method: 'DELETE' }, "That tool couldn't be removed");
}

/**
 * `POST /api/v1/dev-tools/:toolId/install`: runs the tool's own real install
 * command, only once the user confirmed it. The exact command came from
 * {@link fetchDevTools}'s `installCommand`; nothing this call sends can
 * change what actually runs (the server always runs its own stored one).
 */
export async function installDevTool(toolId: string, auth: Auth = tabAuth): Promise<DevToolStatus> {
  const json = await call(auth, apiPath(API_ROUTES.devToolInstall, { toolId }), postJson({ confirm: true }), `${toolId} couldn't be installed`);
  return DevToolStatus.parse(json);
}

/** `GET /api/v1/workspaces/:wsId/dev-tools-allowlist`: every installed tool and whether this project allows it for unattended builds. */
export async function fetchDevToolsAllowlist(wsId: string, auth: Auth = tabAuth): Promise<DevToolUnattendedAllowance[]> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceDevToolsAllowlist, { wsId }), {}, "Ogden Agents couldn't check this project's unattended-build allowlist");
  return DevToolsAllowlistResponse.parse(json).tools;
}

/** `PUT /api/v1/workspaces/:wsId/dev-tools-allowlist/:toolId`: grants or revokes one tool's unattended-build allowance, explicit either way. */
export async function setDevToolUnattendedAllowed(wsId: string, toolId: string, allowed: boolean, auth: Auth = tabAuth): Promise<DevToolUnattendedAllowance[]> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceDevToolAllow, { wsId, toolId }), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed }) }, 'That allowance could not be saved');
  return DevToolsAllowlistResponse.parse(json).tools;
}

/** The install-wide catalog, kept current from the event stream (another tab's install or Add). */
export function useDevTools() {
  useEventInvalidation((event) => (event.type === 'devtools.catalog_changed' ? [CATALOG_KEY] : []));
  return useQuery({ queryKey: CATALOG_KEY, queryFn: () => fetchDevTools(), retry: false });
}

/** A project's unattended-build allowlist, kept current from the event stream (another tab's grant or revoke). */
export function useDevToolsAllowlist(wsId: string) {
  useEventInvalidation((event) => {
    if (event.type === 'devtools.catalog_changed') return [allowlistKey(wsId)];
    if (event.type === 'workspace.dev_tool_unattended_allow_changed' && event.workspaceId === wsId) return [allowlistKey(wsId)];
    return [];
  });
  return useQuery({ queryKey: allowlistKey(wsId), queryFn: () => fetchDevToolsAllowlist(wsId), retry: false });
}

export { CATALOG_KEY as DEV_TOOLS_QUERY_KEY, allowlistKey as devToolsAllowlistQueryKey };
