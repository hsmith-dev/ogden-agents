/**
 * Codex's API key (epic 12 entry 6, AD-16): the environment variable Codex
 * reads it from, what an OpenAI key looks like, and a check with OpenAI that
 * costs nothing (`GET /v1/models`) before the key is saved. Codex takes only
 * an API key (user decision, 2026-10-05).
 *
 * The key goes only to the fixed OpenAI host, in the `Authorization`
 * header, with redirects refused. Neither the key nor the response body is
 * ever logged: diagnostics carry the status code or the error's code only.
 */
import type { AgentApiKeySupport, ApiKeyVerification } from '@ogden-agents/core';
import { CODEX_API_KEY_ENV } from '../acp-codex/constants.js';
import { errorCode } from '../error-code.js';

/** What an OpenAI API key looks like (`sk-` then letters, digits, `-` and `_`, as `sk-proj-...` keys have). */
export const OPENAI_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{20,}$/;

/** The free call that checks a key: list the models. The host is fixed. */
export const OPENAI_VERIFY_URL = 'https://api.openai.com/v1/models';

/** How long the check may take before the key is saved as "couldn't check". */
export const OPENAI_VERIFY_TIMEOUT_MS = 5_000;

export const BAD_OPENAI_API_KEY = "That doesn't look like an OpenAI API key. It starts with sk-.";

export interface CodexApiKeyOptions {
  /** Default: the global `fetch`. Tests pass a fake: no test ever reaches OpenAI. */
  fetch?: typeof fetch;
  /** Default {@link OPENAI_VERIFY_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Replaces the check entirely (the server's tests stub it). */
  verify?: AgentApiKeySupport['verify'];
  /** The check's outcome for the log: a status code or an error code, never the key or the body. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

/** Codex's {@link AgentApiKeySupport}. */
export function createCodexApiKey(options: CodexApiKeyOptions = {}): AgentApiKeySupport {
  const timeoutMs = options.timeoutMs ?? OPENAI_VERIFY_TIMEOUT_MS;
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
      response = await fetchImpl(OPENAI_VERIFY_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${value}` },
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: unknown } | null } | null)?.cause;
      diagnostic('OpenAI API key check failed', { step: 'verify_api_key', code: timeout.aborted ? 'timeout' : errorCode(cause?.code != null ? cause : error, 'unknown') });
      return 'unchecked';
    }
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      diagnostic('OpenAI refused the API key', { step: 'verify_api_key', status: response.status });
      return 'refused';
    }
    if (response.ok) return 'ok';
    diagnostic('OpenAI API key check inconclusive', { step: 'verify_api_key', status: response.status });
    return 'unchecked';
  };
  return {
    envName: CODEX_API_KEY_ENV,
    check: (value) => (OPENAI_API_KEY_PATTERN.test(value) ? undefined : BAD_OPENAI_API_KEY),
    verify: options.verify ?? verify,
  };
}
