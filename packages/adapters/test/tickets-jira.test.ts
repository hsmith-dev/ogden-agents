/**
 * `tickets-jira`'s real `JiraLinkPort` (epic 18 story 4; AD-29): the one
 * read-only test call, over Basic auth, with no redirect ever followed,
 * and whole-value credential redaction (AD-16, the security review's
 * finding 1). Only the fake Jira server fixture on loopback is ever
 * called.
 */
import { JiraUnauthorizedError, JiraUnreachableError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { basicAuthHeader, startFakeJiraServer, type FakeJiraServer } from '../../../tests/fixtures/fake-jira-server.mjs';
import { createJiraLinkPort, gatewayBaseUrl, jiraGet, JIRA_SEARCH_MAX_ISSUES, resolveBaseUrl, searchAllIssues } from '../src/index.js';
import { redactJiraCredential, redactJiraValues, withJiraRedaction } from '../src/tickets-jira/redact.js';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fakeServer(options: Parameters<typeof startFakeJiraServer>[0] = {}): Promise<FakeJiraServer> {
  const server = await startFakeJiraServer(options);
  closers.push(() => server.close());
  return server;
}

describe('resolveBaseUrl', () => {
  it('uses the site URL directly (classic-token shape) and strips a trailing slash', () => {
    expect(resolveBaseUrl('https://my-team.atlassian.net/')).toBe('https://my-team.atlassian.net');
  });
});

describe('scoped-token gateway fallback (AD-29; unverified against a real scoped token, see jira-client.ts header)', () => {
  it('falls back to the gateway when the classic path is unauthorized, discovering the cloud id first', async () => {
    const server = await fakeServer({ email: 'dev@example.com', token: 'scoped-token', scopedOnly: true, cloudId: 'cloud-abc' });
    const port = createJiraLinkPort({ gatewayHost: server.url });
    const result = await port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'scoped-token', projectKey: 'ENG' });
    expect(result).toEqual({ baseUrl: gatewayBaseUrl('cloud-abc', server.url) });
    const paths = server.log.map((entry) => `${entry.method} ${entry.path}`);
    expect(paths).toEqual(['GET /rest/api/3/myself', 'GET /_edge/tenant_info', 'GET /ex/jira/cloud-abc/rest/api/3/myself']);
    expect(server.log[0]?.authorized).toBe(false); // the classic attempt, correctly refused for a scoped token
    expect(server.log[2]?.authorized).toBe(true); // the gateway retry, with the same credential
    expect(server.log[2]?.gateway).toBe(true);
  });

  it('still fails with the original unauthorized error when tenant_info cannot be reached at all', async () => {
    const server = await fakeServer({ email: 'dev@example.com', token: 'scoped-token', scopedOnly: true, tamper: 'tenant-info-down' });
    const port = createJiraLinkPort({ gatewayHost: server.url });
    await expect(port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'scoped-token', projectKey: 'ENG' })).rejects.toBeInstanceOf(JiraUnauthorizedError);
  });

  it('never attempts the gateway fallback for a classic token that works on the first try', async () => {
    const server = await fakeServer({ email: 'dev@example.com', token: 'classic-token' });
    const port = createJiraLinkPort({ gatewayHost: server.url });
    await port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'classic-token', projectKey: 'ENG' });
    expect(server.log.map((entry) => entry.path)).toEqual(['/rest/api/3/myself']);
  });
});

