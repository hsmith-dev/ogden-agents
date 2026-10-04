import type { ChatAgent } from '@ogden-agents/shared';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';

/**
 * The agent a new chat starts with (epic 6, E6-R1; EXPERIENCE.md Composer):
 * one segment per agent, by its product name. It applies to new chats only,
 * and it is not shown while the install has a single agent.
 */
export function AgentPicker({ agents, value, onChange }: { agents: readonly ChatAgent[]; value: string; onChange: (agentId: string) => void }) {
  if (agents.length < 2) return null;
  return (
    <ToggleGroup
      type="single"
      aria-label="Agent for new chats"
      data-testid="agent-picker"
      value={value}
      // Radix sends '' when the chosen segment is clicked again: a chat always has an agent, so that changes nothing.
      onValueChange={(next) => {
        if (next !== '') onChange(next);
      }}
    >
      {agents.map((agent) => (
        <ToggleGroupItem key={agent.agentId} value={agent.agentId} data-testid="agent-option">
          {agent.displayName}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
