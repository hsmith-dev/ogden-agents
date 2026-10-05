/**
 * The Unattended builds routes (story 5.2, epic 5's tracer). Each is
 * registered through `bmadPieceRoutes('builds', …)`, so core's guard answers
 * 409 `feature_off` for a project with Unattended builds off, and the
 * script trust 409 `scripts_not_trusted` until the user trusted the project,
 * both before the handler runs or the body is read (AD-22); the use-cases
 * check again, in board's order.
 *
 * - `POST …/builds` `StartBuildRequest` → 201 `BuildResponse`; 400 for a
 *   malformed body or ref, 404 for an unknown ticket, 409 with the build
 *   refusal's code (`prerequisite_unmet`, `not_ready`, `run_active`,
 *   `sandbox_unavailable`, `plan_uncommitted`, `vcs_unavailable`,
 *   `disk_space_low`), 409
 *   `bmad_not_downloaded`, 503 `tickets_unavailable`.
 * - `GET …/builds/:ref` → `ReviewResponse`: the ticket's latest run; 404 without one.
 * - `POST …/builds/:ref/approve` `ApproveBuildRequest` (the reviewed
 *   revision) → `ReviewResponse`; 400 without it, 409 `checks_failed`
 *   (also when the branch moved since), `checkout_dirty`, `merge_conflict`.
 * - `POST …/builds/:ref/reject` → `ReviewResponse`; 409 `run_active`, `checks_failed`.
 * - `POST …/builds/:ref/commit-plan` (story 5.5, no body) →
 *   `CommitPlanFilesResponse`: **Commit plan files**; 409 `checkout_dirty`,
 *   `vcs_unavailable`.
 * - `GET …/sessions/:sesId/run` → `SessionRunResponse`: a `build` session's run; 404 otherwise.
 * - `POST …/runs/:runId/retry` `RetryRunRequest` (story 5.4) → `RunResponse`
 *   for a run paused at a checkpoint (it resumes); 409 `run_not_active` for
 *   a run running, ready for review or decided; 501 for any other run until
 *   5.8; 400 for a malformed body or run id, 404 for another workspace's
 *   run, 409 `sandbox_unavailable`.
 *
 * Story 5.3 pre-registers the rest of epics 5 and 11, each behind the same
 * guard and trust, answering 501 `not_implemented` (no body read) until its
 * lane: `GET …/runs` and `GET …/runs/:runId` (11.1), `POST …/runs/:runId/stop`
 * and the rest of `…/retry` (5.8, 5.9, 11.1), `…/check-again` (11.2), and `GET` and
 * `PATCH …/build-settings` (5.8, 11.2). `POST …/builds` with `{ all: true }`
 * answers 501 until 5.8. A build's live activity is its session's events on
 * the existing `/ws` workspace subscription: no run socket exists.
 *
 * Without the use-cases each answers 501 once the guards have passed. A
 * failure of git answers 500 with a plain message (never git's output).
 */
