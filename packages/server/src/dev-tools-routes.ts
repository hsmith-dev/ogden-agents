/**
 * Generic developer CLI tools' routes (CAP-25, story: generic developer CLI
 * tools detect, install, and sandbox-gate): the install-wide catalog and a
 * confirmed real install, plus a project's per-tool unattended-build
 * allowlist (deny by default). Served whole: this feature is not a BMad
 * piece, so there is no piece guard here, only the gate (AD-15) every
 * `/api/v1/*` route already has.
 *
 * - `GET /dev-tools` → `DevToolsResponse`; `POST AddDevToolRequest` → 201
 *   `DevToolsResponse`, 400 for a duplicate id or bad input.
 * - `DELETE /dev-tools/:toolId` → 204; 404 for an unknown tool.
 * - `POST /dev-tools/:toolId/install` `InstallDevToolRequest` → `DevToolStatus`;
 *   404 unknown tool, 409 `no_install_command`/`install_failed` with a plain
 *   reason, never the installer's raw output.
 * - `GET /workspaces/:wsId/dev-tools-allowlist` → `DevToolsAllowlistResponse`.
 * - `PUT …/dev-tools-allowlist/:toolId` `SetDevToolAllowedRequest` → the same.
 *
 * Without the use-case they answer 501 `not_implemented`.
 */
import { CoreError, DevToolsError, NotFoundError, ValidationError, type DevTools } from '@ogden-agents/core';
import { API_ROUTES, DevToolsAllowlistResponse, DevToolsResponse, DevToolStatus } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { ids } from './request-input.js';

/** `AddDevToolRequest`'s longest field (`installCommand`, 2000 chars) with room to spare. */
const MAX_BODY_BYTES = 8 * 1024;

export interface DevToolsRoutesOptions {
  devTools?: DevTools | undefined;
  log: Logger;
}

export function registerDevToolsRoutes(app: Hono, { devTools, log }: DevToolsRoutesOptions): void {
  if (devTools === undefined) {
    app.get(API_ROUTES.devTools, notImplemented);
    app.post(API_ROUTES.devTools, notImplemented);
    app.delete(API_ROUTES.devTool, notImplemented);
    app.post(API_ROUTES.devToolInstall, notImplemented);
    app.get(API_ROUTES.workspaceDevToolsAllowlist, notImplemented);
    app.put(API_ROUTES.workspaceDevToolAllow, notImplemented);
    return;
  }
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', error.message);
    if (error instanceof DevToolsError) return apiError(c, 409, error.code, error.message);
    log.error('a dev tools request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that. Try again.");
  };
  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  const readBody = async (c: Context): Promise<{ body: unknown } | { response: Response }> => {
    try {
      return { body: JSON.parse(await c.req.text()) as unknown };
    } catch {
      return { response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
    }
  };

  app.get(API_ROUTES.devTools, async (c) => c.json(DevToolsResponse.parse({ tools: await devTools.list() })));

  app.post(API_ROUTES.devTools, limit, async (c) => {
    const read = await readBody(c);
    if ('response' in read) return read.response;
    try {
      const tool = await devTools.addCustomTool(read.body);
      log.info('a dev tool was added', { toolId: tool.id });
      return c.json(DevToolStatus.parse(tool), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete(API_ROUTES.devTool, async (c) => {
    try {
      await devTools.removeCustomTool(c.req.param('toolId'));
      log.info('a dev tool was removed', { toolId: c.req.param('toolId') });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.devToolInstall, limit, async (c) => {
    const read = await readBody(c);
    if ('response' in read) return read.response;
    const toolId = c.req.param('toolId');
    try {
      const tool = await devTools.install(toolId, read.body);
      log.info('a dev tool was installed', { toolId });
      return c.json(DevToolStatus.parse(tool));
    } catch (error) {
      if (!(error instanceof ValidationError) && !(error instanceof NotFoundError)) log.warn('a dev tool install failed', { toolId, code: error instanceof CoreError ? error.code : 'unexpected' });
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.workspaceDevToolsAllowlist, async (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', 'There is no such project.');
    try {
      return c.json(DevToolsAllowlistResponse.parse({ tools: await devTools.unattendedAllowlist(scope.workspaceId) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.put(API_ROUTES.workspaceDevToolAllow, limit, async (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', 'There is no such project.');
    const read = await readBody(c);
    if ('response' in read) return read.response;
    const toolId = c.req.param('toolId');
    try {
      const tools = await devTools.setUnattendedAllowed(scope.workspaceId, toolId, read.body);
      log.info('a dev tool unattended allowance changed', { wsId: scope.workspaceId, toolId });
      return c.json(DevToolsAllowlistResponse.parse({ tools }));
    } catch (error) {
      return refusal(c, error);
    }
  });
}
