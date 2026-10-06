import { TERMINAL_SOCKET_ROUTE, TerminalServerFrame } from '@ogden-agents/shared';
import type { TabAuth } from '@/auth/tab-token';
import { openTerminalWebSocket, type TerminalConnection } from './terminal-websocket';

export type { TerminalConnection };

/**
 * The terminal WebSocket of one session (story 3.1, AD-6), on the shared
 * terminal socket (`terminal-websocket.ts`): `exit` and `size` come in.
 */

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

/** Connects to the session's terminal, or `undefined` when this tab has no token. */
export function connectTerminal(sesId: string, handlers: TerminalSocketHandlers, auth?: Pick<TabAuth, 'webSocketProtocols'>): TerminalConnection | undefined {
  return openTerminalWebSocket(
    TERMINAL_SOCKET_ROUTE,
    { sesId },
    {
      size: handlers.size,
      onOpen: handlers.onOpen,
      onBytes: handlers.onBytes,
      onClose: handlers.onClose,
      onFrame(json) {
        // Anything else (the server's `server.stopping`, a malformed frame) is not for the terminal.
        const frame = TerminalServerFrame.safeParse(json);
        if (!frame.success) return;
        if (frame.data.type === 'exit') handlers.onExit(frame.data.exitCode);
        else handlers.onSize(frame.data.cols, frame.data.rows);
      },
    },
    ...(auth === undefined ? [] : [auth]),
  );
}
