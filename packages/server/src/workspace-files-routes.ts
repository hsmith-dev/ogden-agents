/**
 * The Workbench's Files routes (AD-36, E8-R1, E8-R2): one folder of a
 * project listed, one file read, read-only. Behind the gate (AD-15) like
 * every `/api/v1/*` route, and on no paired-device allowlist. Not a BMad
 * piece, so there is no piece guard and no script trust: nothing of the
 * project's runs.
 *
 * - `GET /workspaces/:wsId/files?path=` → `WorkspaceFolderResponse`.
 * - `GET /workspaces/:wsId/files/content?path=` → `WorkspaceFileResponse`.
 *
 * 400 `invalid_request` for a malformed path, 403 `path_protected`, 404
 * `not_found` (an unknown project too). A file's content is only in the
 * response: never an event, and neither it nor the path is logged. Without
 * the use-case both answer 501 `not_implemented`.
 */
import { CoreError, NotFoundError, PathProtectedError, ValidationError, type WorkspaceFiles } from '@ogden-agents/core';
import { API_ROUTES, WORKSPACE_PATH_HARD_LINK_MESSAGE, WORKSPACE_PATH_NOT_FOUND_MESSAGE, WORKSPACE_PATH_PROTECTED_MESSAGE, WorkspaceFileResponse, WorkspaceFolderResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface WorkspaceFilesRoutesOptions {
  workspaceFiles?: WorkspaceFiles | undefined;
  log: Logger;
}

/** Neither a browser nor a proxy keeps a file's content. */
const NO_STORE = { 'Cache-Control': 'no-store' };

export function registerWorkspaceFilesRoutes(app: Hono, { workspaceFiles, log }: WorkspaceFilesRoutesOptions): void {
  if (workspaceFiles === undefined) {
    app.get(API_ROUTES.workspaceFiles, notImplemented);
    app.get(API_ROUTES.workspaceFileContent, notImplemented);
    return;
  }
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    // One of two fixed messages, never the error's own text.
    if (error instanceof PathProtectedError) return apiError(c, 403, 'path_protected', error.message === WORKSPACE_PATH_HARD_LINK_MESSAGE ? WORKSPACE_PATH_HARD_LINK_MESSAGE : WORKSPACE_PATH_PROTECTED_MESSAGE);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', WORKSPACE_PATH_NOT_FOUND_MESSAGE);
    // Never the path or the reason's text, which could name it.
    log.error('a workspace files request failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that. Try again.");
  };

  app.get(API_ROUTES.workspaceFiles, async (c) => {
    try {
      return c.json(WorkspaceFolderResponse.parse(await workspaceFiles.list(c.req.param('wsId'), c.req.query('path'))), 200, NO_STORE);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.workspaceFileContent, async (c) => {
    try {
      return c.json(WorkspaceFileResponse.parse(await workspaceFiles.read(c.req.param('wsId'), c.req.query('path'))), 200, NO_STORE);
    } catch (error) {
      return refusal(c, error);
    }
  });
}
