import type { ApiErrorBody, ApiErrorCode } from '@ogden-agents/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * An API error response in the Conventions' shape,
 * `{ error: { code, message, details? } }`, with a code from `packages/shared`.
 */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const body: ApiErrorBody = { error: details === undefined ? { code, message } : { code, message, details } };
  return c.json(body, status);
}
