import { ApiErrorCode } from '@ogden-agents/shared';
import type { TabAuth } from '@/auth/tab-token';

/**
 * The web app's one fetch-error helper: REST calls sent with this tab's
 * token, and a refusal turned into the server's plain message (the API error
 * body `{ error: { code, message } }`) or a fallback with the HTTP status.
 */

export type Auth = Pick<TabAuth, 'fetch'>;

/** What every call says when the server can't be reached at all. */
export const UNREACHABLE = "Couldn't reach Ogden Agents. Check that it is still running, then try again.";

/**
 * A refused request, with the server's plain message, its HTTP status (0:
 * unreachable) and its API error code when the body named a known one
 * (story 4.2: the Board tells `scripts_not_trusted` from other refusals).
 */
export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiErrorCode,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

/** The `error.message` and known `error.code` of a failed reply's body; `fallback` and no code when it has none (or is not JSON). */
async function errorOf(response: Response, fallback: string): Promise<{ message: string; code: ApiErrorCode | undefined }> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown; code?: unknown } };
    const code = ApiErrorCode.safeParse(body.error?.code);
    return { message: typeof body.error?.message === 'string' ? body.error.message : fallback, code: code.success ? code.data : undefined };
  } catch {
    // Not JSON: keep the fallback.
  }
  return { message: fallback, code: undefined };
}

/** The `error.message` of a failed reply's body, or `fallback` when it has none (or is not JSON). */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  return (await errorOf(response, fallback)).message;
}

/** Whether `error` is a refusal with the API error `code`. */
export function isApiError(error: unknown, code: ApiErrorCode): error is ChatApiError {
  return error instanceof ChatApiError && error.code === code;
}

async function send(auth: Auth, path: string, init: RequestInit, fallback: string): Promise<Response> {
  let response: Response;
  try {
    response = await auth.fetch(path, init);
  } catch {
    throw new ChatApiError(UNREACHABLE, 0);
  }
  if (response.ok) return response;
  const refusal = await errorOf(response, `${fallback} (error ${response.status}).`);
  throw new ChatApiError(refusal.message, response.status, refusal.code);
}

/** A call answered with JSON, or a `ChatApiError`. */
export async function call(auth: Auth, path: string, init: RequestInit, fallback: string): Promise<unknown> {
  return (await send(auth, path, init, fallback)).json();
}

/** A call answered 204 No Content (any 2xx), or a `ChatApiError`. */
export async function callNoContent(auth: Auth, path: string, init: RequestInit, fallback: string): Promise<void> {
  await send(auth, path, init, fallback);
}

/** A JSON `POST` body. */
export const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
