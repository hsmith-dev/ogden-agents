import {
  API_ROUTES,
  apiPath,
  OrchestrationActivityResponse,
  OrchestrationDefaultsResponse,
  WorkspaceSettingsResponse,
  type OrchestrationActivityEntry,
  type OrchestrationDefaults,
  type OrchestrationMode,
  type RunLimits,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

type Auth = Pick<TabAuth, 'fetch'>;
const json = { 'content-type': 'application/json' };

/**
 * `PATCH …/settings`: the project's orchestration mode. Dispatch automatically carries `confirm` the first time in a project (the user's
 * answer to the question); the server asks for it only when the project never confirmed, and refuses without it.
 */
export async function saveProjectMode(wsId: string, orchestrationMode: OrchestrationMode, confirm: boolean, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const body = JSON.stringify({ orchestrationMode, ...(confirm ? { confirm: true } : {}) });
  return WorkspaceSettingsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceSettings, { wsId }), { method: 'PATCH', headers: json, body }, "The mode couldn't be saved")).settings;
}

/** `GET /settings/orchestration`: the mode new projects are offered and the limits of every run. */
export async function fetchOrchestrationDefaults(auth: Auth = tabAuth): Promise<OrchestrationDefaults> {
  return OrchestrationDefaultsResponse.parse(await call(auth, API_ROUTES.orchestrationDefaults, {}, "Ogden Agents couldn't load the orchestration defaults")).defaults;
}

/** `PUT /settings/orchestration`: the default mode and/or the limits. Dispatch automatically as the default carries `confirm`. */
export async function saveOrchestrationDefaults(change: { mode?: OrchestrationMode; limits?: Partial<RunLimits>; confirm?: boolean }, auth: Auth = tabAuth): Promise<OrchestrationDefaults> {
  const body = JSON.stringify(change);
  return OrchestrationDefaultsResponse.parse(await call(auth, API_ROUTES.orchestrationDefaults, { method: 'PUT', headers: json, body }, "The orchestration defaults couldn't be saved")).defaults;
}

/** `GET …/orchestration/activity`: every instruction sent or refused, newest first. */
export async function fetchOrchestrationActivity(wsId: string, auth: Auth = tabAuth): Promise<OrchestrationActivityEntry[]> {
  return OrchestrationActivityResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceOrchestrationActivity, { wsId }), {}, "Ogden Agents couldn't load the activity log")).entries;
}

export function useOrchestrationDefaults() {
  useEventInvalidation((event) => (event.type === 'settings.orchestration_defaults_changed' ? [['orchestration-defaults']] : []));
  return useQuery({ queryKey: ['orchestration-defaults'], queryFn: () => fetchOrchestrationDefaults(), retry: false, refetchOnMount: 'always' as const });
}

/** The activity log, kept current from the run's events and the worker chats' state changes (a result settles on a read). */
export function useOrchestrationActivity(wsId: string) {
  useEventInvalidation((event) => (event.workspaceId === wsId && (event.type.startsWith('orchestration.') || event.type === 'session.state_changed') ? [['orchestration-activity', wsId]] : []));
  return useQuery({ queryKey: ['orchestration-activity', wsId], queryFn: () => fetchOrchestrationActivity(wsId), retry: false });
}
