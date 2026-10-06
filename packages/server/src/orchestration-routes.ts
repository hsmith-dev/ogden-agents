/**
 * The orchestration route (epic 15, story 15.2): the one read of a project's
 * orchestration settings, registered through `bmadPieceRoutes('orchestration')`
 * so core's guard answers 409 `feature_off` while the piece is off (AD-22).
 * It runs none of the project's scripts, so it needs no script trust. The
 * Orchestrate page, plan, approval and dispatch routes come with entries 3
 * to 9. The mode and roster change through the workspace settings route.
 */
import type { BmadFeatures, Permissions } from '@ogden-agents/core';
import { API_ROUTES, DEFAULT_ORCHESTRATION_MODE, OrchestrationSettingsResponse, RUN_LIMITS, TeamRoster } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bmadPieceRoutes } from './bmad-pieces.js';
import { notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface OrchestrationRoutesOptions {
  bmad: BmadFeatures;
  /** The project's settings; without it the route answers 501 once the guard passes. */
  permissions?: Pick<Permissions, 'getSettings'> | undefined;
  log: Logger;
}

export function registerOrchestrationRoutes(app: Hono, { bmad, permissions, log }: OrchestrationRoutesOptions): void {
  const routes = bmadPieceRoutes(app, { bmad, log });
  routes.get('orchestration', API_ROUTES.workspaceOrchestration, (c, { workspaceId }) => {
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
