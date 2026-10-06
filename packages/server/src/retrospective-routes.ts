/**
 * The retrospective routes (story 7.1, epic 7's tracer; story 7.2
 * pre-registers the rest of the epic's), each registered through
 * `bmadPieceRoutes`: core's guard answers 409 `feature_off` for a project
 * with Retrospectives off and the script trust 409 `scripts_not_trusted`
 * until the user trusted the project, both before the handler runs (AD-22);
 * the use-case checks again.
 *
 * - `POST …/epics/:epic/look-back` (`retrospectives`, trust) → 201
 *   `SessionResponse`: a `planning` session whose first message invokes the
 *   retrospective skill on the epic's folder. 400 for a malformed epic name,
 *   404 for an epic the board doesn't have or a project whose BMad Method
 *   lacks the skill; the board's refusals (409 `bmad_not_downloaded`,
 *   `reduced_mode`, `scripts_changed`, 503 `tickets_unavailable`) as the board.
 *
 * Without the use-cases (an app wired without them) it answers 501 once the
 * guards have passed.
 */
import {
  NotFoundError,
  TicketsUnavailableError,
  ValidationError,
  type BmadFeatures,
  type BmadScriptTrust,
  type RetrospectiveUseCases,
} from '@ogden-agents/core';
import {
  API_ROUTES,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  LOOK_BACK_EPIC_NOT_FOUND_MESSAGE,
  LOOK_BACK_UNAVAILABLE_MESSAGE,
  SessionResponse,
} from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bmadPieceRoutes } from './bmad-pieces.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface RetrospectiveRoutesOptions {
  /** Core's guard (AD-22). */
  bmad: BmadFeatures;
  /** Core's script trust (story 4.2), checked for every retrospective route. */
  scriptTrust: Pick<BmadScriptTrust, 'requireScriptsTrusted'>;
  /** The look-back; without it the routes answer 501. */
  retrospectives?: RetrospectiveUseCases | undefined;
  log: Logger;
}

export function registerRetrospectiveRoutes(app: Hono, { bmad, scriptTrust, retrospectives, log }: RetrospectiveRoutesOptions): void {
  const routes = bmadPieceRoutes(app, { bmad, scriptTrust, log });

  routes.post('retrospectives', API_ROUTES.workspaceEpicLookBack, async (c, { workspaceId }) => {
    if (retrospectives === undefined) return notImplemented(c);
    try {
      const session = await retrospectives.lookBack(workspaceId, c.req.param('epic') ?? '');
      // The epic's name is the user's own files': never in the log.
      log.info('look back started', { workspaceId, sessionId: session.id });
      return c.json(SessionResponse.parse({ session }), 201);
    } catch (error) {
      if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
      // `bmad_not_downloaded`, `bmad_not_set_up` and `reduced_mode` from the board's guards answer 409 through the guarded helper.
      if (error instanceof TicketsUnavailableError) {
        log.warn('tickets unavailable', { workspaceId, reason: error.reason });
        return error.reason === 'not_downloaded' ? apiError(c, 409, 'bmad_not_downloaded', BMAD_NOT_DOWNLOADED_MESSAGE) : apiError(c, 503, 'tickets_unavailable', error.message);
      }
      // Which thing was missing: the epic (the board has no such epic) or the skill (the project's BMad Method lacks it).
      if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', error.message.startsWith('skill ') ? LOOK_BACK_UNAVAILABLE_MESSAGE : LOOK_BACK_EPIC_NOT_FOUND_MESSAGE);
      throw error;
    }
  });
}
