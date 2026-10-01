import { serveStatic } from '@hono/node-server/serve-static';
import type { AgentSetup, AppShortcutPort, BmadFeatures, Chat, EventLog, Onboarding, Permissions, Toolchain } from '@ogden-agents/core';
import { API_ROUTES, ToolchainInstallResponse, ToolchainResponse } from '@ogden-agents/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { registerAgentSetupRoutes } from './agent-setup-routes.js';
import type { TabTokens } from './auth.js';
import { registerChatRoutes } from './chat-routes.js';
import { apiError } from './errors.js';
import { registerEventSocket } from './event-socket.js';
import type { Logger } from './log.js';
import { isServerPath } from './paths.js';
import { registerPermissionRoutes } from './permission-routes.js';
import { registerShortcutRoutes } from './shortcut-routes.js';
import type { TerminalAvailabilityCheck } from './terminal-availability.js';
import { registerTerminalSocket } from './terminal-socket.js';
import { registerWorkspaceRoutes } from './workspace-routes.js';

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
  /** Whether a session's terminal can work, for `GET` session (story 3.2); without it that answer has no `terminal`. */
  terminalAvailability?: TerminalAvailabilityCheck;
  /** Core's answers to permission requests, which the permission routes decide through (the declining stub until 2.6). */
  permissions?: Permissions;
  /** Core's BMad pieces guard (AD-22, story 10.1). */
  bmad?: BmadFeatures;
  /** Registers the test-only BMad probe route (story 10.1); `start()` sets it only when its test hook is allowed. */
  bmadProbe?: boolean;
  /** Core's agent setup use-case: each agent's state and signing in (9.1); without it those routes answer 501. */
  agentSetup?: AgentSetup;
  /** Whether the first-run Welcome is done (9.5); without it those routes answer 501. */
  onboarding?: Onboarding;
  /** The Ogden Agents app shortcut (E2-R10; the `shortcut-memory` stub until 2.4). */
  appShortcut?: AppShortcutPort;
  /**
   * The tab tokens the gate checks. An open `/ws` holds its tab's token, so a
   * tab that stays connected never hits the idle expiry.
   */
  tabs?: TabTokens;
}

export function createApp({ events, webRoot, log, gate, control, toolchain, chat, terminalAvailability, permissions, bmad, bmadProbe, agentSetup, onboarding, appShortcut, tabs }: AppOptions): Hono {
  const app = new Hono();

  // First, for every method and path: no route may be registered before this line.
  app.use('*', gate);

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

  // One route file per lane (story 2.3): each fills only its own. Every route is in
  // `API_ROUTES` under `/api/v1`, registered after the gate.
  if (chat !== undefined) registerChatRoutes(app, chat, log, { terminalAvailability });
  registerWorkspaceRoutes(app, { chat, permissions, bmad, bmadProbe, log });
  registerPermissionRoutes(app, { permissions, log });
  registerShortcutRoutes(app, { appShortcut, log });
  registerAgentSetupRoutes(app, { agentSetup, onboarding, log });

  registerEventSocket(app, { events, log, tabs });
  // A session's terminal (story 3.1): behind the same gate as `/ws`.
  if (chat !== undefined) registerTerminalSocket(app, { chat, log, tabs });

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