describe('the real JiraLinkPort (testConnection)', () => {
  it('succeeds against the matching email and token', async () => {
    const server = await fakeServer({ email: 'dev@example.com', token: 'good-token' });
    const port = createJiraLinkPort();
    const result = await port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'good-token', projectKey: 'ENG' });
    expect(result).toEqual({ baseUrl: server.url });
    expect(server.log.map((entry) => `${entry.method} ${entry.path}`)).toEqual(['GET /rest/api/3/myself']);
    expect(server.log[0]?.authorized).toBe(true);
  });

  it('rejects with JiraUnauthorizedError on a wrong token, before anything else', async () => {
    const server = await fakeServer({ email: 'dev@example.com', token: 'good-token' });
    // gatewayHost: a port nothing listens on, so the scoped-token fallback this triggers (the fake server's
    // tenant_info always answers) fails fast locally instead of reaching the real api.atlassian.com.
    const port = createJiraLinkPort({ gatewayHost: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'wrong-token', projectKey: 'ENG' })).rejects.toBeInstanceOf(JiraUnauthorizedError);
  });

  it('rejects with JiraUnauthorizedError when the server plays "unauthorized"', async () => {
    const server = await fakeServer({ tamper: 'unauthorized' });
    const port = createJiraLinkPort({ gatewayHost: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token', projectKey: 'ENG' })).rejects.toBeInstanceOf(JiraUnauthorizedError);
  });

  it('rejects with JiraUnreachableError when nothing is listening', async () => {
    const port = createJiraLinkPort({ timeoutMs: 500 });
    await expect(port.testConnection({ siteUrl: 'http://127.0.0.1:1', email: 'a@b.com', token: 'x', projectKey: 'ENG' })).rejects.toBeInstanceOf(JiraUnreachableError);
  });

  it('never follows a redirect: a 3xx answer is treated as unreachable, not success', async () => {
    const server = await fakeServer();
    const redirecting: typeof fetch = async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example.com/steal' } });
    const port = createJiraLinkPort({ fetch: redirecting });
    await expect(port.testConnection({ siteUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token', projectKey: 'ENG' })).rejects.toBeInstanceOf(JiraUnreachableError);
  });

  it("sends Basic auth of email:token, Jira Cloud's own shape", async () => {
    const server = await fakeServer({ email: 'someone@example.com', token: 'tok-abc' });
    await jiraGet({ baseUrl: server.url, email: 'someone@example.com', token: 'tok-abc' }, '/rest/api/3/myself');
    expect(server.log[0]?.auth).toBe('basic-present');
    expect(basicAuthHeader('someone@example.com', 'tok-abc')).toBe(`Basic ${Buffer.from('someone@example.com:tok-abc').toString('base64')}`);
  });
});

describe('whole-value credential redaction', () => {
  const credential = { token: 'super-secret-token-xyz', email: 'dev@example.com', siteUrl: 'https://my-team.atlassian.net' };

  it('removes every occurrence of the token, email, and site URL, not just a token-shaped pattern', () => {
    const text = `sync failed for dev@example.com at https://my-team.atlassian.net: Authorization: Basic ${Buffer.from('dev@example.com:super-secret-token-xyz').toString('base64')}`;
    const redacted = redactJiraValues(text, [credential.token, credential.email, credential.siteUrl]);
    expect(redacted).not.toContain(credential.token);
    expect(redacted).not.toContain(credential.email);
    expect(redacted).not.toContain(credential.siteUrl);
    // The email and site URL are not token-shaped, so a pattern-based redactor (secret-patterns.ts) would miss them; this whole-value one does not.
    expect(redacted).toContain('[redacted]');
  });

  it('redacts a caught error raised from deep inside a failed call, via withJiraRedaction', async () => {
    const thrown = new Error(`request to https://my-team.atlassian.net/rest/api/3/myself failed for dev@example.com with token super-secret-token-xyz`);
    const caught = await withJiraRedaction(credential, async () => {
      throw thrown;
    }).catch((error: unknown) => error as Error);
    expect(caught.message).not.toContain(credential.token);
    expect(caught.message).not.toContain(credential.email);
    expect(caught.message).not.toContain(credential.siteUrl);
  });

  it('leaves ordinary text untouched when none of the credential values appear', () => {
    expect(redactJiraCredential('nothing secret here', credential)).toBe('nothing secret here');
  });

  it('never redacts very short values (which would mangle unrelated text)', () => {
    expect(redactJiraValues('ok', ['', 'a', undefined])).toBe('ok');
  });
});

describe('searchAllIssues (pagination)', () => {
  const issue = (n: number) => ({ key: `ENG-${n}`, fields: { summary: `Issue ${n}`, status: { name: 'To Do' } } });

  it('fetches one page whole when it is smaller than the page size', async () => {
    const server = await fakeServer({ issues: [issue(1), issue(2)] });
    const call = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = await searchAllIssues(call, 'project = ENG', 50);
    expect(issues.map((i) => i.key)).toEqual(['ENG-1', 'ENG-2']);
    expect(server.log.filter((l) => l.path.startsWith('/rest/api/3/search'))).toHaveLength(1);
  });

  it('pages through a board larger than one page, with no duplicate or missing issue', async () => {
    const all = Array.from({ length: 23 }, (_, i) => issue(i + 1));
    const server = await fakeServer({ issues: all });
    const call = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = await searchAllIssues(call, 'project = ENG', 10);
    expect(issues.map((i) => i.key)).toEqual(all.map((i) => i.key));
    expect(server.log.filter((l) => l.path.startsWith('/rest/api/3/search'))).toHaveLength(3); // 10 + 10 + 3
  });

  it('stops at JIRA_SEARCH_MAX_ISSUES rather than looping forever on a huge board', async () => {
    const all = Array.from({ length: JIRA_SEARCH_MAX_ISSUES + 500 }, (_, i) => issue(i + 1));
    const server = await fakeServer({ issues: all });
    const call = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const issues = await searchAllIssues(call, 'project = ENG', 500);
    expect(issues).toHaveLength(JIRA_SEARCH_MAX_ISSUES);
  }, 15_000);

  it('returns an empty list for an empty board, with no error', async () => {
    const server = await fakeServer({ issues: [] });
    const call = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    expect(await searchAllIssues(call, 'project = ENG')).toEqual([]);
  });

  it('percent-encodes the jql and includes the field list', async () => {
    const server = await fakeServer({ issues: [issue(1)] });
    const call = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    await searchAllIssues(call, 'project = "ENG" AND type = Epic');
    expect(server.log[0]?.query).toContain(encodeURIComponent('project = "ENG" AND type = Epic'));
    expect(server.log[0]?.query).toContain('fields=summary');
  });
});
