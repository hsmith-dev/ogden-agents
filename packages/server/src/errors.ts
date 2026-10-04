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

/**
 * The answer of a route whose lane has not shipped yet (the story 2.3
 * stubs): 501 `not_implemented`. It never reads the request body, so nothing
 * sent to a stub (an API key, say) is parsed or logged.
 */
export function notImplemented(c: Context): Response {
  return apiError(c, 501, 'not_implemented', 'Ogden Agents cannot do this yet.');
}
