import {
  API_ROUTES,
  apiPath,
  BmadPiecesResponse,
  SCRIPT_TRUST_FAILED,
  WorkspaceSettingsResponse,
  type BmadPiece,
  type BmadPieceAvailability,
  type CautionLevel,
  type PermissionMode,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, fetchPermissionRules } from '@/chat/chat-api';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/**
 * The workspace settings REST calls (story 2.8), sent with this tab's token,
 * and the queries built on them. The event log only invalidates them (AD-7),
 * so a level changed or a rule added or removed in any tab shows up here.
 */

type Auth = Pick<TabAuth, 'fetch'>;

/** `GET /api/v1/workspaces/:wsId/settings`. */
export async function fetchWorkspaceSettings(wsId: string, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceSettings, { wsId }), {}, "Ogden Agents couldn't load this project's settings");
  return WorkspaceSettingsResponse.parse(json).settings;
}

/**
 * `PATCH /api/v1/workspaces/:wsId/settings`: the agent the project's new
 * chats preselect (epic 6, entry 6), or `null` for the install's default.
 */
export async function updateDefaultAgent(wsId: string, defaultAgentId: string | null, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.workspaceSettings, { wsId }),
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultAgentId }) },
    "The default agent couldn't be saved",
  );
  return WorkspaceSettingsResponse.parse(json).settings;
}

/**
 * `PATCH /api/v1/workspaces/:wsId/settings`: the mode the project's new
 * chats start in (default permission mode). Skip all carries `confirm`, the
 * user's answer to its red warning; the server refuses it without that or
 * without Developer mode.
 */
export async function updateDefaultPermissionMode(wsId: string, defaultPermissionMode: PermissionMode, confirm: boolean, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.workspaceSettings, { wsId }),
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultPermissionMode, ...(confirm ? { confirm: true } : {}) }),
    },
    "The default permission mode couldn't be saved",
  );
  return WorkspaceSettingsResponse.parse(json).settings;
}

/** `PATCH /api/v1/workspaces/:wsId/settings`: the new caution level, for requests not yet shown. */
export async function updateCautionLevel(wsId: string, cautionLevel: CautionLevel, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.workspaceSettings, { wsId }),
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cautionLevel }) },
    "The caution level couldn't be saved",
  );
  return WorkspaceSettingsResponse.parse(json).settings;
}

/**
 * `PATCH /api/v1/workspaces/:wsId/settings`: the BMad pieces the project has
 * on (story 10.1). The server's guard, not this page, decides what runs (AD-22).
 */
export async function updateBmadPieces(wsId: string, bmadPieces: readonly BmadPiece[], auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(
    auth,
    apiPath(API_ROUTES.workspaceSettings, { wsId }),
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bmadPieces }) },
    "The BMad Method setting couldn't be saved",
  );
  return WorkspaceSettingsResponse.parse(json).settings;
}

/**
 * `PUT /api/v1/workspaces/:wsId/bmad/script-trust` (story 4.2): the user
 * allows Ogden Agents to run this project's own BMad Method scripts, once
 * for the project. Answers the settings, now trusted.
 */
export async function trustProjectScripts(wsId: string, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }), { method: 'PUT' }, SCRIPT_TRUST_FAILED);
  return WorkspaceSettingsResponse.parse(json).settings;
}

/**
 * `GET /api/v1/bmad/pieces` (story 10.2): every BMad Method piece, in order,
 * each available on this install or coming soon. Install-wide, so it is the
 * same for every project and never changes while the server runs.
 */
export async function fetchBmadPieces(auth: Auth = tabAuth): Promise<BmadPieceAvailability[]> {
  const json = await call(auth, API_ROUTES.bmadPieces, {}, "Ogden Agents couldn't check which BMad Method features it has");
  return BmadPiecesResponse.parse(json).pieces;
}

/** Which BMad Method pieces this install ships; fetched once per page load. */
export function useBmadPieces() {
  return useQuery({ queryKey: ['bmad-pieces'], queryFn: () => fetchBmadPieces(), retry: false, staleTime: Number.POSITIVE_INFINITY });
}

/** Numbers requests so only the latest one's answer is used; an earlier one's is stale. */
export function createLatestGate() {
  let last = 0;
  return {
    next: (): number => ++last,
    isLatest: (ticket: number): boolean => ticket === last,
  };
}

/** Invalidates this workspace's settings and rules on each new settings or rule event. */
function useSettingsInvalidation(wsId: string): void {
  useEventInvalidation((event) => {
    if (event.workspaceId !== wsId) return [];
    // The script trust (story 4.2) is part of the settings: allowed in another tab, this one follows.
    if (event.type === 'workspace.settings_changed' || event.type === 'workspace.bmad_scripts_trusted') return [['workspace-settings', wsId]];
    if (event.type === 'workspace.permission_rule_added' || event.type === 'workspace.permission_rule_removed') return [['permission-rules', wsId]];
    return [];
  });
}

/** The workspace's settings, kept current from the event stream. */
export function useWorkspaceSettings(wsId: string) {
  useSettingsInvalidation(wsId);
  return useQuery({ queryKey: ['workspace-settings', wsId], queryFn: () => fetchWorkspaceSettings(wsId), retry: false });
}

/** The workspace's always-allow rules, oldest first, kept current from the event stream. */
export function usePermissionRules(wsId: string) {
  useSettingsInvalidation(wsId);
  return useQuery({ queryKey: ['permission-rules', wsId], queryFn: () => fetchPermissionRules(wsId), retry: false });
}
