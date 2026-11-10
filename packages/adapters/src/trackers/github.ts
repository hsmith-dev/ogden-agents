/**
 * GitHub Issues (CAP-35, epic 27): the REST API at `api.github.com` with a
 * token that can read the account's one repository (`owner/name`). Pull
 * requests, which GitHub's issues list also returns, are left out. A search
 * is the user's words with any `qualifier:` taken out, scoped to the
 * repository and open issues, so it can never reach another repository.
 */
import { GITHUB_REPOSITORY_PATTERN, Issue, MAX_ISSUE_DESCRIPTION, MAX_ISSUES_LISTED, type IssueKey } from '@ogden-agents/shared';
import { TrackerError, type TrackerAdapter, type TrackerCall } from '@ogden-agents/core';
import { capped, trackerRequest, type TrackerHttpOptions } from './http.js';

export const GITHUB_API = 'https://api.github.com';

interface GitHubIssue {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  body?: string | null;
  updated_at?: string;
  assignees?: Array<{ login?: string }>;
  pull_request?: unknown;
}

const repositoryOf = (call: TrackerCall): string => {
  if (call.scope === null || !GITHUB_REPOSITORY_PATTERN.test(call.scope)) throw new TrackerError('not_found');
  return call.scope;
};

/** A GitHub issue as Ogden's `Issue`, or `undefined` for a pull request or a shape it can't read. */
function toIssue(raw: GitHubIssue): Issue | undefined {
  if (raw.pull_request !== undefined || typeof raw.number !== 'number') return undefined;
  const parsed = Issue.safeParse({
    kind: 'github',
    key: String(raw.number),
    identifier: `#${raw.number}`,
    title: capped(raw.title ?? '', 500),
    url: raw.html_url,
    status: raw.state ?? null,
    assignees: (raw.assignees ?? []).flatMap((each) => (typeof each.login === 'string' ? [capped(each.login, 100)] : [])).slice(0, 20),
    description: capped(raw.body ?? '', MAX_ISSUE_DESCRIPTION),
    updatedAt: raw.updated_at ?? null,
  });
  return parsed.success ? parsed.data : undefined;
}

/** The user's search words with every `qualifier:value` removed. */
export const plainSearchWords = (query: string): string =>
  query
    .split(/\s+/)
    .filter((word) => word !== '' && !/^-?[A-Za-z_-]+:/.test(word))
    .join(' ');

export function createGitHubTracker(options: TrackerHttpOptions = {}): TrackerAdapter {
  const get = async (call: TrackerCall, path: string): Promise<unknown> =>
    (await trackerRequest(options, { url: `${GITHUB_API}${path}`, method: 'GET', headers: { authorization: `Bearer ${call.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } })).json;
  const list = (json: unknown): Issue[] => (Array.isArray(json) ? (json as GitHubIssue[]).flatMap((raw) => toIssue(raw) ?? []).slice(0, MAX_ISSUES_LISTED) : []);

  return {
    async verify(call) {
      await get(call, `/repos/${repositoryOf(call)}`);
    },
    async issues(call, query) {
      const repository = repositoryOf(call);
      const words = query === undefined ? '' : plainSearchWords(query);
      if (words === '') return list(await get(call, `/repos/${repository}/issues?state=open&sort=updated&direction=desc&per_page=${MAX_ISSUES_LISTED}`));
      const q = encodeURIComponent(`${words} repo:${repository} is:issue is:open`);
      const found = (await get(call, `/search/issues?q=${q}&sort=updated&order=desc&per_page=${MAX_ISSUES_LISTED}`)) as { items?: unknown } | undefined;
      return list(found?.items);
    },
    async issue(call, key: IssueKey) {
      if (!/^\d{1,10}$/.test(key)) throw new TrackerError('not_found');
      const issue = toIssue((await get(call, `/repos/${repositoryOf(call)}/issues/${key}`)) as GitHubIssue);
      if (issue === undefined) throw new TrackerError('not_found');
      return issue;
    },
  };
}
