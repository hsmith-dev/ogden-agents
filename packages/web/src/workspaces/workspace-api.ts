import {
  API_ROUTES,
  apiPath,
  CreateFolderResponse,
  FolderListing,
  HistoryDeletedResponse,
  SessionsResponse,
  WorkspaceResponse,
  WorkspacesResponse,
  type Session,
  type SessionState,
  type Workspace,
} from '@ogden-agents/shared';
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, postJson } from '@/api/http';
import { useEventStream } from '@/events/event-stream';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/**
 * The workspace REST calls (story 2.5), sent with this tab's token, and the
 * lists built on them. REST reads go through TanStack Query; the event log
 * only invalidates them (AD-7), so a project added or a chat started in any
 * tab shows up here without a reload.
 */

type Auth = Pick<TabAuth, 'fetch'>;

/** A workspace's display name: the last segment of its real path, on `/` or `\`. */
export function workspaceName(workspace: Pick<Workspace, 'path' | 'realPath'>): string {
  const path = (workspace.realPath || workspace.path).replace(/[\\/]+$/, '');
  return path.split(/[\\/]/).at(-1) || path || workspace.path;
}

/** `GET /api/v1/workspaces`. */
export async function fetchWorkspaces(auth: Auth = tabAuth): Promise<Workspace[]> {
  const json = await call(auth, API_ROUTES.workspaces, {}, "Ogden Agents couldn't load your projects");
  return WorkspacesResponse.parse(json).workspaces;
}

/** `GET /api/v1/workspaces/:wsId`. */
export async function fetchWorkspace(wsId: string, auth: Auth = tabAuth): Promise<Workspace> {
  const json = await call(auth, apiPath(API_ROUTES.workspace, { wsId }), {}, "Ogden Agents couldn't load this project");
  return WorkspaceResponse.parse(json).workspace;
}

/** `GET /api/v1/workspaces/:wsId/sessions`. */
export async function fetchSessions(wsId: string, auth: Auth = tabAuth): Promise<Session[]> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceSessions, { wsId }), {}, "Ogden Agents couldn't load this project's chats");
  return SessionsResponse.parse(json).sessions;
}

/** `DELETE /api/v1/workspaces/:wsId/history`: refused (409) while a chat is working or waiting. */
export async function deleteHistory(wsId: string, auth: Auth = tabAuth): Promise<HistoryDeletedResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceHistory, { wsId }), { method: 'DELETE' }, "Ogden Agents couldn't delete the history");
  return HistoryDeletedResponse.parse(json);
}

/** `GET /api/v1/folders?path=`: the folder and its subfolders; without `path`, the home folder. */
export async function listFolders(path?: string, auth: Auth = tabAuth): Promise<FolderListing> {
  const url = path === undefined ? API_ROUTES.folders : `${API_ROUTES.folders}?${new URLSearchParams({ path }).toString()}`;
  const json = await call(auth, url, {}, "Ogden Agents couldn't open that folder");
  return FolderListing.parse(json);
}

/** `POST /api/v1/folders`: Start a new project folder; returns its path. */
export async function createFolder(parent: string, name: string, auth: Auth = tabAuth): Promise<string> {
  const json = await call(auth, API_ROUTES.folders, postJson({ parent, name }), "Ogden Agents couldn't create that folder");
  return CreateFolderResponse.parse(json).path;
}

/**
 * Invalidates `['workspaces']` on `workspace.created`, and `['sessions', wsId]`
 * on `session.created` and `workspace.history_deleted`, for each new event.
 */
function useListInvalidation(): void {
  useEventInvalidation((event) => {
    if (event.type === 'workspace.created') return [['workspaces']];
    if ((event.type === 'session.created' || event.type === 'workspace.history_deleted') && event.workspaceId !== null) return [['sessions', event.workspaceId]];
    return [];
  });
}

/** Every workspace, kept current from the event stream. */
export function useWorkspaces() {
  useListInvalidation();
  return useQuery({ queryKey: ['workspaces'], queryFn: () => fetchWorkspaces() });
}

/**
 * The workspace's sessions, newest first, each with its live state from the
 * event stream (AD-4), kept current as chats start or the history is deleted.
 */
