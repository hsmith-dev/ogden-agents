/**
 * The server side of the per-project BMad pieces (CAP-19, AD-22; story
 * 10.2; story 4.2 adds the script trust): the list of pieces this install
 * ships, and the one helper every route serving a piece is registered
 * through.
 *
 * Shipping a piece is data, not core code: the epic that builds a piece
 * appends it to {@link SHIPPED_BMAD_PIECES} and registers its routes with
 * {@link bmadPieceRoutes}; `start()` hands the list to `openCore`, which
 * then lets the piece be turned on.
 */
import {
  CoreError,
  FeatureOffError,
  FeatureUnavailableError,
  NotFoundError,
  ScriptsNotTrustedError,
  StatusNotAllowedError,
  type BmadFeatures,
  type BmadScriptTrust,
} from '@ogden-agents/core';
import {
  API_BASE,
  BMAD_ITEM_NOT_FOUND_MESSAGE,
  BMAD_PIECE_INFO,
  BMAD_PROJECT_NOT_FOUND_MESSAGE,
  FEATURE_OFF_MESSAGE,
  FEATURE_UNAVAILABLE_MESSAGE,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  STATUS_NOT_ALLOWED_MESSAGE,
  type BmadPiece,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError } from './errors.js';
import type { Logger } from './log.js';
import { ids } from './request-input.js';

/**
 * The pieces this install ships: epic 4 (story 4.2) ships Planning and
 * Board, whose routes are registered through {@link bmadPieceRoutes} with
 * the script trust. Unattended builds and Retrospectives stay coming soon
 * until epics 5 and 7 append theirs.
 */
export const SHIPPED_BMAD_PIECES: readonly BmadPiece[] = ['planning', 'board'];

/** What a guarded handler is given besides the request: the workspace, already checked to have the piece on (and trusted, when it runs scripts). */
export interface BmadPieceScope {
  workspaceId: WorkspaceId;
}

export type BmadPieceHandler = (c: Context, scope: BmadPieceScope) => Response | Promise<Response>;

export interface BmadPieceRouteOptions {
  /**
   * Whether the route runs the project's own BMad Method scripts, so it
   * also needs the project's trust (story 4.2). Default: whether any of its
   * pieces runs them (`BMAD_PIECE_INFO[piece].runsProjectScripts`). Only a
   * route that runs none of the project's code (BMad Method's setup, which
   * runs only the verified pinned `setup.py`) is registered with `false`.
   */
  projectScripts?: boolean;
}

/**
 * Registers one route serving `piece` (or any of `pieces`: the route
 * answers while at least one is on) at `path`, behind core's guard and,
 * when it runs project scripts, the script trust.
 */
export type BmadPieceRouteRegistrar = (piece: BmadPiece | readonly BmadPiece[], path: string, handler: BmadPieceHandler, options?: BmadPieceRouteOptions) => void;

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
  /**
   * Core's script trust (story 4.2), read at each request. Registering a
   * route that runs project scripts without it throws: such a route is
   * never served unchecked.
   */
  scriptTrust?: Pick<BmadScriptTrust, 'requireScriptsTrusted'> | undefined;
  log: Logger;
}

/** Every route `bmadPieceRoutes` registered on an app, as `METHOD path`. */
const registered = new WeakMap<Hono, Set<string>>();
/** The subset that checks the script trust (story 4.2). */
const trusted = new WeakMap<Hono, Set<string>>();

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
  if (error instanceof ScriptsNotTrustedError) return apiError(c, 409, 'scripts_not_trusted', SCRIPTS_NOT_TRUSTED_MESSAGE);
  if (error instanceof StatusNotAllowedError) return apiError(c, 409, 'status_not_allowed', STATUS_NOT_ALLOWED_MESSAGE);
  if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', notFound);
  // Story 4.2's other refusals, thrown by entries 4.3 to 4.11 as core errors with their shared code.
  if (error instanceof CoreError && (error.code === 'bmad_not_set_up' || error.code === 'reduced_mode' || error.code === 'bmad_not_downloaded' || error.code === 'bmad_already_set_up' || error.code === 'bmad_upgrade_refused')) {
    return apiError(c, 409, error.code, error.message);
  }
  throw error;
}

