import {
  API_ROUTES,
  apiPath,
  TeamRosterViewResponse,
  WorkspaceSettingsResponse,
  type TeamRoster,
  type TeamRosterViewResponse as RosterAnswer,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

type Auth = Pick<TabAuth, 'fetch'>;

const json = { 'content-type': 'application/json' };

/** `GET …/orchestration/roster`: the project's roster as the screen shows it. */
export async function fetchProjectRoster(wsId: string, auth: Auth = tabAuth): Promise<RosterAnswer> {
  return TeamRosterViewResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceTeamRoster, { wsId }), {}, "Ogden Agents couldn't load the team"));
}

/** `PATCH …/settings`: saves the whole roster of the project. The server refuses a role that cannot be taken, with its reason. */
export async function saveProjectRoster(wsId: string, roster: TeamRoster, auth: Auth = tabAuth): Promise<WorkspaceSettings> {
  const body = JSON.stringify({ orchestrationRoster: roster });
  return WorkspaceSettingsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceSettings, { wsId }), { method: 'PATCH', headers: json, body }, "The team couldn't be saved")).settings;
}

/** `GET /settings/team-roster`: the roster new projects start with. */
export async function fetchDefaultRoster(auth: Auth = tabAuth): Promise<RosterAnswer> {
  return TeamRosterViewResponse.parse(await call(auth, API_ROUTES.teamRosterDefault, {}, "Ogden Agents couldn't load the team for new projects"));
}

/** `PUT /settings/team-roster`: saves the roster new projects start with. */
export async function saveDefaultRoster(roster: TeamRoster, auth: Auth = tabAuth): Promise<RosterAnswer> {
  const body = JSON.stringify({ roster });
  return TeamRosterViewResponse.parse(await call(auth, API_ROUTES.teamRosterDefault, { method: 'PUT', headers: json, body }, "The team for new projects couldn't be saved"));
}

/** What changes who can take a role: the project's settings, the servers, an agent signing in or out, the default. */
const changesRoster = (wsId: string | undefined) => (event: { type: string; workspaceId: string | null }): boolean =>
  (event.type === 'workspace.settings_changed' && (wsId === undefined || event.workspaceId === wsId)) ||
  event.type === 'settings.local_endpoints_changed' ||
  event.type === 'settings.team_roster_default_changed' ||
  event.type.startsWith('agent.');

export function useProjectRoster(wsId: string) {
  useEventInvalidation((event) => (changesRoster(wsId)(event) ? [['team-roster', wsId]] : []));
  return useQuery({ queryKey: ['team-roster', wsId], queryFn: () => fetchProjectRoster(wsId), retry: false, refetchOnMount: 'always' as const });
}

export function useDefaultRoster() {
  useEventInvalidation((event) => (changesRoster(undefined)(event) ? [['team-roster-default']] : []));
  return useQuery({ queryKey: ['team-roster-default'], queryFn: () => fetchDefaultRoster(), retry: false, refetchOnMount: 'always' as const });
}