export function useSessions(wsId: string) {
  useListInvalidation();
  const { events } = useEventStream();
  const query = useQuery({ queryKey: ['sessions', wsId], queryFn: () => fetchSessions(wsId), retry: false });
  const sessions = useMemo(() => {
    if (query.data === undefined) return undefined;
    const states = new Map<string, SessionState>();
    for (const event of events) {
      if (event.workspaceId !== wsId) continue;
      if (event.type === 'session.state_changed') states.set(event.payload.sessionId, event.payload.state);
    }
    return [...query.data]
      .map((session) => ({ ...session, state: states.get(session.id) ?? session.state }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }, [query.data, events, wsId]);
  return { ...query, sessions };
}

const BUSY: ReadonlySet<SessionState> = new Set(['working', 'waiting']);

/** Whether a session's agent is `working` or `waiting` (AD-4). */
export const isBusy = (session: Pick<Session, 'state'>): boolean => BUSY.has(session.state);

/** Stable, so TanStack Query keeps the combined result's identity while nothing changes. */
const combineSessionLists = (results: UseQueryResult<Session[]>[]) => results.map((result) => ({ data: result.data, error: result.isError }));

export interface AllSessions {
  sessions: Session[];
  /** The workspaces whose session list has not loaded (still loading, or failed until the next retry). */
  unloaded: ReadonlySet<string>;
  /** Whether the workspace list itself has not loaded yet. */
  loading: boolean;
}

/**
 * Every workspace's sessions: the REST lists (story 2.5), with each
 * session's live state from the event stream laid over them (AD-4). The
 * stream holds only each workspace's recent window, so a state older than
 * the window comes from REST; a chat started since the lists loaded comes
 * from its `session.created` until the refetch lands. A state change also
 * moves the session's `updatedAt` to the event's time. A list that failed is
 * fetched again whenever the stream catches up (a reconnect).
 */
export function useAllSessionsStatus(): AllSessions {
  const workspaces = useWorkspaces();
  const { events, caughtUp } = useEventStream();
  const queryClient = useQueryClient();
  const lists = useQueries({
    queries: (workspaces.data ?? []).map((workspace) => ({
      queryKey: ['sessions', workspace.id],
      queryFn: () => fetchSessions(workspace.id),
      retry: false,
    })),
    combine: combineSessionLists,
  });
  const failed = (workspaces.data ?? []).filter((_workspace, i) => lists[i]?.error === true).map((workspace) => workspace.id).join(' ');
  useEffect(() => {
    if (!caughtUp) return;
    if (workspaces.isError) void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    for (const wsId of failed.split(' ').filter(Boolean)) void queryClient.invalidateQueries({ queryKey: ['sessions', wsId] });
  }, [caughtUp, failed, workspaces.isError, queryClient]);
  const sessions = useMemo(() => {
    const byId = new Map<string, Session>();
    for (const list of lists) for (const session of list.data ?? []) byId.set(session.id, session);
    for (const event of events) {
      if (event.type === 'session.created') {
        if (!byId.has(event.payload.session.id)) byId.set(event.payload.session.id, event.payload.session);
      } else if (event.type === 'session.state_changed') {
        const session = byId.get(event.payload.sessionId);
        if (session !== undefined) byId.set(session.id, { ...session, state: event.payload.state, updatedAt: event.at > session.updatedAt ? event.at : session.updatedAt });
      } else if (event.type === 'session.model_changed') {
        // Story 11: the row's tooltip names the chat's model.
        const session = byId.get(event.payload.sessionId);
        if (session !== undefined) {
          const { model: _previous, ...rest } = session;
          byId.set(session.id, event.payload.model === null ? rest : { ...rest, model: event.payload.model });
        }
      } else if (event.type === 'workspace.history_deleted') {
        for (const [id, session] of byId) if (session.workspaceId === event.workspaceId) byId.delete(id);
      }
    }
    return [...byId.values()];
  }, [lists, events]);
  const unloaded = useMemo(
    () => new Set((workspaces.data ?? []).filter((_workspace, i) => lists[i]?.data === undefined).map((workspace) => workspace.id)),
    [workspaces.data, lists],
  );
  return { sessions, unloaded, loading: workspaces.data === undefined };
}
