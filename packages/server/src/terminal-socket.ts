/**
 * The terminal WebSocket, `/ws/terminal/:sesId` (story 3.1, AD-6): carries a
 * session's terminal while the terminal drives it. The gate has already
 * checked the upgrade exactly as for `/ws` (Host, the tab-token subprotocol,
 * Origin; AD-15), and the server echoes only `ogden.v1`.
 *
 * - Binary frames are bytes: from the client they are typed into the
 *   terminal, from the server they are what it printed.
 * - Text frames are JSON control frames: `attach` (the viewer's first, with
 *   its size) and `resize` in; `exit` out (then the socket closes,
 *   {@link TERMINAL_CLOSE}.ended) and `size` (the terminal took another
 *   viewer's size). A frame that fails its schema is ignored.
 * - Attaching (story 3.5): on `attach` the terminal takes the viewer's size
 *   (the other viewers get `size`), then the viewer gets the recent output
 *   core kept, then the live output. A viewer that sends no `attach` within
 *   {@link ATTACH_WAIT_MS} is attached at the terminal's current size (and
 *   told it). Bytes and `resize` before attaching are ignored.
 * - Several viewers (story 3.5): each sees all the output and may type; the
 *   terminal's size follows whichever viewer last resized or typed.
 * - Each viewer's typing is rate limited ({@link INPUT_BURST_BYTES}, refilled
 *   at {@link INPUT_BYTES_PER_SECOND}; 3.1 review F4), each control frame
 *   costing {@link CONTROL_FRAME_COST_BYTES}: a viewer over it is closed
 *   (1008, `rate_limited`); the terminal and its other viewers go on.
 * - A session's terminal has at most {@link MAX_TERMINAL_VIEWERS} viewers; one
 *   more is closed ({@link TERMINAL_CLOSE}.tooManyViewers).
 * - An unknown session, or one the terminal does not drive, is closed at
 *   once ({@link TERMINAL_CLOSE}.notTerminal). A frame over its size limit
 *   closes the socket (1009); so does the server's `maxPayload` before a
 *   larger one is buffered. A viewer more than {@link MAX_VIEWER_BUFFERED_BYTES}
 *   behind is closed ({@link TERMINAL_CLOSE}.slowViewer) and reattaches.
 * - Closing the socket only detaches that viewer: the server owns the
 *   terminal until the session switches back or the server stops, with or
 *   without viewers.
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
import { ATTACH_WAIT_MS, CONTROL_FRAME_COST_BYTES, createInputBudget, createViewerCounter, INPUT_BURST_BYTES, INPUT_BYTES_PER_SECOND, MAX_TERMINAL_VIEWERS, MAX_VIEWER_BUFFERED_BYTES, POLICY, TERMINAL_TOO_MANY_VIEWERS, TOO_BIG, WS_OPEN } from './terminal-socket-limits.js';

// The limits live in terminal-socket-limits.ts; these names stay importable from here.
export { ATTACH_WAIT_MS, CONTROL_FRAME_COST_BYTES, createInputBudget, INPUT_BURST_BYTES, INPUT_BYTES_PER_SECOND, MAX_TERMINAL_VIEWERS, MAX_VIEWER_BUFFERED_BYTES, TERMINAL_TOO_MANY_VIEWERS };

export interface TerminalSocketOptions {
  chat: Chat;
  log: Logger;
  /** The tab tokens the gate checks: an open terminal socket holds its tab's token, as `/ws` does. */
  tabs?: TabTokens | undefined;
  /** The clock of the typing rate limit, in milliseconds (tests). Default `Date.now`. */
  now?: () => number;
  /** How long a viewer has to send `attach` (tests). Default {@link ATTACH_WAIT_MS}. */
  attachWaitMs?: number;
}