import {
  BuildRefusedError,
  NotImplementedError,
  TicketsUnavailableError,
  ValidationError,
  VcsError,
  type BmadFeatures,
  type BmadScriptTrust,
  type BuildsUseCases,
} from '@ogden-agents/core';
import { API_ROUTES, BMAD_NOT_DOWNLOADED_MESSAGE, BuildResponse, CommitPlanFilesResponse, ReviewResponse, RunResponse, SessionId, SessionRunResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { bmadPieceRoutes } from './bmad-pieces.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** `{"ref": "<at most 128 characters>"}` with room to spare. */
const MAX_BUILD_BODY_BYTES = 1024;
/** `RetryRunRequest`: a note of up to `MAX_RUN_NOTE_LENGTH` characters, each up to 4 UTF-8 bytes, JSON-escaped, with room to spare. */
const MAX_RETRY_BODY_BYTES = 64 * 1024;

export interface BuildRoutesOptions {
  /** Core's guard (AD-22). */
  bmad: BmadFeatures;
  /** Core's script trust: every builds route runs, or leads to, the project's scripts. */
  scriptTrust: Pick<BmadScriptTrust, 'requireScriptsTrusted'>;
  /** The builds use-cases; without them every route answers 501. */
  builds?: BuildsUseCases | undefined;
  log: Logger;
}

export function registerBuildRoutes(app: Hono, { bmad, scriptTrust, builds, log }: BuildRoutesOptions): void {
  const routes = bmadPieceRoutes(app, { bmad, scriptTrust, log });

  /** The builds refusals and failures every route shares; anything else goes to the guarded helper (or 500). */
  const refused = (c: Context, workspaceId: string, error: unknown): Response => {
    if (error instanceof BuildRefusedError) {
      log.info('build refused', { workspaceId, code: error.code });
      return apiError(c, 409, error.code, error.message);
    }
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof NotImplementedError) return apiError(c, 501, 'not_implemented', error.message);
    if (error instanceof TicketsUnavailableError) {
      log.warn('tickets unavailable', { workspaceId, reason: error.reason });
      if (error.reason === 'not_downloaded') return apiError(c, 409, 'bmad_not_downloaded', BMAD_NOT_DOWNLOADED_MESSAGE);
      return apiError(c, 503, 'tickets_unavailable', error.message);
    }
    if (error instanceof VcsError) {
      log.warn('git failed', { workspaceId, ...error.details });
      return apiError(c, 500, 'internal_error', error.message);
    }
    throw error;
  };

  const limit = bodyLimit({ maxSize: MAX_BUILD_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  const retryLimit = bodyLimit({ maxSize: MAX_RETRY_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  routes.post('builds', API_ROUTES.workspaceBuilds, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    let response: Response | undefined;
    // The guards have passed, so the body limit applies here, after them; over it, `limit` answers 413 itself.
    const tooLarge = await limit(c, async () => {
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        response = apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
        return;
      }
      try {
        const started = await builds.start(workspaceId, body);
        log.info('build started', { workspaceId, runId: started.run.id, sessionId: started.session.id, ref: started.run.ticketRef, sandbox: started.run.sandbox });
        response = c.json(BuildResponse.parse(started), 201);
      } catch (error) {
        response = refused(c, workspaceId, error);
      }
    });
    return response ?? tooLarge ?? apiError(c, 413, 'invalid_request', 'That request is too large.');
  });

  routes.get('builds', API_ROUTES.workspaceBuild, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    try {
      return c.json(ReviewResponse.parse(await builds.review(workspaceId, c.req.param('ref') ?? '')));
    } catch (error) {
      return refused(c, workspaceId, error);
    }
  });

  routes.post('builds', API_ROUTES.workspaceBuildApprove, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    let response: Response | undefined;
    // `{ revision }`: the branch revision the user reviewed (review loop 1).
    const tooLarge = await limit(c, async () => {
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        response = apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
        return;
      }
      try {
        const review = ReviewResponse.parse(await builds.approve(workspaceId, c.req.param('ref') ?? '', body));
        log.info('build approved and merged', { workspaceId, runId: review.run.id, ref: review.run.ticketRef });
        response = c.json(review);
      } catch (error) {
        response = refused(c, workspaceId, error);
      }
    });
    return response ?? tooLarge ?? apiError(c, 413, 'invalid_request', 'That request is too large.');
  });

  routes.post('builds', API_ROUTES.workspaceBuildReject, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    try {
      const review = ReviewResponse.parse(await builds.reject(workspaceId, c.req.param('ref') ?? ''));
      log.info('build rejected', { workspaceId, runId: review.run.id, ref: review.run.ticketRef });
      return c.json(review);
    } catch (error) {
      return refused(c, workspaceId, error);
    }
  });

  // Story 5.5: Commit plan files (no body).
  routes.post('builds', API_ROUTES.workspaceBuildCommitPlan, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    try {
      const committed = CommitPlanFilesResponse.parse(await builds.commitPlanFiles(workspaceId, c.req.param('ref') ?? ''));
      log.info('plan files committed', { workspaceId, files: committed.committed.length });
      return c.json(committed);
    } catch (error) {
      return refused(c, workspaceId, error);
    }
  });

  // Story 5.3: every other route of epics 5 and 11, guarded and trusted, 501 until its lane fills it.
  const notYet = (c: Context): Response => notImplemented(c);
  routes.get('builds', API_ROUTES.workspaceRuns, notYet);
  routes.get('builds', API_ROUTES.workspaceRun, notYet);
  routes.post('builds', API_ROUTES.runStop, notYet);
  // Story 5.4: Retry resumes a run paused at a checkpoint; any other Retry answers 501 until 5.8.
  routes.post('builds', API_ROUTES.runRetry, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    let response: Response | undefined;
    const tooLarge = await retryLimit(c, async () => {
      let body: unknown = {};
      const text = await c.req.text();
      if (text.trim() !== '') {
        try {
          body = JSON.parse(text);
        } catch {
          response = apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
          return;
        }
      }
      try {
        const run = await builds.retry(workspaceId, c.req.param('runId') ?? '', body);
        log.info('build resumed', { workspaceId, runId: run.id, ref: run.ticketRef });
        response = c.json(RunResponse.parse({ run }));
      } catch (error) {
        response = refused(c, workspaceId, error);
      }
    });
    return response ?? tooLarge ?? apiError(c, 413, 'invalid_request', 'That request is too large.');
  });
  routes.post('builds', API_ROUTES.runCheckAgain, notYet);
  routes.get('builds', API_ROUTES.workspaceBuildSettings, notYet);
  routes.patch('builds', API_ROUTES.workspaceBuildSettings, notYet);

  routes.get('builds', API_ROUTES.sessionRun, async (c, { workspaceId }) => {
    if (builds === undefined) return notImplemented(c);
    const session = SessionId.safeParse(c.req.param('sesId'));
    if (!session.success) return apiError(c, 404, 'not_found', 'There is no such session.');
    try {
      return c.json(SessionRunResponse.parse({ run: await builds.runOfSession(workspaceId, session.data) }));
    } catch (error) {
      return refused(c, workspaceId, error);
    }
  });
}
