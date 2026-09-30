/**
 * The events WebSocket, `/ws` (AD-5; moved out of `app.ts` in story 2.3,
 * owned by story 2.9 from here). The gate has already checked the upgrade's
 * Origin and the tab token it carries (AD-15).
 *
 * Nothing is sent until the client says where to start. The legacy
 * install-wide `subscribe { afterSeq }` streams every event after `afterSeq`,
 * then live, then `caught_up`. The scoped, windowed subscriptions and paging
 * (`subscribe_install`, `subscribe_workspace`, `unsubscribe_workspace`,
 * `page_history`; E2-R8) are answered `request_failed` with
 * `not_implemented` until 2.9 builds them.
 */
import { upgradeWebSocket } from '@hono/node-server';
import type { EventLog } from '@ogden-agents/core';
import { ClientMessage, ServerMessage, type RequestFailedMessage } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { webSocketToken, type TabTokens } from './auth.js';
import type { Logger } from './log.js';

const WS_OPEN = 1;

export interface EventSocketOptions {
  events: EventLog;
  log: Logger;
  /**
   * The tab tokens the gate checks. An open `/ws` holds its tab's token, so a
   * tab that stays connected never hits the idle expiry.
   */
  tabs?: TabTokens | undefined;
}

export function registerEventSocket(app: Hono, { events, log, tabs }: EventSocketOptions): void {
  /** Validate against the shared contract, then send; never send unschematized data. */
  const send = (ws: WSContext, message: unknown) => {
    const parsed = ServerMessage.safeParse(message);
    if (!parsed.success) {
      log.error('refusing to send a message that fails the shared schema', {
        issues: parsed.error.issues,
      });
      return;
    }
    if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(parsed.data));
  };

  app.get(
    '/ws',
    upgradeWebSocket((c) => {
      // Nothing is sent until the client says where to start: `{ type: 'subscribe', afterSeq }`.
      let unsubscribe: (() => void) | undefined;
      // The gate verified this token; holding it keeps a connected tab's token alive.
      const token = webSocketToken(c.req.header('sec-websocket-protocol'));
      let release: (() => void) | undefined;
      const end = () => {
        unsubscribe?.();
        release?.();
        release = undefined;
      };

      return {
        onOpen() {
          release = tabs?.hold(token);
        },

        onMessage(event, ws) {
          const raw = typeof event.data === 'string' ? event.data : null;
          let json: unknown;
          try {
            if (raw === null) throw new Error('binary frames are not supported');
            json = JSON.parse(raw);
          } catch (error) {
            log.warn('ignoring unparseable client message', { reason: String(error) });
            return;
          }
          const parsed = ClientMessage.safeParse(json);
          if (!parsed.success) {
            log.warn('ignoring client message that fails the shared schema', {
              issues: parsed.error.issues,
            });
            return;
          }
          const message = parsed.data;
          switch (message.type) {
            case 'ping':
              send(ws, { type: 'pong', at: new Date().toISOString() });
              break;
            case 'subscribe':
              // Replaces any earlier subscription. The backlog after `afterSeq`
              // is sent synchronously, then live events, with no gap or repeat.
              unsubscribe?.();
              unsubscribe = events.subscribe(message.afterSeq, (event) => send(ws, event));
              // The backlog went out synchronously above; everything after this is live.
              send(ws, { type: 'caught_up' });
              break;
            case 'subscribe_install':
            case 'subscribe_workspace':
            case 'unsubscribe_workspace':
            case 'page_history': {
              // Story 2.9 builds the scoped, windowed subscriptions and paging.
              const failed: RequestFailedMessage = {
                type: 'request_failed',
                for: message.type,
                ...('requestId' in message ? { requestId: message.requestId } : {}),
                ...('workspaceId' in message ? { workspaceId: message.workspaceId } : {}),
                code: 'not_implemented',
                message: 'Ogden Agents cannot do this yet.',
              };
              send(ws, failed);
              break;
            }
          }
        },

        onClose() {
          end();
        },

        onError(event) {
          log.warn('websocket error', { error: String((event as Event & { error?: unknown }).error ?? event.type) });
          end();
        },
      };
    }),
  );
}
