import {
  API_ROUTES,
  apiPath,
  BMAD_SETUP_FAILED,
  BmadSetupStartedResponse,
  BmadSetupStatusResponse,
  type BmadSetupProgress,
  type BmadSetupStartRequest,
  type BmadSetupStatus,
  type CoreEvent,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { bmadDetectionQueryKey } from '@/workspaces/bmad-detection-api';

/**
 * BMad Method's setup in a project (story 4.3), sent with this tab's token:
 * its status (`GET …/bmad/setup`, read from the project's files; Workspace
 * settings asks for it, Plan and Board use the detection), starting one
 * (`POST …/bmad/setup`), and the setup's progress, read from the
 * `bmad.setup_*` events on the workspace's stream (AD-7: events only say
 * what changed; a finished setup invalidates the detection, the status, the
 * catalog and the tickets, which are fetched again).
 */

export const bmadSetupQueryKey = (wsId: string) => ['bmad-setup', wsId] as const;

/** `GET /api/v1/workspaces/:wsId/bmad/setup`. */
export async function fetchBmadSetupStatus(wsId: string, auth: Auth = tabAuth): Promise<BmadSetupStatus> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBmadSetup, { wsId }), {}, BMAD_SETUP_FAILED);
  return BmadSetupStatusResponse.parse(json).setup;
}

/**
 * `POST /api/v1/workspaces/:wsId/bmad/setup`: starts a setup (`started: false`
 * when one already runs). `{ upgrade: true }` is Upgrade this project (entry
 * 4.11), sent as the body; Set up sends none, as before.
 */
export async function startBmadSetup(wsId: string, request: BmadSetupStartRequest = {}, auth: Auth = tabAuth): Promise<BmadSetupStartedResponse> {
  const init: RequestInit =
    request.upgrade === true ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ upgrade: true }) } : { method: 'POST' };
  const json = await call(auth, apiPath(API_ROUTES.workspaceBmadSetup, { wsId }), init, BMAD_SETUP_FAILED);
  return BmadSetupStartedResponse.parse(json);
}

/** The queries a finished setup makes stale: the detection, the status, the catalog and the tickets. */
export function setupStaleKeys(wsId: string) {
  return [bmadDetectionQueryKey(wsId), bmadSetupQueryKey(wsId), ['catalog', wsId], ['tickets', wsId]] as const;
}

/** Invalidates {@link setupStaleKeys} on each setup that ends in this workspace, from any tab. */
export function useSetupInvalidation(wsId: string): void {
  useEventInvalidation((event) =>
    event.workspaceId === wsId && (event.type === 'bmad.setup_completed' || event.type === 'bmad.setup_failed') ? setupStaleKeys(wsId) : [],
  );
}

/** The project's setup status (Workspace settings only), asked again after each setup or pieces change. */
export function useBmadSetupStatus(wsId: string, enabled: boolean) {
  useSetupInvalidation(wsId);
  useEventInvalidation((event) => (event.workspaceId === wsId && event.type === 'workspace.settings_changed' ? [bmadSetupQueryKey(wsId)] : []));
  return useQuery({ queryKey: bmadSetupQueryKey(wsId), queryFn: () => fetchBmadSetupStatus(wsId), retry: false, enabled });
}

/** Where the workspace's latest setup stands, from its events. */
export interface SetupProgress {
  /** A setup started and hasn't ended. */
  running: boolean;
  /** The steps reported since the latest start, in order. */
  steps: BmadSetupProgress[];
  /** The latest setup's failure reason, when it failed. */
  failedReason: string | undefined;
  /** The latest setup's status, when it completed. */
  completed: BmadSetupStatus | undefined;
  /** The `seq` of the latest setup event (0 when none). */
  seq: number;
  /** The `seq` of the latest `bmad.setup_started` (0 when none). */
  startedSeq: number;
}

/** The workspace's latest setup, from `events` (every scope merged, in `seq` order). */
export function setupProgressOf(events: readonly CoreEvent[], wsId: string): SetupProgress {
  const progress: SetupProgress = { running: false, steps: [], failedReason: undefined, completed: undefined, seq: 0, startedSeq: 0 };
  for (const event of events) {
    if (event.workspaceId !== wsId) continue;
    switch (event.type) {
      case 'bmad.setup_started':
        Object.assign(progress, { running: true, steps: [], failedReason: undefined, completed: undefined, seq: event.seq, startedSeq: event.seq });
        break;
      case 'bmad.setup_progress':
        progress.steps = [...progress.steps, event.payload];
        progress.seq = event.seq;
        break;
      case 'bmad.setup_completed':
        Object.assign(progress, { running: false, completed: event.payload.status, seq: event.seq });
        break;
      case 'bmad.setup_failed':
        Object.assign(progress, { running: false, failedReason: event.payload.reason, seq: event.seq });
        break;
      default:
        break;
    }
  }
  return progress;
}

/**
 * The workspace's setup progress, and `liveAfter`: the highest `seq` once
 * this view had the stream's backlog (review Q3). A setup that started at or
 * before it is replayed history, so its done or failed line is not shown
 * again after a reload; `undefined` until the backlog has arrived (nothing
 * counts as live yet).
 */
export function useBmadSetupProgress(wsId: string): SetupProgress & { liveAfter: number | undefined; lastSeq: number } {
  const { events, lastSeq, caughtUp } = useEventStream();
  const liveAfter = useRef<number | undefined>(undefined);
  if (liveAfter.current === undefined && caughtUp) liveAfter.current = lastSeq;
  useSetupInvalidation(wsId);
  const progress = useMemo(() => setupProgressOf(events, wsId), [events, wsId]);
  return { ...progress, liveAfter: liveAfter.current, lastSeq };
}

/** Invalidates the queries a setup changes (a 409 `bmad_already_set_up` says the detection was stale). */
export function useInvalidateSetup(wsId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    for (const key of setupStaleKeys(wsId)) void queryClient.invalidateQueries({ queryKey: key });
  };
}
