/**
 * The one way Ogden's server calls an OpenAI-compatible endpoint (epic 14):
 * only the server calls out (AD-15's gate and the CSP are unchanged), never
 * the browser. A request goes only to the configured base URL, with the key
 * (if the endpoint has one) only in the `Authorization` header, redirects
 * refused (a redirect could carry the key to another host), a hard timeout
 * and a cap on how much of an answer is read. Neither a key nor a response
 * body is ever logged: a failure carries a kind and a status code.
 */

import { errorCode } from '../error-code.js';

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
    readonly details: { status?: number; code?: string; apiCode?: string } = {},
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

const codeOf = (error: unknown): string => errorCode((error as { cause?: unknown } | undefined)?.cause ?? error, 'unknown');

/**
 * One call to `path` on the endpoint; resolves with the parsed JSON answer.
 * Rejects with an {@link EndpointError}; never throws anything else.
 */
export async function callEndpoint(call: EndpointCall, path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
  const fetchImpl = call.fetch ?? globalThis.fetch;
  if (call.signal?.aborted) throw new EndpointError('unreachable', { code: 'aborted' });
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
      // The server's own error code (a short token such as `model_not_found`), read to tell a missing model or a full context
      // from other errors. Its message is never kept or shown.
      const apiCode = await errorCodeOf(response);
      throw new EndpointError('http', { status: response.status, ...(apiCode === undefined ? {} : { apiCode }) });
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

/** Whether a server's error text or type says the request was longer than the model's context. */
const CONTEXT_ERROR = /context[ _-]?(?:length|window|size)|maximum context|too many tokens|exceed[_ ]context|input is too long|prompt is too long/i;

/**
 * The server's own error code (a short token such as `model_not_found`), read to tell a missing model or a full context
 * from other errors; the answer is read to at most 8 KB. A context error is recognised by its code, type or words
 * (servers differ: a code, a type, a plain string). Its message is never kept or shown.
 */
async function errorCodeOf(response: Response): Promise<string | undefined> {
  try {
    const text = await readLimited(response, 8 * 1024);
    const body = JSON.parse(text) as { error?: unknown };
    const error = body.error;
    const message = typeof error === 'string' ? error : typeof (error as { message?: unknown } | null)?.message === 'string' ? (error as { message: string }).message : '';
    const type = typeof (error as { type?: unknown } | null)?.type === 'string' ? (error as { type: string }).type : '';
    const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
    if (CONTEXT_ERROR.test(code) || CONTEXT_ERROR.test(type) || CONTEXT_ERROR.test(message)) return 'context_length_exceeded';
    const token = code !== '' ? code : type;
    return /^[A-Za-z0-9_.-]{1,60}$/.test(token) ? token : /model[^\n]{0,60}not found/i.test(message) ? 'model_not_found' : undefined;
  } catch {
    return undefined;
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
