/**
 * The terminal pane WebSocket, `/ws/pane/:paneId` (epic 16, story 16.2): the
 * gate has already checked the upgrade exactly as for `/ws` (Host, the
 * tab-token subprotocol, Origin; AD-15), and the server echoes only
 * `ogden.v1`. Beyond the gate, core refuses it without Developer mode (close
 * 4403) and for an unknown pane (4404).
 *
 * Frames are the session terminal's (`terminal-socket.ts`): binary frames are
 * bytes, text frames JSON control frames (`attach` and `resize` in; `size`,
 * `state`, `reset` and `exit` out). Differences:
 * - On `attach` the viewer gets `reset`, then the pane's screen as it is now
 *   (a snapshot of the server's mirror, so a reload shows a full-screen
 *   program exactly), then the live output.
 * - A pane that exits keeps the socket: `exit` is sent, the pane stays, and
 *   Restart pane starts it again, `reset` and the new screen following.
 * - The same input rate limit, slow viewer close and viewer limit apply.
 *
 * Nothing here logs, events or stores a frame's contents (AD-16).
 */
import { upgradeWebSocket } from '@hono/node-server';
import { DeveloperModeRequiredError, type PaneViewer, type Panes } from '@ogden-agents/core';
import {
  MAX_TERMINAL_CONTROL_BYTES,
  MAX_TERMINAL_INPUT_BYTES,
  PANE_CLOSE,
  PANE_SOCKET_ROUTE,
  PaneId,
  PaneServerFrame,
  TERMINAL_CLOSE,
  TerminalClientFrame,
} from '@ogden-agents/shared';
import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { webSocketToken, type TabTokens } from './auth.js';
import type { Logger } from './log.js';
import {
  ATTACH_WAIT_MS,
  CONTROL_FRAME_COST_BYTES,
  createInputBudget,
  INPUT_BURST_BYTES,
  INPUT_BYTES_PER_SECOND,
  MAX_TERMINAL_VIEWERS,
  MAX_VIEWER_BUFFERED_BYTES,
} from './terminal-socket.js';

const WS_OPEN = 1;
const TOO_BIG = 1009;
const POLICY = 1008;

export interface PaneSocketOptions {
  panes: Panes;
  log: Logger;
  tabs?: TabTokens | undefined;
  now?: () => number;
  attachWaitMs?: number;
}

