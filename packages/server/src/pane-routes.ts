/**
 * The terminal pane routes (epic 16, story 16.2): a project's panes, opening
 * one, closing one and Restart pane. Developer mode only, enforced here by
 * core on every call (403 `developer_mode_required`, as Skip all is), and
 * never behind a BMad piece's guard (E16-R3). They carry no terminal text:
 * only each pane's state (AD-6, AD-16).
 */
import { CoreError, DeveloperModeRequiredError, LauncherUnavailableError, NotFoundError, PaneLimitError, TerminalUnavailableError, ValidationError, type Panes } from '@ogden-agents/core';
import {
  API_ROUTES,
  ArrangePanesRequest,
  RenamePaneRequest,
  OpenPaneRequest,
  PaneId,
  PaneLaunchersResponse,
  PaneResponse,
  PanesResponse,
  RestartPaneRequest,
  MAX_PANES_PER_INSTALL,
  MAX_PANES_PER_PROJECT,
  WorkspaceId,
  type SessionTerminal,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** `{"cols":1000,"rows":500}` with room to spare. */
const MAX_BODY_BYTES = 1024;
/** A layout of up to 8 panes in nested splits, with room to spare. */
const MAX_LAYOUT_BODY_BYTES = 16 * 1024;

export interface PaneRoutesOptions {
  panes?: Panes | undefined;
  log: Logger;
}

export function registerPaneRoutes(app: Hono, { panes, log }: PaneRoutesOptions): void {
  if (panes === undefined) {
    app.get(API_ROUTES.workspacePanes, notImplemented);
    app.post(API_ROUTES.workspacePanes, notImplemented);
    app.delete(API_ROUTES.workspacePane, notImplemented);
    app.patch(API_ROUTES.workspacePane, notImplemented);
    app.put(API_ROUTES.workspacePaneLayout, notImplemented);
    app.get(API_ROUTES.terminalLaunchers, notImplemented);
    app.post(API_ROUTES.terminalLaunchers, notImplemented);
    app.post(API_ROUTES.workspacePaneRestart, notImplemented);
    return;
  }

  /** The error answers every pane route shares; a failure of our own is a 500 and never says what the pane printed. */
  const refuse = (c: Context, error: unknown): Response => {
    if (error instanceof DeveloperModeRequiredError) return apiError(c, 403, 'developer_mode_required', error.message);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', 'There is no such terminal.');
    if (error instanceof LauncherUnavailableError) return apiError(c, 409, 'launcher_unavailable', error.message, { launcher: error.launcherCode, ...(error.installUrl === undefined ? {} : { installUrl: error.installUrl }) });
    if (error instanceof PaneLimitError) return apiError(c, 409, 'pane_limit_reached', error.message, { scope: error.scope, limit: error.limit });
    if (error instanceof TerminalUnavailableError) return apiError(c, 409, 'terminal_unavailable', error.message, { terminal: error.terminal });
    log.error('a terminal pane request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that with the terminal. Try again.");
  };
  const tooLarge = (c: Context) => apiError(c, 413, 'invalid_request', 'That request is too large.');
  const workspaceId = (c: Context): WorkspaceId | undefined => {
    const parsed = WorkspaceId.safeParse(c.req.param('wsId'));
    return parsed.success ? parsed.data : undefined;
  };
  const paneIds = (c: Context): { workspaceId: WorkspaceId; paneId: PaneId } | undefined => {
    const workspace = workspaceId(c);
    const pane = PaneId.safeParse(c.req.param('paneId'));
    return workspace === undefined || !pane.success ? undefined : { workspaceId: workspace, paneId: pane.data };
  };
  const notFound = (c: Context) => apiError(c, 404, 'not_found', 'There is no such terminal.');

  app.get(API_ROUTES.workspacePanes, async (c) => {
    const id = workspaceId(c);
    if (id === undefined) return notFound(c);
    try {
      const list = panes.list(id);
      const pty = await panes.available();
      const terminal: SessionTerminal = pty.ok ? { available: true } : { available: false, code: 'pty_unavailable', reason: pty.reason };
      return c.json(PanesResponse.parse({ panes: list, layout: panes.layout(id), terminal, limits: { perProject: MAX_PANES_PER_PROJECT, perInstall: MAX_PANES_PER_INSTALL } }));
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.post(API_ROUTES.workspacePanes, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    const id = workspaceId(c);
    if (id === undefined) return notFound(c);
    const body = await readBody(c, OpenPaneRequest);
    if (!body.ok) return body.response;
    try {
      const pane = await panes.open(id, { cols: body.value.cols, rows: body.value.rows }, body.value.placement, { launcherId: body.value.launcherId, args: body.value.args });
      log.info('terminal pane opened', { paneId: pane.id, workspaceId: id, launcherId: pane.launcherId });
      return c.json(PaneResponse.parse({ pane }), 201);
    } catch (error) {
      return refuse(c, error);
    }
  });

  // What a pane can run and what detection found (story 16.5). Install wide; Developer mode only. Never the paths.
  const live = panes;
  for (const refresh of [false, true]) {
    const handler = async (c: Context) => {
      try {
        const launchers = await live.launchers(refresh);
        if (refresh) log.info('terminal launchers detected again', { found: launchers.filter((one) => one.detection.state === 'found').length });
        return c.json(PaneLaunchersResponse.parse({ launchers }));
      } catch (error) {
        return refuse(c, error);
      }
    };
    if (refresh) app.post(API_ROUTES.terminalLaunchers, handler);
    else app.get(API_ROUTES.terminalLaunchers, handler);
  }

  app.put(API_ROUTES.workspacePaneLayout, bodyLimit({ maxSize: MAX_LAYOUT_BODY_BYTES, onError: tooLarge }), async (c) => {
    const id = workspaceId(c);
    if (id === undefined) return notFound(c);
    const body = await readBody(c, ArrangePanesRequest);
    if (!body.ok) return body.response;
    try {
      panes.arrange(id, body.value.layout);
      const pty = await panes.available();
      const terminal: SessionTerminal = pty.ok ? { available: true } : { available: false, code: 'pty_unavailable', reason: pty.reason };
      return c.json(PanesResponse.parse({ panes: panes.list(id), layout: panes.layout(id), terminal, limits: { perProject: MAX_PANES_PER_PROJECT, perInstall: MAX_PANES_PER_INSTALL } }));
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.patch(API_ROUTES.workspacePane, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    const ids = paneIds(c);
    if (ids === undefined) return notFound(c);
    const body = await readBody(c, RenamePaneRequest);
    if (!body.ok) return body.response;
    try {
      return c.json(PaneResponse.parse({ pane: panes.rename(ids.workspaceId, ids.paneId, body.value.title) }));
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.delete(API_ROUTES.workspacePane, (c) => {
    const ids = paneIds(c);
    if (ids === undefined) return notFound(c);
    try {
      panes.close(ids.workspaceId, ids.paneId);
      log.info('terminal pane closed', { paneId: ids.paneId });
      return c.body(null, 204);
    } catch (error) {
      return refuse(c, error);
    }
  });

  app.post(API_ROUTES.workspacePaneRestart, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    const ids = paneIds(c);
    if (ids === undefined) return notFound(c);
    const body = await readBody(c, RestartPaneRequest);
    if (!body.ok) return body.response;
    try {
      const pane = await panes.restart(ids.workspaceId, ids.paneId, body.value);
      log.info('terminal pane restarted', { paneId: pane.id });
      return c.json(PaneResponse.parse({ pane }));
    } catch (error) {
      return refuse(c, error);
    }
  });
}
