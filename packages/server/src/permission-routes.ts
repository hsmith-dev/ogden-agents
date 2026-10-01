/**
 * The permission routes (story 2.6): the user's answer on a permission card,
 * and the workspace's always-allow rules, which core stores and enforces
 * (E2-R3). Under `/api/v1`, behind the gate: a tab token on every request,
 * and a matching `Origin` on the POST and DELETE (AD-15). Routes call core's
 * permissions and never write themselves (AD-11). Without permissions to
 * answer (an app wired without core) each answers 501 `not_implemented`
 * without reading the body.
 */
import { NotFoundError, PermissionNotPendingError, ValidationError, type Permissions } from '@ogden-agents/core';
import { API_ROUTES, PermissionDecisionRequest, PermissionRequestId, PermissionRuleId, PermissionRulesResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ids, readBody } from './request-input.js';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface PermissionRoutesOptions {
  /** The same permissions core's chat asks (`core.permissions`). */
  permissions?: Permissions | undefined;
  log: Logger;
}

/** Largest decision body these routes read (a Deny reason is at most 2,000 characters). */
const MAX_BODY_BYTES = 64 * 1024;

const NOT_FOUND = 'There is no such project or chat.';
const RULE_NOT_FOUND = 'There is no such rule in this project.';
const NOT_PENDING = 'This request is no longer waiting for an answer.';

export function registerPermissionRoutes(app: Hono, options: PermissionRoutesOptions): void {
  const { permissions, log } = options;
  if (permissions === undefined) {
    app.post(API_ROUTES.sessionPermission, notImplemented);
    app.get(API_ROUTES.permissionRules, notImplemented);
    app.delete(API_ROUTES.permissionRule, notImplemented);
    return;
  }

  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'invalid_request', 'That reason is too long.'),
  });

  /** Core's refusals as API errors; anything else is left for `onError` (500). */
  const refusal = (c: Context, error: unknown, notFound = NOT_FOUND): Response => {
    if (error instanceof PermissionNotPendingError) return apiError(c, 409, 'permission_not_pending', NOT_PENDING);
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', notFound);
    if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    throw error;
  };

  // `POST PermissionDecisionRequest` → 204; 409 `permission_not_pending`.
  app.post(API_ROUTES.sessionPermission, limit, async (c) => {
    const scope = ids(c);
    if (scope?.sessionId === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    const body = await readBody(c, PermissionDecisionRequest);
    if (!body.ok) return body.response;
    const requestId = PermissionRequestId.safeParse(c.req.param('requestId'));
    if (!requestId.success) return apiError(c, 409, 'permission_not_pending', NOT_PENDING);
    try {
      permissions.decide(scope.workspaceId, scope.sessionId, requestId.data, body.value);
      // The reason is the user's words: never logged.
      log.info('permission decided', { workspaceId: scope.workspaceId, sessionId: scope.sessionId, decision: body.value.decision });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error);
    }
  });

  // `GET` → `PermissionRulesResponse`.
  app.get(API_ROUTES.permissionRules, (c) => {
    const scope = ids(c);
    if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      return c.json(PermissionRulesResponse.parse({ rules: permissions.listRules(scope.workspaceId) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // `DELETE` → 204: undoes an always-allow rule.
  app.delete(API_ROUTES.permissionRule, (c) => {
    const scope = ids(c);
    const ruleId = PermissionRuleId.safeParse(c.req.param('ruleId'));
    if (scope === undefined || !ruleId.success) return apiError(c, 404, 'not_found', RULE_NOT_FOUND);
    try {
      permissions.removeRule(scope.workspaceId, ruleId.data);
      log.info('always-allow rule removed', { workspaceId: scope.workspaceId, ruleId: ruleId.data });
      return c.body(null, 204);
    } catch (error) {
      return refusal(c, error, RULE_NOT_FOUND);
    }
  });
}
