import { z } from 'zod';

/**
 * The API's error codes (Conventions: `snake_case`, kept here). Every 4xx and
 * 5xx the server answers on an API route has the body {@link ApiErrorBody}.
 */
export const API_ERROR_CODES = [
  /** No valid tab token (or launch code, or launcher token) (401). */
  'unauthorized',
  /** A wrong Host, or a missing or foreign Origin (403, AD-15). */
  'forbidden',
  /** A request body that fails its shared schema, or a workspace path that is not a folder (400). */
  'invalid_request',
  /** No such route (404), such as an old path outside `/api/v1`, or no such workspace or session. */
  'not_found',
  /** The session's agent is still answering the last message (409). */
  'session_busy',
  /** Quit was refused while agents are working; `details.busySessions` says how many (409). */
  'sessions_busy',
  /** uv's status or install could not be read or started (500). */
  'toolchain_unavailable',
  /** A route or socket request whose lane has not shipped yet (501; the story 2.3 stubs). */
  'not_implemented',
  /** A permission decision for a request that is no longer waiting: already decided, cancelled, or unknown (409). */
  'permission_not_pending',
  /** The app shortcut can't be added on this computer (422). */
  'shortcut_unsupported',
  /** An agent's install, sign-in or API key could not be done (500). The message says why in plain words. */
  'agent_setup_failed',
  /** Anything else that went wrong on the server (500). */
  'internal_error',
] as const;
export const ApiErrorCode = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** `{ "error": { "code", "message", "details"? } }`: every API error body. `message` is plain words for the user. */
export const ApiErrorBody = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