export function registerTerminalSocket(app: Hono, { chat, log, tabs, now = Date.now, attachWaitMs = ATTACH_WAIT_MS }: TerminalSocketOptions): void {
  /** How many viewers each session's terminal has now, over every socket. */
  const viewers = createViewerCounter<SessionId>();

  app.get(
    TERMINAL_SOCKET_ROUTE,
    upgradeWebSocket((c) => {
      const parsedId = SessionId.safeParse(c.req.param('sesId'));
      const sessionId = parsedId.success ? parsedId.data : undefined;
      // The gate verified this token; holding it keeps a connected tab's token alive.
      const token = webSocketToken(c.req.header('sec-websocket-protocol'));
      let release: (() => void) | undefined;
      let viewer: TerminalViewer | undefined;
      /** Whether the viewer has attached (`attach`, or the wait ran out): until then, nothing is sent or typed. */
      let attached = false;
      let attachTimer: ReturnType<typeof setTimeout> | undefined;
      const budget = createInputBudget(INPUT_BURST_BYTES, INPUT_BYTES_PER_SECOND, now);
      let closed = false;
      /** Whether this socket counts toward its session's {@link MAX_TERMINAL_VIEWERS}. */
      let counted = false;
      /** Detaches only this viewer: the terminal runs on. */
      const end = () => {
        closed = true;
        if (counted && sessionId !== undefined) viewers.count(sessionId, -1);
        counted = false;
        clearTimeout(attachTimer);
        attachTimer = undefined;
        viewer?.detach();
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
          if (!budget.take(CONTROL_FRAME_COST_BYTES)) {
            log.warn('terminal viewer sent control frames too fast; closing it', { sessionId });
            close(ws, POLICY, 'rate_limited');
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
          if (frame.data.type === 'attach' && !attached) {
            attach(ws, target, frame.data);
            return;
          }
          // A second `attach` is a resize; a `resize` before attaching is ignored.
          if (attached) target.resize(frame.data.cols, frame.data.rows);
          return;
        }
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
        if (bytes === undefined) return;
        if (bytes.byteLength > MAX_TERMINAL_INPUT_BYTES) {
          log.warn('terminal input frame too large; closing', { sessionId });
          close(ws, TOO_BIG, 'too_large');
          return;
        }
        // Counted before attaching too, though ignored then: a flood is a flood.
        if (!budget.take(bytes.byteLength)) {
          // Only how much: never what.
          log.warn('terminal viewer typed too fast; closing it', { sessionId, bytes: bytes.byteLength });
          close(ws, POLICY, 'rate_limited');
          return;
        }
        if (!attached) return;
        target.write(decoder.decode(bytes, { stream: true }));
      };

      /**
       * Attaches the viewer: the terminal takes its size (the other viewers
       * are told), or, with none, it is told the terminal's; then the recent
       * output, then the live output, read and subscribed in one tick.
       */
      const attach = (ws: WSContext, target: TerminalViewer, size: { cols: number; rows: number } | undefined) => {
        attached = true;
        clearTimeout(attachTimer);
        attachTimer = undefined;
        log.info('terminal viewer attached', { sessionId, waited: size === undefined });
        const sendBytes = (data: string) => {
          if (closed || ws.readyState !== WS_OPEN) return;
          ws.send(encoder.encode(data));
          const buffered = (ws.raw as { bufferedAmount?: number } | undefined)?.bufferedAmount ?? 0;
          if (buffered > MAX_VIEWER_BUFFERED_BYTES) {
            log.warn('terminal viewer fell behind; closing it', { sessionId });
            close(ws, TERMINAL_CLOSE.slowViewer, 'slow_viewer');
          }
        };
        const sendSize = (cols: number, rows: number) => {
          if (closed || ws.readyState !== WS_OPEN) return;
          ws.send(JSON.stringify(TerminalServerFrame.parse({ type: 'size', cols, rows })));
        };
        if (size === undefined) {
          const current = target.size;
          sendSize(current.cols, current.rows);
        } else {
          try {
            target.resize(size.cols, size.rows);
          } catch (error) {
            // It still gets the output, at whatever size the terminal has.
            log.warn('the terminal could not be resized', { sessionId, error: error instanceof Error ? error.name : 'unknown' });
          }
        }
        target.onSize(({ cols, rows }) => sendSize(cols, rows));
        const backlog = target.backlog;
        if (backlog !== '') sendBytes(backlog);
        target.onData(sendBytes);
      };

      return {
        onOpen(_event, ws) {
          release = tabs?.hold(token);
          viewer = sessionId === undefined ? undefined : chat.attachTerminal(sessionId);
          if (viewer === undefined || sessionId === undefined) {
            close(ws, TERMINAL_CLOSE.notTerminal, 'not_terminal');
            return;
          }
          if (viewers.of(sessionId) >= MAX_TERMINAL_VIEWERS) {
            log.warn('too many terminal viewers; closing the newest', { sessionId, max: MAX_TERMINAL_VIEWERS });
            close(ws, TERMINAL_CLOSE.tooManyViewers, 'too_many_viewers');
            return;
          }
          viewers.count(sessionId, 1);
          counted = true;
          // Told even before attaching: the terminal can end first.
          viewer.onEnd(({ exitCode }) => {
            const frame = TerminalServerFrame.parse({ type: 'exit', exitCode });
            if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(frame));
            close(ws, TERMINAL_CLOSE.ended, 'ended');
          });
          const target = viewer;
          attachTimer = setTimeout(() => {
            attachTimer = undefined;
            if (!closed && !attached) attach(ws, target, undefined);
          }, attachWaitMs);
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
