import { upgradeWebSocket } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { EventBus } from '@ogdenmad/core';
import { ClientMessage, ServerMessage } from '@ogdenmad/shared';
import { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { Logger } from './log.js';

export interface AppOptions {
  bus: EventBus;
  /** Absolute path to the built web UI (`packages/web/dist`). */
  webRoot: string;
  log: Logger;
}

const WS_OPEN = 1;

export function createApp({ bus, webRoot, log }: AppOptions): Hono {
  const app = new Hono();

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
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined;

      return {
        onOpen(_event, ws) {
          unsubscribe = bus.subscribe((event) => send(ws, event));
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
          switch (parsed.data.type) {
            case 'ping':
              send(ws, { type: 'pong', at: new Date().toISOString() });
              break;
          }
        },

        onClose() {
          unsubscribe?.();
        },

        onError(event) {
          log.warn('websocket error', { error: String((event as Event & { error?: unknown }).error ?? event.type) });
          unsubscribe?.();
        },
      };
    }),
  );

  app.use('/*', serveStatic({ root: webRoot }));

  app.notFound((c) =>
    c.req.path === '/'
      ? c.text('OgdenMad UI is not built. Run `pnpm build`.', 503)
      : c.text('Not found', 404),
  );

  return app;
}
