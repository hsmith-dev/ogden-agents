/**
 * The Workbench's Files routes (AD-36, E8-R1, E8-R2): one folder of a
 * project listed, one file read, read-only. Behind the gate (AD-15) like
 * every `/api/v1/*` route, and on no paired-device allowlist. Not a BMad
 * piece, so there is no piece guard and no script trust: nothing of the
 * project's runs.
 *
 * - `GET /workspaces/:wsId/files?path=&session=` → `WorkspaceFolderResponse`.
 * - `GET /workspaces/:wsId/files/content?path=&session=` → `WorkspaceFileResponse`.
 * - `GET /workspaces/:wsId/files/search?q=&mode=&matchCase=&session=` →
 *   `WorkspaceSearchResponse` (epic 8 entry 2; 501 until the port can search, 8.8).
 *
 * Both files routes' query is read through `WorkspaceFilesQuery`.
 * `session` roots a request at that chat's worktree when it has one; a
 * foreign or unknown session is 404, a malformed one 400. 400 `invalid_request` for a malformed
 * path, 403 `path_protected`, 404 `not_found` (an unknown project too). A
 * file's content is only in the response: never an event, and neither it
 * nor the path is logged. Without the use-case all answer 501 `not_implemented`.
 */
import {
  AgentMidTurnError,
  CoreError,
  EditorUnavailableError,
  HunkOutdatedError,
  InvalidOperationError,
  NotImplementedError,
  NotFoundError,
  PathProtectedError,
  ValidationError,
  type WorkspaceFiles,
} from '@ogden-agents/core';
import {
  AGENT_MID_TURN_MESSAGE,
  API_ROUTES,
  EDITOR_NONE_FOUND_TEXT,
  EDITOR_UNAVAILABLE_MESSAGE,
  HUNK_OUTDATED_TEXT,
  WORKSPACE_PATH_HARD_LINK_MESSAGE,
  WORKSPACE_PATH_NOT_FOUND_MESSAGE,
  WORKSPACE_PATH_PROTECTED_MESSAGE,
  WorkspaceFileResponse,
  WorkspaceFilesQuery,
  WorkspaceFolderResponse,
  WorkspaceSearchResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface WorkspaceFilesRoutesOptions {
  workspaceFiles?: WorkspaceFiles | undefined;
  log: Logger;
}

/** Neither a browser nor a proxy keeps a file's content, a diff or output. */
export const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The Workbench's refusals in the API's error shape (8.1's mapping, and
 * epic 8 entry 2's 409s). Each message is one of the fixed shared ones,
 * never an error's own text, which could name a path. Anything else is
 * logged by code only and answers 500.
 */
export function workbenchRefusal(log: Logger, what: string): (c: Context, error: unknown) => Response {
  return (c, error) => {
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof PathProtectedError) return apiError(c, 403, 'path_protected', error.message === WORKSPACE_PATH_HARD_LINK_MESSAGE ? WORKSPACE_PATH_HARD_LINK_MESSAGE : WORKSPACE_PATH_PROTECTED_MESSAGE);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', WORKSPACE_PATH_NOT_FOUND_MESSAGE);
    if (error instanceof AgentMidTurnError) return apiError(c, 409, 'agent_mid_turn', AGENT_MID_TURN_MESSAGE);
    if (error instanceof HunkOutdatedError) return apiError(c, 409, 'hunk_outdated', HUNK_OUTDATED_TEXT);
    // Core's own plain message (never a path).
    if (error instanceof InvalidOperationError) return apiError(c, 409, 'invalid_operation', error.message);
    // A lane not shipped yet (hunk actions before 8.5): core's own plain message.
    if (error instanceof NotImplementedError) return apiError(c, 501, 'not_implemented', error.message);
    if (error instanceof EditorUnavailableError) return apiError(c, 409, 'editor_unavailable', error.message === EDITOR_NONE_FOUND_TEXT ? EDITOR_NONE_FOUND_TEXT : EDITOR_UNAVAILABLE_MESSAGE);
    // Never the path or the reason's text, which could name it.
    log.error(`a ${what} request failed`, { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't do that. Try again.");
  };
}

export function registerWorkspaceFilesRoutes(app: Hono, { workspaceFiles, log }: WorkspaceFilesRoutesOptions): void {
  if (workspaceFiles === undefined) {
    app.get(API_ROUTES.workspaceFiles, notImplemented);
    app.get(API_ROUTES.workspaceFileContent, notImplemented);
    app.get(API_ROUTES.workspaceFileSearch, notImplemented);
    return;
  }
  const refusal = workbenchRefusal(log, 'workspace files');
  /** The files routes' query through `WorkspaceFilesQuery` (an empty `path` is absent: the root, or a read's missing path), or a 400. */
  const filesQuery = (c: Context): WorkspaceFilesQuery | Response => {
    const path = c.req.query('path');
    const session = c.req.query('session');
    const parsed = WorkspaceFilesQuery.safeParse({ ...(path === undefined || path === '' ? {} : { path }), ...(session === undefined ? {} : { session }) });
    return parsed.success ? parsed.data : apiError(c, 400, 'invalid_request', 'That is not a path inside the project.');
  };

  app.get(API_ROUTES.workspaceFiles, async (c) => {
    try {
      const query = filesQuery(c);
      if (query instanceof Response) return query;
      return c.json(WorkspaceFolderResponse.parse(await workspaceFiles.list(c.req.param('wsId'), query.path, query.session)), 200, NO_STORE);
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.get(API_ROUTES.workspaceFileContent, async (c) => {
    try {
      const query = filesQuery(c);
      if (query instanceof Response) return query;
      return c.json(WorkspaceFileResponse.parse(await workspaceFiles.read(c.req.param('wsId'), query.path, query.session)), 200, NO_STORE);
    } catch (error) {
      return refusal(c, error);
    }
  });

  const search = workspaceFiles.search;
  if (search === undefined) {
    // The files port has no search yet (8.8).
    app.get(API_ROUTES.workspaceFileSearch, notImplemented);
    return;
  }
  app.get(API_ROUTES.workspaceFileSearch, async (c) => {
    try {
      const { q, mode, matchCase, session } = c.req.query();
      const query = {
        ...(q === undefined ? {} : { q }),
        ...(mode === undefined ? {} : { mode }),
        ...(matchCase === undefined ? {} : { matchCase: matchCase === 'true' ? true : matchCase === 'false' ? false : matchCase }),
        ...(session === undefined ? {} : { session }),
      };
      return c.json(WorkspaceSearchResponse.parse(await search(c.req.param('wsId'), query)), 200, NO_STORE);
    } catch (error) {
      return refusal(c, error);
    }
  });
}
