/**
 * The app-shortcut routes (story 2.3 stubs; story 2.4 fills them, E2-R10):
 * whether the Ogden Agents shortcut is there, adding and removing it through
 * `AppShortcutPort`, and dismissing its first-run offer. Under `/api/v1`,
 * behind the gate (AD-15). Until 2.4 ships each answers 501 `not_implemented`.
 */
import type { AppShortcutPort } from '@ogden-agents/core';
import { API_ROUTES } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface ShortcutRoutesOptions {
  appShortcut?: AppShortcutPort | undefined;
  log: Logger;
}

export function registerShortcutRoutes(app: Hono, options: ShortcutRoutesOptions): void {
  // `GET` → `AppShortcutStatus`; `POST` → 201 `AppShortcutStatus` (422 `shortcut_unsupported`); `DELETE` → 204.
  app.get(API_ROUTES.appShortcut, notImplemented);
  app.post(API_ROUTES.appShortcut, notImplemented);
  app.delete(API_ROUTES.appShortcut, notImplemented);
  // `DELETE` → 204: dismisses the first-run offer.
  app.delete(API_ROUTES.appShortcutOffer, notImplemented);
}
