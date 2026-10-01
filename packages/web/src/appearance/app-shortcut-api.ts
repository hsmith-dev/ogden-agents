import { API_ROUTES, AppShortcutStatus } from '@ogden-agents/shared';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, callNoContent } from '@/api/http';

/**
 * The app shortcut REST calls (story 2.4, E2-R10), sent with this tab's
 * token, and the query and mutations the first-run offer and the Appearance
 * setting share: one answer updates both.
 */

type Auth = Pick<TabAuth, 'fetch'>;

export const APP_SHORTCUT_QUERY_KEY = ['app-shortcut'] as const;
/** Every answer to the offer (Not now, and Welcome's answer) while it is being sent or retried. */
export const OFFER_ANSWER_MUTATION_KEY = ['app-shortcut', 'offer-answer'] as const;

/** `GET /api/v1/app-shortcut`. */
export async function fetchAppShortcut(auth: Auth = tabAuth): Promise<AppShortcutStatus> {
  const json = await call(auth, API_ROUTES.appShortcut, {}, "Ogden Agents couldn't check the app shortcut");
  return AppShortcutStatus.parse(json);
}

/** `POST /api/v1/app-shortcut`: adds (or re-points) the shortcut; 422 with plain words when it can't. */
export async function addAppShortcut(auth: Auth = tabAuth): Promise<AppShortcutStatus> {
  const json = await call(auth, API_ROUTES.appShortcut, { method: 'POST' }, "Ogden Agents couldn't add the app shortcut");
  return AppShortcutStatus.parse(json);
}

/** `DELETE /api/v1/app-shortcut`. */
export const removeAppShortcut = (auth: Auth = tabAuth) => callNoContent(auth, API_ROUTES.appShortcut, { method: 'DELETE' }, "Ogden Agents couldn't remove the app shortcut");

/** `DELETE /api/v1/app-shortcut/offer`: Not now. */
export const dismissAppShortcutOffer = (auth: Auth = tabAuth) => callNoContent(auth, API_ROUTES.appShortcutOffer, { method: 'DELETE' }, "Ogden Agents couldn't save your answer");

/** Whether this computer can have the shortcut, has it, and still shows the offer. */
export function useAppShortcut() {
  return useQuery({ queryKey: APP_SHORTCUT_QUERY_KEY, queryFn: () => fetchAppShortcut(), retry: false });
}

/** How many times a failed answer to the offer is sent again when asked to (Welcome's shortcut step, 9.6). */
export const OFFER_ANSWER_RETRIES = 3;

/**
 * Add, Remove and Not now. Each refreshes the shared status; Add answers the
 * offer too. With `retryAnswer`, a failed Not now is sent again (up to
 * {@link OFFER_ANSWER_RETRIES} times, backing off) before it counts as failed,
 * so an answer nobody watches still reaches the server.
 */
export function useAppShortcutActions({ retryAnswer = false }: { retryAnswer?: boolean } = {}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: APP_SHORTCUT_QUERY_KEY });
  const add = useMutation({
    mutationFn: () => addAppShortcut(),
    onSuccess: (status) => queryClient.setQueryData(APP_SHORTCUT_QUERY_KEY, status),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => removeAppShortcut(), onSettled: refresh });
  const dismiss = useMutation({
    mutationKey: OFFER_ANSWER_MUTATION_KEY,
    mutationFn: () => dismissAppShortcutOffer(),
    retry: retryAnswer ? OFFER_ANSWER_RETRIES : 0,
    // Not now hides the offer at once; the server's answer confirms it.
    onMutate: () => {
      const current = queryClient.getQueryData<AppShortcutStatus>(APP_SHORTCUT_QUERY_KEY);
      if (current !== undefined) queryClient.setQueryData(APP_SHORTCUT_QUERY_KEY, { ...current, offerPending: false });
    },
    onSettled: refresh,
  });
  return { add, remove, dismiss };
}

/**
 * Whether an answer to the offer is still being sent (or retried): the offer
 * counts as answered until it fails for good (9.6), so a status read in the
 * meantime doesn't bring the offer back.
 */
export function useOfferAnswerPending(): boolean {
  return useIsMutating({ mutationKey: OFFER_ANSWER_MUTATION_KEY }) > 0;
}

/** Where the shortcut lives on this OS, in the user's words. */
export function shortcutLocation(platform: string): string {
  if (platform === 'darwin') return 'your Applications folder';
  if (platform === 'win32') return 'the Start menu';
  return 'your apps menu';
}
