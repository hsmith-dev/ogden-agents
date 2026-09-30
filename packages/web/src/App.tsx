import { ServerMessage } from '@ogdenmad/shared';
import { useEffect, useState } from 'react';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const RECONNECT_DELAY_MS = 1000;

/** Tracer-bullet page: lists server events arriving live over `/ws`. Unstyled until stories 1.5-1.6. */
export function App() {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [messages, setMessages] = useState<ServerMessage[]>([]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      setConnection('connecting');

      socket.addEventListener('open', () => {
        // The server replays its latest event on every connect; start fresh to avoid duplicates.
        setMessages([]);
        setConnection('connected');
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        let json: unknown;
        try {
          json = JSON.parse(String(event.data));
        } catch {
          console.warn('ignoring non-JSON server message');
          return;
        }
        const parsed = ServerMessage.safeParse(json);
        if (!parsed.success) {
          console.warn('ignoring server message that fails the shared schema', parsed.error.issues);
          return;
        }
        setMessages((previous) => [...previous, parsed.data]);
      });
      socket.addEventListener('close', () => {
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
      <h1>OgdenMad</h1>
      <p>
        Connection: <strong data-testid="connection-state">{connection}</strong>
      </p>
      <h2>Events</h2>
      {messages.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ol>
          {messages.map((message, index) => (
            <li key={index}>
              <code>{message.type}</code> at <time dateTime={message.at}>{message.at}</time>
              {message.type === 'server.started' ? <> (version {message.version})</> : null}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
