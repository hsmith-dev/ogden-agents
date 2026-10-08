import type { ChatAgent, RemoteMachineId } from '@ogden-agents/shared';
import { CaretDown, ChatCircle, GearSix } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { SET_UP_AGENTS } from './agent-picker';
import { CHAT_AGENTS_QUERY_KEY, createChatSession } from './chat-api';
import { agentAvailability, type AgentAvailability } from './use-chat-agents';

/** Said when starting a chat fails with no reason from the server. */
export const START_FAILED = "Ogden Agents couldn't start a chat. Try again.";

/** The primary action of an empty project (its Chats page and its sidebar entry). */
export const START_A_CHAT = 'Start a chat';

/**
 * Starts a chat in a project and opens it (the empty project's one click,
 * and the header's New chat). One start at a time: a click while one is in
 * flight does nothing, so a double click never makes two chats. The chat
 * starts in Ask, as every new chat does (the server's rule).
 */
export function useStartChat(wsId: string, onOpened?: () => void) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const start = useCallback(
    (agentId: string | undefined, machineId?: RemoteMachineId | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStarting(true);
      setError(undefined);
      const done = () => {
        inFlight.current = false;
        setStarting(false);
      };
      createChatSession(wsId, undefined, agentId, undefined, machineId).then(
        (session) => {
          // Still starting until the chat replaces this action: the sidebar row stays until the chat's event arrives, and a click then must not start a second chat.
          onOpened?.();
          void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: session.id } }).catch(done);
        },
        (failure: unknown) => {
          done();
          // The trust may have changed under a cached agent list (a file changed on disk): read it again so the Trust prompt shows (epic 12, 12.3).
          void queryClient.invalidateQueries({ queryKey: CHAT_AGENTS_QUERY_KEY });
          setError(failure instanceof Error && failure.message !== '' ? failure.message : START_FAILED);
        },
      );
    },
    [wsId, navigate, onOpened, queryClient],
  );
  return { start, starting, error, setError };
}

export interface StartChatActionsProps {
  agents: readonly ChatAgent[];
  /** The agent Start a chat uses: the project's default. */
  agentId: string | undefined;
  /** Why the default can't start a chat now (only while there is a choice of agents, 6.6). */
  blocked: AgentAvailability | undefined;
  /** The id of the line that says why, tied to the button while blocked. */
  describedBy?: string;
  starting: boolean;
  onStart: (agentId: string | undefined) => void;
  /** A click on Start a chat while blocked: say the reason where the click landed. */
  onBlocked: (reason: string) => void;
}

/**
 * An empty project's actions (EXPERIENCE.md Empty chats): **Start a chat**,
 * the one primary button, with the project's default agent; and, while the
 * install has more than one agent, **Use another agent**, a menu of the
 * others with their readiness that starts a chat with the one chosen. One
 * that can't start a chat stays in the menu, unavailable with its reason
 * and reachable by keyboard, and Settings → Agents is linked below it.
 */
export function StartChatActions({ agents, agentId, blocked, describedBy, starting, onStart, onBlocked }: StartChatActionsProps) {
  const others = agents.filter((agent) => agent.agentId !== agentId);
  const needsSetUp = others.some((agent) => agentAvailability(agent).setUp);
  return (
    <>
      <Button
        data-testid="start-chat"
        aria-disabled={starting || blocked !== undefined}
        aria-busy={starting || undefined}
        aria-describedby={blocked === undefined ? undefined : describedBy}
        onClick={() => {
          if (starting) return;
          if (blocked !== undefined) onBlocked(blocked.description);
          else onStart(agentId);
        }}
      >
        <ChatCircle aria-hidden />
        {START_A_CHAT}
      </Button>
      {agents.length < 2 || others.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" data-testid="start-chat-other" aria-disabled={starting || undefined}>
              Use another agent
              <CaretDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="start-chat-other-menu">
            <DropdownMenuLabel>Start a chat with</DropdownMenuLabel>
            {others.map((agent) => {
              const availability = agentAvailability(agent);
              const unavailable = !availability.available;
              return (
                <DropdownMenuItem
                  key={agent.agentId}
                  data-testid="start-chat-option"
                  data-agent={agent.agentId}
                  // Unavailable but focusable: the keyboard and a screen reader still reach its reason.
                  aria-disabled={unavailable || undefined}
                  data-disabled={unavailable ? '' : undefined}
                  className="min-h-(--row-height) flex-col items-start gap-0.5 py-1.5"
                  onSelect={(event) => {
                    if (unavailable || starting) {
                      event.preventDefault();
                      return;
                    }
                    onStart(agent.agentId);
                  }}
                >
                  <span className="text-label">{agent.displayName}</span>
                  <span className="max-w-72 text-caption text-muted-foreground">{availability.description}</span>
                </DropdownMenuItem>
              );
            })}
            {needsSetUp ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings/agents" data-testid="start-chat-set-up-link">
                    <GearSix aria-hidden />
                    {SET_UP_AGENTS}
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <span role="status" className="sr-only">
        {starting ? 'Starting a chat' : ''}
      </span>
    </>
  );
}
