import { ServerMessage, type ClientMessage, type CoreEvent, type SessionState } from '@ogden-agents/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addEvent } from './fold';

/**
 * `connecting` before the first connection; `connected` while the socket is
 * open; `reconnecting` once the socket has been gone for RECONNECTING_AFTER_MS
 * (EXPERIENCE.md State Patterns: Reconnecting); `stopped` once the server said
 * it is stopping, or has been unreachable for UNREACHABLE_AFTER_MS, after
 * which it never reconnects (see {@link StoppedReason}).
 */
export type ServerStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

/** Why the page shows the stopped state: Quit, a restart for an update, or no server for too long. */
export type StoppedReason = 'quit' | 'restart' | 'unreachable';

export const RECONNECT_DELAY_MS = 1000;
export const RECONNECTING_AFTER_MS = 2000;
/** How long the server may stay unreachable before the page stops retrying and says so. */
export const UNREACHABLE_AFTER_MS = 60_000;

interface EventStreamValue {
  status: ServerStatus;
  events: readonly CoreEvent[];
  /** Highest `seq` received; the next (re)connect subscribes after it. */
  lastSeq: number;
  /** True once the current connection's backlog has all arrived (`caught_up`). */
  caughtUp: boolean;
  /** Why the server stopped, once `status` is `stopped`. */
  stoppedReason: StoppedReason | undefined;
  /** Close the socket for good and show the stopped state. */
  markStopped(reason: StoppedReason): void;
}

const EventStreamContext = createContext<EventStreamValue | null>(null);

/**
 * The UI's one WebSocket to the event log (AD-5). On every (re)connect it
 * subscribes after the last `seq` it has, so reconnecting and catching up are
 * the same call, and it never applies an event twice.
 */
export function EventStreamProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ServerStatus>('connecting');
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [lastSeqState, setLastSeqState] = useState(0);
  const [caughtUp, setCaughtUp] = useState(false);
  const [stoppedReason, setStoppedReason] = useState<StoppedReason | undefined>(undefined);
  /** Highest `seq` received; survives reconnects. */
  const lastSeq = useRef(0);
  /** Closes the socket for good; set by the effect below. */
  const stopRef = useRef<(reason: StoppedReason) => void>(() => {});

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let slow: ReturnType<typeof setTimeout> | undefined;
    let gone: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const stop = (reason: StoppedReason) => {
      if (disposed) return;
      disposed = true;
      clearTimeout(retry);
      clearTimeout(slow);
      clearTimeout(gone);
      socket?.close();
      setStoppedReason(reason);
      setStatus('stopped');
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

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket = ws;

      ws.addEventListener('open', () => {
        const subscribe: ClientMessage = { type: 'subscribe', afterSeq: lastSeq.current };
        ws.send(JSON.stringify(subscribe));
        clearTimeout(slow);
        slow = undefined;
        clearTimeout(gone);
        gone = undefined;
        setCaughtUp(false);
        setStatus('connected');
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
        if (data.type === 'pong') return;
        if (data.type === 'caught_up') {
          setCaughtUp(true);
          return;
        }
        if (data.type === 'server.stopping') {
          stop(data.reason);
          return;
        }
        if (data.seq <= lastSeq.current) return;
        lastSeq.current = data.seq;
        setLastSeqState(data.seq);
        setEvents((previous) => addEvent(previous, data));
      });
      ws.addEventListener('close', () => {
        if (disposed) return;
        markDown();
        retry = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    stopRef.current = stop;

    markDown();
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(slow);
      clearTimeout(gone);
      socket?.close();
    };
  }, []);

  const markStopped = useCallback((reason: StoppedReason) => stopRef.current(reason), []);
  const value = useMemo(
    () => ({ status, events, lastSeq: lastSeqState, caughtUp, stoppedReason, markStopped }),
    [status, events, lastSeqState, caughtUp, stoppedReason, markStopped],
  );
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

const BUSY: ReadonlySet<SessionState> = new Set(['working', 'waiting']);

/**
 * Sessions that are `working` or `waiting` (AD-4), from their latest state in
 * the events. A deleted workspace's events are already folded out.
 */
export function busySessionCount(events: readonly CoreEvent[]): number {
  const states = new Map<string, SessionState>();
  for (const event of events) {
    if (event.type === 'session.created') states.set(event.payload.session.id, event.payload.session.state);
    else if (event.type === 'session.state_changed') states.set(event.payload.sessionId, event.payload.state);
  }
  let busy = 0;
  for (const state of states.values()) if (BUSY.has(state)) busy++;
  return busy;
}
