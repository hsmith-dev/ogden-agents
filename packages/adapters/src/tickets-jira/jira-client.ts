/**
 * The one place Jira's own REST shapes and endpoints are named (AD-27,
 * AD-12): `tickets-jira`'s thin HTTP client, the real
 * `packages/core/src/jira-links.ts` `JiraLinkPort`. Built on the same
 * call shape `packages/adapters/src/local-model-openai/http.ts` already
 * uses for another user-configured endpoint: the global `fetch` (injectable
 * for tests, so nothing ever reaches a real server in CI), `redirect:
 * 'manual'` (a redirect is a failure, never followed — AD-27's guard
 * already refused one at the DNS/address level, but a same-host redirect
 * to a different path could still leak the credential to the wrong
 * endpoint if followed), a hard timeout, and Basic auth (Jira Cloud's own
 * shape: `email:token`), never a bearer token.
 *
 * Classic-token base URL resolution only, for now: the given site URL is
 * used directly as the API base (`<site>/rest/api/3/...`). Scoped-token
 * discovery (`api.atlassian.com/ex/jira/<cloudId>`, AD-29) is not yet
 * implemented — `resolveBaseUrl` is the one seam a follow-up story extends,
 * without changing any caller.
 */
import { JiraUnauthorizedError, JiraUnreachableError, type JiraLinkPort } from '@ogden-agents/core';

/** How long any one Jira call may take before it counts as unreachable. */
export const JIRA_CALL_TIMEOUT_MS = 10_000;
/** The most of an answer ever read (Jira's own payloads are small JSON). */
export const JIRA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface JiraCallOptions {
  baseUrl: string;
  email: string;
  token: string;
  /** Default: the global `fetch`. Tests pass the fake Jira server's own fetch-compatible caller so nothing reaches the network. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const basicAuth = (email: string, token: string): string => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

/** One GET to `path` on `baseUrl`, parsed as JSON. Rejects with {@link JiraUnauthorizedError} (401/403) or {@link JiraUnreachableError} (anything else that stops it, including a redirect or a timeout). */
export async function jiraGet(options: JiraCallOptions, path: string): Promise<unknown> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? JIRA_CALL_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: basicAuth(options.email, options.token) },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      throw new JiraUnreachableError();
    }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new JiraUnreachableError(); // a redirect is a failure: the base URL the user confirmed is the only one ever used
    }
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => {});
      throw new JiraUnauthorizedError();
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new JiraUnreachableError();
    }
    const text = await response.text();
    if (text.length > JIRA_MAX_RESPONSE_BYTES) throw new JiraUnreachableError();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new JiraUnreachableError();
    }
  } catch (error) {
    if (error instanceof JiraUnauthorizedError || error instanceof JiraUnreachableError) throw error;
    throw new JiraUnreachableError();
  } finally {
    clearTimeout(timer);
  }
}

/** The classic-token base URL: the site itself. Scoped-token discovery is a later story's extension of this one function. */
export function resolveBaseUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

export interface JiraClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The real {@link JiraLinkPort}: resolves the base URL and makes the one read-only test call. */
export function createJiraLinkPort(options: JiraClientOptions = {}): JiraLinkPort {
  return {
    async testConnection({ siteUrl, email, token }) {
      const baseUrl = resolveBaseUrl(siteUrl);
      await jiraGet({ baseUrl, email, token, fetch: options.fetch, timeoutMs: options.timeoutMs }, '/rest/api/3/myself');
      return { baseUrl };
    },
  };
}
