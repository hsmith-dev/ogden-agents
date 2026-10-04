import { projectNotTrustedReason, type ChatAgent, type ChatAgentsResponse } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { CHAT_AGENTS_QUERY_KEY, fetchChatAgents } from './chat-api';

/**
 * The agents a chat can be started with (epic 6), with whether each can
 * start one now. Read again whenever an agent's setup changes (an
 * `agent.*` event: signed in or out, installed), so the picker follows
 * without a reload.
 */
export function useChatAgents() {
  useEventInvalidation((event) => (event.type.startsWith('agent.') ? [CHAT_AGENTS_QUERY_KEY] : []));
  return useQuery({ queryKey: CHAT_AGENTS_QUERY_KEY, queryFn: () => fetchChatAgents(), staleTime: 30_000, retry: 1 });
}

/** Whether a new chat with an agent can start now, in words (epic 6, entry 6), and whether Settings → Agents fixes it. */
export interface AgentAvailability {
  available: boolean;
  /** One line: its readiness ("Installed, signed in"), or why it can't start a chat. */
  description: string;
  /** Installing or signing in fixes it: a link to Settings → Agents goes with it. */
  setUp: boolean;
}

/**
 * An agent's readiness for a new chat, as the server will judge it: not
 * installed or signed out (the agent list's `unavailable`, with its plain
 * reason), or one that needs a trusted project (no project is trusted until
 * the trust gate ships, so it never starts; nothing here fixes that).
 */
export function agentAvailability(agent: ChatAgent): AgentAvailability {
  if (agent.unavailable !== undefined) return { available: false, description: agent.unavailable.reason, setUp: agent.unavailable.action !== 'trust_project' };
  if (agent.needsProjectTrust) return { available: false, description: projectNotTrustedReason(agent.displayName), setUp: false };
  const signedIn = agent.install === 'installed' && agent.auth === 'signed_in';
  return { available: true, description: signedIn ? 'Installed, signed in' : 'Installed', setUp: false };
}

/**
 * The agent a project's new chats preselect: its own default while the
 * install still has it, else the install's default (epic 6, entry 6).
 */
export function projectDefaultAgent(list: ChatAgentsResponse, projectDefault: string | undefined): string {
  return projectDefault !== undefined && list.agents.some((agent) => agent.agentId === projectDefault) ? projectDefault : list.defaultAgentId;
}
