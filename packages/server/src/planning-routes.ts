/**
 * The Plan and Board routes (story 4.1, epic 4's tracer; story 4.2
 * pre-registers the rest of the epic's). Each is registered through
 * `bmadPieceRoutes`, so core's guard answers 409 `feature_off` for a project
 * with the piece off, and, for a route that runs the project's own BMad
 * Method scripts (every `board` route), the script trust answers 409
 * `scripts_not_trusted` until the user trusted the project, both before the
 * handler runs or the body is read (AD-22); the use-cases check again.
 *
 * - `GET …/catalog` (`planning`) → `CatalogResponse`: the project's catalog.
 * - `POST …/planning-sessions` (`planning`) `StartPlanningRequest` → 201
 *   `SessionResponse`: a `planning` session whose first message invokes the
 *   skill, with the idea when given; 400 for a malformed body, name or idea,
 *   404 for a skill not in the catalog.
 * - `GET …/tickets` (`board`, trust) → `TicketsResponse`; 503
 *   `tickets_unavailable` with a plain message when they can't be read.
 * - `GET …/tickets/:ref` and `PUT …/tickets/:ref/status` (`board`, trust):
 *   501 until entries 4.9 and 4.10 fill them.
 * - `GET` and `POST …/bmad/setup` (`planning` or `board`; runs only the
 *   bundled `setup.py`, so no trust): 501 until entry 4.3 fills them.
 *
 * Without the use-cases (an app wired without them) each answers 501 once
 * the guards have passed.
 */
import { TicketsUnavailableError, ValidationError, type BmadFeatures, type BmadScriptTrust, type BoardUseCases, type PlanningUseCases } from '@ogden-agents/core';
import { API_ROUTES, CatalogResponse, MAX_IDEA_LENGTH, SessionResponse, StartPlanningRequest, TicketsResponse } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { bmadPieceRoutes } from './bmad-pieces.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** A skill name and an idea (at most `MAX_IDEA_LENGTH` characters of up to 4 bytes each): a body this size is plenty. */
const MAX_BODY_BYTES = 4 * 1024 + 4 * MAX_IDEA_LENGTH;

export interface PlanningRoutesOptions {
  /** Core's guard (AD-22). */
  bmad: BmadFeatures;
  /** Core's script trust (story 4.2), checked for every `board` route. */
  scriptTrust: Pick<BmadScriptTrust, 'requireScriptsTrusted'>;
  /** The catalog and planning sessions; without it the `planning` routes answer 501. */
  planning?: PlanningUseCases | undefined;
  /** The project's tickets; without it the `board` route answers 501. */
  board?: BoardUseCases | undefined;
  log: Logger;
}

export function registerPlanningRoutes(app: Hono, { bmad, scriptTrust, planning, board, log }: PlanningRoutesOptions): void {
  const routes = bmadPieceRoutes(app, { bmad, scriptTrust, log });

  routes.get('planning', API_ROUTES.workspaceCatalog, async (c, { workspaceId }) => {
    if (planning === undefined) return notImplemented(c);
    return c.json(CatalogResponse.parse(await planning.catalog(workspaceId)));
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
        const session = await planning.start(workspaceId, body.value.skill, body.value.idea);
        // Never the idea: it is the user's own words.
        log.info('planning session started', { workspaceId, sessionId: session.id, skill: body.value.skill, withIdea: body.value.idea !== undefined });
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

  // Pre-registered by story 4.2, so their entries only fill them: each answers 501 once the guards pass.
  routes.get('board', API_ROUTES.workspaceTicket, (c) => notImplemented(c));
  routes.put('board', API_ROUTES.workspaceTicketStatus, (c) => notImplemented(c));
  // BMad Method's setup runs the bundled `setup.py`, never the project's own code (entry 4.3 confirms it).
  routes.get(['planning', 'board'], API_ROUTES.workspaceBmadSetup, (c) => notImplemented(c), { projectScripts: false });
  routes.post(['planning', 'board'], API_ROUTES.workspaceBmadSetup, (c) => notImplemented(c), { projectScripts: false });
}
