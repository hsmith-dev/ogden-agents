import { serveStatic } from '@hono/node-server/serve-static';
import {
  createAddProject,
  type AgentSetup,
  type AppShortcutPort,
  type BmadDetectionUseCases,
  type BmadFeatures,
  type BmadScriptTrust,
  type BmadSourceUseCases,
  type BmadSetupUseCases,
  type BoardUseCases,
  type Orchestration,
  type OrchestrationFeature,
  type Team,
  type RetrospectiveUseCases,
  type BuildSettings,
  type Notifications,
  type LocalEndpoints,
  type LocalModels,
  type BuildsUseCases,
  type Chat,
  type EventLog,
  type InstallSettings,
  type NewProjectDefaultsStore,
  type OrchestrationDefaultsUseCase,
  type Panes,
  type TerminalsSettingsStore,
  type Onboarding,
  type Permissions,
  type PlanningUseCases,
  type Toolchain,
  type AgentModels,
  type AgentLinkedCommands,
} from '@ogden-agents/core';
import { API_ROUTES, ToolchainInstallResponse, ToolchainResponse } from '@ogden-agents/shared';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { registerAgentSetupRoutes } from './agent-setup-routes.js';
import { registerBmadDetectionRoutes } from './bmad-detection-routes.js';
import { registerBmadRoutes } from './bmad-routes.js';
import { registerBmadSourceRoutes } from './bmad-source-routes.js';
import { registerBmadTrustRoutes } from './bmad-trust-routes.js';
import type { TabTokens } from './auth.js';
import { registerChatRoutes } from './chat-routes.js';
import { apiError } from './errors.js';
import { registerEventSocket } from './event-socket.js';
import type { Logger } from './log.js';
import { isServerPath } from './paths.js';
import { registerPaneRoutes } from './pane-routes.js';
import { registerPaneSocket } from './pane-socket.js';
import { registerPermissionRoutes } from './permission-routes.js';
import { registerPlanningRoutes } from './planning-routes.js';
import { registerOrchestrationRoutes } from './orchestration-routes.js';
import { registerOrchestrationDefaultsRoutes } from './orchestration-defaults-routes.js';
import { registerTeamRosterRoutes } from './team-roster-routes.js';
import { registerRetrospectiveRoutes } from './retrospective-routes.js';
import { registerBuildRoutes } from './build-routes.js';
import { registerLocalEndpointRoutes } from './local-endpoint-routes.js';
import { registerLocalEndpointModelsRoute } from './local-endpoint-models-route.js';
import { registerLocalEndpointUseRoutes, type EndpointPresetData } from './local-endpoint-use-routes.js';
import { registerRunSettingsRoutes } from './run-settings-routes.js';
import { registerUpdateRoutes } from './update-routes.js';
import type { UpdateCheck } from './update-check.js';
import type { ShellMode } from './shell-mode.js';
import { registerLauncherUpdateRoutes } from './update-notice/routes.js';
import type { DesktopUpdate } from './update-notice/desktop-update.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { registerTerminalsSettingsRoutes } from './terminals-settings-routes.js';
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
  /** Core's BMad pieces (AD-22): the guard (10.1) and what this install ships (10.2); without it `GET` pieces answers 501. */
  bmad?: BmadFeatures;
  /** Core's Orchestration guard (epic 15, 15.2); without it the orchestration routes are not registered. */
  orchestration?: OrchestrationFeature;
  /** Core's Orchestration use-case over the chat (epic 15, 15.3); without it the run routes answer 501. */
  orchestrationRuns?: Orchestration;
  /** The install's orchestration mode default and run limits (15.8); without it the defaults route answers 501 and runs use the built in limits. */
  orchestrationDefaults?: OrchestrationDefaultsUseCase;
  /** Core's team roster (epic 15, 15.5); without it the roster routes answer 501 and settings are not checked for it. */
  team?: Team;
  /** Registers the test-only BMad probe route (story 10.1); `start()` sets it only when its test hook is allowed. */
  bmadProbe?: boolean;
  /** Core's read-only BMad detection and Not now on its offer (story 10.3); without it those routes answer 501. */
  bmadDetection?: BmadDetectionUseCases;
  /**
   * Core's per-project script trust (story 4.2): its route, and the check
   * every route of a piece that runs project scripts makes. Without it the
   * trust route answers 501, and the Plan and Board routes are not
   * registered (none may run unchecked).
   */
  bmadScriptTrust?: BmadScriptTrust;
  /**
   * The catalog and planning sessions (story 4.1), served behind the
   * `planning` piece's guard; without it those routes answer 501 once the guard passes.
   */
  planning?: PlanningUseCases;
  /** The project's tickets (story 4.1), behind the `board` piece's guard; without it that route answers 501 once the guard passes. */
  board?: BoardUseCases;
  /** Looking back on an epic (story 7.1), behind the `retrospectives` piece's guard and the trust; without it that route answers 501 once the guards pass. */
  retrospectives?: RetrospectiveUseCases;
  /** Unattended builds (story 5.2), behind the `builds` piece's guard and the trust; without them those routes answer 501 once the guards pass. */
  builds?: BuildsUseCases;
  /** The install's run limits and a project's build settings (story 5.8). */
  buildSettings?: BuildSettings;
  /** Notification settings and webhooks (story 11.4). */
  notifications?: Notifications;
  /** The Local model's endpoints (epic 14 story 14.3); without it those routes answer 501. */
  localEndpoints?: LocalEndpoints | undefined;
  /** Test connection and Detect (epic 14 story 14.4); without it those routes answer 501. */
  localModels?: LocalModels | undefined;
  /** The one-click presets served to the page (story 14.4). */
  endpointPresets?: readonly EndpointPresetData[] | undefined;
  /** The pinned upstream BMad Method's status and its user-initiated download (story 4.14); without it those routes answer 501. */
  bmadSource?: BmadSourceUseCases;
  /** BMad Method's setup in a project (story 4.3), behind Planning or Board; without it those routes answer 501 once the guard passes. */
  bmadSetup?: BmadSetupUseCases | undefined;
  /** Core's agent setup use-case: each agent's state and signing in (9.1); without it those routes answer 501. */
  agentSetup?: AgentSetup;
  /**
   * Each agent's linked command (epic 12, entry 12), over `core.agentLinkedCommands`; without it the linked-command
   * routes answer 501 and no `AgentSetupStatus` ever carries `linkedCommand`.
   */
  agentLinkedCommands?: AgentLinkedCommands;
  /** Whether the first-run Welcome is done (9.5); without it those routes answer 501. */
  onboarding?: Onboarding;
  /**
   * The app-wide default for new projects (10.4): its routes, and the pieces a
   * project added without its own starts with. Without it those routes answer
   * 501 and new projects start Simple.
   */
  newProjectDefaults?: NewProjectDefaultsStore;
  /** Developer mode, kept and enforced by core (permission modes); without it its routes answer 501. */
  installSettings?: InstallSettings;
  /** The install's Terminals settings (epic 16, story 16.9); without it their routes answer 501. */
  terminalsSettings?: TerminalsSettingsStore;
  /** Terminal panes (epic 16): Developer mode only; without it their routes answer 501 and the socket is not registered. */
  panes?: Panes;
  /** The "newer version" notice (story 13.7); without it its routes answer 501. */
  updates?: UpdateCheck;
  /** Inside the desktop app (`OGDEN_AGENTS_SHELL=desktop`, story 13.3): the update the shell reported, its channel and Restart. */
  desktopUpdate?: DesktopUpdate;
  /** `desktop` inside the app, so the page uses app wording. */
  shell?: ShellMode | null;
  /** Each agent's install-wide default model (story 11), and whether an agent is registered: `PUT` default model. */
  agentDefaults?: { models: Pick<AgentModels, 'setDefaultModel'>; isAgentRegistered: (agentId: string) => boolean };
  /** The Ogden Agents app shortcut (E2-R10; the `shortcut-memory` stub until 2.4). */
  appShortcut?: AppShortcutPort;
  /**
   * The tab tokens the gate checks. An open `/ws` holds its tab's token, so a
   * tab that stays connected never hits the idle expiry.
   */
  tabs?: TabTokens;
}

