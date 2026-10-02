import { API_ROUTES, apiPath, BmadDetectionResponse, type BmadDetection, type BmadPiece } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call, callNoContent } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/**
 * Whether a project's repo already uses BMad Method, and Not now on the
 * offer (story 10.3), sent with this tab's token. The server detects
 * read-only, each time the chats page opens; the event log only
 * invalidates the answer (AD-7), so a piece turned on or a Not now in any
 * tab hides the offer here too.
 */

type Auth = Pick<TabAuth, 'fetch'>;

export const bmadDetectionQueryKey = (wsId: string) => ['bmad-detection', wsId] as const;

/** `GET /api/v1/workspaces/:wsId/bmad/detection`. */
export async function fetchBmadDetection(wsId: string, auth: Auth = tabAuth): Promise<BmadDetection> {
  const json = await call(auth, apiPath(API_ROUTES.workspaceBmadDetection, { wsId }), {}, "Ogden Agents couldn't check this project for BMad Method");
  return BmadDetectionResponse.parse(json).detection;
}

/** `DELETE /api/v1/workspaces/:wsId/bmad/offer`: Not now, kept for this project. */
export async function dismissBmadOffer(wsId: string, auth: Auth = tabAuth): Promise<void> {
  await callNoContent(auth, apiPath(API_ROUTES.workspaceBmadOffer, { wsId }), { method: 'DELETE' }, "Ogden Agents couldn't save your answer");
}

/**
 * Whether the offer shows: the repo has `_bmad/`, every piece is off, and
 * the user hasn't answered Not now. Unknown (still loading, or a failed
 * fetch) never shows it.
 */
export function bmadOfferVisible(detection: BmadDetection | undefined, pieces: readonly BmadPiece[] | undefined): boolean {
  return detection !== undefined && pieces !== undefined && detection.hasBmad && !detection.offerDismissed && pieces.length === 0;
}

/** Invalidates this project's detection on each new pieces change or Not now, from any tab. */
function useDetectionInvalidation(wsId: string): void {
  useEventInvalidation((event) =>
    event.workspaceId === wsId && (event.type === 'workspace.settings_changed' || event.type === 'workspace.bmad_offer_dismissed') ? [bmadDetectionQueryKey(wsId)] : [],
  );
}

/** The project's detection, asked again each time the page that shows the offer opens. */
export function useBmadDetection(wsId: string) {
  useDetectionInvalidation(wsId);
  return useQuery({ queryKey: bmadDetectionQueryKey(wsId), queryFn: () => fetchBmadDetection(wsId), retry: false, refetchOnMount: 'always' });
}

/** Not now: hides the offer at once; the server keeps the answer for this project. */
export function useDismissBmadOffer(wsId: string) {
  const queryClient = useQueryClient();
  const key = bmadDetectionQueryKey(wsId);
  return useMutation({
    mutationFn: () => dismissBmadOffer(wsId),
    onSuccess: () => {
      const current = queryClient.getQueryData<BmadDetection>(key);
      if (current !== undefined) queryClient.setQueryData<BmadDetection>(key, { ...current, offerDismissed: true });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
