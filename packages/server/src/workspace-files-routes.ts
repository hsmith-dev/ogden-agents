/**
 * The Workbench's Files routes (AD-36, E8-R1, E8-R2): one folder of a
 * project listed, one file read, read-only. Behind the gate (AD-15) like
 * every `/api/v1/*` route, and on no paired-device allowlist. Not a BMad
 * piece, so there is no piece guard and no script trust: nothing of the
 * project's runs.
 *
 * - `GET /workspaces/:wsId/files?path=&session=` → `WorkspaceFolderResponse`.
 * - `GET /workspaces/:wsId/files/content?path=&session=` → `WorkspaceFileResponse`.
 * - `GET /workspaces/:wsId/files/search?q=&mode=&matchCase=&regex=&session=` →
 *   `WorkspaceSearchResponse` (8.8; 501 when the port can't search). The
 *   request's signal stops the search when the client goes away; neither
 *   the query nor a result is logged.
 * - `POST /workspaces/:wsId/files/links` `WorkspaceFileLinksRequest` →
 *   `WorkspaceFileLinksResponse` (8.7): which candidate paths are files the
 *   viewer would open, and nothing else (501 until the port can locate).
 *
 * Both files routes' query is read through `WorkspaceFilesQuery`.
 * `session` roots a request at that chat's worktree when it has one; a
 * foreign or unknown session is 404, a malformed one 400. 400 `invalid_request` for a malformed
 * path, 403 `path_protected`, 404 `not_found` (an unknown project too). A
 * file's content is only in the response: never an event, and neither it
 * nor the path is logged. Without the use-case all answer 501 `not_implemented`.
 */
import type { WorkspaceFiles } from '@ogden-agents/core';
import {
  API_ROUTES,
  SessionId,
  WorkspaceFileLinksRequest,
  WorkspaceFileLinksResponse,
  WorkspaceFileResponse,
  WorkspaceFilesQuery,
  WorkspaceFolderResponse,
  WorkspaceSearchResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { NO_STORE, workbenchRefusal } from './workbench-refusal.js';

export interface WorkspaceFilesRoutesOptions {
  workspaceFiles?: WorkspaceFiles | undefined;
  log: Logger;
}

/**
 * A links request's largest body: 100 paths of at most 4096 UTF-16 units,
 * each up to 6 bytes once JSON-escaped (`\uXXXX`), is 2.4 MiB; 3 MiB covers it and a session.
 */
const MAX_LINKS_BODY_BYTES = 3 * 1024 * 1024;

export function registerWorkspaceFilesRoutes(app: Hono, { workspaceFiles, log }: WorkspaceFilesRoutesOptions): void {
  if (workspaceFiles === undefined) {
    app.get(API_ROUTES.workspaceFiles, notImplemented);
    app.get(API_ROUTES.workspaceFileContent, notImplemented);
    app.get(API_ROUTES.workspaceFileSearch, notImplemented);
    app.post(API_ROUTES.workspaceFileLinks, notImplemented);
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

  const exists = workspaceFiles.exists;
  if (exists === undefined) {
    // The files port can't locate, so it can't confirm a path.
    app.post(API_ROUTES.workspaceFileLinks, notImplemented);
  } else {
    const limit = bodyLimit({ maxSize: MAX_LINKS_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
    app.post(API_ROUTES.workspaceFileLinks, limit, async (c) => {
      // Not JSON is an invalid body like any other: the project is still checked first.
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text()) as unknown;
      } catch {
        body = undefined;
      }
      try {
        const wsId = c.req.param('wsId');
        const parsed = WorkspaceFileLinksRequest.safeParse(body);
        if (!parsed.success) {
          // The project (and a well-formed chat) first: an unknown one is 404 whatever the paths; a malformed one is 400.
          const session = SessionId.safeParse((body as { session?: unknown } | null)?.session);
          await exists(wsId, [], session.success ? session.data : undefined);
          return apiError(c, 400, 'invalid_request', 'Those are not paths inside the project.');
        }
        return c.json(WorkspaceFileLinksResponse.parse({ found: await exists(wsId, parsed.data.paths, parsed.data.session) }), 200, NO_STORE);
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  const search = workspaceFiles.search;
  if (search === undefined) {
    // The files port has no search yet (8.8).
    app.get(API_ROUTES.workspaceFileSearch, notImplemented);
    return;
  }
  app.get(API_ROUTES.workspaceFileSearch, async (c) => {
    try {
      const { q, mode, matchCase, regex, session } = c.req.query();
      /** `true` and `false` as booleans; anything else as given, which the schema refuses. */
      const flag = (value: string) => (value === 'true' ? true : value === 'false' ? false : value);
      const query = {
        ...(q === undefined ? {} : { q }),
        ...(mode === undefined ? {} : { mode }),
        ...(matchCase === undefined ? {} : { matchCase: flag(matchCase) }),
        ...(regex === undefined ? {} : { regex: flag(regex) }),
        ...(session === undefined ? {} : { session }),
      };
      return c.json(WorkspaceSearchResponse.parse(await search(c.req.param('wsId'), query, c.req.raw.signal)), 200, NO_STORE);
    } catch (error) {
      return refusal(c, error);
    }
  });
}
