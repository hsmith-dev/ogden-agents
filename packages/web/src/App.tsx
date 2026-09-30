import { ServerMessage, type ClientMessage, type CoreEvent } from '@ogden-agents/shared';
import { useEffect, useRef, useState } from 'react';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const RECONNECT_DELAY_MS = 1000;

/**
 * Folds one event into the list: events already seen (by `seq`) are dropped,
 * a completed message replaces its deltas (AD-5), and a workspace's deleted
 * history is dropped from the list.
 */
function addEvent(previous: CoreEvent[], event: CoreEvent): CoreEvent[] {
  let next = previous;
  if (event.type === 'session.message_completed') {
    const { messageId } = event.payload;
    next = next.filter(
      (e) => !(e.type === 'session.message_delta' && e.streamId === event.streamId && e.payload.messageId === messageId),
    );
  } else if (event.type === 'workspace.history_deleted') {
    next = next.filter((e) => e.workspaceId !== event.workspaceId);
  }
  return [...next, event];
}

/**
 * Tracer-bullet page: lists logged events arriving over `/ws`. Unstyled until
 * stories 1.5-1.6. On every (re)connect it subscribes after the last `seq` it
 * has, so it receives exactly what it missed and never shows an event twice.
 */
export function App() {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [events, setEvents] = useState<CoreEvent[]>([]);
  /** Highest `seq` received; survives reconnects. */
  const lastSeq = useRef(0);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket = ws;
      setConnection('connecting');

      ws.addEventListener('open', () => {
        const subscribe: ClientMessage = { type: 'subscribe', afterSeq: lastSeq.current };
        ws.send(JSON.stringify(subscribe));
        setConnection('connected');
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
        setEvents((previous) => addEvent(previous, data));
      });
      ws.addEventListener('close', () => {
        if (disposed) return;
        setConnection('disconnected');
        retry = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return (
    <main>
      <h1>Ogden Agents</h1>
      <p>
        Connection: <strong data-testid="connection-state">{connection}</strong>
      </p>
      <h2>Events</h2>
      {events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ol>
          {events.map((event) => (
            <li key={event.seq}>
              #{event.seq} <code>{event.type}</code> at <time dateTime={event.at}>{event.at}</time>
              {event.type === 'server.started' ? <> (version {event.payload.version})</> : null}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