export function registerPaneSocket(app: Hono, { panes, log, tabs, now = Date.now, attachWaitMs = ATTACH_WAIT_MS }: PaneSocketOptions): void {
  const viewerCounts = new Map<PaneId, number>();
  const countViewer = (id: PaneId, change: 1 | -1) => {
    const next = (viewerCounts.get(id) ?? 0) + change;
    if (next <= 0) viewerCounts.delete(id);
    else viewerCounts.set(id, next);
  };

  app.get(
    PANE_SOCKET_ROUTE,
    upgradeWebSocket((c) => {
      const parsedId = PaneId.safeParse(c.req.param('paneId'));
      const paneId = parsedId.success ? parsedId.data : undefined;
      const token = webSocketToken(c.req.header('sec-websocket-protocol'));
      let release: (() => void) | undefined;
      let viewer: PaneViewer | undefined;
      let attached = false;
      let attachTimer: ReturnType<typeof setTimeout> | undefined;
      const budget = createInputBudget(INPUT_BURST_BYTES, INPUT_BYTES_PER_SECOND, now);
      let closed = false;
      let counted = false;
      const unsubscribes: Array<() => void> = [];
      const end = () => {
        closed = true;
        if (counted && paneId !== undefined) countViewer(paneId, -1);
        counted = false;
        clearTimeout(attachTimer);
        attachTimer = undefined;
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
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

      const sendFrame = (ws: WSContext, frame: PaneServerFrame) => {
        if (closed || ws.readyState !== WS_OPEN) return;
        ws.send(JSON.stringify(PaneServerFrame.parse(frame)));
      };

      const attach = (ws: WSContext, target: PaneViewer, size: { cols: number; rows: number } | undefined) => {
        attached = true;
        clearTimeout(attachTimer);
        attachTimer = undefined;
        log.info('terminal pane viewer attached', { paneId, waited: size === undefined });
        if (size !== undefined) target.resize(size.cols, size.rows);
        else sendFrame(ws, { type: 'size', cols: target.size.cols, rows: target.size.rows });
        sendFrame(ws, { type: 'state', state: target.pane.state });
        if (target.pane.state === 'exited') sendFrame(ws, { type: 'exit', exitCode: target.pane.exitCode });
        unsubscribes.push(
          target.onSize(({ cols, rows }) => sendFrame(ws, { type: 'size', cols, rows })),
          target.onState((pane) => {
            sendFrame(ws, { type: 'state', state: pane.state });
            if (pane.state === 'exited') sendFrame(ws, { type: 'exit', exitCode: pane.exitCode });
          }),
          target.onClose(() => close(ws, PANE_CLOSE.closed, 'closed')),
        );
        const sendBytes = (data: string, snapshot = false) => {
          if (closed || ws.readyState !== WS_OPEN) return;
          ws.send(encoder.encode(data));
          // A snapshot of a deep scrollback can itself pass the limit: only live output counts as falling behind.
          if (snapshot) return;
          const buffered = (ws.raw as { bufferedAmount?: number } | undefined)?.bufferedAmount ?? 0;
          if (buffered > MAX_VIEWER_BUFFERED_BYTES) {
            log.warn('terminal pane viewer fell behind; closing it', { paneId });
            close(ws, TERMINAL_CLOSE.slowViewer, 'slow_viewer');
          }
        };
        target.attach(
          (snapshot) => {
            // The viewer resets, then writes what follows: the screen as it is, then the live output.
            sendFrame(ws, { type: 'reset' });
            if (snapshot !== '') sendBytes(snapshot, true);
          },
          (data) => sendBytes(data),
        );
      };

      const receive = (ws: WSContext, target: PaneViewer, data: unknown) => {
        if (typeof data === 'string') {
          if (Buffer.byteLength(data) > MAX_TERMINAL_CONTROL_BYTES) {
            log.warn('terminal pane control frame too large; closing', { paneId });
            close(ws, TOO_BIG, 'too_large');
            return;
          }
          if (!budget.take(CONTROL_FRAME_COST_BYTES)) {
            log.warn('terminal pane viewer sent control frames too fast; closing it', { paneId });
            close(ws, POLICY, 'rate_limited');
            return;
          }
          let json: unknown;
          try {
            json = JSON.parse(data);
          } catch {
            log.warn('ignoring an unreadable terminal pane control frame', { paneId });
            return;
          }
          const frame = TerminalClientFrame.safeParse(json);
          if (!frame.success) {
            // Its issues are not logged: they could quote what was sent.
            log.warn('ignoring a terminal pane control frame that fails the shared schema', { paneId });
            return;
          }
          if (frame.data.type === 'attach' && !attached) {
            attach(ws, target, frame.data);
            return;
          }
          if (attached) target.resize(frame.data.cols, frame.data.rows);
          return;
        }
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
        if (bytes === undefined) return;
        if (bytes.byteLength > MAX_TERMINAL_INPUT_BYTES) {
          log.warn('terminal pane input frame too large; closing', { paneId });
          close(ws, TOO_BIG, 'too_large');
          return;
        }
        if (!budget.take(bytes.byteLength)) {
          log.warn('terminal pane viewer typed too fast; closing it', { paneId, bytes: bytes.byteLength });
          close(ws, POLICY, 'rate_limited');
          return;
        }
        if (!attached) return;
        target.write(decoder.decode(bytes, { stream: true }));
      };

      return {
        onOpen(_event, ws) {
          release = tabs?.hold(token);
          if (paneId === undefined) {
            close(ws, PANE_CLOSE.notAvailable, 'not_available');
            return;
          }
          try {
            viewer = panes.attach(paneId);
          } catch (error) {
            // Developer mode is off: core refuses, and so does the socket.
            close(ws, error instanceof DeveloperModeRequiredError ? PANE_CLOSE.developerModeOff : PANE_CLOSE.notAvailable, 'not_available');
            return;
          }
          if (viewer === undefined) {
            close(ws, PANE_CLOSE.notAvailable, 'not_available');
            return;
          }
          if ((viewerCounts.get(paneId) ?? 0) >= MAX_TERMINAL_VIEWERS) {
            log.warn('too many terminal pane viewers; closing the newest', { paneId, max: MAX_TERMINAL_VIEWERS });
            close(ws, TERMINAL_CLOSE.tooManyViewers, 'too_many_viewers');
            return;
          }
          countViewer(paneId, 1);
          counted = true;
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
            log.warn('a terminal pane frame could not be handled', { paneId, error: error instanceof Error ? error.name : 'unknown' });
          }
        },

        onClose() {
          if (viewer !== undefined) log.info('terminal pane viewer left', { paneId });
          end();
        },

        onError(event) {
          log.warn('terminal pane websocket error', { paneId, error: (event as Event & { error?: unknown }).error instanceof Error ? ((event as Event & { error: Error }).error.name) : 'unknown' });
          end();
        },
      };
    }),
  );
}
