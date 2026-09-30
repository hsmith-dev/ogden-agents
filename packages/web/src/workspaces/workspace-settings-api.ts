import { API_ROUTES, apiPath, WorkspaceSettingsResponse, type CautionLevel, type WorkspaceSettings } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, fetchPermissionRules } from '@/chat/chat-api';
import { useEventStream } from '@/events/event-stream';

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
  const { events } = useEventStream();
  const queryClient = useQueryClient();
  const seen = useRef(events.at(-1)?.seq ?? 0);
  useEffect(() => {
    let settings = false;
    let rules = false;
    for (const event of events) {
      if (event.seq <= seen.current || event.workspaceId !== wsId) continue;
      if (event.type === 'workspace.settings_changed') settings = true;
      else if (event.type === 'workspace.permission_rule_added' || event.type === 'workspace.permission_rule_removed') rules = true;
    }
    seen.current = Math.max(seen.current, events.at(-1)?.seq ?? 0);
    if (settings) void queryClient.invalidateQueries({ queryKey: ['workspace-settings', wsId] });
    if (rules) void queryClient.invalidateQueries({ queryKey: ['permission-rules', wsId] });
  }, [events, queryClient, wsId]);
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
