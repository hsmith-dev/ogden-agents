import type { TabAuth } from '@/auth/tab-token';

/**
 * The web app's one fetch-error helper: REST calls sent with this tab's
 * token, and a refusal turned into the server's plain message (the API error
 * body `{ error: { code, message } }`) or a fallback with the HTTP status.
 */

export type Auth = Pick<TabAuth, 'fetch'>;

/** What every call says when the server can't be reached at all. */
export const UNREACHABLE = "Couldn't reach Ogden Agents. Check that it is still running, then try again.";

/** A refused request, with the server's plain message and its HTTP status (0: unreachable). */
export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

/** The `error.message` of a failed reply's body, or `fallback` when it has none (or is not JSON). */
export async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON: keep the fallback.
  }
  return fallback;
}

async function send(auth: Auth, path: string, init: RequestInit, fallback: string): Promise<Response> {
  let response: Response;
  try {
    response = await auth.fetch(path, init);
  } catch {
    throw new ChatApiError(UNREACHABLE, 0);
  }
  if (response.ok) return response;
  throw new ChatApiError(await errorMessage(response, `${fallback} (error ${response.status}).`), response.status);
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
