import {
  API_ROUTES,
  apiPath,
  APPROVE_FAILED,
  BUILD_DIALOG_LOAD_FAILED,
  BUILD_FAILED,
  type BuildMode,
  BuildResponse,
  COMMIT_PLAN_FILES_FAILED,
  CommitPlanFilesResponse,
  REJECT_FAILED,
  RunLimitSettingsResponse,
  RunResponse,
  RunsResponse,
  WorkspaceBuildSettingsResponse,
  type RunLimitSettings,
  type WorkspaceBuildSettings,
  type UpdateRunLimitSettingsRequest,
  type UpdateWorkspaceBuildSettingsRequest,
  REVIEW_LOAD_FAILED,
  ReviewResponse,
  SandboxStatusResponse,
  SessionRunResponse,
  type Run,
} from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream, useSessionEvents } from '@/events/event-stream';

/**
 * Unattended builds' REST calls (story 5.2, the tracer), sent with this
 * tab's token: Build on a card, a build session's run, and the review page's
 * read, Approve and Reject. Run state is fetched; `run.*` events only
 * trigger a refetch (AD-7's pattern).
 */

/**
 * `POST /api/v1/workspaces/:wsId/builds`: builds ticket `ref` in its own
 * worktree and `build` session. `mode: 'attended'` (story 5.6, the Build
 * dialog's Build with me watching) builds with every tool call a card.
 */
export async function startBuild(wsId: string, ref: string, mode: BuildMode = 'unattended', auth: Auth = tabAuth): Promise<BuildResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuilds, { wsId }), postJson(mode === 'attended' ? { ref, mode } : { ref }), BUILD_FAILED);
  return BuildResponse.parse(json);
}

/** `GET …/build-sandbox` (story 5.6): what a build's sandbox is here, in plain words, for the Build dialog. */
export async function fetchBuildSandbox(wsId: string, auth: Auth = tabAuth) {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuildSandbox, { wsId }), {}, BUILD_DIALOG_LOAD_FAILED);
  return SandboxStatusResponse.parse(json).status;
}

/** `POST …/builds/:ref/commit-plan` (story 5.5): commits the ticket's uncommitted plan files, and only those. */
export async function commitPlanFiles(wsId: string, ref: string, auth: Auth = tabAuth): Promise<CommitPlanFilesResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuildCommitPlan, { wsId, ref }), { method: 'POST' }, COMMIT_PLAN_FILES_FAILED);
  return CommitPlanFilesResponse.parse(json);
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

/** `POST …/builds/:ref/approve`: merges the reviewed `revision` locally with the ticket's `done` mark. */
export async function approveBuild(wsId: string, ref: string, revision: string, auth: Auth = tabAuth): Promise<ReviewResponse> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuildApprove, { wsId, ref }), postJson({ revision }), APPROVE_FAILED);
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
  const runEvents = events.filter((event) => event.type === 'run.created' || event.type === 'run.dispatched' || event.type === 'run.outcome_changed').length;
  useEffect(() => {
    if (runEvents > 0) void queryClient.invalidateQueries({ queryKey: ['session-run', wsId, sesId] });
  }, [runEvents, queryClient, wsId, sesId]);
  return useQuery({ queryKey: ['session-run', wsId, sesId], queryFn: () => fetchSessionRun(wsId, sesId), retry: false, enabled });
}

/** The review page's read of ticket `ref`. */
export function useReview(wsId: string, ref: string) {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  // A run of this workspace changed (a build ending, a verification): the page reads again.
  const relevant = events.filter((event) => event.workspaceId === wsId && event.type.startsWith('run.')).length;
  useEffect(() => {
    if (relevant > 0) void queryClient.invalidateQueries({ queryKey: ['review', wsId, ref], exact: true });
  }, [relevant, queryClient, wsId, ref]);
  return useQuery({ queryKey: ['review', wsId, ref], queryFn: () => fetchReview(wsId, ref), retry: false });
}

/** Approve or Reject: once settled, the review, the board's tickets and the run refetch. */
export function useReviewAction(wsId: string, ref: string, action: 'approve' | 'reject') {
  const queryClient = useQueryClient();
  return useMutation({
    // Approve sends the branch revision the page showed (review loop 1): a build that moved since is refused.
    mutationFn: (revision: string | null) => (action === 'approve' ? approveBuild(wsId, ref, revision ?? '') : rejectBuild(wsId, ref)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review', wsId, ref] }),
        queryClient.invalidateQueries({ queryKey: ['tickets', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['session-run', wsId] }),
      ]),
  });
}

