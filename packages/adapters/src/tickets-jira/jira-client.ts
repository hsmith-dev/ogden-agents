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
 * Base URL resolution (AD-29): a classic token answers directly at the site
 * (`<site>/rest/api/3/...`); a scoped token needs the
 * `api.atlassian.com/ex/jira/<cloudId>` gateway instead. `testConnection`
 * tries the site directly first (the common case) and, only on an
 * authorization failure there, discovers the site's cloud id
 * (`GET <site>/_edge/tenant_info`, an unauthenticated, undocumented-but-
 * widely-relied-on Atlassian endpoint several other Jira integrations use
 * for exactly this) and retries through the gateway.
 *
 * Caveat, stated plainly rather than left implicit: this fallback path has
 * no live Jira Cloud account with an actual scoped token to verify against
 * in this environment, only this adapter's own fake server fixture (which
 * models the endpoints as documented, not as independently confirmed live).
 * The classic-token path is the one proven end-to-end here; the scoped-token
 * path should be confirmed against a real scoped token before being relied
 * on, and `tenantInfoPath`/`gatewayBaseUrl` are the two seams to adjust if
 * Atlassian's actual behavior differs.
 */
import { JiraUnauthorizedError, JiraUnreachableError, type JiraLinkPort } from '@ogden-agents/core';
import type { JiraIssue } from './jira-issue-mapping.js';

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

