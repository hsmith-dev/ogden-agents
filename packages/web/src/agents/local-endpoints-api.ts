import {
  API_ROUTES,
  apiPath,
  LocalEndpointDetectResponse,
  LocalEndpointModelsResponse,
  ManagerTestResponse,
  LocalEndpointPresetsResponse,
  LocalEndpointResponse,
  LocalEndpointsResponse,
  LocalEndpointTestResponse,
  type LocalEndpointId,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { useEventStream } from '@/events/event-stream';

/**
 * The Local model's endpoint REST calls (epic 14 story 14.4), sent with this
 * tab's token. Only Ogden Agents' server ever calls an endpoint: the page
 * asks the server to test or detect and never contacts one itself. A key is
 * sent once, in the request that saves it, and is never kept in the page or
 * read back (the server only says whether one is saved).
 */

export const LOCAL_ENDPOINTS_QUERY_KEY = ['local-endpoints'] as const;
export const LOCAL_ENDPOINT_PRESETS_QUERY_KEY = ['local-endpoint-presets'] as const;

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchLocalEndpoints(auth: Auth = tabAuth) {
  return LocalEndpointsResponse.parse(await call(auth, API_ROUTES.localEndpoints, {}, "Ogden Agents couldn't read your servers"));
}

export async function fetchEndpointPresets(auth: Auth = tabAuth) {
  return LocalEndpointPresetsResponse.parse(await call(auth, API_ROUTES.localEndpointPresets, {}, "Ogden Agents couldn't read the server list")).presets;
}

export async function addLocalEndpoint(body: { label: string; baseUrl: string; preset?: string | null; key?: string; confirmHost?: string }, auth: Auth = tabAuth) {
  return LocalEndpointResponse.parse(await call(auth, API_ROUTES.localEndpoints, postJson(body), "Ogden Agents couldn't add that server")).endpoint;
}

export async function removeLocalEndpoint(id: LocalEndpointId, auth: Auth = tabAuth) {
  await callNoContent(auth, apiPath(API_ROUTES.localEndpoint, { endpointId: id }), { method: 'DELETE' }, "Ogden Agents couldn't remove that server");
}

export async function saveEndpointKey(id: LocalEndpointId, key: string, auth: Auth = tabAuth) {
  return LocalEndpointResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpointKey, { endpointId: id }), json('PUT', { key }), "Ogden Agents couldn't save the key")).endpoint;
}

export async function removeEndpointKey(id: LocalEndpointId, auth: Auth = tabAuth) {
  return LocalEndpointResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpointKey, { endpointId: id }), { method: 'DELETE' }, "Ogden Agents couldn't remove the key")).endpoint;
}

export async function confirmEndpointHost(id: LocalEndpointId, host: string, auth: Auth = tabAuth) {
  return LocalEndpointResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpointConfirm, { endpointId: id }), postJson({ host }), "Ogden Agents couldn't record that")).endpoint;
}

export async function setDefaultEndpoint(endpointId: LocalEndpointId | null, auth: Auth = tabAuth) {
  return LocalEndpointsResponse.parse(await call(auth, API_ROUTES.localEndpointDefault, json('PUT', { endpointId }), "Ogden Agents couldn't change that"));
}

export async function testLocalEndpoint(id: LocalEndpointId, auth: Auth = tabAuth) {
  return LocalEndpointTestResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpointTest, { endpointId: id }), { method: 'POST' }, "Ogden Agents couldn't test that server"));
}

export async function detectLocalServers(auth: Auth = tabAuth) {
  return LocalEndpointDetectResponse.parse(await call(auth, API_ROUTES.localEndpointDetect, { method: 'POST' }, "Ogden Agents couldn't look for servers")).found;
}

/** The seq of the newest endpoint event received, or 0. */
function lastEndpointSeq(events: readonly { seq: number; type: string }[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'settings.local_endpoints_changed') return events[i]!.seq;
  return 0;
}

/** The endpoints, read over REST and read again whenever another tab changes them. */
export function useLocalEndpoints() {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const seq = lastEndpointSeq(events);
  useEffect(() => {
    if (seq > 0) void queryClient.invalidateQueries({ queryKey: LOCAL_ENDPOINTS_QUERY_KEY });
  }, [seq, queryClient]);
  return useQuery({ queryKey: LOCAL_ENDPOINTS_QUERY_KEY, queryFn: () => fetchLocalEndpoints(), retry: 1 });
}

export function useEndpointPresets() {
  return useQuery({ queryKey: LOCAL_ENDPOINT_PRESETS_QUERY_KEY, queryFn: () => fetchEndpointPresets(), retry: 1, staleTime: Infinity });
}

/** `GET /api/v1/local-endpoints/:endpointId/models`: what the server serves, with what it reports of each (the server asks it, never the page). */
export async function fetchEndpointModels(id: LocalEndpointId, auth: Auth = tabAuth) {
  return LocalEndpointModelsResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpointModels, { endpointId: id }), {}, "Ogden Agents couldn't list that server's models"));
}

/** `PATCH /api/v1/local-endpoints/:endpointId`: the model this server's chats start on (`null`: the first one it lists). */
export async function chooseEndpointModel(id: LocalEndpointId, model: string | null, auth: Auth = tabAuth) {
  return LocalEndpointResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpoint, { endpointId: id }), json('PATCH', { model }), "Ogden Agents couldn't choose that model")).endpoint;
}

/** `POST /api/v1/local-endpoints/:endpointId/manager-test`: Test as a manager on one model (the server calls the endpoint, never the page). */
export async function testAsManager(id: LocalEndpointId, model: string, auth: Auth = tabAuth) {
  return ManagerTestResponse.parse(await call(auth, apiPath(API_ROUTES.localEndpointManagerTest, { endpointId: id }), postJson({ model }), "Ogden Agents couldn't run that test"));
}