// ---- Story 5.8: the queue, Stop, Retry and the limits ----

/** The failure sentences of the calls below (plain words, no dashes). */
export const STOP_FAILED = "The build couldn't be stopped. Try again.";
export const RETRY_FAILED = "The build couldn't be started again. Try again.";
export const BUILD_SETTINGS_LOAD_FAILED = "The build settings couldn't be loaded.";
export const BUILD_SETTINGS_SAVE_FAILED = "The build settings couldn't be saved. Try again.";

/** `GET …/runs`: the workspace's runs, newest first, and its queue. */
export async function fetchRuns(wsId: string, auth: Auth = tabAuth) {
  const json = await call(auth, apiPath(API_ROUTES.workspaceRuns, { wsId }), {}, REVIEW_LOAD_FAILED);
  return RunsResponse.parse(json);
}

/** `POST …/runs/:runId/stop`: stops a running or queued build. */
export async function stopRun(wsId: string, runId: string, auth: Auth = tabAuth): Promise<Run> {
  const json = await call(auth, apiPath(API_ROUTES.runStop, { wsId, runId }), { method: 'POST' }, STOP_FAILED);
  return RunResponse.parse(json).run;
}

/** `POST …/runs/:runId/retry`: runs a blocked, failed or stopped build again, or continues one paused at a checkpoint. */
export async function retryRun(wsId: string, runId: string, auth: Auth = tabAuth): Promise<Run> {
  const json = await call(auth, apiPath(API_ROUTES.runRetry, { wsId, runId }), postJson({}), RETRY_FAILED);
  return RunResponse.parse(json).run;
}

/** `GET` and `PATCH /api/v1/settings/run-limits`: the install's builds at a time and time limit. */
export async function fetchRunLimits(auth: Auth = tabAuth): Promise<RunLimitSettings> {
  return RunLimitSettingsResponse.parse(await call(auth, API_ROUTES.runLimits, {}, BUILD_SETTINGS_LOAD_FAILED)).settings;
}
export async function saveRunLimits(request: UpdateRunLimitSettingsRequest, auth: Auth = tabAuth): Promise<RunLimitSettings> {
  return RunLimitSettingsResponse.parse(await call(auth, API_ROUTES.runLimits, { ...postJson(request), method: 'PATCH' }, BUILD_SETTINGS_SAVE_FAILED)).settings;
}

/** `GET` and `PATCH …/build-settings`: a project's builds at a time (and its test command, 11.2). */
export async function fetchBuildSettings(wsId: string, auth: Auth = tabAuth): Promise<WorkspaceBuildSettings> {
  return WorkspaceBuildSettingsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceBuildSettings, { wsId }), {}, BUILD_SETTINGS_LOAD_FAILED)).settings;
}
export async function saveBuildSettings(wsId: string, request: UpdateWorkspaceBuildSettingsRequest, auth: Auth = tabAuth): Promise<WorkspaceBuildSettings> {
  return WorkspaceBuildSettingsResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceBuildSettings, { wsId }), { ...postJson(request), method: 'PATCH' }, BUILD_SETTINGS_SAVE_FAILED)).settings;
}

/** The workspace's runs and queue, refetched when a `run.*` event of this workspace arrives (AD-7's pattern). */
export function useWorkspaceRuns(wsId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const relevant = events.filter((event) => event.workspaceId === wsId && event.type.startsWith('run.')).length;
  useEffect(() => {
    if (relevant > 0) void queryClient.invalidateQueries({ queryKey: ['runs', wsId], exact: true });
  }, [relevant, queryClient, wsId]);
  return useQuery({ queryKey: ['runs', wsId], queryFn: () => fetchRuns(wsId), retry: false, enabled });
}

/** Stop or Retry: once settled, the run, the runs and the board's tickets refetch. */
export function useRunAction(wsId: string, action: 'stop' | 'retry') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => (action === 'stop' ? stopRun(wsId, runId) : retryRun(wsId, runId)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['session-run', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['runs', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['tickets', wsId] }),
      ]),
  });
}