/** One call to `path` on `baseUrl`, parsed as JSON (`undefined` for a `204 No Content`, which `transitionIssue` relies on). Rejects with {@link JiraUnauthorizedError} (401/403) or {@link JiraUnreachableError} (anything else that stops it, including a redirect or a timeout). */
export async function jiraRequest(options: JiraCallOptions, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? JIRA_CALL_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { accept: 'application/json', authorization: basicAuth(options.email, options.token), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    if (response.status === 204) {
      void response.body?.cancel().catch(() => {});
      return undefined;
    }
    const text = await response.text();
    if (text.length > JIRA_MAX_RESPONSE_BYTES) throw new JiraUnreachableError();
    if (text === '') return undefined;
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

/** One GET to `path` on `baseUrl`, parsed as JSON. See {@link jiraRequest}. */
export async function jiraGet(options: JiraCallOptions, path: string): Promise<unknown> {
  return jiraRequest(options, 'GET', path);
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

/** The transitions available right now on `issueKey` (its current status decides which ones Jira offers). */
export async function listTransitions(options: JiraCallOptions, issueKey: string): Promise<JiraTransition[]> {
  const data = (await jiraRequest(options, 'GET', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`)) as { transitions?: JiraTransition[] };
  return data.transitions ?? [];
}

/** Applies transition `transitionId` to `issueKey` (`POST .../transitions`); Jira answers `204` with no body. */
export async function transitionIssue(options: JiraCallOptions, issueKey: string, transitionId: string): Promise<void> {
  await jiraRequest(options, 'POST', `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, { transition: { id: transitionId } });
}

/** Pushes a local title and/or body edit to Jira's `summary`/`description` (AD-28, `PUT .../issue/<key>`); Jira answers `204` with no body. Description is sent as a single ADF paragraph (Jira Cloud v3's own format) rather than plain text, so it round-trips through Jira's own editor correctly. */
export async function updateIssueFields(options: JiraCallOptions, issueKey: string, fields: { summary?: string; description?: string }): Promise<void> {
  const body: { fields: Record<string, unknown> } = { fields: {} };
  if (fields.summary !== undefined) body.fields.summary = fields.summary;
  if (fields.description !== undefined) {
    body.fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: fields.description === '' ? [] : [{ type: 'text', text: fields.description }] }] };
  }
  await jiraRequest(options, 'PUT', `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, body);
}

/** One local ticket's `after` entry pushed to Jira as a one-way "is blocked by" Issue Link (AD-28: local → Jira only, never read back). `POST .../issueLink`; Jira answers `201` with no body this adapter reads. */
export async function linkIsBlockedBy(options: JiraCallOptions, issueKey: string, blockingIssueKey: string): Promise<void> {
  await jiraRequest(options, 'POST', '/rest/api/3/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: issueKey }, outwardIssue: { key: blockingIssueKey } });
}

/** The classic-token base URL: the site itself. */
export function resolveBaseUrl(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, '');
}

/** Atlassian's one fixed gateway host for every site's scoped-token access. Tests override it (`JiraClientOptions.gatewayHost`) to point at the fake server instead. */
export const DEFAULT_GATEWAY_HOST = 'https://api.atlassian.com';

/** The scoped-token gateway base URL for a resolved cloud id, under `gatewayHost`. */
export function gatewayBaseUrl(cloudId: string, gatewayHost: string = DEFAULT_GATEWAY_HOST): string {
  return `${gatewayHost.replace(/\/+$/, '')}/ex/jira/${encodeURIComponent(cloudId)}`;
}

/** The one unauthenticated call used to discover a site's cloud id, for the scoped-token gateway fallback (see this file's header comment). */
export const TENANT_INFO_PATH = '/_edge/tenant_info';

/** Whether `error` is specifically an authorization failure (401/403), as opposed to any other kind of unreachable. */
function isUnauthorized(error: unknown): boolean {
  return error instanceof JiraUnauthorizedError;
}

/** The site's cloud id, read from {@link TENANT_INFO_PATH}; `undefined` if that call fails or answers without one (never thrown: this is a best-effort fallback step, not a required one). */
async function discoverCloudId(siteUrl: string, options: { fetch?: typeof fetch; timeoutMs?: number }): Promise<string | undefined> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImpl(`${siteUrl.replace(/\/+$/, '')}${TENANT_INFO_PATH}`, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual' });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { cloudId?: unknown };
    return typeof data.cloudId === 'string' && data.cloudId !== '' ? data.cloudId : undefined;
  } catch {
    return undefined;
  }
}

export interface JiraClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Default {@link DEFAULT_GATEWAY_HOST}. Tests point this at the fake Jira server instead of the real Atlassian host. */
  gatewayHost?: string;
}

/**
 * The real {@link JiraLinkPort}: tries the classic base URL first; on an
 * authorization failure there, discovers the cloud id and retries through
 * the scoped-token gateway (see this file's header comment on that path's
 * verification status) before giving up with the original failure.
 */
export function createJiraLinkPort(options: JiraClientOptions = {}): JiraLinkPort {
  return {
    async testConnection({ siteUrl, email, token }) {
      const classicBaseUrl = resolveBaseUrl(siteUrl);
      try {
        await jiraGet({ baseUrl: classicBaseUrl, email, token, fetch: options.fetch, timeoutMs: options.timeoutMs }, '/rest/api/3/myself');
        return { baseUrl: classicBaseUrl };
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
        const cloudId = await discoverCloudId(siteUrl, options);
        if (cloudId === undefined) throw error;
        const scopedBaseUrl = gatewayBaseUrl(cloudId, options.gatewayHost);
        try {
          await jiraGet({ baseUrl: scopedBaseUrl, email, token, fetch: options.fetch, timeoutMs: options.timeoutMs }, '/rest/api/3/myself');
        } catch {
          // The gateway retry is a best-effort fallback (see this file's header): whatever it fails
          // with, the classic attempt's own failure is the one the caller sees, not a confusing
          // unreachable-gateway error for what is really an authorization problem either way.
          throw error;
        }
        return { baseUrl: scopedBaseUrl };
      }
    },
  };
}

/** The largest page `searchIssues` asks for at once. */
export const JIRA_SEARCH_PAGE_SIZE = 50;
/** A hard cap on total issues fetched per sync, so a misconfigured JQL (or a huge board) can't loop forever or exhaust memory. */
export const JIRA_SEARCH_MAX_ISSUES = 5_000;

export interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

/**
 * Every issue matching `jql`, paginating `GET /rest/api/3/search` until
 * `total` is reached or {@link JIRA_SEARCH_MAX_ISSUES} is hit (whichever
 * first; hitting the cap is not an error, the caller decides what to do
 * with a truncated result). Rejects the same way {@link jiraGet} does.
 */
export async function searchAllIssues(options: JiraCallOptions, jql: string, pageSize: number = JIRA_SEARCH_PAGE_SIZE): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let startAt = 0;
  for (;;) {
    const page = (await jiraGet(options, `/rest/api/3/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${pageSize}&fields=summary,description,status,issuetype,parent,assignee,priority`)) as JiraSearchResponse;
    issues.push(...page.issues);
    startAt += page.issues.length;
    if (page.issues.length === 0 || startAt >= page.total || issues.length >= JIRA_SEARCH_MAX_ISSUES) break;
  }
  return issues.slice(0, JIRA_SEARCH_MAX_ISSUES);
}
