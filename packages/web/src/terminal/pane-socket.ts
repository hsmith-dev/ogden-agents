import { apiPath, PANE_SOCKET_ROUTE, PaneServerFrame, type PaneState, type PaneStatus, type TerminalClientFrame } from '@ogden-agents/shared';
import { tabAuth, type TabAuth } from '@/auth/tab-token';

/**
 * The WebSocket of one terminal pane (epic 16, story 16.2): as the session
 * terminal's (`terminal-socket.ts`; the tab's token goes as a subprotocol,
 * never in the URL; binary frames carry bytes both ways, text frames carry
 * control), plus `reset` (what follows is the pane's screen as it is now),
 * `state` and an `exit` that does not close the socket. Nothing here keeps or
 * logs what goes through.
 */

/** The largest binary frame this sends: a long paste goes in several. */
const MAX_FRAME_BYTES = 64 * 1024;

export interface PaneSocketHandlers {
  /** The viewer's terminal size, sent as the `attach` frame the moment the socket opens. */
  size(): { cols: number; rows: number };
  onOpen(): void;
  /** Bytes the pane printed (after a reset, the screen so far first). */
  onBytes(bytes: Uint8Array): void;
  /** What follows replaces what is shown: the viewer resets its terminal. */
  onReset(): void;
  onState(state: PaneState, status?: PaneStatus): void;
  /** The pane's program ended (`null`: it was stopped). The socket stays open. */
  onExit(exitCode: number | null): void;
  /** Another viewer resized the pane: follow its size. */
  onSize(cols: number, rows: number): void;
  onClose(code: number): void;
}

export interface PaneConnection {
  type(text: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/** Connects to the pane's socket, or `undefined` when this tab has no token. */
export function connectPane(paneId: string, handlers: PaneSocketHandlers, auth: Pick<TabAuth, 'webSocketProtocols'> = tabAuth): PaneConnection | undefined {
  const protocols = auth.webSocketProtocols();
  if (protocols === undefined) return undefined;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${scheme}//${window.location.host}${apiPath(PANE_SOCKET_ROUTE, { paneId })}`, protocols);
  ws.binaryType = 'arraybuffer';
  const encoder = new TextEncoder();
  const control = (frame: TerminalClientFrame) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  };
  ws.addEventListener('open', () => {
    // Always `attach` first, with the size, so the server sizes the pane before it sends the screen.
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
    const frame = PaneServerFrame.safeParse(json);
    if (!frame.success) return;
    switch (frame.data.type) {
      case 'reset':
        handlers.onReset();
        break;
      case 'state':
        handlers.onState(frame.data.state, frame.data.status);
        break;
      case 'exit':
        handlers.onExit(frame.data.exitCode);
        break;
      case 'size':
        handlers.onSize(frame.data.cols, frame.data.rows);
        break;
    }
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
