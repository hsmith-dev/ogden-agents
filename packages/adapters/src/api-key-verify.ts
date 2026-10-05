/**
 * The free API key check Codex and Grok share (epic 12 sweep, 12.10): one
 * `GET` of a fixed provider URL with the key as a bearer token, redirects
 * refused, the response body discarded. A status in `refusedStatuses` is
 * "refused", any other success is "ok", anything else (a server error, a
 * timeout, no network) is "unchecked", so a key is never refused wrongly.
 * Neither the key nor the body is ever logged: diagnostics carry a status
 * code or an error's code only.
 */
import type { ApiKeyVerification } from '@ogden-agents/core';
import { errorCode } from './error-code.js';

export interface BearerKeyCheck {
  /** The provider's name for the log lines ("OpenAI", "xAI"). */
  provider: string;
  /** The free call; its host is fixed. */
  url: string;
  /** The statuses that mean the provider refused the key. */
  refusedStatuses: readonly number[];
  timeoutMs: number;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch | undefined;
  onDiagnostic: (message: string, fields?: Record<string, unknown>) => void;
}

/** The check as a function of the key and the caller's abort signal. */
export function bearerKeyVerify(check: BearerKeyCheck): (value: string, signal: AbortSignal) => Promise<ApiKeyVerification> {
  return async (value, signal) => {
    const fetchImpl = check.fetch ?? globalThis.fetch;
    const timeout = AbortSignal.timeout(check.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(check.url, {
        method: 'GET',
        headers: { authorization: `Bearer ${value}` },
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: unknown } | null } | null)?.cause;
      check.onDiagnostic(`${check.provider} API key check failed`, { step: 'verify_api_key', code: timeout.aborted ? 'timeout' : errorCode(cause?.code != null ? cause : error, 'unknown') });
      return 'unchecked';
    }
    void response.body?.cancel().catch(() => {});
    if (check.refusedStatuses.includes(response.status)) {
      check.onDiagnostic(`${check.provider} refused the API key`, { step: 'verify_api_key', status: response.status });
      return 'refused';
    }
    if (response.ok) return 'ok';
    check.onDiagnostic(`${check.provider} API key check inconclusive`, { step: 'verify_api_key', status: response.status });
    return 'unchecked';
  };
}
