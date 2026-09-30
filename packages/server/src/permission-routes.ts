/**
 * The permission routes (story 2.3 stubs; story 2.6 fills them): the user's
 * answer on a permission card, and the workspace's always-allow rules, which
 * core stores and enforces (E2-R3). Under `/api/v1`, behind the gate
 * (AD-15). Until 2.6 ships each answers 501 `not_implemented` without
 * reading the body.
 */
import type { Permissions } from '@ogden-agents/core';
import { API_ROUTES } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface PermissionRoutesOptions {
  /** The same permissions core's chat asks (`permissions.ts`, which 2.6 replaces). */
  permissions?: Permissions | undefined;
  log: Logger;
}

export function registerPermissionRoutes(app: Hono, options: PermissionRoutesOptions): void {
  // `POST PermissionDecisionRequest` → 204; 409 `permission_not_pending`.
  app.post(API_ROUTES.sessionPermission, notImplemented);
  // `GET` → `PermissionRulesResponse`.
  app.get(API_ROUTES.permissionRules, notImplemented);
  // `DELETE` → 204: undoes an always-allow rule.
  app.delete(API_ROUTES.permissionRule, notImplemented);
}
