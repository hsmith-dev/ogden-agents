/**
 * The install-level routes builds and notifications use (story 5.3
 * pre-registers them for 5.8 and 11.4): the run limits
 * (`/api/v1/settings/run-limits`) and the notification settings and
 * webhooks (`/api/v1/settings/notifications…`). They serve the whole
 * install, not a project's piece, so they are behind the gate only, never
 * core's piece guard (E11-R1), and their paths name no BMad piece. Each
 * answers 501 `not_implemented` and reads no body until its lane.
 */
import { API_ROUTES } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { notImplemented } from './errors.js';

export function registerRunSettingsRoutes(app: Hono): void {
  // The install's run limits (5.8).
  app.get(API_ROUTES.runLimits, notImplemented);
  app.patch(API_ROUTES.runLimits, notImplemented);
  // Settings: Notifications (11.4). A webhook's URL is a secret (AD-16): it is never answered.
  app.get(API_ROUTES.notificationSettings, notImplemented);
  app.patch(API_ROUTES.notificationSettings, notImplemented);
  app.post(API_ROUTES.notificationWebhooks, notImplemented);
  app.patch(API_ROUTES.notificationWebhook, notImplemented);
  app.delete(API_ROUTES.notificationWebhook, notImplemented);
  app.post(API_ROUTES.notificationWebhookTest, notImplemented);
}
