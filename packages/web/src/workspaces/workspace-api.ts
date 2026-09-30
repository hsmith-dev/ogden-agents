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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, postJson } from '@/chat/chat-api';
import { useEventStream } from '@/events/event-stream';

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
  const { events } = useEventStream();
  const queryClient = useQueryClient();
  // What is already in the stream when the lists mount is already in their first fetch.
  const seen = useRef(events.at(-1)?.seq ?? 0);
  useEffect(() => {
    let workspaces = false;
    const sessions = new Set<string>();
    for (const event of events) {
      if (event.seq <= seen.current) continue;
      if (event.type === 'workspace.created') workspaces = true;
      else if ((event.type === 'session.created' || event.type === 'workspace.history_deleted') && event.workspaceId !== null) sessions.add(event.workspaceId);
    }
    seen.current = Math.max(seen.current, events.at(-1)?.seq ?? 0);
    if (workspaces) void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    for (const wsId of sessions) void queryClient.invalidateQueries({ queryKey: ['sessions', wsId] });
  }, [events, queryClient]);
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
