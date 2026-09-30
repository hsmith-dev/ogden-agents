import { API_ROUTES, AppShortcutStatus } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { call, ChatApiError } from '@/chat/chat-api';

/**
 * The app shortcut REST calls (story 2.4, E2-R10), sent with this tab's
 * token, and the query and mutations the first-run offer and the Appearance
 * setting share: one answer updates both.
 */

type Auth = Pick<TabAuth, 'fetch'>;

const UNREACHABLE = "Couldn't reach Ogden Agents. Check that it is still running, then try again.";

export const APP_SHORTCUT_QUERY_KEY = ['app-shortcut'] as const;

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

/** A `DELETE` answered 204. */
async function callDelete(auth: Auth, path: string, fallback: string): Promise<void> {
  let response: Response;
  try {
    response = await auth.fetch(path, { method: 'DELETE' });
  } catch {
    throw new ChatApiError(UNREACHABLE, 0);
  }
  if (response.ok) return;
  let message = `${fallback} (error ${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') message = body.error.message;
  } catch {
    // Not JSON: keep the fallback.
  }
  throw new ChatApiError(message, response.status);
}

/** `DELETE /api/v1/app-shortcut`. */
export const removeAppShortcut = (auth: Auth = tabAuth) => callDelete(auth, API_ROUTES.appShortcut, "Ogden Agents couldn't remove the app shortcut");

/** `DELETE /api/v1/app-shortcut/offer`: Not now. */
export const dismissAppShortcutOffer = (auth: Auth = tabAuth) => callDelete(auth, API_ROUTES.appShortcutOffer, "Ogden Agents couldn't save your answer");

/** Whether this computer can have the shortcut, has it, and still shows the offer. */
export function useAppShortcut() {
  return useQuery({ queryKey: APP_SHORTCUT_QUERY_KEY, queryFn: () => fetchAppShortcut(), retry: false });
}

/** Add, Remove and Not now. Each refreshes the shared status; Add answers the offer too. */
export function useAppShortcutActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: APP_SHORTCUT_QUERY_KEY });
  const add = useMutation({
    mutationFn: () => addAppShortcut(),
    onSuccess: (status) => queryClient.setQueryData(APP_SHORTCUT_QUERY_KEY, status),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => removeAppShortcut(), onSettled: refresh });
  const dismiss = useMutation({
    mutationFn: () => dismissAppShortcutOffer(),
    // Not now hides the offer at once; the server's answer confirms it.
    onMutate: () => {
      const current = queryClient.getQueryData<AppShortcutStatus>(APP_SHORTCUT_QUERY_KEY);
      if (current !== undefined) queryClient.setQueryData(APP_SHORTCUT_QUERY_KEY, { ...current, offerPending: false });
    },
    onSettled: refresh,
  });
  return { add, remove, dismiss };
}

/** Where the shortcut lives on this OS, in the user's words. */
export function shortcutLocation(platform: string): string {
  if (platform === 'darwin') return 'your Applications folder';
  if (platform === 'win32') return 'the Start menu';
  return 'your apps menu';
}
