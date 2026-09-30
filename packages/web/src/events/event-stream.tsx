import { ServerMessage, type ClientMessage, type CoreEvent } from '@ogden-agents/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addEvent } from './fold';

/**
 * `connecting` before the first connection; `connected` while the socket is
 * open; `reconnecting` once the socket has been gone for RECONNECTING_AFTER_MS
 * (EXPERIENCE.md State Patterns: Reconnecting).
 */
export type ServerStatus = 'connecting' | 'connected' | 'reconnecting';

export const RECONNECT_DELAY_MS = 1000;
export const RECONNECTING_AFTER_MS = 2000;

interface EventStreamValue {
  status: ServerStatus;
  events: readonly CoreEvent[];
  /** Highest `seq` received; the next (re)connect subscribes after it. */
  lastSeq: number;
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
  /** Highest `seq` received; survives reconnects. */
  const lastSeq = useRef(0);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let slow: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const markDown = () => {
      if (slow === undefined) {
        slow = setTimeout(() => {
          if (!disposed) setStatus('reconnecting');
        }, RECONNECTING_AFTER_MS);
      }
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

    markDown();
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(slow);
      socket?.close();
    };
  }, []);

  const value = useMemo(() => ({ status, events, lastSeq: lastSeqState }), [status, events, lastSeqState]);
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
