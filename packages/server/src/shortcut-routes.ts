/**
 * The app-shortcut routes (story 2.4, E2-R10): whether the Ogden Agents
 * shortcut is there, adding and removing it through `AppShortcutPort`, and
 * dismissing its first-run offer. Under `/api/v1`, behind the gate (AD-15).
 * None reads a body. A port refusal is 422 `shortcut_unsupported` with its
 * plain words; the log gets only an error code, never a path.
 */
import type { AppShortcutPort } from '@ogden-agents/core';
import { API_ROUTES, AppShortcutStatus } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError } from './errors.js';
import type { Logger } from './log.js';

export interface ShortcutRoutesOptions {
  appShortcut?: AppShortcutPort | undefined;
  log: Logger;
}

const UNSUPPORTED = "An app shortcut can't be added on this computer.";

/** `AppShortcutStatus` from the port: the offer is pending until it is answered or a shortcut is there. */
export async function shortcutStatus(appShortcut: AppShortcutPort | undefined): Promise<AppShortcutStatus> {
  if (appShortcut === undefined) return { platform: process.platform, supported: false, installed: false, offerPending: false };
  const state = await appShortcut.status();
  return AppShortcutStatus.parse({
    platform: state.platform,
    supported: state.supported,
    installed: state.installed,
    offerPending: state.supported && !state.installed && !state.offerDismissed,
  });
}

/** An error code for the log: the cause's (`EACCES`, say), never its message, which may name a path. */
export function shortcutErrorCode(error: unknown): string {
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown';
}

export function registerShortcutRoutes(app: Hono, options: ShortcutRoutesOptions): void {
  const { appShortcut, log } = options;

  const refused = (c: Context, what: string, error: unknown): Response => {
    log.warn(what, { code: shortcutErrorCode(error) });
    const message = error instanceof Error && error.message !== '' ? error.message : UNSUPPORTED;
    return apiError(c, 422, 'shortcut_unsupported', message);
  };

  app.get(API_ROUTES.appShortcut, async (c) => c.json(await shortcutStatus(appShortcut)));

  app.post(API_ROUTES.appShortcut, async (c) => {
    if (appShortcut === undefined) return apiError(c, 422, 'shortcut_unsupported', UNSUPPORTED);
    try {
      await appShortcut.add();
    } catch (error) {
      return refused(c, 'the app shortcut could not be added', error);
    }
    // Adding answers the first-run offer: it never shows again, even after a Remove.
    // The shortcut is there either way, so a failure here is only logged.
    try {
      await appShortcut.dismissOffer();
    } catch (error) {
      log.warn('the app shortcut offer could not be dismissed', { code: shortcutErrorCode(error) });
    }
    log.info('app shortcut added');
    return c.json(await shortcutStatus(appShortcut), 201);
  });

  app.delete(API_ROUTES.appShortcut, async (c) => {
    if (appShortcut !== undefined) {
      try {
        await appShortcut.remove();
      } catch (error) {
        return refused(c, 'the app shortcut could not be removed', error);
      }
      log.info('app shortcut removed');
    }
    return c.body(null, 204);
  });

  app.delete(API_ROUTES.appShortcutOffer, async (c) => {
    try {
      await appShortcut?.dismissOffer();
    } catch (error) {
      return refused(c, 'the app shortcut offer could not be dismissed', error);
    }
    return c.body(null, 204);
  });
}
