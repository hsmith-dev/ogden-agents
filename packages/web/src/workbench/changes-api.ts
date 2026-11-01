import {
  API_ROUTES,
  apiPath,
  CHANGES_READ_FAILED,
  CHANGES_TURNS_READ_FAILED,
  ChangesResponse,
  COMMIT_FAILED,
  CommitWorktreeResponse,
  FileDiffResponse,
  HUNK_ACTION_FAILED,
  HunkActionResponse,
  TurnsResponse,
  type ChangesView,
  type HunkActionRequest,
  type UndoHunkRequest,
} from '@ogden-agents/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { call, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/**
 * The Workbench's Changes calls (AD-37; stories 8.4 and 8.5), sent with
 * this tab's token. A diff is fetched each time it is shown and never kept
 * once the panel closes (`gcTime: 0`); it never travels in an event. A
 * hunk action names hunk ids only: the patch is the server's own diff.
 */

/** Which view, of which chat's folder (and turn). */
export interface ChangesTarget {
  view: ChangesView;
  session?: string | undefined;
  turn?: string | undefined;
}

const queryOf = (target: ChangesTarget, extra: Record<string, string> = {}): string =>
  new URLSearchParams({
    view: target.view,
    ...(target.session === undefined ? {} : { session: target.session }),
    ...(target.turn === undefined || target.view !== 'turn' ? {} : { turn: target.turn }),
    ...extra,
  }).toString();

/** `GET …/changes?view=&session=&turn=`: the view's changed files. */
export async function fetchChanges(wsId: string, target: ChangesTarget, auth: Auth = tabAuth): Promise<ChangesResponse> {
  return ChangesResponse.parse(await call(auth, `${apiPath(API_ROUTES.workspaceChanges, { wsId })}?${queryOf(target)}`, {}, CHANGES_READ_FAILED));
}

/** `GET …/changes/file?view=&path=&session=&turn=`: one file's hunks. */
export async function fetchFileDiff(wsId: string, target: ChangesTarget, path: string, auth: Auth = tabAuth): Promise<FileDiffResponse> {
  return FileDiffResponse.parse(await call(auth, `${apiPath(API_ROUTES.workspaceChangesFile, { wsId })}?${queryOf(target, { path })}`, {}, CHANGES_READ_FAILED));
}

/** `GET …/sessions/:sesId/turns`: the chat's recorded turns, newest first. */
export async function fetchTurns(wsId: string, sesId: string, auth: Auth = tabAuth): Promise<TurnsResponse> {
  return TurnsResponse.parse(await call(auth, apiPath(API_ROUTES.sessionTurns, { wsId, sesId }), {}, CHANGES_TURNS_READ_FAILED));
}

/** `POST …/sessions/:sesId/worktree/commit`: everything in the chat's worktree, on its own branch, never pushed. */
export async function commitWorktree(wsId: string, sesId: string, message: string, auth: Auth = tabAuth): Promise<CommitWorktreeResponse> {
  return CommitWorktreeResponse.parse(await call(auth, apiPath(API_ROUTES.sessionWorktreeCommit, { wsId, sesId }), postJson({ message }), COMMIT_FAILED));
}

/** A hunk action's body, its chat and turn as the panel has them (the server checks each). */
export type HunkActionBody = Omit<HunkActionRequest, 'session' | 'turn'> & { session?: string; turn?: string };
/** An Undo's body. */
export type UndoRevertBody = Omit<UndoHunkRequest, 'session'> & { session?: string };

/** `POST …/changes/hunks`: stage, unstage or revert one hunk or the whole file (by the ids shown). */
export async function postHunkAction(wsId: string, request: HunkActionBody, auth: Auth = tabAuth): Promise<HunkActionResponse> {
  return HunkActionResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceChangesHunks, { wsId }), postJson(request), HUNK_ACTION_FAILED));
}

/** `POST …/changes/hunks/undo`: put back what a revert took. */
export async function postUndoRevert(wsId: string, request: UndoRevertBody, auth: Auth = tabAuth): Promise<HunkActionResponse> {
  return HunkActionResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceChangesHunksUndo, { wsId }), postJson(request), HUNK_ACTION_FAILED));
}

const changesKey = (wsId: string, target: ChangesTarget) => ['workspace-changes', wsId, target.view, target.session ?? '', target.turn ?? ''] as const;

/** The view's changed files. */
export function useChanges(wsId: string, target: ChangesTarget) {
  return useQuery({ queryKey: changesKey(wsId, target), queryFn: () => fetchChanges(wsId, target), retry: false, staleTime: 0 });
}

/** The diffs of `paths` in the view (fetched each time, never kept). */
export function useFileDiffs(wsId: string, target: ChangesTarget, paths: readonly string[]) {
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: [...changesKey(wsId, target), 'file', path] as const,
      queryFn: () => fetchFileDiff(wsId, target, path),
      retry: false,
      staleTime: 0,
      gcTime: 0,
    })),
  });
}

/** The chat's recorded turns; only with a chat. */
export function useTurns(wsId: string, sesId: string | undefined) {
  return useQuery({ queryKey: ['session-turns', wsId, sesId ?? ''], queryFn: () => fetchTurns(wsId, sesId!), enabled: sesId !== undefined, retry: false, staleTime: 0 });
}

/** Commit these changes; every view of the project is read again after. */
export function useCommitWorktree(wsId: string, sesId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => commitWorktree(wsId, sesId, message),
    onSettled: () => client.invalidateQueries({ queryKey: ['workspace-changes', wsId] }),
  });
}

/** A hunk action; every view of the project is read again after, applied or refused. */
export function useHunkAction(wsId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: HunkActionBody) => postHunkAction(wsId, request),
    onSettled: () => client.invalidateQueries({ queryKey: ['workspace-changes', wsId] }),
  });
}

/** A revert's Undo; every view of the project is read again after. */
export function useUndoRevert(wsId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: UndoRevertBody) => postUndoRevert(wsId, request),
    onSettled: () => client.invalidateQueries({ queryKey: ['workspace-changes', wsId] }),
  });
}
