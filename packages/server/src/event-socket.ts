/**
 * The events WebSocket, `/ws` (AD-5; moved out of `app.ts` in story 2.3,
 * owned by story 2.9 from here). The gate has already checked the upgrade's
 * Origin and the tab token it carries (AD-15).
 *
 * Nothing is sent until the client says where to start (E2-R8, story 2.9):
 *
 * - `subscribe_install { afterSeq }` streams the install-level events (and
 *   every `workspace.created`) after `afterSeq`, then live.
 * - `subscribe_workspace { workspaceId, afterSeq?, window? }` streams one
 *   workspace's recent window (or, on a reconnect, every event after
 *   `afterSeq`), then live. Subscribing again replaces the earlier one.
 * - `unsubscribe_workspace` stops one; `page_history` answers `history_page`
 *   with at most `MAX_PAGE_EVENTS` older events.
 *
 * Each subscription ends its backlog with a `caught_up` naming its scope. An
 * unknown workspace is answered `request_failed` / `not_found`. The legacy
 * install-wide `subscribe { afterSeq }` still streams every event after
 * `afterSeq`, then live, then `caught_up`; the web no longer sends it.
 */
import { upgradeWebSocket } from '@hono/node-server';
import { NotFoundError, type EventLog, type EventScope, type ScopeSubscription } from '@ogden-agents/core';
import {
  ClientMessage,
  ClientRequestType,
  DEFAULT_WINDOW_EVENTS,
  PageHistoryMessage,
  ServerMessage,
  WorkspaceId as WorkspaceIdSchema,
  type RequestFailedMessage,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import { webSocketToken, type TabTokens } from './auth.js';
import type { Logger } from './log.js';

const WS_OPEN = 1;

/** A request id as the shared messages define it. */
const RequestId = PageHistoryMessage.shape.requestId;

/**
 * The request id and workspace of a client message that failed its schema,
 * when they are themselves valid, so the refusal can be correlated; `undefined`
 * for anything that is not a request carrying a valid `requestId`.
 */
function correlate(json: unknown): { type: ClientRequestType; requestId: string; workspaceId?: WorkspaceId } | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  const { type, requestId, workspaceId } = json as Record<string, unknown>;
  const request = ClientRequestType.safeParse(type);
  const id = RequestId.safeParse(requestId);
  if (!request.success || !id.success) return undefined;
  const workspace = WorkspaceIdSchema.safeParse(workspaceId);
  return { type: request.data, requestId: id.data, ...(workspace.success ? { workspaceId: workspace.data } : {}) };
}

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
      // Nothing is sent until the client says where to start.
      let unsubscribe: (() => void) | undefined;
      let install: ScopeSubscription | undefined;
      const workspaceSubscriptions = new Map<WorkspaceId, ScopeSubscription>();
      let closed = false;
      // The gate verified this token; holding it keeps a connected tab's token alive.
      const token = webSocketToken(c.req.header('sec-websocket-protocol'));
      let release: (() => void) | undefined;
      const end = () => {
        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;
        install?.unsubscribe();
        install = undefined;
        for (const subscription of workspaceSubscriptions.values()) subscription.unsubscribe();
        workspaceSubscriptions.clear();
        release?.();
        release = undefined;
      };

      const fail = (
        ws: WSContext,
        request: { type: ClientRequestType; requestId?: string; workspaceId?: WorkspaceId },
        code: RequestFailedMessage['code'],
        message: string,
      ) => {
        const failed: RequestFailedMessage = {
          type: 'request_failed',
          for: request.type,
          ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
          ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
          code,
          message,
        };
        send(ws, failed);
      };

      /** Reads the backlog and registers in one tick, then says `caught_up`; `undefined` if the workspace is unknown. */
      const subscribeScope = (
        ws: WSContext,
        scope: EventScope,
        from: { afterSeq: number } | { window: number },
        request: { type: ClientRequestType; workspaceId?: WorkspaceId },
      ): ScopeSubscription | undefined => {
        let subscription: ScopeSubscription;
        try {
          subscription = events.subscribeScope(scope, from, (event) => send(ws, event));
        } catch (error) {
          if (error instanceof NotFoundError) fail(ws, request, 'not_found', 'That project does not exist.');
          else {
            log.error('scoped subscription failed', { error: String(error) });
            fail(ws, request, 'internal_error', 'Ogden Agents could not load these events.');
          }
          return undefined;
        }
        // The backlog went out synchronously above; everything after this is live.
        send(ws, { type: 'caught_up', scope, oldestSeq: subscription.oldestSeq, hasEarlier: subscription.hasEarlier });
        return subscription;
      };

      return {
        onOpen() {
          release = tabs?.hold(token);
        },

        onMessage(event, ws) {
          // A message racing the close must not register anything that is never released.
          if (closed) return;
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
            // A request the client is waiting on (it carries a valid request id) is refused, not left to time out.
            const request = correlate(json);
            if (request !== undefined) fail(ws, request, 'invalid_request', 'Ogden Agents could not read that request.');
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
              // Replaces any earlier install subscription.
              install?.unsubscribe();
              install = subscribeScope(ws, 'install', { afterSeq: message.afterSeq }, message);
              break;
            case 'subscribe_workspace': {
              const { workspaceId } = message;
              // Replaces an earlier subscription to the same workspace, so nothing arrives twice.
              const previous = workspaceSubscriptions.get(workspaceId);
              // The map is keyed by workspace, and only existing workspaces can be
              // subscribed, so it never holds more than the install's projects.
              if (previous !== undefined) {
                previous.unsubscribe();
                workspaceSubscriptions.delete(workspaceId);
              }
              const from = message.afterSeq !== undefined ? { afterSeq: message.afterSeq } : { window: message.window ?? DEFAULT_WINDOW_EVENTS };
              const subscription = subscribeScope(ws, workspaceId, from, message);
              if (subscription !== undefined) workspaceSubscriptions.set(workspaceId, subscription);
              break;
            }
            case 'unsubscribe_workspace':
              workspaceSubscriptions.get(message.workspaceId)?.unsubscribe();
              workspaceSubscriptions.delete(message.workspaceId);
              break;
            case 'page_history': {
              let page: ReturnType<EventLog['readBefore']>;
              try {
                // At most MAX_PAGE_EVENTS: the schema caps `limit`, and so does core.
                page = events.readBefore(message.workspaceId, message.beforeSeq, message.limit, message.sessionId);
              } catch (error) {
                if (error instanceof NotFoundError) fail(ws, message, 'not_found', 'That project does not exist.');
                else {
                  log.error('reading older history failed', { error: String(error) });
                  fail(ws, message, 'internal_error', 'Ogden Agents could not load earlier history.');
                }
                break;
              }
              send(ws, { type: 'history_page', requestId: message.requestId, workspaceId: message.workspaceId, events: page.events, hasMore: page.hasMore });
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
