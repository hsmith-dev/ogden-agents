import {
  API_ROUTES,
  apiPath,
  BOARD_LOAD_FAILED,
  CatalogResponse,
  PLAN_LOAD_FAILED,
  PLAN_START_FAILED,
  SessionResponse,
  TicketsResponse,
  type Catalog,
  type Session,
} from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/**
 * The Plan and Board REST calls (story 4.1), sent with this tab's token, and
 * the queries built on them. Tickets are fetched, never carried in events (AD-7).
 */

/** `GET /api/v1/workspaces/:wsId/catalog`: the project's catalog (story 4.2: modules, skills, agents, entry action, capabilities). */
export async function fetchCatalog(wsId: string, auth: Auth = tabAuth): Promise<Catalog> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceCatalog, { wsId }), {}, PLAN_LOAD_FAILED);
  return CatalogResponse.parse(json);
}

/**
 * `POST /api/v1/workspaces/:wsId/planning-sessions`: a planning session on
 * `skill`, its first message already sent, with the user's `idea` when given.
 */
export async function startPlanningSession(wsId: string, skill: string, idea?: string, auth: Auth = tabAuth): Promise<Session> {
  const json = await call(auth, apiPath(API_ROUTES.workspacePlanningSessions, { wsId }), postJson(idea === undefined ? { skill } : { skill, idea }), PLAN_START_FAILED);
  return SessionResponse.parse(json).session;
}

/** `GET /api/v1/workspaces/:wsId/tickets`: the project's tickets as BMad Method reports them. */
export async function fetchTickets(wsId: string, auth: Auth = tabAuth): Promise<TicketsResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceTickets, { wsId }), {}, BOARD_LOAD_FAILED);
  return TicketsResponse.parse(json);
}

/** The project's catalog. */
export function useCatalog(wsId: string) {
  return useQuery({ queryKey: ['catalog', wsId], queryFn: () => fetchCatalog(wsId), retry: false });
}

/** The project's tickets. */
export function useTickets(wsId: string) {
  return useQuery({ queryKey: ['tickets', wsId], queryFn: () => fetchTickets(wsId), retry: false });
}
