import { API_ROUTES, SetUpdateCheckRequest, UpdateCheckResponse, UpdateNoticeResponse } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/** The update notice, kept current from the event stream (every tab follows a check or the switch). */
export const UPDATES_QUERY_KEY = ['updates'] as const;

/** `GET /api/v1/updates`. */
export async function fetchUpdateNotice(auth: Auth = tabAuth): Promise<UpdateNoticeResponse> {
  return UpdateNoticeResponse.parse(await call(auth, API_ROUTES.updates, {}, "Ogden couldn't read the version notice"));
}

/** `PUT /api/v1/updates`: the switch for the check when Ogden starts. */
export async function saveUpdateCheck(enabled: boolean, auth: Auth = tabAuth): Promise<UpdateNoticeResponse> {
  const body: SetUpdateCheckRequest = { enabled };
  const json = await call(auth, API_ROUTES.updates, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, "Ogden couldn't save that setting");
  return UpdateNoticeResponse.parse(json);
}

/** `POST /api/v1/updates/check`: Check now. The server asks npm; the browser never does. */
export async function checkForUpdates(auth: Auth = tabAuth): Promise<UpdateCheckResponse> {
  return UpdateCheckResponse.parse(await call(auth, API_ROUTES.updatesCheck, { method: 'POST' }, "Ogden couldn't check for new versions"));
}

export function useUpdateNotice() {
  useEventInvalidation((event) => (event.type === 'settings.update_notice_changed' ? [[...UPDATES_QUERY_KEY]] : []));
  return useQuery({ queryKey: UPDATES_QUERY_KEY, queryFn: () => fetchUpdateNotice(), retry: false });
}

export function useUpdateActions() {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (enabled: boolean) => saveUpdateCheck(enabled),
    onSuccess: (notice) => client.setQueryData(UPDATES_QUERY_KEY, notice),
  });
  const check = useMutation({
    mutationFn: () => checkForUpdates(),
    onSuccess: (result) => client.setQueryData(UPDATES_QUERY_KEY, result.notice),
  });
  return { save, check };
}
