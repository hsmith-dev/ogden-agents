import {
  API_ROUTES,
  apiPath,
  CustomAgentListResponse,
  CustomAgentResponse,
  CustomAgentTestResponse,
  type AgentId,
  type CustomAgentCreateRequest,
  type CustomAgentTestRequest,
} from '@ogden-agents/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, callNoContent, postJson, type Auth } from '@/api/http';
import { tabAuth } from '@/auth/tab-token';
import { CHAT_AGENTS_QUERY_KEY } from '@/chat/chat-api';
import { useEventStream } from '@/events/event-stream';
import { AGENTS_QUERY_KEY } from './agent-setup-api';

/**
 * The custom agents' REST calls (epic 21, story 21.3), sent with this tab's
 * token. A key is sent once, in the request that saves or tests it, and is
 * never kept in the page or read back: the server only says whether one is
 * kept and under which variable.
 */

export const CUSTOM_AGENTS_QUERY_KEY = ['custom-agents'] as const;

export async function fetchCustomAgents(auth: Auth = tabAuth) {
  return CustomAgentListResponse.parse(await call(auth, API_ROUTES.customAgents, {}, "Ogden Agents couldn't read your agents")).agents;
}

export async function addCustomAgent(body: CustomAgentCreateRequest, auth: Auth = tabAuth) {
  return CustomAgentResponse.parse(await call(auth, API_ROUTES.customAgents, postJson(body), "Ogden Agents couldn't add that agent")).agent;
}

export async function removeCustomAgent(agentId: AgentId, auth: Auth = tabAuth) {
  await callNoContent(auth, apiPath(API_ROUTES.customAgent, { agentId }), { method: 'DELETE' }, "Ogden Agents couldn't remove that agent");
}

/** Test before saving: the typed command and key; nothing is kept. */
export async function testCustomCommand(body: CustomAgentTestRequest, auth: Auth = tabAuth) {
  return CustomAgentTestResponse.parse(await call(auth, API_ROUTES.customAgentsTest, postJson(body), "Ogden Agents couldn't test that agent"));
}

/** Test a saved agent with its own command and key. */
export async function testCustomAgent(agentId: AgentId, auth: Auth = tabAuth) {
  return CustomAgentTestResponse.parse(await call(auth, apiPath(API_ROUTES.customAgentTest, { agentId }), { method: 'POST' }, "Ogden Agents couldn't test that agent"));
}

/** The seq of the newest custom agent event received, or 0. */
function lastCustomAgentSeq(events: readonly { seq: number; type: string }[]): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'settings.custom_agent_changed') return events[i]!.seq;
  return 0;
}

/** The custom agents, read again (with the agent cards and the chat picker) whenever any tab changes one. */
export function useCustomAgents() {
  const queryClient = useQueryClient();
  const { events } = useEventStream();
  const seq = lastCustomAgentSeq(events);
  useEffect(() => {
    if (seq === 0) return;
    for (const queryKey of [CUSTOM_AGENTS_QUERY_KEY, AGENTS_QUERY_KEY, CHAT_AGENTS_QUERY_KEY]) void queryClient.invalidateQueries({ queryKey });
  }, [seq, queryClient]);
  return useQuery({ queryKey: CUSTOM_AGENTS_QUERY_KEY, queryFn: () => fetchCustomAgents(), retry: 1 });
}
