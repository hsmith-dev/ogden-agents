import { PANE_SOCKET_ROUTE, PaneServerFrame, type PaneState, type PaneStatus } from '@ogden-agents/shared';
import type { TabAuth } from '@/auth/tab-token';
import { openTerminalWebSocket, type TerminalConnection } from './terminal-websocket';

/**
 * The WebSocket of one terminal pane (epic 16, story 16.2), on the shared
 * terminal socket (`terminal-websocket.ts`), plus `reset` (what follows is the pane's screen as it is now),
 * `state` and an `exit` that does not close the socket. Nothing here keeps or
 * logs what goes through.
 */

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

export type PaneConnection = TerminalConnection;

/** Connects to the pane's socket, or `undefined` when this tab has no token. */
export function connectPane(paneId: string, handlers: PaneSocketHandlers, auth?: Pick<TabAuth, 'webSocketProtocols'>): PaneConnection | undefined {
  return openTerminalWebSocket(
    PANE_SOCKET_ROUTE,
    { paneId },
    {
      size: handlers.size,
      onOpen: handlers.onOpen,
      onBytes: handlers.onBytes,
      onClose: handlers.onClose,
      onFrame(json) {
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
      },
    },
    ...(auth === undefined ? [] : [auth]),
  );
}