export function createApp({
  events,
  webRoot,
  log,
  gate,
  control,
  toolchain,
  chat,
  terminalAvailability,
  permissions,
  bmad,
  orchestration,
  orchestrationRuns,
  orchestrationDefaults,
  team,
  bmadProbe,
  bmadDetection,
  bmadScriptTrust,
  planning,
  board,
  retrospectives,
  builds,
  buildSettings,
  notifications,
  localEndpoints,
  localModels,
  endpointPresets,
  bmadSource,
  bmadSetup,
  agentSetup,
  agentLinkedCommands,
  onboarding,
  newProjectDefaults,
  installSettings,
  updates,
  desktopUpdate,
  shell,
  agentDefaults,
  appShortcut,
  panes,
  terminalsSettings,
  tabs,
}: AppOptions): Hono {
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

    // The desktop shell's update calls (story 13.3), only in shell mode.
    registerLauncherUpdateRoutes(app, { desktop: desktopUpdate });

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
    const quit = async (c: Context) => {
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
    };
    app.post(API_ROUTES.serverQuit, quit);
    // The desktop app's own Quit (story 13.5): the same rule and answers, for the shell, which holds the launcher token and no tab.
    // Only the app starts a server in shell mode, and only the server it started is quit this way.
    if (shell === 'desktop') app.post('/launcher/quit', quit);
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
  if (chat !== undefined) {
    const addProject = createAddProject({ chat, defaults: newProjectDefaults, bmad });
    registerChatRoutes(app, chat, log, { terminalAvailability, addProject, agentDefaults });
  }
  registerWorkspaceRoutes(app, { chat, permissions, bmad, bmadProbe, team, builds, log });
  registerPermissionRoutes(app, { permissions, log });
  registerShortcutRoutes(app, { appShortcut, log });
  registerAgentSetupRoutes(app, { agentSetup, onboarding, agentLinkedCommands, log });
  registerBmadRoutes(app, { bmad, newProjectDefaults, log });
  // The pinned upstream BMad Method (story 4.14): install-level, not a piece's.
  registerBmadSourceRoutes(app, { bmadSource, log });
  registerBmadDetectionRoutes(app, { bmadDetection, log });
  registerBmadTrustRoutes(app, { scriptTrust: bmadScriptTrust, permissions, log });
  // Plan and Board (stories 4.1, 4.2): every route through `bmadPieceRoutes`, behind core's guard and the script trust (AD-22).
  if (bmad !== undefined && bmadScriptTrust !== undefined) registerPlanningRoutes(app, { bmad, scriptTrust: bmadScriptTrust, planning, board, bmadSetup, log });
  // Retrospectives (story 7.1): the same helper, guard and trust.
  if (bmad !== undefined && bmadScriptTrust !== undefined) registerRetrospectiveRoutes(app, { bmad, scriptTrust: bmadScriptTrust, retrospectives, log });
  // Orchestration (epic 15, story 15.2): the same helper and guard; it runs no project script, so no trust.
  if (orchestration !== undefined) registerOrchestrationRoutes(app, { orchestration, permissions, runs: orchestrationRuns, defaults: orchestrationDefaults, log });
  registerTeamRosterRoutes(app, { team, orchestration, log });
  registerOrchestrationDefaultsRoutes(app, { defaults: orchestrationDefaults, log });
  // Unattended builds (story 5.2): the same helper, guard and trust.
  if (bmad !== undefined && bmadScriptTrust !== undefined) registerBuildRoutes(app, { bmad, scriptTrust: bmadScriptTrust, builds, buildSettings, log });
  // Terminal panes (epic 16): behind the gate, and Developer mode enforced by core on every call.
  registerPaneRoutes(app, { panes, log });
  registerSettingsRoutes(app, { installSettings, newProjectDefaults, panes, log });
  registerTerminalsSettingsRoutes(app, { terminalsSettings, installSettings, log });
  // The install's run limits and notification settings (story 5.3; 5.8 and 11.4 fill them): the gate, never a piece's guard.
  registerRunSettingsRoutes(app, { buildSettings, builds, notifications, log });
  // The Local model's endpoints (epic 14 story 14.3): app-wide, behind the gate, never a piece's guard; a key never leaves.
  registerLocalEndpointRoutes(app, { localEndpoints, log });
  registerLocalEndpointUseRoutes(app, { localModels, presets: endpointPresets ?? [], log });
  registerLocalEndpointModelsRoute(app, { localModels, log });
  registerUpdateRoutes(app, { updates, desktop: desktopUpdate, shell });

  registerEventSocket(app, { events, log, tabs });
  // A session's terminal (story 3.1): behind the same gate as `/ws`.
  if (chat !== undefined) registerTerminalSocket(app, { chat, log, tabs });
  // A pane's terminal (epic 16): the same gate, and core refuses it without Developer mode.
  if (panes !== undefined) registerPaneSocket(app, { panes, log, tabs });

  // The built UI, never under the server's own paths (`paths.ts`).
  const staticFiles = serveStatic({ root: webRoot });
  app.use('/*', (c, next) => (isServerPath(c.req.path) ? next() : staticFiles(c, next)));

  // The UI's client-side routes (such as `/settings/appearance`) load the app,
  // so a reload or a bookmark lands on the same screen. Only extensionless GET
  // paths outside `/ws`, `/api` and `/launcher` (and below them; see
  // `paths.ts`, which the gate shares); a missing asset stays a 404. A ticket's
  // detail (`/w/:wsId/board/:ref`, story 4.9) and a build's review
  // (`/w/:wsId/review/:ref`, story 5.2) are pages even though the ref (`1.2`)
  // looks like an extension.
  app.get(
    '/*',
    async (c, next) => {
      const path = c.req.path;
      if (isServerPath(path) || (/\.[A-Za-z0-9]+$/.test(path) && !/^\/w\/[^/]+\/(board|review)\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(path))) {
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
