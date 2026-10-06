import {
  API_ROUTES,
  apiPath,
  APPLY_FIX_FAILED,
  CHECK_AGAIN_FAILED,
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
  type CoreEvent,
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

/** `POST …/builds/:ref/reject`: removes the run's worktree and stops it; with `retry`, builds the ticket again with the optional `note` (Reject and retry, story 5.9). */
export async function rejectBuild(wsId: string, ref: string, options: { retry?: boolean; note?: string } = {}, auth: Auth = tabAuth): Promise<ReviewResponse> {
  const note = options.note?.trim();
  const body = { ...(options.retry === true ? { retry: true } : {}), ...(note === undefined || note === '' ? {} : { note }) };
  const json = await call(auth, apiPath(API_ROUTES.workspaceBuildReject, { wsId, ref }), postJson(body), REJECT_FAILED);
  return ReviewResponse.parse(json);
}

/** `POST …/runs/:runId/retry` with `mode: 'rebase'` (Update and retry, story 5.9): the blocked run's branch is updated and checked again. */
export async function updateAndRetryRun(wsId: string, runId: string, auth: Auth = tabAuth): Promise<Run> {
  const json = await call(auth, apiPath(API_ROUTES.runRetry, { wsId, runId }), postJson({ mode: 'rebase' }), RETRY_FAILED);
  return RunResponse.parse(json).run;
}

/**
 * The newest `seq` among the events `matches` (0 for none). A query refetches when this changes, never when a
 * count does: the store trims a stream it does not keep whole, so an old event can leave as a new one arrives and
 * leave the count where it was (a blocked run stayed "Building" on a slow computer, story 11.2).
 */
export function latestSeq(events: readonly CoreEvent[], matches: (event: CoreEvent) => boolean): number {
  let latest = 0;
  for (const event of events) if (matches(event) && event.seq > latest) latest = event.seq;
  return latest;
}

/** A `build` session's run, refetched whenever the session's stream says its run changed. */
export function useSessionRun(wsId: string, sesId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const events = useSessionEvents(wsId, sesId);
  const runEvents = latestSeq(events, (event) => event.type === 'run.created' || event.type === 'run.dispatched' || event.type === 'run.outcome_changed');
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
  const relevant = latestSeq(events, (event) => event.workspaceId === wsId && event.type.startsWith('run.'));
  useEffect(() => {
    if (relevant > 0) void queryClient.invalidateQueries({ queryKey: ['review', wsId, ref], exact: true });
  }, [relevant, queryClient, wsId, ref]);
  return useQuery({ queryKey: ['review', wsId, ref], queryFn: () => fetchReview(wsId, ref), retry: false });
}

/**
 * Approve, Reject and retry, or Update and retry: once settled, the review,
 * the board's tickets and the runs refetch. A Reject and retry answers with
 * the new run's review, which is the ticket's latest.
 */
export function useReviewAction(wsId: string, ref: string, action: 'approve' | 'reject' | 'update') {
  const queryClient = useQueryClient();
  return useMutation({
    // Approve sends the branch revision the page showed (review loop 1): a build that moved since is refused.
    mutationFn: (input: { revision?: string | null; note?: string; runId?: string }): Promise<unknown> =>
      action === 'approve'
        ? approveBuild(wsId, ref, input.revision ?? '')
        : action === 'reject'
          ? rejectBuild(wsId, ref, { retry: true, ...(input.note === undefined ? {} : { note: input.note }) })
          : updateAndRetryRun(wsId, input.runId ?? ''),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review', wsId, ref] }),
        queryClient.invalidateQueries({ queryKey: ['tickets', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['session-run', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['runs', wsId] }),
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

/** `POST …/runs/:runId/check-again` (11.2): runs the end checks on the run's worktree once more. */
export async function checkRunAgain(wsId: string, runId: string, auth: Auth = tabAuth): Promise<Run> {
  const json = await call(auth, apiPath(API_ROUTES.runCheckAgain, { wsId, runId }), { method: 'POST' }, CHECK_AGAIN_FAILED);
  return RunResponse.parse(json).run;
}

/** `GET …/runs/:runId` (11.1): the run and its verification (11.2 shows it). */
export async function fetchRun(wsId: string, runId: string, auth: Auth = tabAuth): Promise<RunResponse> {
  return RunResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceRun, { wsId, runId }), {}, REVIEW_LOAD_FAILED));
}

/** One run with its verification, refetched when a `run.*` event of its workspace arrives. */
export function useRunDetail(wsId: string, runId: string | undefined) {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const relevant = latestSeq(events, (event) => event.workspaceId === wsId && event.type.startsWith('run.'));
  useEffect(() => {
    if (relevant > 0) void queryClient.invalidateQueries({ queryKey: ['run', wsId, runId], exact: true });
  }, [relevant, queryClient, wsId, runId]);
  return useQuery({ queryKey: ['run', wsId, runId], queryFn: () => fetchRun(wsId, runId!), retry: false, enabled: runId !== undefined });
}

/** `POST …/runs/:runId/retry` with `mode: 'apply_fix'` (11.1): applies an intent gap's saved fix in the run's worktree and builds again. */
export async function applySavedFix(wsId: string, runId: string, auth: Auth = tabAuth): Promise<Run> {
  const json = await call(auth, apiPath(API_ROUTES.runRetry, { wsId, runId }), postJson({ mode: 'apply_fix' }), APPLY_FIX_FAILED);
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
  const relevant = latestSeq(events, (event) => event.workspaceId === wsId && event.type.startsWith('run.'));
  useEffect(() => {
    if (relevant > 0) void queryClient.invalidateQueries({ queryKey: ['runs', wsId], exact: true });
  }, [relevant, queryClient, wsId]);
  return useQuery({ queryKey: ['runs', wsId], queryFn: () => fetchRuns(wsId), retry: false, enabled });
}

/** Stop or Retry: once settled, the run, the runs and the board's tickets refetch. */
export function useRunAction(wsId: string, action: 'stop' | 'retry' | 'apply_fix' | 'check_again') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => (action === 'stop' ? stopRun(wsId, runId) : action === 'apply_fix' ? applySavedFix(wsId, runId) : action === 'check_again' ? checkRunAgain(wsId, runId) : retryRun(wsId, runId)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['session-run', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['runs', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['run', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['review', wsId] }),
        queryClient.invalidateQueries({ queryKey: ['tickets', wsId] }),
      ]),
  });
}
