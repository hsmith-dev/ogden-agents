/**
 * Linear (CAP-35, epic 27): the GraphQL API at `api.linear.app` with a
 * personal API key (sent as Linear asks, the key itself in Authorization),
 * optionally scoped to one team by its key. Every query is fixed here and
 * the user's words travel only as GraphQL variables. Lists leave out
 * completed and canceled issues; an issue outside the account's team is
 * not found.
 */
import { Issue, MAX_ISSUE_DESCRIPTION, MAX_ISSUES_LISTED, type IssueKey } from '@ogden-agents/shared';
import { TrackerError, type TrackerAdapter, type TrackerCall } from '@ogden-agents/core';
import { capped, trackerRequest, type TrackerHttpOptions } from './http.js';

export const LINEAR_API = 'https://api.linear.app/graphql';

const ISSUE_FIELDS = 'identifier title url description updatedAt state { name } assignee { name } team { key }';

interface LinearIssue {
  identifier?: string;
  title?: string;
  url?: string;
  description?: string | null;
  updatedAt?: string;
  state?: { name?: string } | null;
  assignee?: { name?: string } | null;
  team?: { key?: string } | null;
}

interface GraphQlAnswer {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message?: string; extensions?: { code?: string; type?: string } }>;
}

function toIssue(raw: LinearIssue | null | undefined): Issue | undefined {
  if (raw === null || raw === undefined || typeof raw.identifier !== 'string') return undefined;
  const parsed = Issue.safeParse({
    kind: 'linear',
    key: raw.identifier,
    identifier: raw.identifier,
    title: capped(raw.title ?? '', 500),
    url: raw.url,
    status: raw.state?.name ?? null,
    assignees: typeof raw.assignee?.name === 'string' ? [capped(raw.assignee.name, 100)] : [],
    description: capped(raw.description ?? '', MAX_ISSUE_DESCRIPTION),
    updatedAt: raw.updatedAt ?? null,
  });
  return parsed.success ? parsed.data : undefined;
}

/** A GraphQL error as a failure: authentication is `unauthorized`, a missing entity `not_found`, anything else `unreachable`. */
function failureOf(errors: NonNullable<GraphQlAnswer['errors']>): TrackerError {
  const auth = errors.some((each) => /auth/i.test(`${each.extensions?.code ?? ''} ${each.extensions?.type ?? ''}`) || /authenticat/i.test(each.message ?? ''));
  if (auth) return new TrackerError('unauthorized');
  if (errors.some((each) => /not.?found/i.test(`${each.extensions?.code ?? ''} ${each.message ?? ''}`))) return new TrackerError('not_found');
  return new TrackerError('unreachable');
}

export function createLinearTracker(options: TrackerHttpOptions = {}): TrackerAdapter {
  const query = async (call: TrackerCall, text: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { json } = await trackerRequest(options, { url: LINEAR_API, method: 'POST', headers: { authorization: call.token }, body: { query: text, variables } });
    const answer = (json ?? {}) as GraphQlAnswer;
    if (answer.errors !== undefined && answer.errors.length > 0) throw failureOf(answer.errors);
    if (answer.data === null || answer.data === undefined) throw new TrackerError('unreachable');
    return answer.data;
  };
  const teamFilter = (call: TrackerCall) => (call.scope === null ? {} : { team: { key: { eq: call.scope } } });
  const nodes = (connection: unknown): Issue[] => {
    const list = (connection as { nodes?: LinearIssue[] } | undefined)?.nodes;
    return Array.isArray(list) ? list.flatMap((raw) => toIssue(raw) ?? []).slice(0, MAX_ISSUES_LISTED) : [];
  };

  return {
    async verify(call) {
      await query(call, 'query { viewer { id } }', {});
      if (call.scope === null) return;
      const data = await query(call, 'query Team($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }', { key: call.scope });
      if ((data.teams as { nodes?: unknown[] } | undefined)?.nodes?.length !== 1) throw new TrackerError('not_found');
    },
    async issues(call, words) {
      const filter = { ...teamFilter(call), state: { type: { nin: ['completed', 'canceled'] } } };
      if (words === undefined) {
        const data = await query(call, `query Issues($filter: IssueFilter, $first: Int) { issues(filter: $filter, first: $first, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`, { filter, first: MAX_ISSUES_LISTED });
        return nodes(data.issues);
      }
      const data = await query(call, `query Search($term: String!, $filter: IssueFilter, $first: Int) { searchIssues(term: $term, filter: $filter, first: $first) { nodes { ${ISSUE_FIELDS} } } }`, { term: words, filter, first: MAX_ISSUES_LISTED });
      return nodes(data.searchIssues);
    },
    async issue(call, key: IssueKey) {
      const data = await query(call, `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: key });
      const raw = data.issue as LinearIssue | null | undefined;
      if (call.scope !== null && raw?.team?.key !== call.scope) throw new TrackerError('not_found');
      const issue = toIssue(raw);
      if (issue === undefined) throw new TrackerError('not_found');
      return issue;
    },
  };
}