/**
 * The one way to register a route that serves a BMad piece (AD-22). Each
 * request first asks core's guard whether the route's workspace has the
 * piece (or one of the pieces) on, read at that moment: a well-formed but
 * unknown workspace answers 404 `not_found`, a malformed `:wsId` too, and a
 * piece that is off 409 `feature_off`. Then, for a route that runs the
 * project's own scripts, core's script trust: 409 `scripts_not_trusted`
 * until the user trusted the project (story 4.2). All of it before the
 * handler runs or the body is read. The handler's own `feature_off`,
 * `feature_unavailable`, `scripts_not_trusted`, `status_not_allowed` and
 * `not_found` from core answer the same way.
 *
 * `path` must lie inside a workspace (`/api/v1/workspaces/:wsId/…`), or
 * registering throws: a piece is always a project's. {@link guardedRouteKeys}
 * lists what was registered and {@link trustedRouteKeys} what checks the
 * trust, for the architecture tests.
 */
export function bmadPieceRoutes(app: Hono, { bmad, scriptTrust, log }: BmadPieceRoutesOptions): BmadPieceRoutes {
  const keys = registered.get(app) ?? new Set<string>();
  registered.set(app, keys);
  const trustKeys = trusted.get(app) ?? new Set<string>();
  trusted.set(app, trustKeys);
  const register =
    (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'): BmadPieceRouteRegistrar =>
    (piece, path, handler, options = {}) => {
      if (!path.startsWith(WORKSPACE_SCOPE)) throw new Error(`a BMad piece's route must be inside a workspace (${WORKSPACE_SCOPE}…): ${method} ${path}`);
      const pieces: readonly BmadPiece[] = typeof piece === 'string' ? [piece] : piece;
      if (pieces.length === 0) throw new Error(`a BMad piece's route must serve a piece: ${method} ${path}`);
      const needsTrust = options.projectScripts ?? pieces.some((each) => BMAD_PIECE_INFO[each].runsProjectScripts);
      if (needsTrust && scriptTrust === undefined) throw new Error(`a route that runs the project's scripts needs core's script trust: ${method} ${path}`);
      app.on(method, path, async (c) => {
        const scope = ids(c);
        if (scope === undefined) return apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);
        try {
          if (pieces.length === 1) bmad.requireBmadFeature(scope.workspaceId, pieces[0]!);
          else bmad.requireAnyBmadFeature(scope.workspaceId, pieces);
          // After the piece: a piece that is off says so, whatever the trust.
          if (needsTrust) scriptTrust!.requireScriptsTrusted(scope.workspaceId);
        } catch (error) {
          if (error instanceof FeatureOffError) log.info('BMad piece is off; route refused', { workspaceId: scope.workspaceId, piece: pieces.join(',') });
          if (error instanceof ScriptsNotTrustedError) log.info("project's scripts not trusted; route refused", { workspaceId: scope.workspaceId });
          return refusal(c, error, BMAD_PROJECT_NOT_FOUND_MESSAGE);
        }
        try {
          return await handler(c, { workspaceId: scope.workspaceId });
        } catch (error) {
          return refusal(c, error, BMAD_ITEM_NOT_FOUND_MESSAGE);
        }
      });
      keys.add(`${method} ${path}`);
      if (needsTrust) trustKeys.add(`${method} ${path}`);
    };
  return { get: register('GET'), post: register('POST'), patch: register('PATCH'), put: register('PUT'), delete: register('DELETE') };
}

/** Every route registered on `app` through {@link bmadPieceRoutes}, as sorted `METHOD path` keys. */
export function guardedRouteKeys(app: Hono): string[] {
  return [...(registered.get(app) ?? [])].sort();
}

/** The routes registered on `app` through {@link bmadPieceRoutes} that also check the script trust (story 4.2), sorted. */
export function trustedRouteKeys(app: Hono): string[] {
  return [...(trusted.get(app) ?? [])].sort();
}
