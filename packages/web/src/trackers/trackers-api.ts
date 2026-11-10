import { API_ROUTES, apiPath, IssueContextResponse, IssuesResponse, TrackerAccountResponse, TrackerAccountsResponse, type TrackerAccountId, type TrackerKind } from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';

/**
 * The issue tracker REST calls (CAP-35, epic 27), sent with this tab's
 * token. Only the server talks to a tracker: this page sends a token once,
 * when adding an account, and never reads one back.
 */

export const TRACKER_ACCOUNTS_QUERY_KEY = ['tracker-accounts'] as const;

export async function fetchTrackerAccounts(auth: Auth = tabAuth) {
  return TrackerAccountsResponse.parse(await call(auth, API_ROUTES.trackerAccounts, {}, "Ogden Agents couldn't read your tracker accounts")).accounts;
}

export async function addTrackerAccount(body: { kind: TrackerKind; label: string; token: string; scope: string | null }, auth: Auth = tabAuth) {
  return TrackerAccountResponse.parse(await call(auth, API_ROUTES.trackerAccounts, postJson(body), "Ogden Agents couldn't add that account")).account;
}

export async function removeTrackerAccount(id: TrackerAccountId, auth: Auth = tabAuth) {
  await callNoContent(auth, apiPath(API_ROUTES.trackerAccount, { accountId: id }), { method: 'DELETE' }, "Ogden Agents couldn't remove that account");
}

export async function fetchIssues(id: TrackerAccountId, query: string, auth: Auth = tabAuth) {
  const path = apiPath(API_ROUTES.trackerIssues, { accountId: id });
  const q = query.trim();
  return IssuesResponse.parse(await call(auth, q === '' ? path : `${path}?q=${encodeURIComponent(q)}`, {}, "Ogden Agents couldn't read the issues")).issues;
}

export async function fetchIssueContext(id: TrackerAccountId, issueKey: string, auth: Auth = tabAuth) {
  return IssueContextResponse.parse(await call(auth, apiPath(API_ROUTES.trackerIssueContext, { accountId: id, issueKey }), {}, "Ogden Agents couldn't read that issue"));
}

/** The seq of the newest tracker account event received, or 0. */
function lastTrackerSeq(events: readonly { seq: number; type: string }[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'settings.tracker_accounts_changed') return events[i]!.seq;
  return 0;
}

/** The accounts, read over REST and again whenever another tab changes them. */
export function useTrackerAccounts() {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const seq = lastTrackerSeq(events);
  useEffect(() => {
    if (seq > 0) void queryClient.invalidateQueries({ queryKey: TRACKER_ACCOUNTS_QUERY_KEY });
  }, [seq, queryClient]);
  return useQuery({ queryKey: TRACKER_ACCOUNTS_QUERY_KEY, queryFn: () => fetchTrackerAccounts(), retry: false });
}
