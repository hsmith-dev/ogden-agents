import { apiPath, TERMINAL_SOCKET_ROUTE, TerminalServerFrame, type TerminalClientFrame } from '@ogden-agents/shared';
import { tabAuth, type TabAuth } from '@/auth/tab-token';

/**
 * The terminal WebSocket of one session (story 3.1, AD-6): the tab's token
 * goes as a subprotocol, as on the event socket, never in the URL. Binary
 * frames carry the terminal's bytes both ways; text frames carry control
 * (`attach` and `resize` out, `exit` and `size` in). Nothing here keeps or logs what goes through.
 */

/** The largest binary frame this sends: a long paste goes in several. */
const MAX_FRAME_BYTES = 64 * 1024;

export interface TerminalSocketHandlers {
  /** The viewer's terminal size, sent as the `attach` frame the moment the socket opens (story 3.6). */
  size(): { cols: number; rows: number };
  /** The socket is open and `attach` was sent. */
  onOpen(): void;
  /** Bytes the terminal printed. */
  onBytes(bytes: Uint8Array): void;
  /** The terminal ended (`null`: it was stopped, such as by switching back). */
  onExit(exitCode: number | null): void;
  /** Another viewer resized the terminal: follow its size (`size` frame, story 3.2's contract). */
  onSize(cols: number, rows: number): void;
  /** The socket closed, with its close code. */
  onClose(code: number): void;
}

export interface TerminalConnection {
  /** Types `text` into the terminal. */
  type(text: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/** Connects to the session's terminal, or `undefined` when this tab has no token. */
export function connectTerminal(sesId: string, handlers: TerminalSocketHandlers, auth: Pick<TabAuth, 'webSocketProtocols'> = tabAuth): TerminalConnection | undefined {
  const protocols = auth.webSocketProtocols();
  if (protocols === undefined) return undefined;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${scheme}//${window.location.host}${apiPath(TERMINAL_SOCKET_ROUTE, { sesId })}`, protocols);
  ws.binaryType = 'arraybuffer';
  const encoder = new TextEncoder();
  const control = (frame: TerminalClientFrame) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  ws.addEventListener('open', () => {
    // The first frame is always `attach` with the size, so the server can size the terminal before replaying it (story 3.5).
    const { cols, rows } = handlers.size();
    control({ type: 'attach', cols, rows });
    handlers.onOpen();
  });
  ws.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) {
      handlers.onBytes(new Uint8Array(event.data));
      return;
    }
    if (typeof event.data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }
    // Anything else (the server's `server.stopping`, a malformed frame) is not for the terminal.
    const frame = TerminalServerFrame.safeParse(json);
    if (!frame.success) return;
    if (frame.data.type === 'exit') handlers.onExit(frame.data.exitCode);
    else handlers.onSize(frame.data.cols, frame.data.rows);
  });
  ws.addEventListener('close', (event) => handlers.onClose(event.code));
  return {
    type(text) {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = encoder.encode(text);
      for (let start = 0; start < bytes.length; start += MAX_FRAME_BYTES) ws.send(bytes.subarray(start, start + MAX_FRAME_BYTES));
    },
    resize: (cols, rows) => control({ type: 'resize', cols, rows }),
    close: () => ws.close(),
  };
}
