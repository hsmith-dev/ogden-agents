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
 * - `GET …/tickets` (`board`, trust) → `TicketsResponse`; 409
 *   `bmad_not_downloaded` before the pinned BMad Method is downloaded
 *   (story 4.14; nothing runs); 503 `tickets_unavailable` with a plain
 *   message when they can't be read.
 * - `GET …/tickets/:ref` (`board`, trust) → `TicketResponse` (story 4.8):
 *   one ticket; 400 for a malformed ref, 404 when no ticket matches, 409
 *   `bmad_not_downloaded` and 503 `tickets_unavailable` as the tree.
 * - `PUT …/tickets/:ref/status` (`board`, trust): 501 until entry 4.10
 *   fills it.
 * - `GET …/bmad/setup` (`planning` or `board`; no trust; entry 4.3) →
 *   `BmadSetupStatusResponse`, read from the project's files only (no
 *   process, no network).
 * - `POST …/bmad/setup` (the same; runs only the verified pinned `setup.py`,
 *   downloading it first) → 202 `BmadSetupStartedResponse`: a setup started (`started: false` when one already runs); progress
 *   follows as `bmad.setup_*` events. 409 `bmad_already_set_up` when the
 *   project already has `_bmad/`, nothing written.
 *
 * - `GET …/documents?path=` (`planning`; no trust: it reads one file, runs
 *   nothing; story 4.7) → `DocumentResponse`: a Markdown document inside
 *   the project's output folder; 400 for a malformed path, one outside the
 *   folder or not `.md`, 404 when it is missing or its real path leaves the
 *   folder.
 *
 * Without the use-cases (an app wired without them) each answers 501 once
 * the guards have passed.
 */
import {
  NotFoundError,
  TicketsUnavailableError,
  ValidationError,
  type BmadFeatures,
  type BmadScriptTrust,
  type BmadSetupUseCases,
  type BoardUseCases,
  type PlanningUseCases,
} from '@ogden-agents/core';
import {
  API_ROUTES,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  BmadSetupStartedResponse,
  BmadSetupStatusResponse,
  CatalogResponse,
  DOCUMENT_NOT_FOUND_TEXT,
  DocumentResponse,
  MAX_IDEA_LENGTH,
  SessionResponse,
  StartPlanningRequest,
  TicketResponse,
  TicketsResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
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
  /** BMad Method's setup (entry 4.3); without it the setup routes answer 501. */
  bmadSetup?: BmadSetupUseCases | undefined;
  log: Logger;
}

export function registerPlanningRoutes(app: Hono, { bmad, scriptTrust, planning, board, bmadSetup, log }: PlanningRoutesOptions): void {
  const routes = bmadPieceRoutes(app, { bmad, scriptTrust, log });

  /** A store that can't answer: 503 `tickets_unavailable`, or 409 `bmad_not_downloaded` when the verified `tickets.py` is gone. */
  const ticketsUnavailable = (c: Context, workspaceId: string, error: TicketsUnavailableError): Response => {
    log.warn('tickets unavailable', { workspaceId, reason: error.reason });
    // The marker says downloaded but the verified `tickets.py` is gone: the same answer as not downloaded,
    // so the Board offers Download, which re-checks the copy and downloads it again (story 4.14).
    if (error.reason === 'not_downloaded') return apiError(c, 409, 'bmad_not_downloaded', BMAD_NOT_DOWNLOADED_MESSAGE);
    return apiError(c, 503, 'tickets_unavailable', error.message);
  };

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
      if (error instanceof TicketsUnavailableError) return ticketsUnavailable(c, workspaceId, error);
      throw error;
    }
  });

  // One ticket (story 4.8): a `NotFoundError` answers 404 through the guarded helper.
  routes.get('board', API_ROUTES.workspaceTicket, async (c, { workspaceId }) => {
    if (board === undefined) return notImplemented(c);
    try {
      return c.json(TicketResponse.parse({ ticket: await board.ticket(workspaceId, c.req.param('ref') ?? '') }));
    } catch (error) {
      if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
      if (error instanceof TicketsUnavailableError) return ticketsUnavailable(c, workspaceId, error);
      throw error;
    }
  });

  // A document a planning session wrote (story 4.7): read-only, confined to the output folder.
  routes.get(
    'planning',
    API_ROUTES.workspaceDocument,
    async (c, { workspaceId }) => {
      if (planning === undefined) return notImplemented(c);
      try {
        return c.json(DocumentResponse.parse({ document: await planning.document(workspaceId, c.req.query('path')) }));
      } catch (error) {
        if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
        // Never the path in the answer or the log: it is the user's.
        if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', DOCUMENT_NOT_FOUND_TEXT);
        throw error;
      }
    },
    { projectScripts: false },
  );

  // Pre-registered by story 4.2, so its entry only fills it: it answers 501 once the guards pass.
  routes.put('board', API_ROUTES.workspaceTicketStatus, (c) => notImplemented(c));
  // BMad Method's setup runs the verified pinned `setup.py`, never the project's own code (the entry 4.3 trust proof).
  routes.get(
    ['planning', 'board'],
    API_ROUTES.workspaceBmadSetup,
    async (c, { workspaceId }) => {
      if (bmadSetup === undefined) return notImplemented(c);
      return c.json(BmadSetupStatusResponse.parse({ setup: await bmadSetup.status(workspaceId) }));
    },
    { projectScripts: false },
  );
  routes.post(
    ['planning', 'board'],
    API_ROUTES.workspaceBmadSetup,
    async (c, { workspaceId }) => {
      if (bmadSetup === undefined) return notImplemented(c);
      // No body is read: setup takes no input but the workspace.
      const started = await bmadSetup.start(workspaceId);
      if (started.started) log.info('BMad Method setup started', { workspaceId });
      return c.json(BmadSetupStartedResponse.parse(started), 202);
    },
    { projectScripts: false },
  );
}
