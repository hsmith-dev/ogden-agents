/**
 * The update notice (story 13.7): `GET` and `PUT /api/v1/updates`, and
 * `POST /api/v1/updates/check` (Check now), behind the gate (a tab token, and
 * a matching `Origin` on the writes; AD-15). Without the service the routes
 * answer 501.
 */
import { API_ROUTES, SetUpdateCheckRequest, UpdateCheckResponse, UpdateNoticeResponse } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import { readBody } from './request-input.js';
import type { UpdateCheck } from './update-check.js';

/** Largest body read (`{"enabled":false}`). */
const MAX_BODY_BYTES = 1024;

export function registerUpdateRoutes(app: Hono, { updates }: { updates: UpdateCheck | undefined }): void {
  if (updates === undefined) {
    app.get(API_ROUTES.updates, notImplemented);
    app.put(API_ROUTES.updates, notImplemented);
    app.post(API_ROUTES.updatesCheck, notImplemented);
    return;
  }
  app.get(API_ROUTES.updates, (c) => c.json(UpdateNoticeResponse.parse(updates.notice())));
  app.put(
    API_ROUTES.updates,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
    async (c) => {
      const body = await readBody(c, SetUpdateCheckRequest);
      if (!body.ok) return body.response;
      return c.json(UpdateNoticeResponse.parse(updates.setEnabled(body.value.enabled)));
    },
  );
  app.post(API_ROUTES.updatesCheck, async (c) => c.json(UpdateCheckResponse.parse(await updates.checkNow())));
}
