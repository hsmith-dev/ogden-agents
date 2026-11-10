/**
 * The `trackers` adapters (CAP-35, epic 27) against a fetch fake: nothing
 * reaches GitHub or Linear. Mapping to `Issue`, failures in plain words,
 * no redirect followed, the token only in the Authorization header, and
 * the user's words never widening the scope.
 */
import { TrackerError } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createGitHubTracker, createLinearTracker, GITHUB_API, LINEAR_API, plainSearchWords } from '../src/index.js';

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (url: string, init: RequestInit) => Response) {
  const seen: Seen[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    seen.push({ url, init });
    return answer(url, init);
  };
  return { fetch, seen };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const GH = { kind: 'github' as const, token: 'ghp_secretsecretsecretsecret0000', scope: 'acme/app' };
const GH_ISSUE = { number: 42, title: 'Login button does nothing', html_url: 'https://github.com/acme/app/issues/42', state: 'open', body: 'Steps', updated_at: '2026-11-01T00:00:00Z', assignees: [{ login: 'sam' }] };

describe('GitHub Issues', () => {
  it('lists open issues without pull requests, as Issue, with the token only in Authorization', async () => {
    const { fetch, seen } = fakeFetch(() => json([GH_ISSUE, { ...GH_ISSUE, number: 43, pull_request: {} }]));
    const issues = await createGitHubTracker({ fetch }).issues(GH);
    expect(issues).toEqual([{ kind: 'github', key: '42', identifier: '#42', title: 'Login button does nothing', url: GH_ISSUE.html_url, status: 'open', assignees: ['sam'], description: 'Steps', updatedAt: GH_ISSUE.updated_at }]);
    expect(seen[0]!.url).toBe(`${GITHUB_API}/repos/acme/app/issues?state=open&sort=updated&direction=desc&per_page=25`);
    expect(seen[0]!.init.redirect).toBe('manual');
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${GH.token}`);
    expect(seen[0]!.url).not.toContain(GH.token);
  });

  it("a search keeps to the account's repository: the user's qualifiers are taken out", async () => {
    const { fetch, seen } = fakeFetch(() => json({ items: [GH_ISSUE] }));
    await createGitHubTracker({ fetch }).issues(GH, 'login repo:evil/other is:pr');
    expect(decodeURIComponent(seen[0]!.url)).toContain('/search/issues?q=login repo:acme/app is:issue is:open');
    expect(plainSearchWords('org:x  -label:y crash')).toBe('crash');
  });

  it('a redirect, a refused token, a missing issue and a pull request are plain failures', async () => {
    const failureOf = async (response: Response, key = '42') =>
      createGitHubTracker({ fetch: fakeFetch(() => response).fetch })
        .issue(GH, key)
        .catch((error: unknown) => (error instanceof TrackerError ? error.failure : 'other'));
    expect(await failureOf(new Response(null, { status: 302, headers: { location: 'https://evil.example' } }))).toBe('unreachable');
    expect(await failureOf(json({ message: 'Bad credentials' }, 401))).toBe('unauthorized');
    expect(await failureOf(json({}, 404))).toBe('not_found');
    expect(await failureOf(json({ ...GH_ISSUE, pull_request: {} }))).toBe('not_found');
    expect(await failureOf(json(GH_ISSUE), 'ENG-1')).toBe('not_found');
  });

  it('verifies by reading the repository', async () => {
    const { fetch, seen } = fakeFetch(() => json({ id: 1 }));
    await createGitHubTracker({ fetch }).verify(GH);
    expect(seen[0]!.url).toBe(`${GITHUB_API}/repos/acme/app`);
  });
});

const LN = { kind: 'linear' as const, token: 'lin_api_secretsecretsecretsecret00', scope: 'ENG' };
const LN_ISSUE = { identifier: 'ENG-7', title: 'Crash on save', url: 'https://linear.app/acme/issue/ENG-7', description: 'Boom', updatedAt: '2026-11-02T00:00:00Z', state: { name: 'Todo' }, assignee: { name: 'Robin' }, team: { key: 'ENG' } };

describe('Linear', () => {
  it("lists the team's open issues, the user's words only as variables", async () => {
    const { fetch, seen } = fakeFetch(() => json({ data: { searchIssues: { nodes: [LN_ISSUE] } } }));
    const issues = await createLinearTracker({ fetch }).issues(LN, 'save" } }');
    expect(issues[0]).toMatchObject({ kind: 'linear', key: 'ENG-7', identifier: 'ENG-7', status: 'Todo', assignees: ['Robin'] });
    expect(seen[0]!.url).toBe(LINEAR_API);
    const body = JSON.parse(String(seen[0]!.init.body)) as { query: string; variables: { term: string; filter: unknown } };
    expect(body.query).not.toContain('save');
    expect(body.variables.term).toBe('save" } }');
    expect(body.variables.filter).toEqual({ team: { key: { eq: 'ENG' } }, state: { type: { nin: ['completed', 'canceled'] } } });
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(LN.token);
  });

  it('an authentication error, even with HTTP 400, is unauthorized; an issue of another team is not found', async () => {
    const auth = createLinearTracker({ fetch: fakeFetch(() => json({ errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 400)).fetch });
    await expect(auth.verify(LN)).rejects.toMatchObject({ failure: 'unauthorized' });
    const other = createLinearTracker({ fetch: fakeFetch(() => json({ data: { issue: { ...LN_ISSUE, team: { key: 'OPS' } } } })).fetch });
    await expect(other.issue(LN, 'OPS-1')).rejects.toMatchObject({ failure: 'not_found' });
  });

  it('verifies the key, then that the team exists', async () => {
    let call = 0;
    const { fetch } = fakeFetch(() => json(call++ === 0 ? { data: { viewer: { id: 'u' } } } : { data: { teams: { nodes: [] } } }));
    await expect(createLinearTracker({ fetch }).verify(LN)).rejects.toMatchObject({ failure: 'not_found' });
  });
});
