import type { ChatAgent, ChatAgentsResponse } from '@ogden-agents/shared';
import { useQuery } from '@tanstack/react-query';
import { useEventInvalidation } from '@/events/use-event-invalidation';
import { CHAT_AGENTS_QUERY_KEY, fetchChatAgents } from './chat-api';

/**
 * The agents a chat can be started with (epic 6), with whether each can
 * start one now. Read again whenever an agent's setup changes (an
 * `agent.*` event: signed in or out, installed), so the picker follows
 * without a reload.
 */
export function useChatAgents(wsId?: string) {
  // Story 11: an agent's default model, set in any tab. A project's trust changing changes which agents can start a chat in it (epic 12, 12.3).
  useEventInvalidation((event) =>
    event.type.startsWith('agent.') || event.type === 'settings.agent_default_model_changed' || event.type === 'workspace.bmad_scripts_trusted' ? [CHAT_AGENTS_QUERY_KEY] : [],
  );
  return useQuery({
    queryKey: wsId === undefined ? CHAT_AGENTS_QUERY_KEY : [...CHAT_AGENTS_QUERY_KEY, wsId],
    queryFn: () => fetchChatAgents(undefined, wsId),
    staleTime: 30_000,
    retry: 1,
  });
}

/** Whether a new chat with an agent can start now, in words (epic 6, entry 6), and whether Settings → Agents fixes it. */
export interface AgentAvailability {
  available: boolean;
  /** One line: its readiness ("Installed, signed in"), or why it can't start a chat. */
  description: string;
  /** Installing or signing in fixes it: a link to Settings → Agents goes with it. */
  setUp: boolean;
  /** Trusting the project fixes it: the trust prompt (epic 12, 12.3). */
  trust: boolean;
}

/**
 * An agent's readiness for a new chat, as the server will judge it: not
 * installed or signed out (the agent list's `unavailable`, with its plain
 * reason), or needing the project trusted (`trust_project`, said only by a
 * list read for a project; the trust prompt fixes it). Read without a
 * project, an agent that needs project trust is available: each project
 * asks for its trust.
 */
export function agentAvailability(agent: ChatAgent): AgentAvailability {
  if (agent.unavailable !== undefined) {
    const trust = agent.unavailable.action === 'trust_project';
    return { available: false, description: agent.unavailable.reason, setUp: !trust, trust };
  }
  const signedIn = agent.install === 'installed' && agent.auth === 'signed_in';
  const base = signedIn ? 'Installed, signed in' : 'Installed';
  return { available: true, description: agent.needsProjectTrust ? `${base}. Asks you to trust each project first.` : base, setUp: false, trust: false };
}

/**
 * The agent a project's new chats preselect: its own default while the
 * install still has it, else the install's default (epic 6, entry 6).
 */
export function projectDefaultAgent(list: ChatAgentsResponse, projectDefault: string | undefined): string {
  return projectDefault !== undefined && list.agents.some((agent) => agent.agentId === projectDefault) ? projectDefault : list.defaultAgentId;
}
