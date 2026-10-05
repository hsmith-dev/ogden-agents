/**
 * The one way Ogden's server calls an OpenAI-compatible endpoint (epic 14):
 * only the server calls out (AD-15's gate and the CSP are unchanged), never
 * the browser. A request goes only to the configured base URL, with the key
 * (if the endpoint has one) only in the `Authorization` header, redirects
 * refused (a redirect could carry the key to another host), a hard timeout
 * and a cap on how much of an answer is read. Neither a key nor a response
 * body is ever logged: a failure carries a kind and a status code.
 */

/** How long a call may take before it counts as failed. */
export const DEFAULT_TIMEOUT_MS = 5_000;
/** The most of an answer that is read (a model list is small; a chat completion is capped by the caller). */
export const DEFAULT_MAX_BYTES = 1024 * 1024;

export type EndpointFailureKind =
  /** Nothing is listening, or the host is not found. */
  | 'unreachable'
  /** No answer within the time allowed. */
  | 'timeout'
  /** The server said the key is missing or wrong (401 or 403). */
  | 'key_refused'
  /** It answered, but not as an OpenAI-compatible server does. */
  | 'not_openai'
  /** An HTTP error other than a refused key. */
  | 'http'
  /** The answer was larger than allowed. */
  | 'too_large'
  /** It answered with a redirect, which is never followed (a key could be carried to another host). */
  | 'redirected';

export class EndpointError extends Error {
  override readonly name = 'EndpointError';
  constructor(
    readonly kind: EndpointFailureKind,
    readonly details: { status?: number; code?: string } = {},
  ) {
    super(`endpoint ${kind}`);
  }
}

export interface EndpointCall {
  /** The endpoint's base URL (`http://localhost:1234/v1`). */
  baseUrl: string;
  /** The endpoint's key, when it has one. Only ever sent as a bearer token. */
  key?: string | undefined;
  /** Default: the global `fetch`. Tests pass a fake: no test ever reaches a real server. */
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** `baseUrl` with `path` joined on (`/models`), whatever trailing slashes it has. */
export function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

const codeOf = (error: unknown): string => {
  const cause = (error as { cause?: unknown } | undefined)?.cause ?? error;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'unknown';
};

/**
 * One call to `path` on the endpoint; resolves with the parsed JSON answer.
 * Rejects with an {@link EndpointError}; never throws anything else.
 */
export async function callEndpoint(call: EndpointCall, path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
  const fetchImpl = call.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  call.signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(endpointUrl(call.baseUrl, path), {
        method: init.method ?? 'GET',
        headers: {
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(call.key === undefined || call.key === '' ? {} : { authorization: `Bearer ${call.key}` }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new EndpointError('timeout');
      if (call.signal?.aborted) throw new EndpointError('unreachable', { code: 'aborted' });
      throw new EndpointError('unreachable', { code: codeOf(error) });
    }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new EndpointError('redirected', { status: response.status });
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      throw new EndpointError('key_refused', { status: response.status });
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new EndpointError('http', { status: response.status });
    }
    const text = await readLimited(response, call.maxBytes ?? DEFAULT_MAX_BYTES);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new EndpointError('not_openai');
    }
  } catch (error) {
    if (error instanceof EndpointError) throw error;
    if (timedOut) throw new EndpointError('timeout');
    throw new EndpointError('unreachable', { code: codeOf(error) });
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener('abort', onAbort);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      void response.body.cancel().catch(() => {});
      throw new EndpointError('too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
