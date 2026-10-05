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
 * - `GET` and `PATCH /settings/notifications` (11.4): the webhooks (never
 *   their URL: its masked host only) and the browser notification switch.
 * - `POST /settings/notifications/webhooks` `AddWebhookRequest` → 201; 400
 *   for a URL that isn't `https:` (or `http:` to this computer) or no events,
 *   503 `secrets_unavailable` without a keychain (nothing stored).
 * - `PATCH` and `DELETE …/webhooks/:webhookId`, `POST …/webhooks/:webhookId/test`
 *   (`WebhookTestResult`, always 200 for a send that failed: its plain words are
 *   the answer); 404 for an unknown webhook.
 *
 * Without the notifications use-cases they answer 501 `not_implemented`.
 * Nothing logs or answers a webhook URL (AD-16).
 */
import { CoreError, NotFoundError, SecretsUnavailableError, ValidationError, type BuildSettings, type BuildsUseCases, type Notifications } from '@ogden-agents/core';
import { API_ROUTES, NotificationSettingsResponse, WebhookTestResult, WEBHOOK_SECRETS_UNAVAILABLE_MESSAGE } from '@ogden-agents/shared';
import { RunLimitSettingsResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** `{"maxConcurrentRunsPerInstall": 20, "maxRunMinutes": 480}` with room to spare. */
const MAX_BODY_BYTES = 1024;
/** `AddWebhookRequest`: a URL of up to 2048 characters (each up to 4 bytes, escaped) and its events. */
const NOTIFICATION_BODY_BYTES = 16 * 1024;

export interface RunSettingsRoutesOptions {
  buildSettings?: Pick<BuildSettings, 'runLimits' | 'setRunLimits'> | undefined;
  builds?: Pick<BuildsUseCases, 'dispatchQueued'> | undefined;
  /** The notification settings and webhooks (story 11.4). */
  notifications?: Notifications | undefined;
  log: Logger;
}

export function registerRunSettingsRoutes(app: Hono, { buildSettings, builds, notifications, log }: RunSettingsRoutesOptions): void {
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
  // Settings: Notifications (11.4). A webhook's URL is a secret (AD-16): it is never answered or logged.
  if (notifications === undefined) {
    app.get(API_ROUTES.notificationSettings, notImplemented);
    app.patch(API_ROUTES.notificationSettings, notImplemented);
    app.post(API_ROUTES.notificationWebhooks, notImplemented);
    app.patch(API_ROUTES.notificationWebhook, notImplemented);
    app.delete(API_ROUTES.notificationWebhook, notImplemented);
    app.post(API_ROUTES.notificationWebhookTest, notImplemented);
    return;
  }
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', 'There is no such webhook.');
    if (error instanceof SecretsUnavailableError) {
      log.warn('the keychain is unavailable', { code: typeof error.cause === 'string' ? error.cause : 'unknown' });
      return apiError(c, 503, 'secrets_unavailable', error.message === '' ? WEBHOOK_SECRETS_UNAVAILABLE_MESSAGE : WEBHOOK_SECRETS_UNAVAILABLE_MESSAGE);
    }
    log.error('a notification setting failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save that setting. Try again.");
  };
  const limit = bodyLimit({ maxSize: NOTIFICATION_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.') });
  const readBody = async (c: Context): Promise<{ body: unknown } | { response: Response }> => {
    try {
      return { body: JSON.parse(await c.req.text()) as unknown };
    } catch {
      return { response: apiError(c, 400, 'invalid_request', 'The request body must be JSON.') };
    }
  };
  app.get(API_ROUTES.notificationSettings, (c) => c.json(NotificationSettingsResponse.parse({ settings: notifications.settings() })));
  app.patch(API_ROUTES.notificationSettings, limit, async (c) => {
    const read = await readBody(c);
    if ('response' in read) return read.response;
    try {
      return c.json(NotificationSettingsResponse.parse({ settings: notifications.setBrowserNotifications(read.body) }));
    } catch (error) {
      return refusal(c, error);
    }
  });
  app.post(API_ROUTES.notificationWebhooks, limit, async (c) => {
    const read = await readBody(c);
    if ('response' in read) return read.response;
    try {
      const settings = await notifications.addWebhook(read.body);
      log.info('a webhook was added', { webhooks: settings.webhooks.length });
      return c.json(NotificationSettingsResponse.parse({ settings }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });
  app.patch(API_ROUTES.notificationWebhook, limit, async (c) => {
    const read = await readBody(c);
    if ('response' in read) return read.response;
    try {
      return c.json(NotificationSettingsResponse.parse({ settings: notifications.updateWebhook(c.req.param('webhookId'), read.body) }));
    } catch (error) {
      return refusal(c, error);
    }
  });
  app.delete(API_ROUTES.notificationWebhook, async (c) => {
    try {
      await notifications.removeWebhook(c.req.param('webhookId'));
      log.info('a webhook was removed', {});
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });
  app.post(API_ROUTES.notificationWebhookTest, async (c) => {
    try {
      return c.json(WebhookTestResult.parse(await notifications.testWebhook(c.req.param('webhookId'))));
    } catch (error) {
      return refusal(c, error);
    }
  });
}
