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
import { bearerKeyVerify } from '../api-key-verify.js';

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
  const verify = bearerKeyVerify({ provider: 'xAI', url: XAI_VERIFY_URL, refusedStatuses: [400, 401, 403], timeoutMs, fetch: options.fetch, onDiagnostic: diagnostic });
  return {
    envName: GROK_API_KEY_ENV,
    check: (value) => (XAI_API_KEY_PATTERN.test(value) ? undefined : BAD_XAI_API_KEY),
    verify: options.verify ?? verify,
  };
}
