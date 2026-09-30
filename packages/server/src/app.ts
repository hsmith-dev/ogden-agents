import { upgradeWebSocket } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { EventLog } from '@ogden-agents/core';
import { ClientMessage, ServerMessage } from '@ogden-agents/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import type { WSContext } from 'hono/ws';
import type { Logger } from './log.js';

/** What `GET /launcher/hello` reports about the running server (AD-20). */
export interface ServerInfo {
  version: string;
  pid: number;
  port: number;
  /** Sessions that are `working` or `waiting` (AD-4): the server must not stop under them. */
  busySessions: number;
}

/** The server's own lifecycle, as the launcher handshake and Quit drive it. */
export interface ServerControl {
  info(): ServerInfo;
  /** A fresh single-use launch link (AD-15). A secret: never log it. */
  issueLaunchUrl(): string;
  /**
   * Stops the server cleanly if no session is busy, and says whether it will.
   * The stop happens after the reply is sent.
   */
  restartWhenIdle(): { restarting: boolean; busySessions: number };
  /**
   * Quit in the UI: stops the server cleanly after the reply is sent. With
   * busy sessions it refuses unless `force` (the user confirmed that their
   * running agents stop too).
   */
  quit(force: boolean): { stopping: boolean; busySessions: number };
}

export interface AppOptions {
  /** Core's event log; `/ws` clients subscribe to it (AD-5). */
  events: EventLog;
  /** Absolute path to the built web UI (`packages/web/dist`). */
  webRoot: string;
  log: Logger;
  /**
   * The security gate (AD-15; see `createGate`). Registered before every route,
   * so nothing the app serves, now or later, is reachable around it.
   */
  gate: MiddlewareHandler;
  /** The launcher handshake and Quit; without it those routes answer 404. */
  control?: ServerControl;
}

const WS_OPEN = 1;

export function createApp({ events, webRoot, log, gate, control }: AppOptions): Hono {
  const app = new Hono();

  // First, for every method and path: no route may be registered before this line.
  app.use('*', gate);

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

  if (control !== undefined) {
    // The launcher handshake (AD-20). The gate lets these through only with the launcher token.
    app.get('/launcher/hello', (c) => {
      const info = control.info();
      const wantsLaunch = c.req.query('launch') === '1';
      if (wantsLaunch) log.info('launch code issued for the launcher');
      return c.json(wantsLaunch ? { ...info, launchUrl: control.issueLaunchUrl() } : info);
    });

    app.post('/launcher/restart-when-idle', (c) => {
      const result = control.restartWhenIdle();
      return c.json(result, result.restarting ? 202 : 409);
    });

    // Quit (EXPERIENCE.md sidebar footer). A state-changing POST, so the gate checks its Origin.
    app.post('/api/server/quit', async (c) => {
      let force = false;
      try {
        const body = (await c.req.json()) as { force?: unknown } | null;
        force = body?.force === true;
      } catch {
        // No body or not JSON: not forced.
      }
      const result = control.quit(force);
      if (!result.stopping) {
        return c.json(
          {
            error: {
              code: 'sessions_busy',
              message: 'Agents are still working. Confirm to stop them and quit.',
              details: { busySessions: result.busySessions },
            },
          },
          409,
        );
      }
      return c.json(result, 202);
    });
  }

  app.get(
    '/ws',
    upgradeWebSocket(() => {
      // Nothing is sent until the client says where to start: `{ type: 'subscribe', afterSeq }`.
      let unsubscribe: (() => void) | undefined;

      return {
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
            case 'subscribe':
              // Replaces any earlier subscription. The backlog after `afterSeq`
              // is sent synchronously, then live events, with no gap or repeat.
              unsubscribe?.();
              unsubscribe = events.subscribe(parsed.data.afterSeq, (event) => send(ws, event));
              // The backlog went out synchronously above; everything after this is live.
              send(ws, { type: 'caught_up' });
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

  // The UI's client-side routes (such as `/settings/appearance`) load the app,
  // so a reload or a bookmark lands on the same screen. Only extensionless GET
  // paths outside `/ws`, `/api` and `/launcher`; a missing asset stays a 404.
  app.get(
    '/*',
    async (c, next) => {
      const path = c.req.path;
      if (path === '/ws' || path.startsWith('/api/') || path.startsWith('/launcher/') || /\.[A-Za-z0-9]+$/.test(path)) {
        return c.notFound();
      }
      await next();
    },
    serveStatic({ root: webRoot, rewriteRequestPath: () => '/index.html' }),
  );

  app.notFound((c) =>
    c.req.path === '/'
      ? c.text('Ogden Agents UI is not built. Run `pnpm build`.', 503)
      : c.text('Not found', 404),
  );

  return app;
}
