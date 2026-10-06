/**
 * The Terminals settings routes (epic 16, story 16.9): `GET` and `PUT`
 * `/api/v1/settings/terminals`, behind the gate and Developer mode (403
 * `developer_mode_required` without it: the surface is Developer mode's, and
 * the server says so, not only the page). A change is core's and appends
 * `settings.terminals_changed`. A launcher's arguments are the user's own text:
 * never logged. Without core's store the routes answer 501.
 */
import { CoreError, DeveloperModeRequiredError, PANES_NEED_DEVELOPER_MODE, ValidationError, type InstallSettings, type TerminalsSettingsStore } from '@ogden-agents/core';
import { API_ROUTES, TerminalsSettingsResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

/** Up to 32 launchers' arguments of 500 characters each, with room to spare. */
const MAX_BODY_BYTES = 32 * 1024;

export interface TerminalsSettingsRoutesOptions {
  terminalsSettings?: TerminalsSettingsStore | undefined;
  installSettings?: Pick<InstallSettings, 'developerMode'> | undefined;
  log: Logger;
}

export function registerTerminalsSettingsRoutes(app: Hono, { terminalsSettings, installSettings, log }: TerminalsSettingsRoutesOptions): void {
  if (terminalsSettings === undefined || installSettings === undefined) {
    app.get(API_ROUTES.terminalSettings, notImplemented);
    app.put(API_ROUTES.terminalSettings, notImplemented);
    return;
  }
  const refuse = (c: Context, error: unknown): Response => {
    if (error instanceof DeveloperModeRequiredError) return apiError(c, 403, 'developer_mode_required', error.message);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    log.error('saving the Terminals settings failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
    return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save that setting. Try again.");
  };
  const requireDeveloperMode = () => {
    if (!installSettings.developerMode()) throw new DeveloperModeRequiredError(PANES_NEED_DEVELOPER_MODE);
  };
  app.get(API_ROUTES.terminalSettings, (c) => {
    try {
      requireDeveloperMode();
      return c.json(TerminalsSettingsResponse.parse({ settings: terminalsSettings.get() }));
    } catch (error) {
      return refuse(c, error);
    }
  });
  app.put(API_ROUTES.terminalSettings, bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }), async (c) => {
    try {
      requireDeveloperMode();
      let json: unknown;
      try {
        json = JSON.parse(await c.req.text());
      } catch {
        return apiError(c, 400, 'invalid_request', 'The request body must be JSON.');
      }
      const before = terminalsSettings.get();
      const after = terminalsSettings.update(json);
      // Which parts changed, never their values (a launcher's arguments are the user's own text).
      if (after !== before) log.info('terminals settings changed', { hidden: after.hidden, notifyLaunchers: after.notifyLaunchers.length, passProxies: after.passProxies, passSshAgent: after.passSshAgent });
      return c.json(TerminalsSettingsResponse.parse({ settings: after }));
    } catch (error) {
      return refuse(c, error);
    }
  });
}
