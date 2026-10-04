/**
 * Claude Code's API key (story 9.2, AD-16): the environment variable it reads,
 * the key's format, and a check with Anthropic that costs nothing
 * (`GET /v1/models`) before the key is saved.
 *
 * The key goes only to the fixed Anthropic host, in the `x-api-key` header,
 * with redirects refused. Neither the key nor the response body is ever
 * logged: diagnostics carry the status code or the error's code only.
 */
import type { AgentApiKeySupport, ApiKeyVerification } from '@ogden-agents/core';
import { errorCode } from '../error-code.js';

/** The environment variable Claude Code reads its API key from. It prefers it over a subscription when set. */
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

/** What an Anthropic API key looks like. */
export const ANTHROPIC_API_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

/** The free call that checks a key: list the models. The host is fixed. */
export const ANTHROPIC_VERIFY_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_VERSION = '2023-06-01';

/** How long the check may take before the key is saved as "couldn't check". */
export const VERIFY_TIMEOUT_MS = 5_000;

export const BAD_API_KEY = "That doesn't look like an Anthropic API key.";

export interface ClaudeApiKeyOptions {
  /** Default: the global `fetch`. Tests pass a fake: no test ever reaches Anthropic. */
  fetch?: typeof fetch;
  /** Default {@link VERIFY_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Replaces the check entirely (the server's tests stub it). */
  verify?: AgentApiKeySupport['verify'];
  /** The check's outcome for the log: a status code or an error code, never the key or the body. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

/** A failure's code for the log, never its message: its cause's code (what `fetch` throws), else its own, else its name. */
function codeOf(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } | null } | null)?.cause;
  const name = (error as { name?: unknown } | null)?.name;
  return errorCode(cause?.code != null ? cause : error, typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'unknown');
}

/** Claude Code's {@link AgentApiKeySupport}. */
export function createClaudeApiKey(options: ClaudeApiKeyOptions = {}): AgentApiKeySupport {
  const timeoutMs = options.timeoutMs ?? VERIFY_TIMEOUT_MS;
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
      response = await fetchImpl(ANTHROPIC_VERIFY_URL, {
        method: 'GET',
        headers: { 'x-api-key': value, 'anthropic-version': ANTHROPIC_VERSION },
        redirect: 'error',
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (error) {
      diagnostic('Anthropic API key check failed', { step: 'verify_api_key', code: timeout.aborted ? 'timeout' : codeOf(error) });
      return 'unchecked';
    }
    // The body is never read into the log; drop it.
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      diagnostic('Anthropic refused the API key', { step: 'verify_api_key', status: response.status });
      return 'refused';
    }
    if (response.ok) return 'ok';
    diagnostic('Anthropic API key check inconclusive', { step: 'verify_api_key', status: response.status });
    return 'unchecked';
  };

  return {
    envName: ANTHROPIC_API_KEY_ENV,
    check: (value) => (ANTHROPIC_API_KEY_PATTERN.test(value) ? undefined : BAD_API_KEY),
    verify: options.verify ?? verify,
  };
}
