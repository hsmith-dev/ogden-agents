/**
 * The per-project script trust over REST (story 4.2; user decision
 * 2026-10-02, "Trust once per project"). `PUT …/bmad/script-trust` →
 * `WorkspaceSettingsResponse`: the user allows Ogden Agents to run this
 * project's own BMad Method scripts, as they are now (story 4.13: bound to
 * their contents). Core keeps it on the workspace row and appends
 * `workspace.bmad_scripts_trusted`; a repeat with the same scripts answers
 * the same and appends nothing, and after they changed it allows the new ones.
 *
 * Not guarded by a piece: the trust is asked for before (or right after) a
 * script-running piece is turned on, and is never revoked by turning pieces
 * off. It sits behind the gate like every route (AD-15), and a `PUT` is
 * state-changing, so the gate has checked its Origin. No body is read. An
 * unknown or malformed `:wsId` is 404 `not_found`. Without core's trust or
 * settings (an app wired without core) it answers 501.
 */
import { NotFoundError, type BmadScriptTrust, type Permissions } from '@ogden-agents/core';
import { API_ROUTES, BMAD_PROJECT_NOT_FOUND_MESSAGE, WorkspaceSettingsResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { ids } from './request-input.js';

export interface BmadTrustRoutesOptions {
  /** Core's script trust; without it (or the settings) the route answers 501. */
  scriptTrust?: Pick<BmadScriptTrust, 'trustScripts'> | undefined;
  /** Core's workspace settings, which the answer reports. */
  permissions?: Pick<Permissions, 'getSettings'> | undefined;
  log: Logger;
}

const notFound = (c: Context) => apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);

export function registerBmadTrustRoutes(app: Hono, { scriptTrust, permissions, log }: BmadTrustRoutesOptions): void {
  if (scriptTrust === undefined || permissions === undefined) {
    app.put(API_ROUTES.workspaceBmadScriptTrust, notImplemented);
    return;
  }
  app.put(API_ROUTES.workspaceBmadScriptTrust, async (c) => {
    const scope = ids(c);
    if (scope === undefined || scope.sessionId !== undefined) return notFound(c);
    try {
      await scriptTrust.trustScripts(scope.workspaceId);
      const settings = permissions.getSettings(scope.workspaceId);
      log.info("project's BMad Method scripts trusted", { workspaceId: scope.workspaceId });
      return c.json(WorkspaceSettingsResponse.parse({ settings }));
    } catch (error) {
      if (error instanceof NotFoundError) return notFound(c);
      throw error;
    }
  });
}
