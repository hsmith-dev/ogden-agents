/**
 * The one HTTPS call the tracker adapters make (CAP-35, epic 27), on the
 * shape `tickets-jira`'s client uses: the global `fetch` (injected in tests,
 * so CI never reaches a tracker), a fixed `https://` origin, `redirect:
 * 'manual'` with any redirect a failure (the token goes to that origin
 * only), a timeout and a response cap. Every failure is a core
 * `TrackerError` in plain words: never the tracker's own text or the token.
 */
import { TrackerError } from '@ogden-agents/core';

export const TRACKER_CALL_TIMEOUT_MS = 10_000;
export const TRACKER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface TrackerHttpOptions {
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface TrackerRequest {
  /** A fixed `https://` URL the adapter built (never one the user typed). */
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
}

/** The answer as JSON and its status (a 4xx body is still read: GraphQL puts its errors there). */
export async function trackerRequest(options: TrackerHttpOptions, request: TrackerRequest): Promise<{ status: number; json: unknown }> {
  if (!request.url.startsWith('https://')) throw new TrackerError('unreachable');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TRACKER_CALL_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: { accept: 'application/json', 'user-agent': 'ogden-agents', ...request.headers, ...(request.body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      throw new TrackerError('unreachable');
    }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new TrackerError('unreachable');
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      throw new TrackerError('unauthorized');
    }
    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      throw new TrackerError('not_found');
    }
    if (response.status >= 500) {
      void response.body?.cancel().catch(() => {});
      throw new TrackerError('unreachable');
    }
    const text = await response.text();
    if (text.length > TRACKER_MAX_RESPONSE_BYTES) throw new TrackerError('unreachable');
    try {
      return { status: response.status, json: text === '' ? undefined : (JSON.parse(text) as unknown) };
    } catch {
      throw new TrackerError('unreachable');
    }
  } catch (error) {
    if (error instanceof TrackerError) throw error;
    throw new TrackerError('unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/** `text` cut to `max` characters. */
export const capped = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);
