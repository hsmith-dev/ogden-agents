import type { CaughtUpMessage, CoreEvent, HistoryPageMessage } from '@ogden-agents/shared';
import { addEvent } from './fold';

/**
 * The UI's events, kept per subscription scope (E2-R8, story 2.9): the
 * install-level stream (with every `workspace.created`), and for each
 * workspace its recent window plus any older pages loaded with "Show
 * earlier". Pure: every `apply*` returns a new state and leaves the old one
 * untouched, and a list that did not change keeps its identity.
 */

/** One scope's events and where paging stands. */
export interface ScopeState {
  /** In `seq` order, deduplicated. */
  events: readonly CoreEvent[];
  /** Highest `seq` received live or in a backlog; a reconnect subscribes after it. */
  lastSeq: number;
  /** The oldest `seq` loaded (window or pages), or `null` when there is none. */
  oldestSeq: number | null;
  /** Whether older events exist before `oldestSeq`. */
  hasEarlier: boolean;
  /** True once this connection's backlog for the scope has arrived. */
  caughtUp: boolean;
  /** True once any connection's backlog has arrived; later `caught_up`s keep the paging cursor. */
  synced: boolean;
}

export interface WorkspaceState extends ScopeState {
  /** Each stream's (session's) events. A stream no event touched keeps its array. */
  streams: ReadonlyMap<string, readonly CoreEvent[]>;
  /** The `seq` of the last `workspace.history_deleted`: nothing older may come back. */
  floorSeq: number;
}

/** Where "Show earlier" pages from: before `beforeSeq`, if `hasEarlier`. */
export interface PageCursor {
  beforeSeq: number | null;
  hasEarlier: boolean;
}

export interface EventStoreState {
  install: ScopeState;
  workspaces: ReadonlyMap<string, WorkspaceState>;
  /** Session paging cursors, keyed `wsId/sesId`; a workspace's own is its `oldestSeq` and `hasEarlier`. */
  sessionCursors: ReadonlyMap<string, PageCursor>;
}

const NO_EVENTS: readonly CoreEvent[] = Object.freeze([]);

const emptyScope = (): ScopeState => ({ events: NO_EVENTS, lastSeq: 0, oldestSeq: null, hasEarlier: false, caughtUp: false, synced: false });
const emptyWorkspace = (): WorkspaceState => ({ ...emptyScope(), streams: new Map(), floorSeq: 0 });

export function emptyStore(): EventStoreState {
  return { install: emptyScope(), workspaces: new Map(), sessionCursors: new Map() };
}

const sessionKey = (wsId: string, sesId: string) => `${wsId}/${sesId}`;

function withWorkspace(state: EventStoreState, wsId: string, workspace: WorkspaceState): EventStoreState {
  const workspaces = new Map(state.workspaces);
  workspaces.set(wsId, workspace);
  return { ...state, workspaces };
}

/** Whether an event belongs to the install scope: install-level, or a `workspace.created`. */
const isInstallEvent = (event: CoreEvent) => event.workspaceId === null || event.type === 'workspace.created';

/**
 * A new connection: every scope waits for its `caught_up` again. A workspace
 * whose window never finished arriving is dropped, so its fresh window is
 * taken whole rather than deduplicated against a partial one.
 */
export function beginConnection(state: EventStoreState): EventStoreState {
  const workspaces = new Map<string, WorkspaceState>();
  for (const [wsId, workspace] of state.workspaces) if (workspace.synced) workspaces.set(wsId, { ...workspace, caughtUp: false });
  return { ...state, install: { ...state.install, caughtUp: false }, workspaces };
}

/**
 * Folds one received event into its scope. An event at or below the scope's
 * `lastSeq` was already applied and is ignored. A completed message replaces
 * its deltas, and a workspace's deleted history empties that workspace.
 */
export function applyEvent(state: EventStoreState, event: CoreEvent): EventStoreState {
  if (isInstallEvent(event)) {
    let next = state;
    if (event.seq > state.install.lastSeq) {
      next = { ...state, install: { ...state.install, events: [...state.install.events, event], lastSeq: event.seq } };
    }
    // A workspace's window can include its own `workspace.created`: it counts as received there too.
    const workspace = event.workspaceId === null ? undefined : next.workspaces.get(event.workspaceId);
    if (workspace !== undefined && event.seq > workspace.lastSeq) next = withWorkspace(next, event.workspaceId!, { ...workspace, lastSeq: event.seq });
    return next;
  }
  const wsId = event.workspaceId!;
  const workspace = state.workspaces.get(wsId) ?? emptyWorkspace();
  if (event.seq <= workspace.lastSeq) return state;
  if (event.type === 'workspace.history_deleted') {
    const sessionCursors = new Map([...state.sessionCursors].filter(([key]) => !key.startsWith(`${wsId}/`)));
    return {
      ...withWorkspace(state, wsId, {
        ...workspace,
        events: [event],
        lastSeq: event.seq,
        oldestSeq: event.seq,
        hasEarlier: false,
        streams: new Map([[event.streamId, [event]]]),
        floorSeq: event.seq,
      }),
      sessionCursors,
    };
  }
  const streams = new Map(workspace.streams);
  streams.set(event.streamId, addEvent(workspace.streams.get(event.streamId) ?? NO_EVENTS, event));
  return withWorkspace(state, wsId, {
    ...workspace,
    events: addEvent(workspace.events, event),
    lastSeq: event.seq,
    oldestSeq: workspace.oldestSeq ?? event.seq,
    streams,
  });
}

/**
 * A scope's backlog has all arrived. The first `caught_up` of a scope sets
 * its paging cursor; a reconnect's keeps the one the store already has.
 */
