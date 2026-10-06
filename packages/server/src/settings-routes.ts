/**
 * Install-wide settings the server enforces (permission modes): Developer
 * mode. `GET` and `PUT` under `/api/v1/settings/developer-mode`, behind the
 * gate (a tab token, and a matching `Origin` on the `PUT`; AD-15). Core keeps
 * it and appends `settings.developer_mode_changed`; turning it off drops every
 * Skip-all chat to Ask in the same transaction. Without core's settings the
 * routes answer 501 and read no body.
 */
import { CoreError, type InstallSettings, type NewProjectDefaultsStore, type Panes } from '@ogden-agents/core';
import { API_ROUTES, ChatSettingsResponse, DeveloperModeResponse, SetChatSettingsRequest, SetDeveloperModeRequest } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** Largest Developer mode body read (`{"developerMode":false}`). */
const MAX_BODY_BYTES = 1024;

export interface SettingsRoutesOptions {
  installSettings?: Pick<InstallSettings, 'developerMode' | 'developerModeEverSet' | 'setDeveloperMode' | 'whileWorking' | 'setWhileWorking'> | undefined;
  /** The app-wide default for new projects: a Skip all default goes back to Ask when Developer mode is turned off. */
  newProjectDefaults?: Pick<NewProjectDefaultsStore, 'dropSkipAll'> | undefined;
  /** Terminal panes (epic 16, story 16.9): turning Developer mode off asks what to do with running ones. */
  panes?: Pick<Panes, 'runningCount' | 'keepRunningOnNextDeveloperModeOff'> | undefined;
  log: Logger;
}

export function registerSettingsRoutes(app: Hono, { installSettings, newProjectDefaults, panes, log }: SettingsRoutesOptions): void {
  if (installSettings === undefined) {
    app.get(API_ROUTES.developerMode, notImplemented);
    app.put(API_ROUTES.developerMode, notImplemented);
    app.get(API_ROUTES.chatSettings, notImplemented);
    app.put(API_ROUTES.chatSettings, notImplemented);
    return;
  }
  // Send now or wait: what a message sent while the agent works does, app-wide.
  app.get(API_ROUTES.chatSettings, (c) => c.json(ChatSettingsResponse.parse({ whileWorking: installSettings.whileWorking() })));
  app.put(
    API_ROUTES.chatSettings,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
    async (c) => {
      const body = await readBody(c, SetChatSettingsRequest);
      if (!body.ok) return body.response;
      try {
        const result = installSettings.setWhileWorking(body.value.whileWorking);
        if (result.changed) log.info('chat setting changed', { whileWorking: result.whileWorking });
        return c.json(ChatSettingsResponse.parse({ whileWorking: result.whileWorking }));
      } catch (error) {
        log.error('saving the chat setting failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
        return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save that setting. Try again.");
      }
    },
  );
  app.get(API_ROUTES.developerMode, (c) => c.json(DeveloperModeResponse.parse({ developerMode: installSettings.developerMode(), everSet: installSettings.developerModeEverSet() })));
  app.put(
    API_ROUTES.developerMode,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
    async (c) => {
      const body = await readBody(c, SetDeveloperModeRequest);
      if (!body.ok) return body.response;
      try {
        // Turning it off with terminals running asks first: stop them, or keep them running in the background until the server stops.
        if (!body.value.developerMode && installSettings.developerMode() && panes !== undefined) {
          const running = panes.runningCount();
          if (running > 0) {
            if (body.value.panes === undefined) {
              return apiError(c, 409, 'panes_running', running === 1 ? 'A terminal is still running. Stop it, or keep it running in the background until Ogden Agents stops?' : `${running} terminals are still running. Stop them, or keep them running in the background until Ogden Agents stops?`, { running });
            }
            panes.keepRunningOnNextDeveloperModeOff(body.value.panes === 'keep');
          }
        }
        let result: ReturnType<typeof installSettings.setDeveloperMode>;
        try {
          result = installSettings.setDeveloperMode(body.value.developerMode);
        } finally {
          // The choice is for this request only: a failed save must not decide a later one.
          panes?.keepRunningOnNextDeveloperModeOff(false);
        }
        // The app-wide default lives in a file, outside core's transaction: it already reads as Ask while Developer mode is off,
        // and is rewritten here so it stays Ask when Developer mode comes back (default permission mode).
        let appDefaultBackInAsk = false;
        if (!result.developerMode) {
          try {
            appDefaultBackInAsk = newProjectDefaults?.dropSkipAll() ?? false;
          } catch (error) {
            log.warn('new project defaults: Skip all not set back to Ask', { code: (error as NodeJS.ErrnoException).code ?? 'unexpected' });
          }
        }
        if (result.changed) {
          log.info('developer mode changed', {
            developerMode: result.developerMode,
            chatsBackInAsk: result.dropped.length,
            projectDefaultsBackInAsk: result.defaultsDropped,
            appDefaultBackInAsk,
          });
        }
        return c.json(DeveloperModeResponse.parse({ developerMode: result.developerMode, everSet: true }));
      } catch (error) {
        log.error('saving developer mode failed', { code: error instanceof CoreError ? error.code : 'unexpected' });
        return apiError(c, 500, 'internal_error', "Ogden Agents couldn't save Developer mode. Try again.");
      }
    },
  );
}
