import { upgradeWebSocket } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Chat, EventLog, Toolchain } from '@ogden-agents/core';
import { API_ROUTES, ClientMessage, ServerMessage, ToolchainInstallResponse, ToolchainResponse } from '@ogden-agents/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { WSContext } from 'hono/ws';
import { webSocketToken, type TabTokens } from './auth.js';
import { registerChatRoutes } from './chat-routes.js';
import { apiError } from './errors.js';
import type { Logger } from './log.js';
import { isServerPath } from './paths.js';

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
  /**
   * A fresh single-use launch link (AD-15). With `origin` (an allowed
   * `http://host:port` the gate has checked) the link uses it, so a tab on
   * `localhost` opens its new tab on `localhost` too. A secret: never log it.
   */
  issueLaunchUrl(origin?: string): string;
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
  /** The launcher handshake, Quit and New tab; without it those routes answer 404. */
  control?: ServerControl;
  /** The `uv` status and its user-initiated install (story 1.8); without it those routes answer 404. */
  toolchain?: Toolchain;
  /** Workspaces, chat sessions and messages (story 2.2); without it those routes answer 404. */
  chat?: Chat;
  /**
   * The tab tokens the gate checks. An open `/ws` holds its tab's token, so a
   * tab that stays connected never hits the idle expiry.
   */
  tabs?: TabTokens;
}

const WS_OPEN = 1;

export function createApp({ events, webRoot, log, gate, control, toolchain, chat, tabs }: AppOptions): Hono {
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

  // The gate has already checked the tab's token; this only says so, so a tab
  // whose socket was refused can tell "not connected" from "server gone".
  app.get(API_ROUTES.tabCheck, (c) => c.body(null, 204));

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

    // New tab (sidebar footer): a fresh launch link for another tab, which
    // mints that tab its own token when it opens. A state-changing POST, so the
    // gate checks its Origin as well as this tab's token.
    app.post(API_ROUTES.launchCodes, (c) => {
      log.info('launch code issued for a new tab');
      const origin = `http://${c.req.header('host')!}`;
      return c.json({ launchUrl: control.issueLaunchUrl(origin) }, 201, { 'Cache-Control': 'no-store' });
    });

    // Quit (EXPERIENCE.md sidebar footer). A state-changing POST, so the gate checks its Origin.
    app.post(API_ROUTES.serverQuit, async (c) => {
      let force = false;
      try {
        const body = (await c.req.json()) as { force?: unknown } | null;
        force = body?.force === true;
      } catch {
        // No body or not JSON: not forced.
      }
      const result = control.quit(force);
      if (!result.stopping) {
        return apiError(c, 409, 'sessions_busy', 'Agents are still working. Confirm to stop them and quit.', {
          busySessions: result.busySessions,
        });
      }
      return c.json(result, 202);
    });
  }

  if (toolchain !== undefined) {

    app.get(API_ROUTES.toolchain, async (c) => {
      try {
        return c.json(ToolchainResponse.parse({ uv: await toolchain.status() }));
      } catch (error) {
        log.error('toolchain status failed', { reason: String(error) });
        return apiError(c, 500, 'toolchain_unavailable', "Ogden Agents couldn't check for uv. Try again.");
      }
    });

    // Install only ever starts here, when the user clicks Install: a
    // state-changing POST, so the gate has already checked its Origin (AD-15).
    app.post(API_ROUTES.uvInstall, async (c) => {
      try {
        const result = ToolchainInstallResponse.parse(await toolchain.installUv());
        if (result.started) log.info('uv install started');
        return c.json(result, 202);
      } catch (error) {
        log.error('uv install could not start', { reason: String(error) });
        return apiError(c, 500, 'toolchain_unavailable', "uv couldn't be installed. Try again.");
      }
    });
  }

  if (chat !== undefined) registerChatRoutes(app, chat, log);

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
          end();
        },

        onError(event) {
          log.warn('websocket error', { error: String((event as Event & { error?: unknown }).error ?? event.type) });
          end();
        },
      };
    }),
  );

  // The built UI, never under the server's own paths (`paths.ts`).
  const staticFiles = serveStatic({ root: webRoot });
  app.use('/*', (c, next) => (isServerPath(c.req.path) ? next() : staticFiles(c, next)));

  // The UI's client-side routes (such as `/settings/appearance`) load the app,
  // so a reload or a bookmark lands on the same screen. Only extensionless GET
  // paths outside `/ws`, `/api` and `/launcher` (and below them; see
  // `paths.ts`, which the gate shares); a missing asset stays a 404.
  app.get(
    '/*',
    async (c, next) => {
      const path = c.req.path;
      if (isServerPath(path) || /\.[A-Za-z0-9]+$/.test(path)) {
        return c.notFound();
      }
      await next();
    },
    serveStatic({ root: webRoot, rewriteRequestPath: () => '/index.html' }),
  );

  // The server's own paths answer in the API's error shape; the app's pages and files in plain text.
  app.notFound((c) => {
    if (isServerPath(c.req.path)) return apiError(c, 404, 'not_found', 'There is nothing here.');
    return c.req.path === '/' ? c.text('Ogden Agents UI is not built. Run `pnpm build`.', 503) : c.text('Not found', 404);
  });

  app.onError((error, c) => {
    // A deliberate HTTP error (e.g. a body-limit 413) keeps its own status and response.
    if (error instanceof HTTPException) return error.getResponse();
    log.error('request failed', { path: c.req.path, reason: String(error) });
    if (isServerPath(c.req.path)) return apiError(c, 500, 'internal_error', 'Something went wrong in Ogden Agents. Try again.');
    return c.text('Internal Server Error', 500);
  });

  return app;
}