export function applyCaughtUp(state: EventStoreState, message: CaughtUpMessage): EventStoreState {
  const { scope } = message;
  if (scope === undefined) return state; // The legacy `subscribe`, which the web no longer sends.
  const cursor = (current: ScopeState) =>
    current.synced ? {} : { oldestSeq: message.oldestSeq ?? current.oldestSeq, hasEarlier: message.hasEarlier ?? false };
  if (scope === 'install') return { ...state, install: { ...state.install, ...cursor(state.install), caughtUp: true, synced: true } };
  const workspace = state.workspaces.get(scope) ?? emptyWorkspace();
  return withWorkspace(state, scope, { ...workspace, ...cursor(workspace), caughtUp: true, synced: true });
}

/** Merges `older` into `list` by `seq`, dropping any `seq` already there. Both are in `seq` order. */
function mergeBySeq(list: readonly CoreEvent[], older: readonly CoreEvent[]): readonly CoreEvent[] {
  if (older.length === 0) return list;
  const merged: CoreEvent[] = [];
  let i = 0;
  let j = 0;
  while (i < list.length || j < older.length) {
    const a = list[i];
    const b = older[j];
    if (b === undefined || (a !== undefined && a.seq < b.seq)) {
      merged.push(a!);
      i++;
    } else if (a !== undefined && a.seq === b.seq) {
      merged.push(a);
      i++;
      j++;
    } else {
      merged.push(b);
      j++;
    }
  }
  return merged;
}

/**
 * One page of older history (for the workspace, or for one of its sessions
 * with `sesId`), merged in by `seq` with duplicates dropped. It moves that
 * cursor back to the page's oldest event; `hasMore` says whether more exist.
 */
export function applyHistoryPage(state: EventStoreState, page: Pick<HistoryPageMessage, 'workspaceId' | 'events' | 'hasMore'>, sesId?: string): EventStoreState {
  const wsId = page.workspaceId;
  const workspace = state.workspaces.get(wsId);
  if (workspace === undefined) return state;
  // Never resurrect deleted history: a page from before the deletion changes nothing.
  const current = page.events.filter((event) => event.workspaceId === wsId && event.seq > workspace.floorSeq && event.seq <= workspace.lastSeq);
  if (page.events.length > 0 && current.length === 0) return state;
  // `workspace.created` stays in the install scope.
  const fresh = current.filter((event) => event.type !== 'workspace.created');
  const byStream = new Map<string, CoreEvent[]>();
  for (const event of fresh) {
    const list = byStream.get(event.streamId) ?? [];
    list.push(event);
    byStream.set(event.streamId, list);
  }
  const streams = new Map(workspace.streams);
  for (const [streamId, events] of byStream) streams.set(streamId, mergeBySeq(workspace.streams.get(streamId) ?? NO_EVENTS, events));
  const pageOldest = current[0]?.seq ?? null;
  const oldest = (current: number | null) => (pageOldest === null ? current : current === null ? pageOldest : Math.min(current, pageOldest));

  if (sesId === undefined) {
    return withWorkspace(state, wsId, {
      ...workspace,
      events: mergeBySeq(workspace.events, fresh),
      streams: byStream.size === 0 ? workspace.streams : streams,
      oldestSeq: oldest(workspace.oldestSeq),
      hasEarlier: page.hasMore,
    });
  }
  const cursor = pageCursor(state, wsId, sesId);
  const sessionCursors = new Map(state.sessionCursors);
  sessionCursors.set(sessionKey(wsId, sesId), { beforeSeq: oldest(cursor.beforeSeq), hasEarlier: page.hasMore });
  return {
    ...withWorkspace(state, wsId, { ...workspace, events: mergeBySeq(workspace.events, fresh), streams: byStream.size === 0 ? workspace.streams : streams }),
    sessionCursors,
  };
}

/** Where the next "Show earlier" for the workspace (or one of its sessions) pages from. */
export function pageCursor(state: EventStoreState, wsId: string, sesId?: string): PageCursor {
  const workspace = state.workspaces.get(wsId);
  if (workspace === undefined) return { beforeSeq: null, hasEarlier: false };
  const own: PageCursor = { beforeSeq: workspace.oldestSeq, hasEarlier: workspace.hasEarlier };
  if (sesId === undefined) return own;
  const session = state.sessionCursors.get(sessionKey(wsId, sesId));
  if (session === undefined) return own;
  // Paging the whole workspace back further also loaded the session's events there.
  if (workspace.oldestSeq !== null && (session.beforeSeq === null || workspace.oldestSeq < session.beforeSeq)) {
    return { beforeSeq: workspace.oldestSeq, hasEarlier: session.hasEarlier && workspace.hasEarlier };
  }
  return session;
}

/** One session's (stream's) events. The array keeps its identity until an event of that stream arrives. */
export function streamEvents(state: EventStoreState, wsId: string, sesId: string): readonly CoreEvent[] {
  return state.workspaces.get(wsId)?.streams.get(sesId) ?? NO_EVENTS;
}

let lastMerge: { lists: readonly (readonly CoreEvent[])[]; merged: readonly CoreEvent[] } | undefined;

/**
 * Every scope's events as one list in `seq` order, for the readers that fold
 * across scopes. Memoized: the same lists give the same array.
 */
export function mergedEvents(state: EventStoreState): readonly CoreEvent[] {
  const lists = [state.install.events, ...[...state.workspaces.values()].map((workspace) => workspace.events)];
  if (lastMerge !== undefined && lastMerge.lists.length === lists.length && lastMerge.lists.every((list, i) => list === lists[i])) return lastMerge.merged;
  const all = lists.flat().sort((a, b) => a.seq - b.seq);
  const merged = all.filter((event, i) => i === 0 || all[i - 1]!.seq !== event.seq);
  lastMerge = { lists, merged };
  return merged;
}
