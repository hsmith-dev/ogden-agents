/**
 * The update notice (story 13.7): `GET` and `PUT /api/v1/updates`, and
 * `POST /api/v1/updates/check` (Check now), behind the gate (a tab token, and
 * a matching `Origin` on the writes; AD-15). Without the service the routes
 * answer 501.
 */
import { API_ROUTES, SetUpdateCheckRequest, UpdateCheckResponse, UpdateNoticeResponse } from '@ogden-agents/shared';
import type { ShellMode } from './shell-mode.js';
import type { DesktopUpdate } from './update-notice/desktop-update.js';
import { registerAppUpdateRoutes } from './update-notice/routes.js';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import { readBody } from './request-input.js';
import type { NpmNotice, UpdateCheck } from './update-check.js';

/** Largest body read (`{"enabled":false}`). */
const MAX_BODY_BYTES = 1024;

export function registerUpdateRoutes(
  app: Hono,
  { updates, desktop, shell }: { updates: UpdateCheck | undefined; desktop?: DesktopUpdate | undefined; shell?: ShellMode | null | undefined },
): void {
  // The desktop app's own calls (story 13.3): Restart to update and the channel.
  registerAppUpdateRoutes(app, { desktop });
  /** The npm notice plus whether this is the desktop app and its reported update. */
  const full = (notice: NpmNotice) => UpdateNoticeResponse.parse({ ...notice, shell: shell ?? null, appChannel: desktop?.channel() ?? null, app: desktop?.view() ?? null });
  if (updates === undefined) {
    app.get(API_ROUTES.updates, notImplemented);
    app.put(API_ROUTES.updates, notImplemented);
    app.post(API_ROUTES.updatesCheck, notImplemented);
    return;
  }
  app.get(API_ROUTES.updates, (c) => c.json(full(updates.notice())));
  app.put(
    API_ROUTES.updates,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
    async (c) => {
      const body = await readBody(c, SetUpdateCheckRequest);
      if (!body.ok) return body.response;
      return c.json(full(updates.setEnabled(body.value.enabled)));
    },
  );
  app.post(API_ROUTES.updatesCheck, async (c) => {
    const result = await updates.checkNow();
    return c.json(UpdateCheckResponse.parse({ outcome: result.outcome, notice: full(result.notice) }));
  });
}
