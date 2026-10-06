/**
 * The orchestration route (epic 15, story 15.2): the one read of a project's
 * orchestration settings, behind core's Orchestration guard (AD-22 style): 409
 * `feature_off` while the piece is off, 404 `not_found` for an unknown or
 * malformed project, both before anything is read. It runs none of the
 * project's scripts, so it needs no script trust. The Orchestrate page, plan,
 * approval and dispatch routes come with entries 3 to 9, registered through
 * {@link orchestrationRoutes} too. The piece, mode and roster change through
 * the workspace settings route. {@link orchestrationRouteKeys} lists what was
 * registered, for the architecture tests.
 */
import { NotFoundError, OrchestrationOffError, type OrchestrationFeature, type Permissions } from '@ogden-agents/core';
import {
  API_BASE,
  API_ROUTES,
  BMAD_PROJECT_NOT_FOUND_MESSAGE,
  DEFAULT_ORCHESTRATION_MODE,
  ORCHESTRATION_OFF_MESSAGE,
  OrchestrationSettingsResponse,
  RUN_LIMITS,
  TeamRoster,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { ids } from './request-input.js';

/** Whether this install ships Orchestration. Not yet: the tracer (15.3) turns it on, so a real install cannot turn it on before it does something. */
export const SHIPPED_ORCHESTRATION = false;

export type OrchestrationHandler = (c: Context, scope: { workspaceId: WorkspaceId }) => Response | Promise<Response>;

/** Every route registered through {@link orchestrationRoutes} on an app, as `METHOD path`. */
const registered = new WeakMap<Hono, Set<string>>();
const WORKSPACE_SCOPE = `${API_BASE}/workspaces/:wsId/`;

/**
 * The one way to register a route that serves Orchestration: core's guard
 * runs first, read at each request, before the handler or the body. The path
 * must lie inside a workspace.
 */
export function orchestrationRoutes(app: Hono, { orchestration, log }: { orchestration: OrchestrationFeature; log: Logger }) {
  const keys = registered.get(app) ?? new Set<string>();
  registered.set(app, keys);
  const register = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE') => (path: string, handler: OrchestrationHandler) => {
    if (!path.startsWith(WORKSPACE_SCOPE)) throw new Error(`an orchestration route must be inside a workspace (${WORKSPACE_SCOPE}…): ${method} ${path}`);
    app.on(method, path, async (c) => {
      const scope = ids(c);
      if (scope === undefined) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
      try {
        orchestration.requireOrchestration(scope.workspaceId);
      } catch (error) {
        if (error instanceof OrchestrationOffError) {
          log.info('Orchestration is off; route refused', { workspaceId: scope.workspaceId });
          return apiError(c, 409, 'feature_off', ORCHESTRATION_OFF_MESSAGE);
        }
        if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
        throw error;
      }
      try {
        return await handler(c, { workspaceId: scope.workspaceId });
      } catch (error) {
        if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
        throw error;
      }
    });
    keys.add(`${method} ${path}`);
  };
  return { get: register('GET'), post: register('POST'), patch: register('PATCH'), put: register('PUT'), delete: register('DELETE') };
}

/** Every route registered on `app` through {@link orchestrationRoutes}, sorted. */
export function orchestrationRouteKeys(app: Hono): string[] {
  return [...(registered.get(app) ?? [])].sort();
}

export interface OrchestrationRoutesOptions {
  orchestration: OrchestrationFeature;
  /** The project's settings; without it the route answers 501 once the guard passes. */
  permissions?: Pick<Permissions, 'getSettings'> | undefined;
  log: Logger;
}

export function registerOrchestrationRoutes(app: Hono, { orchestration, permissions, log }: OrchestrationRoutesOptions): void {
  const routes = orchestrationRoutes(app, { orchestration, log });
  routes.get(API_ROUTES.workspaceOrchestration, (c, { workspaceId }) => {
    if (permissions === undefined) return notImplemented(c);
    const settings = permissions.getSettings(workspaceId);
    return c.json(
      OrchestrationSettingsResponse.parse({
        settings: {
          mode: settings.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE,
          limits: RUN_LIMITS,
          roster: settings.orchestrationRoster ?? TeamRoster.parse({}),
        },
      }),
    );
  });
}
