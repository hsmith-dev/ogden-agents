import { API_ROUTES, OnboardingState } from '@ogden-agents/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';

/**
 * Whether the first-run Welcome is done (onboarding 9.5), sent with this
 * tab's token. `/` reads it to send a first run to `/welcome`; Welcome marks
 * it done when it finishes or is skipped. The server owns the flag.
 */

export const ONBOARDING_QUERY_KEY = ['onboarding'] as const;

/** `GET /api/v1/onboarding`. */
export async function fetchOnboarding(auth: Auth = tabAuth): Promise<OnboardingState> {
  const json = await call(auth, API_ROUTES.onboarding, {}, "Ogden Agents couldn't check whether Welcome is done");
  return OnboardingState.parse(json);
}

/** `PATCH /api/v1/onboarding`. */
export async function saveOnboarding(state: OnboardingState, auth: Auth = tabAuth): Promise<OnboardingState> {
  const json = await call(
    auth,
    API_ROUTES.onboarding,
    { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) },
    "Ogden Agents couldn't save that",
  );
  return OnboardingState.parse(json);
}

export function useOnboarding() {
  return useQuery({ queryKey: ONBOARDING_QUERY_KEY, queryFn: () => fetchOnboarding(), retry: 1 });
}

/** Marks Welcome done for good (finished or skipped); `/` then shows Projects. */
export function useCompleteWelcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => saveOnboarding({ welcomeCompleted: true }),
    onSuccess: (state) => queryClient.setQueryData(ONBOARDING_QUERY_KEY, state),
  });
}
