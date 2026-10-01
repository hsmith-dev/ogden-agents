/**
 * The terminal WebSocket, `/ws/terminal/:sesId` (story 3.1, AD-6): carries a
 * session's terminal while the terminal drives it. The gate has already
 * checked the upgrade exactly as for `/ws` (Host, the tab-token subprotocol,
 * Origin; AD-15), and the server echoes only `ogden.v1`.
 *
 * - Binary frames are bytes: from the client they are typed into the
 *   terminal, from the server they are what it printed. A new viewer first
 *   gets the recent output core kept.
 * - Text frames are JSON control frames: `attach` (the viewer's first, with
 *   its size) and `resize` in; `exit` out (then the socket closes,
 *   {@link TERMINAL_CLOSE}.ended) and `size` (another viewer resized; story
 *   3.5 sends it). Story 3.2's stub takes `attach` as a resize; story 3.5
 *   orders reattaching around it. A frame that fails its schema is ignored.
 * - An unknown session, or one the terminal does not drive, is closed at
 *   once ({@link TERMINAL_CLOSE}.notTerminal). A frame over its size limit
 *   closes the socket (1009); so does the server's `maxPayload` before a
 *   larger one is buffered. A viewer more than {@link MAX_VIEWER_BUFFERED_BYTES}
 *   behind is closed ({@link TERMINAL_CLOSE}.slowViewer) and reattaches.
 * - Closing the socket never stops the terminal: the server owns it until
 *   the session switches back or the server stops.
 *
 * Nothing here logs, events or stores a frame's contents (AD-16): only that
 * a viewer came or went, and why a frame was refused.
 */
import { upgradeWebSocket } from '@hono/node-server';
import type { Chat, TerminalViewer } from '@ogden-agents/core';
import {
  MAX_TERMINAL_CONTROL_BYTES,
  MAX_TERMINAL_INPUT_BYTES,
  SessionId,
  TERMINAL_CLOSE,
  TERMINAL_SOCKET_ROUTE,
  TerminalClientFrame,
  TerminalServerFrame,
} from '@ogden-agents/shared';
import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { webSocketToken, type TabTokens } from './auth.js';
import type { Logger } from './log.js';

const WS_OPEN = 1;
/** The standard close code for a message too big to process. */
const TOO_BIG = 1009;
/**
 * The most output a viewer may leave unsent before it is closed
 * ({@link TERMINAL_CLOSE}.slowViewer; story 3.1 review F2), so a stalled tab
 * never makes the server buffer a flooding CLI's output without bound. The
 * CLI is not paused: `ws` has no drain event and node-pty's pause is not
 * reliable on every platform, and one slow tab must not stall the others.
 */
export const MAX_VIEWER_BUFFERED_BYTES = 1024 * 1024;

export interface TerminalSocketOptions {
  chat: Chat;
  log: Logger;
  /** The tab tokens the gate checks: an open terminal socket holds its tab's token, as `/ws` does. */
  tabs?: TabTokens | undefined;
}

export function registerTerminalSocket(app: Hono, { chat, log, tabs }: TerminalSocketOptions): void {
  app.get(
    TERMINAL_SOCKET_ROUTE,
    upgradeWebSocket((c) => {
      const parsedId = SessionId.safeParse(c.req.param('sesId'));
      const sessionId = parsedId.success ? parsedId.data : undefined;
      // The gate verified this token; holding it keeps a connected tab's token alive.
      const token = webSocketToken(c.req.header('sec-websocket-protocol'));
      let release: (() => void) | undefined;
      let viewer: TerminalViewer | undefined;
      const unsubscribe: Array<() => void> = [];
      let closed = false;
      const end = () => {
        closed = true;
        for (const off of unsubscribe.splice(0)) off();
        viewer = undefined;
        release?.();
        release = undefined;
      };
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const close = (ws: WSContext, code: number, reason: string) => {
        end();
        try {
          ws.close(code, reason);
        } catch {
          // Already closing.
        }
      };

      /** One frame from the viewer: bytes to type, or a control frame. */
      const receive = (ws: WSContext, target: TerminalViewer, data: unknown) => {
        if (typeof data === 'string') {
          if (Buffer.byteLength(data) > MAX_TERMINAL_CONTROL_BYTES) {
            log.warn('terminal control frame too large; closing', { sessionId });
            close(ws, TOO_BIG, 'too_large');
            return;
          }
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            log.warn('ignoring an unreadable terminal control frame', { sessionId });
            return;
          }
          const frame = TerminalClientFrame.safeParse(json);
          if (!frame.success) {
            // Its issues are not logged: they could quote what was sent.
            log.warn('ignoring a terminal control frame that fails the shared schema', { sessionId });
            return;
          }
          // `attach` and `resize` both size the terminal for now (story 3.2; 3.5 owns attaching).
          target.resize(frame.data.cols, frame.data.rows);
          return;
        }
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
        if (bytes === undefined) return;
        if (bytes.byteLength > MAX_TERMINAL_INPUT_BYTES) {
          log.warn('terminal input frame too large; closing', { sessionId });
          close(ws, TOO_BIG, 'too_large');
          return;
        }
        target.write(decoder.decode(bytes, { stream: true }));
      };

      return {
        onOpen(_event, ws) {
          release = tabs?.hold(token);
          viewer = sessionId === undefined ? undefined : chat.attachTerminal(sessionId);
          if (viewer === undefined) {
            close(ws, TERMINAL_CLOSE.notTerminal, 'not_terminal');
            return;
          }
          log.info('terminal viewer attached', { sessionId });
          const sendBytes = (data: string) => {
            if (closed || ws.readyState !== WS_OPEN) return;
            ws.send(encoder.encode(data));
            const buffered = (ws.raw as { bufferedAmount?: number } | undefined)?.bufferedAmount ?? 0;
            if (buffered > MAX_VIEWER_BUFFERED_BYTES) {
              log.warn('terminal viewer fell behind; closing it', { sessionId });
              close(ws, TERMINAL_CLOSE.slowViewer, 'slow_viewer');
            }
          };
          if (viewer.backlog !== '') sendBytes(viewer.backlog);
          unsubscribe.push(viewer.onData(sendBytes));
          unsubscribe.push(
            viewer.onEnd(({ exitCode }) => {
              const frame = TerminalServerFrame.parse({ type: 'exit', exitCode });
              if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(frame));
              close(ws, TERMINAL_CLOSE.ended, 'ended');
            }),
          );
        },

        onMessage(event, ws) {
          if (closed || viewer === undefined) return;
          try {
            receive(ws, viewer, event.data);
          } catch (error) {
            // Never the frame itself: only that handling it failed.
            log.warn('a terminal frame could not be handled', { sessionId, error: error instanceof Error ? error.name : 'unknown' });
          }
        },

        onClose() {
          if (viewer !== undefined) log.info('terminal viewer left', { sessionId });
          end();
        },

        onError(event) {
          log.warn('terminal websocket error', { sessionId, error: String((event as Event & { error?: unknown }).error ?? event.type) });
          end();
        },
      };
    }),
  );
}
