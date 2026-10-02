import { API_ROUTES, apiPath, BmadPiecesResponse, WorkspaceSettingsResponse, type BmadPiece, type BmadPieceAvailability, type CautionLevel, type WorkspaceSettings } from '@ogden-agents/shared';
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
    if (event.type === 'workspace.settings_changed') return [['workspace-settings', wsId]];
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
