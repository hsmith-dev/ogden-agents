import type { ChatAgent, RemoteMachineId } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { ScriptTrustPrompt } from '@/workspaces/script-trust-prompt';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { SET_UP_AGENTS } from './agent-picker';
import { CHAT_AGENTS_QUERY_KEY } from './chat-api';
import { agentAvailability, projectDefaultAgent, useChatAgents, type AgentAvailability } from './use-chat-agents';

/** The id of the status line that says why the chosen agent can't start a chat; fields and buttons point at it. */
export const AGENT_UNAVAILABLE_ID = 'agent-unavailable';

/**
 * The agent and machine a new chat starts with (epic 6; CAP-24, epic 19
 * story 19.7), shared by the Chats list's header and the new-chat draft
 * (epic 26): the project's default agent, which follows a change made in
 * another tab, until the user picks another; Local until the user picks a
 * confirmed machine. `initial` is what the draft opened with (the Chats
 * list's picks). Unknown until both the agent list and the settings are in.
 */
export function useNewChatAgent(wsId: string, initial?: { agent?: string | undefined; machine?: RemoteMachineId | null | undefined }) {
  // Read for this project: an agent that needs it trusted says so (epic 12, 12.3), and the trust prompt fixes it.
  const chatAgents = useChatAgents(wsId);
  const settings = useWorkspaceSettings(wsId);
  const [pickedAgent, setPickedAgent] = useState<string | undefined>(initial?.agent);
  // Never persisted beyond the page.
  const [pickedMachine, setPickedMachine] = useState<RemoteMachineId | null>(initial?.machine ?? null);
  const settingsKnown = settings.data !== undefined || settings.isError;
  const projectDefault = chatAgents.data === undefined || !settingsKnown ? undefined : projectDefaultAgent(chatAgents.data, settings.data?.defaultAgentId);
  // A picked agent the list doesn't have (a stale link) falls back to the default.
  const pickedKnown = pickedAgent !== undefined && (chatAgents.data === undefined || chatAgents.data.agents.some((agent) => agent.agentId === pickedAgent));
  const agentId = pickedKnown ? pickedAgent : projectDefault;
  const severalAgents = (chatAgents.data?.agents.length ?? 0) > 1;
  const chosen = chatAgents.data?.agents.find((agent) => agent.agentId === agentId);
  /** Why a new chat with the chosen agent can't start now (not installed, signed out, needs trust), said before trying. */
  const unavailable = chosen === undefined ? undefined : agentAvailability(chosen);
  // Only while there is a choice: with one agent the page is as before, and the server says why a chat can't start.
  const blocked = !severalAgents || unavailable === undefined || unavailable.available ? undefined : unavailable;
  return { chatAgents, settings, agentId, pickedAgent, setPickedAgent, pickedMachine, setPickedMachine, severalAgents, chosen, blocked };
}

/**
 * Why the chosen agent can't start a chat now, and where to fix it (epic 6,
 * entry 6), always mounted so a change is announced; and, for an agent that
 * runs the project's own settings and hooks, the trust prompt (epic 12, 12.3);
 * and, when a remote machine is picked for an agent tied to this computer,
 * that agent's reason (27.5: the server refuses the send with it).
 */
export function NewChatAgentStatus({
  wsId,
  blocked,
  chosen,
  trustChanged,
  localOnlyConflict,
}: {
  wsId: string;
  blocked: AgentAvailability | undefined;
  chosen: ChatAgent | undefined;
  trustChanged: boolean;
  localOnlyConflict?: string | undefined;
}) {
  const queryClient = useQueryClient();
  return (
    <>
      <Text variant="caption" id={AGENT_UNAVAILABLE_ID} role="status" data-testid="agent-unavailable-status">
        {blocked === undefined ? null : (
          <span data-testid="agent-unavailable">
            {blocked.description}
            {blocked.setUp ? (
              <>
                {' '}
                <Button variant="link" size="sm" asChild>
                  <Link to="/settings/agents" data-testid="agent-unavailable-link">
                    {SET_UP_AGENTS}
                  </Link>
                </Button>
              </>
            ) : null}
          </span>
        )}
        {localOnlyConflict === undefined ? null : (
          <span data-testid="agent-local-only">
            {blocked === undefined ? '' : ' '}
            {localOnlyConflict}
          </span>
        )}
      </Text>
      {/* One trust covers the agent and Board's scripts (epic 12, 12.3). */}
      {blocked?.trust !== true || chosen === undefined ? null : (
        <ScriptTrustPrompt
          wsId={wsId}
          agentName={chosen.displayName}
          changed={trustChanged}
          onTrusted={() => void queryClient.invalidateQueries({ queryKey: CHAT_AGENTS_QUERY_KEY })}
        />
      )}
    </>
  );
}
