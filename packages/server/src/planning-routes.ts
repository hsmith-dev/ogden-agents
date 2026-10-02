/**
 * The Plan and Board routes (story 4.1, epic 4's tracer). Each is registered
 * through `bmadPieceRoutes`, so core's guard answers 409 `feature_off` for a
 * project with the piece off before the handler runs or the body is read
 * (AD-22); the use-cases call the guard again themselves.
 *
 * - `GET …/catalog` (`planning`) → `CatalogResponse`: the project's installed skills.
 * - `POST …/planning-sessions` (`planning`) `StartPlanningRequest` → 201
 *   `SessionResponse`: a `planning` session whose first message invokes the
 *   skill; 400 for a malformed body or name, 404 for a skill not in the catalog.
 * - `GET …/tickets` (`board`) → `TicketsResponse`; 503 `tickets_unavailable`
 *   with a plain message when they can't be read.
 *
 * Without the use-cases (an app wired without them) each answers 501 once
 * the guard has passed.
 */
import { TicketsUnavailableError, ValidationError, type BmadFeatures, type BoardUseCases, type PlanningUseCases } from '@ogden-agents/core';
import { API_ROUTES, CatalogResponse, SessionResponse, StartPlanningRequest, TicketsResponse } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { bmadPieceRoutes } from './bmad-pieces.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** A skill name is at most 64 characters: a body this size is plenty. */
const MAX_BODY_BYTES = 4 * 1024;

export interface PlanningRoutesOptions {
  /** Core's guard (AD-22). */
  bmad: BmadFeatures;
  /** The catalog and planning sessions; without it the `planning` routes answer 501. */
  planning?: PlanningUseCases | undefined;
  /** The project's tickets; without it the `board` route answers 501. */
  board?: BoardUseCases | undefined;
  log: Logger;
}

export function registerPlanningRoutes(app: Hono, { bmad, planning, board, log }: PlanningRoutesOptions): void {
  const routes = bmadPieceRoutes(app, { bmad, log });

  routes.get('planning', API_ROUTES.workspaceCatalog, async (c, { workspaceId }) => {
    if (planning === undefined) return notImplemented(c);
    return c.json(CatalogResponse.parse({ skills: await planning.catalog(workspaceId) }));
  });

  const limit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  routes.post('planning', API_ROUTES.workspacePlanningSessions, async (c, { workspaceId }) => {
    if (planning === undefined) return notImplemented(c);
    // The guard has passed, so the body limit applies here, after it.
    let response: Response | undefined;
    // A body over the limit answers 413 from `limit` itself, without calling on.
    const refused = await limit(c, async () => {
      const body = await readBody(c, StartPlanningRequest);
      if (!body.ok) {
        response = body.response;
        return;
      }
      try {
        const session = await planning.start(workspaceId, body.value.skill);
        log.info('planning session started', { workspaceId, sessionId: session.id, skill: body.value.skill });
        response = c.json(SessionResponse.parse({ session }), 201);
      } catch (error) {
        if (error instanceof ValidationError) {
          response = apiError(c, 400, 'invalid_request', error.message);
          return;
        }
        throw error;
      }
    });
    return response ?? refused ?? apiError(c, 413, 'invalid_request', 'That request is too large.');
  });

  routes.get('board', API_ROUTES.workspaceTickets, async (c, { workspaceId }) => {
    if (board === undefined) return notImplemented(c);
    try {
      return c.json(TicketsResponse.parse(await board.tickets(workspaceId)));
    } catch (error) {
      if (error instanceof TicketsUnavailableError) {
        log.warn('tickets unavailable', { workspaceId, reason: error.reason });
        return apiError(c, 503, 'tickets_unavailable', error.message);
      }
      throw error;
    }
  });
}
