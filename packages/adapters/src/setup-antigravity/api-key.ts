/**
 * Antigravity's Gemini API key (epic 6 entry 7, AD-16): the variable its
 * server reads (`GEMINI_API_KEY`, spike 6.1), the key's format, and a check
 * with Google that costs nothing (list one model) before the key is saved.
 *
 * The key goes only to Google's fixed Gemini API host, in the
 * `x-goog-api-key` header (never the URL), with redirects refused. Neither
 * the key nor the response body is ever logged: diagnostics carry the status
 * code or the error's code only.
 */
import type { AgentApiKeySupport, ApiKeyVerification } from '@ogden-agents/core';
import { errorCode } from '../error-code.js';
import { GEMINI_API_KEY_ENV } from './descriptor.js';

/** A Gemini API key: `AIza` and 35 more letters, digits, `_` or `-`. */
export const GEMINI_API_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/;

/** The free call that checks a key. The host is fixed. */
export const GEMINI_VERIFY_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';

/** How long the check may take before the key is saved as "couldn't check". */
export const GEMINI_VERIFY_TIMEOUT_MS = 5_000;

export const BAD_GEMINI_KEY = "That doesn't look like a Gemini API key. It starts with AIza.";

export interface GeminiApiKeyOptions {
  /** Default: the global `fetch`. Tests pass a fake: no test ever reaches Google. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Replaces the check entirely (the server's tests stub it). */
  verify?: AgentApiKeySupport['verify'];
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

/** Antigravity's {@link AgentApiKeySupport}. */
export function createGeminiApiKey(options: GeminiApiKeyOptions = {}): AgentApiKeySupport {
  const timeoutMs = options.timeoutMs ?? GEMINI_VERIFY_TIMEOUT_MS;
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
      response = await fetchImpl(GEMINI_VERIFY_URL, {
        method: 'GET',
        headers: { 'x-goog-api-key': value },
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: unknown } | null } | null)?.cause;
      diagnostic('Gemini API key check failed', { step: 'verify_api_key', code: timeout.aborted ? 'timeout' : errorCode(cause?.code != null ? cause : error, 'unknown') });
      return 'unchecked';
    }
    void response.body?.cancel().catch(() => {});
    // Google answers a bad key with 400 (API_KEY_INVALID), and one that can't use Gemini with 401 or 403.
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      diagnostic('Google refused the Gemini API key', { step: 'verify_api_key', status: response.status });
      return 'refused';
    }
    if (response.ok) return 'ok';
    diagnostic('Gemini API key check inconclusive', { step: 'verify_api_key', status: response.status });
    return 'unchecked';
  };

  return {
    envName: GEMINI_API_KEY_ENV,
    check: (value) => (GEMINI_API_KEY_PATTERN.test(value) ? undefined : BAD_GEMINI_KEY),
    verify: options.verify ?? verify,
  };
}
