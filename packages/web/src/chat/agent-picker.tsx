import type { ChatAgent } from '@ogden-agents/shared';
import { CaretDown, GearSix, ShieldCheck } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuChoiceItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { agentAvailability } from './use-chat-agents';

/** The link under the agents when one needs installing or signing in. */
export const SET_UP_AGENTS = 'Open Settings → Agents';

/**
 * The agent a new chat starts with (epic 6, E6-R1; EXPERIENCE.md Composer,
 * DESIGN.md Composer: it sits in the composer footer): a menu of the
 * agents, each with its readiness. One that can't start a chat now (not
 * installed, signed out, or needing a trusted project) stays in the menu
 * with its reason, marked unavailable but still reachable by keyboard so
 * its reason is read, and Settings → Agents is linked below. It applies to
 * new chats only, and it is not shown while the install has a single agent.
 */
export function AgentPicker({ agents, value, onChange }: { agents: readonly ChatAgent[]; value: string; onChange: (agentId: string) => void }) {
  if (agents.length < 2) return null;
  const current = agents.find((agent) => agent.agentId === value);
  const name = current?.displayName ?? 'Choose an agent';
  const needsSetUp = agents.some((agent) => agentAvailability(agent).setUp);
  // Agents that need this project trusted (epic 12, 12.3): choosing one shows the trust prompt, which allows it.
  const needsTrust = agents.filter((agent) => agentAvailability(agent).trust);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="agent-picker" data-agent={value} aria-label={`Agent for new chats: ${name}`}>
          <span className="text-muted-foreground">Agent:</span>
          {name}
          <CaretDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="agent-menu">
        <DropdownMenuLabel>Agent for new chats</DropdownMenuLabel>
        {agents.map((agent) => {
          const availability = agentAvailability(agent);
          const unavailable = !availability.available;
          return (
            <DropdownMenuChoiceItem
              key={agent.agentId}
              data-testid="agent-option"
              data-agent={agent.agentId}
              checked={agent.agentId === value}
              // Unavailable but focusable: the keyboard and a screen reader still reach its reason.
              aria-disabled={(unavailable && !availability.trust) || undefined}
              data-disabled={unavailable && !availability.trust ? '' : undefined}
              label={agent.displayName}
              description={availability.description}
              onSelect={(event) => {
                // Needing the project trusted is fixed by choosing it: the trust prompt then shows.
                if (unavailable && !availability.trust) {
                  event.preventDefault();
                  return;
                }
                if (agent.agentId !== value) onChange(agent.agentId);
              }}
            />
          );
        })}
        {needsTrust.length === 0 ? null : (
          <>
            <DropdownMenuSeparator />
            {needsTrust.map((agent) => (
              <DropdownMenuItem key={agent.agentId} data-testid="agent-trust-project" data-agent={agent.agentId} onSelect={() => onChange(agent.agentId)}>
                <ShieldCheck aria-hidden />
                {`Trust this project for ${agent.displayName}`}
              </DropdownMenuItem>
            ))}
          </>
        )}
        {needsSetUp ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/agents" data-testid="agent-set-up-link">
                <GearSix aria-hidden />
                {SET_UP_AGENTS}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
