import { API_ROUTES, apiPath, TrialResponse, TrialsResponse, type Trial, type TrialOthers } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/**
 * Trials (epic 27, 27.8): one task tried by several agents, each in its own
 * worktree chat. The server makes the chats, sends each the task and keeps
 * the trial; every tab follows a start, a Keep, a put-away, a Restore and a
 * deleted chat through their events.
 */

export const trialsQueryKey = (wsId: string) => ['trials', wsId] as const;
export const trialQueryKey = (wsId: string, tryId: string) => ['trials', wsId, tryId] as const;

export async function fetchTrials(wsId: string, auth: Auth = tabAuth): Promise<Trial[]> {
  return TrialsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceTrials, { wsId }), {}, "Ogden Agents couldn't load this project's tries")).trials;
}

export async function fetchTrial(wsId: string, tryId: string, auth: Auth = tabAuth): Promise<Trial> {
  return TrialResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceTrial, { wsId, tryId }), {}, "Ogden Agents couldn't load this try")).trial;
}

/** Start: one worktree chat per agent, each sent `text`; a `ChatApiError` naming an agent that can't start (nothing made). */
export async function startTrial(wsId: string, text: string, agentIds: readonly string[], auth: Auth = tabAuth): Promise<Trial> {
  return TrialResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceTrials, { wsId }), postJson({ text, agentIds }), "Ogden Agents couldn't start the try")).trial;
}

/** Keep this one: the others put away or deleted; a 409 (`agent_mid_turn`, `uncommitted_changes`) changes nothing. */
export async function keepTrial(wsId: string, tryId: string, body: { sessionId: string; others: TrialOthers; discard: readonly string[] }, auth: Auth = tabAuth): Promise<Trial> {
  return TrialResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceTrialKeep, { wsId, tryId }), postJson(body), "Ogden Agents couldn't keep that chat")).trial;
}

/** Whether `type` is one that changes a trial or its chats' places. */
const TRIAL_EVENTS: ReadonlySet<string> = new Set(['workspace.trial_started', 'workspace.trial_kept', 'workspace.chat_deleted', 'workspace.history_deleted', 'session.worktree_put_away', 'session.worktree_restored']);

/** The project's trials, newest first, following each start, Keep and deleted chat. */
export function useTrials(wsId: string, { enabled = true, auth = tabAuth }: { enabled?: boolean; auth?: Auth } = {}) {
  useEventInvalidation((event) => (event.workspaceId === wsId && TRIAL_EVENTS.has(event.type) ? [trialsQueryKey(wsId)] : []));
  return useQuery({ queryKey: trialsQueryKey(wsId), queryFn: () => fetchTrials(wsId, auth), retry: false, enabled });
}

/** One trial, following its Keep and its chats' put-aways, Restores and deletes. */
export function useTrial(wsId: string, tryId: string, auth: Auth = tabAuth) {
  useEventInvalidation((event) => (event.workspaceId === wsId && TRIAL_EVENTS.has(event.type) ? [trialQueryKey(wsId, tryId)] : []));
  return useQuery({ queryKey: trialQueryKey(wsId, tryId), queryFn: () => fetchTrial(wsId, tryId, auth), retry: false });
}
