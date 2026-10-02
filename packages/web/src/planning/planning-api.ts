import {
  API_ROUTES,
  apiPath,
  BMAD_DOWNLOAD_OFFLINE_MESSAGE,
  BOARD_LOAD_FAILED,
  BmadSourceResponse,
  CatalogResponse,
  PLAN_LOAD_FAILED,
  PLAN_START_FAILED,
  SessionResponse,
  TICKET_LOAD_FAILED,
  TicketResponse,
  TicketsResponse,
  type Catalog,
  type Session,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';

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

/** `GET /api/v1/workspaces/:wsId/tickets/:ref`: one ticket with its entry's text (story 4.9's detail sheet). */
export async function fetchTicket(wsId: string, ref: string, auth: Auth = tabAuth): Promise<TicketResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceTicket, { wsId, ref }), {}, TICKET_LOAD_FAILED);
  return TicketResponse.parse(json);
}

/**
 * `POST /api/v1/bmad/source`: downloads and verifies the pinned BMad Method
 * (story 4.14), only because the user clicked Download BMad Method.
 */
export async function downloadBmadSource(auth: Auth = tabAuth): Promise<BmadSourceResponse> {
  const json = await call(auth, API_ROUTES.bmadSource, { method: 'POST' }, BMAD_DOWNLOAD_OFFLINE_MESSAGE);
  return BmadSourceResponse.parse(json);
}

/** The project's catalog. */
export function useCatalog(wsId: string) {
  return useQuery({ queryKey: ['catalog', wsId], queryFn: () => fetchCatalog(wsId), retry: false });
}

/** The project's tickets. */
export function useTickets(wsId: string) {
  return useQuery({ queryKey: ['tickets', wsId], queryFn: () => fetchTickets(wsId), retry: false });
}

/** One ticket's detail. */
export function useTicket(wsId: string, ref: string) {
  return useQuery({ queryKey: ['ticket', wsId, ref], queryFn: () => fetchTicket(wsId, ref), retry: false });
}

/** How long a changed card's status line stays highlighted (EXPERIENCE.md Board). */
export const BOARD_HIGHLIGHT_MS = 1200;

const NO_REFS: ReadonlySet<string> = new Set();

/**
 * The board's live updates (story 4.9, AD-7): each `ticket.changed` of this
 * workspace that arrives after mount makes the tickets and that ticket's
 * detail stale (they refetch over REST) and highlights its ref for
 * {@link BOARD_HIGHLIGHT_MS} once the refetched tickets have landed. Events already in the stream at mount are in
 * the first fetch, so they are skipped; the backlog a (re)connection replays
 * refetches but highlights nothing (it isn't a live change); other
 * workspaces' are ignored. Returns the refs highlighted now.
 */
export function useBoardEvents(wsId: string): ReadonlySet<string> {
  const { events, caughtUp } = useEventStream();
  const queryClient = useQueryClient();
  const seen = useRef(events.at(-1)?.seq ?? 0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(NO_REFS);
  const mounted = useRef(true);

  useEffect(() => {
    const changed = new Set<string>();
    for (const event of events) {
      if (event.seq <= seen.current) continue;
      if (event.type === 'ticket.changed' && event.workspaceId === wsId) changed.add(event.payload.ref);
    }
    seen.current = Math.max(seen.current, events.at(-1)?.seq ?? 0);
    if (changed.size === 0) return;
    const refetched = queryClient.invalidateQueries({ queryKey: ['tickets', wsId], exact: true });
    for (const ref of changed) void queryClient.invalidateQueries({ queryKey: ['ticket', wsId, ref], exact: true });
    if (!caughtUp) return;
    // The highlight starts once the new tickets have landed, so it lands on the new status line.
    void refetched
      .catch(() => {})
      .then(() => {
        if (!mounted.current) return;
        for (const ref of changed) {
          const previous = timers.current.get(ref);
          if (previous !== undefined) clearTimeout(previous);
          timers.current.set(
            ref,
            setTimeout(() => {
              timers.current.delete(ref);
              setHighlighted((current) => {
                if (!current.has(ref)) return current;
                const next = new Set(current);
                next.delete(ref);
                return next;
              });
            }, BOARD_HIGHLIGHT_MS),
          );
        }
        setHighlighted((current) => new Set([...current, ...changed]));
      });
  }, [events, caughtUp, queryClient, wsId]);

  useEffect(() => {
    const pending = timers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return highlighted;
}
