/**
 * The install's orchestration defaults over REST (epic 15, story 15.8): `GET` and `PUT /api/v1/settings/orchestration`, the mode new
 * projects are offered and the limits of every run, install-level preferences behind the gate (a `PUT` changes state, so the gate has
 * checked its Origin). Core checks every limit against its bounds and asks for the user's confirmation before Dispatch automatically
 * becomes the default (400 `confirmation_required`); a project's own mode is never changed here. Without core's use-case the routes
 * answer 501 and read no body.
 */
import { ConfirmationRequiredError, CoreError, type OrchestrationDefaultsUseCase } from '@ogden-agents/core';
import { API_ROUTES, OrchestrationDefaultsResponse, UpdateOrchestrationDefaultsRequest } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** A mode, three numbers and a flag. */
const MAX_BODY_BYTES = 1024;

export function registerOrchestrationDefaultsRoutes(app: Hono, { defaults, log }: { defaults?: OrchestrationDefaultsUseCase | undefined; log: Logger }): void {
  if (defaults === undefined) {
    app.get(API_ROUTES.orchestrationDefaults, notImplemented);
    app.put(API_ROUTES.orchestrationDefaults, notImplemented);
    return;
  }
  app.get(API_ROUTES.orchestrationDefaults, (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(OrchestrationDefaultsResponse.parse({ defaults: defaults.get() }));
  });
  app.put(
    API_ROUTES.orchestrationDefaults,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
    async (c) => {
      const body = await readBody(c, UpdateOrchestrationDefaultsRequest);
      if (!body.ok) return body.response;
      try {
        const saved = defaults.set(body.value);
        log.info('orchestration defaults saved', { mode: saved.mode, ...saved.limits });
        return c.json(OrchestrationDefaultsResponse.parse({ defaults: saved }));
      } catch (error) {
        if (error instanceof ConfirmationRequiredError) return apiError(c, 400, 'confirmation_required', error.message);
        if (error instanceof CoreError && error.code === 'invalid_input') return apiError(c, 400, 'invalid_request', error.message);
        log.error('saving the orchestration defaults failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
        return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save that. Try again.");
      }
    },
  );
}
