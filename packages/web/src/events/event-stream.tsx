import {
  API_ROUTES,
  DEFAULT_WINDOW_EVENTS,
  ServerMessage,
  WorkspacesResponse,
  type ClientMessage,
  type CoreEvent,
  type HistoryPageMessage,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call } from '@/chat/chat-api';
import { createPendingPages, type PageRequest, type PendingPages } from './pending-pages';
import {
  applyCaughtUp,
  applyEvent,
  applyHistoryPage,
  beginConnection,
  emptyStore,
  mergedEvents,
  pageCursor,
  streamEvents,
  type EventStoreState,
} from './event-store';

/**
 * `connecting` before the first connection; `connected` while the socket is
 * open; `reconnecting` once the socket has been gone for RECONNECTING_AFTER_MS
 * (EXPERIENCE.md State Patterns: Reconnecting); `stopped` once the server said
 * it is stopping, or has been unreachable for UNREACHABLE_AFTER_MS, after
 * which it never reconnects (see {@link StoppedReason}); `not-connected` when
 * this tab has no token, or the server refused it (a bookmark, a new tab, a
 * restarted server), so it shows "Open Ogden Agents" and never connects.
 */
export type ServerStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped' | 'not-connected';

/** Why the page shows the stopped state: Quit, a restart for an update, or no server for too long. */
export type StoppedReason = 'quit' | 'restart' | 'unreachable';

export const RECONNECT_DELAY_MS = 1000;
/** The longest wait between reconnects while the workspace list keeps failing. */
export const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * The wait before the next reconnect after the workspace list failed again:
 * 1 s, doubling each time, at most {@link MAX_RECONNECT_DELAY_MS}.
 */
export function nextReconnectDelay(previous: number | undefined): number {
  return previous === undefined ? RECONNECT_DELAY_MS : Math.min(previous * 2, MAX_RECONNECT_DELAY_MS);
}
export const RECONNECTING_AFTER_MS = 2000;
/** How long the server may stay unreachable before the page stops retrying and says so. */
export const UNREACHABLE_AFTER_MS = 60_000;

/** What "Show earlier" asks for when it loads one page. */
export const EARLIER_PAGE_EVENTS = DEFAULT_WINDOW_EVENTS;

const DROPPED = 'The connection to Ogden Agents dropped. Try again.';

interface EventStreamValue {
  status: ServerStatus;
  /**
   * Every scope's events merged in `seq` order: the install-level events and
   * each workspace's window plus any pages loaded. Not the whole history.
   */
  events: readonly CoreEvent[];
  /** The events per scope, for {@link useSessionEvents} and {@link useEarlierHistory}. */
  store: EventStoreState;
  /** Highest `seq` received in any scope. */
  lastSeq: number;
  /** True once the current connection's backlog has all arrived: the install scope and every workspace (`caught_up`). */
  caughtUp: boolean;
  /** Loads one page of older history for the workspace, or one of its sessions. */
  loadEarlier(wsId: string, sesId?: string): Promise<void>;
  /** Why the server stopped, once `status` is `stopped`. */
  stoppedReason: StoppedReason | undefined;
  /** Close the socket for good and show the stopped state. */
  markStopped(reason: StoppedReason): void;
}

const EventStreamContext = createContext<EventStreamValue | null>(null);

/**
 * The UI's one WebSocket to the event log (AD-5 as amended in story 2.9). On
 * every (re)connect it subscribes to the install-level events after the last
 * `seq` it has, lists the workspaces and subscribes to each one's recent
 * window (after its last `seq` on a reconnect), and to each new one as it is
 * created. Older history is paged on demand. It never applies an event twice.
 */
