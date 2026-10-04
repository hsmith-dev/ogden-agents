import {
  API_ROUTES,
  apiPath,
  APPROVE_FAILED,
  BUILD_FAILED,
  BuildResponse,
  REJECT_FAILED,
  REVIEW_LOAD_FAILED,
  ReviewResponse,
  SessionRunResponse,
  type Run,
} from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useSessionEvents } from '@/events/event-stream';

/**
 * Unattended builds' REST calls (story 5.2, the tracer), sent with this
 * tab's token: Build on a card, a build session's run, and the review page's
 * read, Approve and Reject. Run state is fetched; `run.*` events only
 * trigger a refetch (AD-7's pattern).
 */

/** `POST /api/v1/workspaces/:wsId/builds`: builds ticket `ref` in its own worktree and `build` session. */
export async function startBuild(wsId: string, ref: string, auth: Auth = tabAuth): Promise<BuildResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuilds, { wsId }), postJson({ ref }), BUILD_FAILED);
  return BuildResponse.parse(json);
}

/** `GET /api/v1/workspaces/:wsId/sessions/:sesId/run`: a `build` session's run. */
export async function fetchSessionRun(wsId: string, sesId: string, auth: Auth = tabAuth): Promise<Run> {
  const json = await call(auth, apiPath(API_ROUTES.sessionRun, { wsId, sesId }), {}, REVIEW_LOAD_FAILED);
  return SessionRunResponse.parse(json).run;
}

/** `GET /api/v1/workspaces/:wsId/builds/:ref`: the ticket's latest run, for the review page. */
export async function fetchReview(wsId: string, ref: string, auth: Auth = tabAuth): Promise<ReviewResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuild, { wsId, ref }), {}, REVIEW_LOAD_FAILED);
  return ReviewResponse.parse(json);
}

/** `POST …/builds/:ref/approve`: merges the run locally with the ticket's `done` mark. */
export async function approveBuild(wsId: string, ref: string, auth: Auth = tabAuth): Promise<ReviewResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref }), { method: 'POST' }, APPROVE_FAILED);
  return ReviewResponse.parse(json);
}

/** `POST …/builds/:ref/reject`: removes the run's worktree and stops it. */
export async function rejectBuild(wsId: string, ref: string, auth: Auth = tabAuth): Promise<ReviewResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuildReject, { wsId, ref }), { method: 'POST' }, REJECT_FAILED);
  return ReviewResponse.parse(json);
}

/** A `build` session's run, refetched whenever the session's stream says its run changed. */
export function useSessionRun(wsId: string, sesId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const events = useSessionEvents(wsId, sesId);
  const runEvents = events.filter((event) => event.type === 'run.created' || event.type === 'run.outcome_changed').length;
  useEffect(() => {
    if (runEvents > 0) void queryClient.invalidateQueries({ queryKey: ['session-run', wsId, sesId] });
  }, [runEvents, queryClient, wsId, sesId]);
  return useQuery({ queryKey: ['session-run', wsId, sesId], queryFn: () => fetchSessionRun(wsId, sesId), retry: false, enabled });
}

/** The review page's read of ticket `ref`. */
export function useReview(wsId: string, ref: string) {
  return useQuery({ queryKey: ['review', wsId, ref], queryFn: () => fetchReview(wsId, ref), retry: false });
}

/** Approve or Reject: once settled, the review, the board's tickets and the run refetch. */
export function useReviewAction(wsId: string, ref: string, action: 'approve' | 'reject') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => (action === 'approve' ? approveBuild(wsId, ref) : rejectBuild(wsId, ref)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review', wsId, ref] }),
        queryClient.invalidateQueries({ queryKey: ['tickets', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['session-run', wsId] }),
      ]),
  });
}
