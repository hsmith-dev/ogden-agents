/**
 * The install-level routes builds and notifications use (story 5.3
 * pre-registers them; 5.8 fills the run limits, 11.4 the notifications): the
 * run limits (`/api/v1/settings/run-limits`) and the notification settings
 * and webhooks (`/api/v1/settings/notifications…`). They serve the whole
 * install, not a project's piece, so they are behind the gate only, never
 * core's piece guard (E11-R1), and their paths name no BMad piece.
 *
 * - `GET /settings/run-limits` → `RunLimitSettingsResponse`.
 * - `PATCH /settings/run-limits` `UpdateRunLimitSettingsRequest` → the same;
 *   400 for a value out of bounds or none given. A raised limit may start a
 *   queued run.
 *
 * The notification routes answer 501 `not_implemented` and read no body
 * until 11.4.
 */
import { CoreError, ValidationError, type BuildSettings, type BuildsUseCases } from '@ogden-agents/core';
import { API_ROUTES, RunLimitSettingsResponse } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** `{"maxConcurrentRunsPerInstall": 20, "maxRunMinutes": 480}` with room to spare. */
const MAX_BODY_BYTES = 1024;

export interface RunSettingsRoutesOptions {
  buildSettings?: Pick<BuildSettings, 'runLimits' | 'setRunLimits'> | undefined;
  builds?: Pick<BuildsUseCases, 'dispatchQueued'> | undefined;
  log: Logger;
}

export function registerRunSettingsRoutes(app: Hono, { buildSettings, builds, log }: RunSettingsRoutesOptions): void {
  // The install's run limits (5.8).
  if (buildSettings === undefined) {
    app.get(API_ROUTES.runLimits, notImplemented);
    app.patch(API_ROUTES.runLimits, notImplemented);
  } else {
    app.get(API_ROUTES.runLimits, (c) => c.json(RunLimitSettingsResponse.parse({ settings: buildSettings.runLimits() })));
    app.patch(API_ROUTES.runLimits, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') }), async (c) => {
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
      }
      try {
        const settings = buildSettings.setRunLimits(body);
        log.info('run limits changed', { maxConcurrentRunsPerInstall: settings.maxConcurrentRunsPerInstall, maxRunMinutes: settings.maxRunMinutes });
        // A raised limit may free a slot for a queued run.
        void builds?.dispatchQueued().catch(() => undefined);
        return c.json(RunLimitSettingsResponse.parse({ settings }));
      } catch (error) {
        if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
        log.error('saving the run limits failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
        return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save that setting. Try again.");
      }
    });
  }
  // Settings: Notifications (11.4). A webhook's URL is a secret (AD-16): it is never answered.
  app.get(API_ROUTES.notificationSettings, notImplemented);
  app.patch(API_ROUTES.notificationSettings, notImplemented);
  app.post(API_ROUTES.notificationWebhooks, notImplemented);
  app.patch(API_ROUTES.notificationWebhook, notImplemented);
  app.delete(API_ROUTES.notificationWebhook, notImplemented);
  app.post(API_ROUTES.notificationWebhookTest, notImplemented);
}
