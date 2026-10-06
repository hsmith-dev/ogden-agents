import { API_ROUTES, apiPath, OrchestrationRoutingResponse, type RoutingRule } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '@/api/http';
import { tabAuth, type TabAuth } from '@/auth/tab-token';
import { useEventInvalidation } from '@/events/use-event-invalidation';

type Auth = Pick<TabAuth, 'fetch'>;

const json = { 'content-type': 'application/json' };

/** `GET …/orchestration/routing`: the project's routing rules and the caps. */
export async function fetchRoutingRules(wsId: string, auth: Auth = tabAuth): Promise<OrchestrationRoutingResponse> {
  return OrchestrationRoutingResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceOrchestrationRouting, { wsId }), {}, "Ogden Agents couldn't load the routing rules"));
}

/** `PUT …/orchestration/routing`: saves the whole list. An item with an `id` keeps that rule; the server refuses a text that breaks a rule, in its own words. */
export async function saveRoutingRules(wsId: string, rules: ReadonlyArray<{ id?: string; text: string }>, auth: Auth = tabAuth): Promise<OrchestrationRoutingResponse> {
  const body = JSON.stringify({ rules: rules.map((rule) => ({ ...(rule.id === undefined ? {} : { id: rule.id }), text: rule.text })) });
  return OrchestrationRoutingResponse.parse(await call(auth, apiPath(API_ROUTES.workspaceOrchestrationRouting, { wsId }), { method: 'PUT', headers: json, body }, "The routing rules couldn't be saved"));
}

export type { RoutingRule };

export function useRoutingRules(wsId: string) {
  useEventInvalidation((event) => (event.workspaceId === wsId && event.type === 'orchestration.routing_changed' ? [['routing-rules', wsId]] : []));
  return useQuery({ queryKey: ['routing-rules', wsId], queryFn: () => fetchRoutingRules(wsId), retry: false, refetchOnMount: 'always' as const });
}