export function EventStreamProvider({ children, auth = tabAuth }: { children: ReactNode; auth?: TabAuth }) {
  const [status, setStatus] = useState<ServerStatus>(() => (auth.token() === undefined ? 'not-connected' : 'connecting'));
  const [store, setStore] = useState<EventStoreState>(emptyStore);
  const [caughtUp, setCaughtUp] = useState(false);
  const [stoppedReason, setStoppedReason] = useState<StoppedReason | undefined>(undefined);
  /** The events per scope; survives reconnects. The source of truth, mirrored into `store`. */
  const storeRef = useRef<EventStoreState>(store);
  /** Closes the socket for good; set by the effect below. */
  const stopRef = useRef<(reason: StoppedReason) => void>(() => {});
  /** Sends one `page_history` on the open socket; set by the effect below. */
  const requestRef = useRef<(message: PageRequest) => Promise<HistoryPageMessage>>(() => Promise.reject(new Error(DROPPED)));

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let slow: ReturnType<typeof setTimeout> | undefined;
    let gone: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    /** The open connection's workspace subscriptions, whether it has listed the workspaces, and its pending pages. */
    let connection:
      | {
          ws: WebSocket;
          subscribed: Set<string>;
          listed: boolean;
          pending: PendingPages;
        }
      | undefined;
    /**
     * The wait before the next reconnect: {@link RECONNECT_DELAY_MS}, or
     * longer while the workspace list keeps failing; reset once it loads.
     */
    let reconnectDelay = RECONNECT_DELAY_MS;
    /** The backoff's last step while the workspace list keeps failing; `undefined` once it has loaded. */
    let listBackoff: number | undefined;

    const update = (change: (state: EventStoreState) => EventStoreState) => {
      storeRef.current = change(storeRef.current);
      setStore(storeRef.current);
      const current = connection;
      const state = storeRef.current;
      setCaughtUp(
        current !== undefined &&
          current.listed &&
          state.install.caughtUp &&
          [...current.subscribed].every((wsId) => state.workspaces.get(wsId)?.caughtUp === true),
      );
    };

    /** Rejects the dropped connection's pending pages. */
    const dropConnection = () => {
      if (connection === undefined) return;
      connection.pending.rejectAll(new Error(DROPPED));
      connection = undefined;
    };

    const sendOn = (ws: WebSocket, message: ClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    /** Subscribes the connection to one workspace: its window, or after its last `seq` on a reconnect. */
    const subscribeWorkspace = (wsId: WorkspaceId) => {
      if (connection === undefined || connection.subscribed.has(wsId)) return;
      connection.subscribed.add(wsId);
      const known = storeRef.current.workspaces.get(wsId);
      sendOn(connection.ws, { type: 'subscribe_workspace', workspaceId: wsId, ...(known?.synced ? { afterSeq: known.lastSeq } : {}) });
      update((state) => state);
    };

    requestRef.current = (request) => {
      const current = connection;
      if (current === undefined || current.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(DROPPED));
      return current.pending.request(request);
    };

    const shutDown = () => {
      if (disposed) return false;
      disposed = true;
      clearTimeout(retry);
      clearTimeout(slow);
      clearTimeout(gone);
      socket?.close();
      dropConnection();
      return true;
    };

    const stop = (reason: StoppedReason) => {
      if (!shutDown()) return;
      setStoppedReason(reason);
      setStatus('stopped');
    };

    /** The server doesn't know this tab (or it has no token): show the launch state for good. */
    const notConnected = () => {
      if (!shutDown()) return;
      setStatus('not-connected');
    };

    const markDown = () => {
      if (slow === undefined) {
        slow = setTimeout(() => {
          if (!disposed) setStatus('reconnecting');
        }, RECONNECTING_AFTER_MS);
      }
      // Not forever: a server that stays away has stopped.
      gone ??= setTimeout(() => stop('unreachable'), UNREACHABLE_AFTER_MS);
    };

    /**
     * After the socket closed or was refused: a browser can't see the HTTP
     * status of a refused upgrade, so ask the API whether this tab's token is
     * still good. 401 forgets it (the launch state); no answer means the
     * server is down, so keep retrying.
     */
    const afterClose = () => {
      auth.fetch(API_ROUTES.tabCheck).then(
        (response) => {
          if (disposed) return;
          if (response.status === 401) return; // forget() already moved this tab to the launch state.
          retry = setTimeout(connect, reconnectDelay);
        },
        () => {
          if (!disposed) retry = setTimeout(connect, reconnectDelay);
        },
      );
    };

    const connect = () => {
      const protocols = auth.webSocketProtocols();
      if (protocols === undefined) {
        notConnected();
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`, protocols);
      socket = ws;

      ws.addEventListener('open', () => {
        const current = {
          ws,
          subscribed: new Set<string>(),
          listed: false,
          pending: createPendingPages((page) => sendOn(ws, page)),
        };
        connection = current;
        update(beginConnection);
        sendOn(ws, { type: 'subscribe_install', afterSeq: storeRef.current.install.lastSeq });
        clearTimeout(slow);
        slow = undefined;
        clearTimeout(gone);
        gone = undefined;
        setStatus('connected');
        call(auth, API_ROUTES.workspaces, {}, "Ogden Agents couldn't load your projects").then(
          (json) => {
            if (connection !== current) return;
            for (const workspace of WorkspacesResponse.parse(json).workspaces) subscribeWorkspace(workspace.id);
            current.listed = true;
            listBackoff = undefined;
            reconnectDelay = RECONNECT_DELAY_MS;
            update((state) => state);
          },
          (error: unknown) => {
            if (connection !== current) return;
            // Without the list this connection can't follow every project: start
            // over, waiting longer each time it fails again.
            console.warn('could not list the workspaces to subscribe to', error);
            listBackoff = nextReconnectDelay(listBackoff);
            reconnectDelay = listBackoff;
            ws.close();
          },
        );
      });
      ws.addEventListener('message', (message: MessageEvent) => {
        let json: unknown;
        try {
          json = JSON.parse(String(message.data));
        } catch {
          console.warn('ignoring non-JSON server message');
          return;
        }
        const parsed = ServerMessage.safeParse(json);
        if (!parsed.success) {
          console.warn('ignoring server message that fails the shared schema', parsed.error.issues);
          return;
        }
        const data = parsed.data;
        if (connection?.ws !== ws) return;
        if (data.type === 'pong') return;
        if (data.type === 'caught_up') {
          update((state) => applyCaughtUp(state, data));
          return;
        }
        if (data.type === 'server.stopping') {
          stop(data.reason);
          return;
        }
        if (data.type === 'history_page') {
          connection.pending.resolve(data);
          return;
        }
        if (data.type === 'request_failed') {
          if (data.requestId !== undefined) {
            connection.pending.reject(data.requestId, new Error(data.message));
          } else if (data.for === 'subscribe_workspace' && data.workspaceId !== undefined) {
            // A workspace that no longer exists: stop waiting for it.
            console.warn('could not follow a project', data.code);
            connection.subscribed.delete(data.workspaceId);
            update((state) => state);
          }
          return;
        }
        update((state) => applyEvent(state, data));
        // A project added in any tab: follow it too.
        if (data.type === 'workspace.created') subscribeWorkspace(data.workspaceId);
      });
      ws.addEventListener('close', () => {
        if (connection?.ws === ws) {
          dropConnection();
          setCaughtUp(false);
        }
        if (disposed) return;
        markDown();
        afterClose();
      });
    };

    stopRef.current = stop;
    const unsubscribe = auth.onForget(notConnected);

    if (auth.token() === undefined) {
      notConnected();
      return unsubscribe;
    }
    markDown();
    connect();
    return () => {
      unsubscribe();
      disposed = true;
      clearTimeout(retry);
      clearTimeout(slow);
      clearTimeout(gone);
      socket?.close();
      dropConnection();
    };
  }, [auth]);

  const markStopped = useCallback((reason: StoppedReason) => stopRef.current(reason), []);
  const loadEarlier = useCallback(async (wsId: string, sesId?: string) => {
    const cursor = pageCursor(storeRef.current, wsId, sesId);
    if (!cursor.hasEarlier || cursor.beforeSeq === null) return;
    // Route params, unchecked so far: the request is validated against the
    // shared schema before it is sent, and an invalid one fails at once.
    const page = await requestRef.current({
      workspaceId: wsId as WorkspaceId,
      ...(sesId === undefined ? {} : { sessionId: sesId as SessionId }),
      beforeSeq: cursor.beforeSeq,
      limit: EARLIER_PAGE_EVENTS,
    });
    storeRef.current = applyHistoryPage(storeRef.current, page, sesId);
    setStore(storeRef.current);
  }, []);
  const events = useMemo(() => mergedEvents(store), [store]);
  const value = useMemo(() => {
    let lastSeq = store.install.lastSeq;
    for (const workspace of store.workspaces.values()) lastSeq = Math.max(lastSeq, workspace.lastSeq);
    return { status, events, store, lastSeq, caughtUp, loadEarlier, stoppedReason, markStopped };
  }, [status, events, store, caughtUp, loadEarlier, stoppedReason, markStopped]);
  return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>;
}

export function useEventStream(): EventStreamValue {
  const context = useContext(EventStreamContext);
  if (context === null) throw new Error('useEventStream must be used inside <EventStreamProvider>');
  return context;
}

/** The live connection to the local server, for the sidebar footer. */
export function useServerStatus(): ServerStatus {
  return useEventStream().status;
}

/**
 * The running server's version: the one in the latest `server.started` event
 * (AD-20), or `undefined` before any has arrived.
 */
export function latestServerVersion(events: readonly CoreEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === 'server.started') return event.payload.version;
  }
  return undefined;
}

/** The server's version, but only once the backlog has been replayed; `undefined` until then. */
export function useServerVersion(): string | undefined {
  const { events, caughtUp } = useEventStream();
  return caughtUp ? latestServerVersion(events) : undefined;
}

/**
 * One session's events in its workspace's window (plus any pages loaded).
 * The array keeps its identity while other sessions stream, so a view
 * memoized on it recomputes only for its own session.
 */
export function useSessionEvents(wsId: string, sesId: string): readonly CoreEvent[] {
  return streamEvents(useEventStream().store, wsId, sesId);
}

export interface EarlierHistory {
  /** Whether older events exist than those loaded. */
  hasEarlier: boolean;
  loading: boolean;
  /** Why the last load failed, in plain words. */
  error: string | undefined;
  /** Loads one more page of older history ("Show earlier"). */
  loadEarlier(): void;
}

/** "Show earlier" for a workspace, or for one of its sessions (story 2.10 renders it). */
export function useEarlierHistory(wsId: string, sesId?: string): EarlierHistory {
  const { store, loadEarlier } = useEventStream();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = useRef(false);
  const load = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(undefined);
    loadEarlier(wsId, sesId)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : DROPPED))
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [loadEarlier, wsId, sesId]);
  return { hasEarlier: pageCursor(store, wsId, sesId).hasEarlier, loading, error, loadEarlier: load };
}
