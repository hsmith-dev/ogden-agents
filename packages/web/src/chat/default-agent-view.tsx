import type { ChatAgent } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { RadioGroup, RadioGroupOption } from '@/ui/radio-group';
import { Text } from '@/ui/typography';
import { SET_UP_AGENTS } from './agent-picker';
import { agentAvailability } from './use-chat-agents';

export interface DefaultAgentViewProps {
  agents: readonly ChatAgent[];
  /** What the default is for, in one sentence under the title. */
  description: string;
  /** The test id prefix: `<testId>-section`, `<testId>`, `<testId>-<agentId>`, `<testId>-status`, `<testId>-error`. */
  testId: string;
  value: string | undefined;
  onChange: (agentId: string) => void;
  saving: boolean;
  status: { kind: 'saved' | 'error'; text: string } | undefined;
}

/**
 * A default agent (epic 6, entry 6): a project's (EXPERIENCE.md Workspace
 * settings) or the one new projects get (Settings → New projects). One
 * radio per agent with its readiness or why it can't start a chat now, and
 * Settings → Agents linked when one needs installing or signing in. Any
 * agent may be the default: the picker says when it can't start yet.
 * Hidden while the install has one agent.
 */
export function DefaultAgentView({ agents, value, onChange, saving, status, description, testId }: DefaultAgentViewProps) {
  if (agents.length < 2) return null;
  const needsSetUp = agents.some((agent) => agentAvailability(agent).setUp);
  return (
    <PageSection title="Default agent" data-testid={`${testId}-section`}>
      <Text id={`${testId}-description`}>{description}</Text>
      {value === undefined ? null : (
        <RadioGroup
          aria-label="Default agent"
          aria-describedby={`${testId}-description`}
          data-testid={testId}
          value={value}
          // Not disabled while saving: arrow keys check a radio as they focus it, and a disabled group would drop focus.
          aria-busy={saving || undefined}
          onValueChange={(next) => {
            if (next !== value && agents.some((agent) => agent.agentId === next)) onChange(next);
          }}
        >
          {agents.map((agent) => (
            <RadioGroupOption
              key={agent.agentId}
              id={`${testId}-${agent.agentId}`}
              value={agent.agentId}
              data-testid={`${testId}-${agent.agentId}`}
              label={agent.displayName}
              description={agentAvailability(agent).description}
            />
          ))}
        </RadioGroup>
      )}
      {needsSetUp ? (
        <Text variant="caption">
          <Link to="/settings/agents" className="text-foreground underline underline-offset-4" data-testid={`${testId}-set-up-link`}>
            {SET_UP_AGENTS}
          </Link>
        </Text>
      ) : null}
      <Text variant="caption" role="status" data-testid={`${testId}-status`}>
        {status?.kind === 'saved' ? status.text : ''}
      </Text>
      {status?.kind === 'error' ? (
        <Notice variant="blocked" role="alert" data-testid={`${testId}-error`}>
          {status.text}
        </Notice>
      ) : null}
    </PageSection>
  );
}
