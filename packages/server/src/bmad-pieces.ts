/**
 * The server side of the per-project BMad pieces (CAP-19, AD-22; story
 * 10.2): the list of pieces this install ships, and the one helper every
 * route serving a piece is registered through.
 *
 * Shipping a piece is data, not core code: the epic that builds a piece
 * appends it to {@link SHIPPED_BMAD_PIECES} (epic 4.2 adds `planning` and
 * `board`) and registers its routes with {@link bmadPieceRoutes}; `start()`
 * hands the list to `openCore`, which then lets the piece be turned on.
 */
import { FeatureOffError, FeatureUnavailableError, NotFoundError, type BmadFeatures } from '@ogden-agents/core';
import { API_BASE, BMAD_ITEM_NOT_FOUND_MESSAGE, BMAD_PROJECT_NOT_FOUND_MESSAGE, FEATURE_OFF_MESSAGE, FEATURE_UNAVAILABLE_MESSAGE, type BmadPiece, type WorkspaceId } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError } from './errors.js';
import type { Logger } from './log.js';
import { ids } from './request-input.js';

/**
 * The pieces this install ships. Empty until epic 4: every piece shows as
 * coming soon and none can be turned on. An epic appends its pieces here,
 * once their routes are registered through {@link bmadPieceRoutes}.
 */
export const SHIPPED_BMAD_PIECES: readonly BmadPiece[] = [];

/** What a guarded handler is given besides the request: the workspace, already checked to have the piece on. */
export interface BmadPieceScope {
  workspaceId: WorkspaceId;
}

export type BmadPieceHandler = (c: Context, scope: BmadPieceScope) => Response | Promise<Response>;

/** Registers one route serving `piece` at `path`, behind core's guard. */
export type BmadPieceRouteRegistrar = (piece: BmadPiece, path: string, handler: BmadPieceHandler) => void;

export interface BmadPieceRoutes {
  get: BmadPieceRouteRegistrar;
  post: BmadPieceRouteRegistrar;
  patch: BmadPieceRouteRegistrar;
  put: BmadPieceRouteRegistrar;
  delete: BmadPieceRouteRegistrar;
}

export interface BmadPieceRoutesOptions {
  /** Core's guard (AD-22), read at each request. */
  bmad: BmadFeatures;
  log: Logger;
}

/** Every route `bmadPieceRoutes` registered on an app, as `METHOD path`. */
const registered = new WeakMap<Hono, Set<string>>();

/** Where every guarded route lives: inside one workspace, under the API (Conventions). */
const WORKSPACE_SCOPE = `${API_BASE}/workspaces/:wsId/`;

/**
 * Core's BMad refusals as API errors; anything else is left for `onError`
 * (500). `notFound` is what a `NotFoundError` says: the project, from the
 * guard, or the thing a handler looked up (a ticket, session or run).
 */
function refusal(c: Context, error: unknown, notFound: string): Response {
  if (error instanceof FeatureOffError) return apiError(c, 409, 'feature_off', FEATURE_OFF_MESSAGE);
  if (error instanceof FeatureUnavailableError) return apiError(c, 409, 'feature_unavailable', FEATURE_UNAVAILABLE_MESSAGE);
  if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', notFound);
  throw error;
}

/**
 * The one way to register a route that serves a BMad piece (AD-22). Each
 * request first asks core's guard whether the route's workspace has the
 * piece on, read at that moment: a well-formed but unknown workspace answers
 * 404 `not_found`, a malformed `:wsId` too, and a piece that is off 409
 * `feature_off`, all before the handler runs or the body is read. The
 * handler's own `feature_off`, `feature_unavailable` and `not_found` from
 * core answer the same way.
 *
 * `path` must lie inside a workspace (`/api/v1/workspaces/:wsId/…`), or
 * registering throws: a piece is always a project's. {@link guardedRouteKeys}
 * lists what was registered, for the architecture test.
 */
export function bmadPieceRoutes(app: Hono, { bmad, log }: BmadPieceRoutesOptions): BmadPieceRoutes {
  const keys = registered.get(app) ?? new Set<string>();
  registered.set(app, keys);
  const register =
    (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'): BmadPieceRouteRegistrar =>
    (piece, path, handler) => {
      if (!path.startsWith(WORKSPACE_SCOPE)) throw new Error(`a BMad piece's route must be inside a workspace (${WORKSPACE_SCOPE}…): ${method} ${path}`);
      app.on(method, path, async (c) => {
        const scope = ids(c);
        if (scope === undefined) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
        try {
          bmad.requireBmadFeature(scope.workspaceId, piece);
        } catch (error) {
          if (error instanceof FeatureOffError) log.info('BMad piece is off; route refused', { workspaceId: scope.workspaceId, piece });
          return refusal(c, error, BMAD_PROJECT_NOT_FOUND_MESSAGE);
        }
        try {
          return await handler(c, { workspaceId: scope.workspaceId });
        } catch (error) {
          return refusal(c, error, BMAD_ITEM_NOT_FOUND_MESSAGE);
        }
      });
      keys.add(`${method} ${path}`);
    };
  return { get: register('GET'), post: register('POST'), patch: register('PATCH'), put: register('PUT'), delete: register('DELETE') };
}

/** Every route registered on `app` through {@link bmadPieceRoutes}, as sorted `METHOD path` keys. */
export function guardedRouteKeys(app: Hono): string[] {
  return [...(registered.get(app) ?? [])].sort();
}
