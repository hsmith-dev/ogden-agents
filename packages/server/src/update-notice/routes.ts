/**
 * The desktop update routes (story 13.3). The shell's three calls sit under
 * `/launcher/` (the gate lets them through only with the launcher token, AD-15)
 * and answer 404 outside shell mode; the page's two calls sit under `/api/v1`
 * behind the gate's tab token and Origin check.
 */
import {
  API_ROUTES,
  AppUpdateRequestResponse,
  DesktopUpdateReport,
  RestartForUpdateRequest,
  RestartForUpdateResponse,
  SetUpdateChannelRequest,
  UpdateChannelResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError } from '../errors.js';
import { readBody } from '../request-input.js';
import type { DesktopUpdate } from './desktop-update.js';

/** The notes are capped at 4000 characters; the whole body at this. */
const MAX_BODY_BYTES = 32 * 1024;

export const LAUNCHER_APP_UPDATE = '/launcher/app-update';
export const LAUNCHER_UPDATE_CHANNEL = '/launcher/update-channel';

const tooLarge = (c: Context) => apiError(c, 413, 'invalid_request', 'The request is too large.');

/** The shell's calls. Registered only in shell mode, so elsewhere they are plain 404s. */
export function registerLauncherUpdateRoutes(app: Hono, { desktop }: { desktop: DesktopUpdate | undefined }): void {
  if (desktop === undefined) return;
  app.post(LAUNCHER_APP_UPDATE, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }), async (c) => {
    const body = await readBody(c, DesktopUpdateReport);
    if (!body.ok) return body.response;
    if (!desktop.report(body.value)) return apiError(c, 409, 'invalid_request', 'That update is not newer than this version.');
    return c.body(null, 204);
  });
  app.get(LAUNCHER_APP_UPDATE, (c) => c.json(AppUpdateRequestResponse.parse({ restart: desktop.pollRestart() }), 200, { 'Cache-Control': 'no-store' }));
  app.get(LAUNCHER_UPDATE_CHANNEL, (c) => c.json(UpdateChannelResponse.parse({ channel: desktop.channel() }), 200, { 'Cache-Control': 'no-store' }));
}

/** The page's calls: Restart to update, and the channel. */
export function registerAppUpdateRoutes(app: Hono, { desktop }: { desktop: DesktopUpdate | undefined }): void {
  if (desktop === undefined) {
    const notFound = (c: Context) => apiError(c, 404, 'not_found', 'Updates through the app are not available here.');
    app.post(API_ROUTES.updatesAppRestart, notFound);
    app.put(API_ROUTES.updatesAppChannel, notFound);
    return;
  }
  app.post(
    API_ROUTES.updatesAppRestart,
    bodyLimit({ maxSize: 1024, onError: tooLarge }),
    async (c) => {
      const body = await readBody(c, RestartForUpdateRequest, { optional: true });
      if (!body.ok) return body.response;
      const result = desktop.requestRestart(body.value.whenIdle === true);
      if (result === 'no_update') return apiError(c, 404, 'not_found', 'There is no update to install.');
      if (result === 'not_downloaded') return apiError(c, 409, 'invalid_request', 'The update is still downloading.');
      const reply = RestartForUpdateResponse.parse(result);
      if (!reply.requested) {
        return apiError(c, 409, 'sessions_busy', 'Agents are still working. Restart when they finish.', { busySessions: reply.busy });
      }
      return c.json(reply, 202, { 'Cache-Control': 'no-store' });
    },
  );
  app.put(API_ROUTES.updatesAppChannel, bodyLimit({ maxSize: 1024, onError: tooLarge }), async (c) => {
    const body = await readBody(c, SetUpdateChannelRequest);
    if (!body.ok) return body.response;
    return c.json(UpdateChannelResponse.parse({ channel: desktop.setChannel(body.value.channel) }));
  });
}
