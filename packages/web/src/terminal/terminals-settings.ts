import { API_ROUTES, TerminalsSettingsResponse, type TerminalsSettings, type UpdateTerminalsSettingsRequest } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

/**
 * The Terminals settings (epic 16, story 16.9): the install's, kept by the
 * server and enforced there (Developer mode only). Every tab follows a change
 * through `settings.terminals_changed`.
 */

export const terminalsSettingsQueryKey = ['terminals-settings'] as const;

export async function fetchTerminalsSettings(auth: Auth = tabAuth): Promise<TerminalsSettings> {
  return TerminalsSettingsResponse.parse(await call(auth, API_ROUTES.terminalSettings, {}, "Ogden Agents couldn't load the Terminals settings")).settings;
}

export async function saveTerminalsSettings(change: UpdateTerminalsSettingsRequest, auth: Auth = tabAuth): Promise<TerminalsSettings> {
  const json = await call(auth, API_ROUTES.terminalSettings, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) }, "Ogden Agents couldn't save that setting");
  return TerminalsSettingsResponse.parse(json).settings;
}

/** The settings, off while Developer mode is (the server would refuse). */
export function useTerminalsSettings(enabled: boolean, auth: Auth = tabAuth) {
  useEventInvalidation((event) => (event.type === 'settings.terminals_changed' ? [terminalsSettingsQueryKey] : []));
  return useQuery({ queryKey: terminalsSettingsQueryKey, queryFn: () => fetchTerminalsSettings(auth), enabled, retry: false });
}

export function useSaveTerminalsSettings(auth: Auth = tabAuth) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: UpdateTerminalsSettingsRequest) => saveTerminalsSettings(change, auth),
    onSuccess: (settings) => queryClient.setQueryData(terminalsSettingsQueryKey, settings),
  });
}
