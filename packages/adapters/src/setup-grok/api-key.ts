/**
 * Grok's xAI API access token (epic 12 entry 8, AD-16): the environment
 * variable Grok reads it from, what an xAI key looks like, and a check with
 * xAI that costs nothing (`GET /v1/api-key`, which describes the key) before
 * the token is saved. Grok takes only an API access token (user decision,
 * 2026-10-05).
 *
 * The token goes only to the fixed xAI host, in the `Authorization` header,
 * with redirects refused. Neither the token nor the response body is ever
 * logged: diagnostics carry the status code or the error's code only.
 * The endpoint and the statuses that mean "refused" are not verified against
 * a real key (deferred-work); anything else counts as "couldn't check" and the
 * token is saved with a note, never refused wrongly.
 */
import type { AgentApiKeySupport, ApiKeyVerification } from '@ogden-agents/core';
import { GROK_API_KEY_ENV } from '../acp-grok/constants.js';
import { errorCode } from '../error-code.js';

/** What an xAI API key looks like (`xai-` then letters, digits, `-` and `_`). */
export const XAI_API_KEY_PATTERN = /^xai-[A-Za-z0-9_-]{20,}$/;

/** The free call that checks a token: the key's own description. The host is fixed. */
export const XAI_VERIFY_URL = 'https://api.x.ai/v1/api-key';

/** How long the check may take before the token is saved as "couldn't check". */
export const XAI_VERIFY_TIMEOUT_MS = 5_000;

export const BAD_XAI_API_KEY = "That doesn't look like an xAI API access token. It starts with xai-.";

export interface GrokApiKeyOptions {
  /** Default: the global `fetch`. Tests pass a fake: no test ever reaches xAI. */
  fetch?: typeof fetch;
  /** Default {@link XAI_VERIFY_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Replaces the check entirely (the server's tests stub it). */
  verify?: AgentApiKeySupport['verify'];
  /** The check's outcome for the log: a status code or an error code, never the token or the body. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * Grok's {@link AgentApiKeySupport}. The token comes from `XAI_API_KEY` in the server's environment (or a saved one);
 * `GROK_CODE_XAI_API_KEY` is only kept out of every process, never used.
 */
export function createGrokApiKey(options: GrokApiKeyOptions = {}): AgentApiKeySupport {
  const timeoutMs = options.timeoutMs ?? XAI_VERIFY_TIMEOUT_MS;
  const diagnostic = (message: string, fields?: Record<string, unknown>) => {
    try {
      options.onDiagnostic?.(message, fields);
    } catch {
      // Logging never changes the outcome.
    }
  };
  const verify = async (value: string, signal: AbortSignal): Promise<ApiKeyVerification> => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(XAI_VERIFY_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${value}` },
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: unknown } | null } | null)?.cause;
      diagnostic('xAI API key check failed', { step: 'verify_api_key', code: timeout.aborted ? 'timeout' : errorCode(cause?.code != null ? cause : error, 'unknown') });
      return 'unchecked';
    }
    void response.body?.cancel().catch(() => {});
    // xAI answered a wrong key with 400 "Incorrect API key provided" on a chat call (spike 12.2); a bad key on this endpoint is 400, 401 or 403.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      diagnostic('xAI refused the API key', { step: 'verify_api_key', status: response.status });
      return 'refused';
    }
    if (response.ok) return 'ok';
    diagnostic('xAI API key check inconclusive', { step: 'verify_api_key', status: response.status });
    return 'unchecked';
  };
  return {
    envName: GROK_API_KEY_ENV,
    check: (value) => (XAI_API_KEY_PATTERN.test(value) ? undefined : BAD_XAI_API_KEY),
    verify: options.verify ?? verify,
  };
}
