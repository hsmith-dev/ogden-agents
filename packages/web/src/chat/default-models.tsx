import type { ChatAgent } from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CHAT_AGENTS_QUERY_KEY } from './chat-api';
import { Notice } from '@/ui/notice';
import { PageSection } from '@/ui/page';
import { Text } from '@/ui/typography';
import { agentDefaultLabel, ModelMenu, modelLabel } from './model-picker';

export interface DefaultModelsSectionProps {
  agents: readonly ChatAgent[];
  /** One sentence under the title: what the defaults are for. */
  description: string;
  /** The test id prefix: `<testId>-section`, `<testId>-<agentId>` (each menu), `<testId>-status`, `<testId>-error`. */
  testId: string;
  /** The saved default for the agent: a model id, or `null` for the first choice. */
  valueOf(agent: ChatAgent): string | null;
  /** The first choice for the agent: who decides when no model is set here. */
  noneOf(agent: ChatAgent): { label: string; description: string };
  /** Saves the choice; rejects with a plain message when it couldn't be saved. */
  onChoose(agent: ChatAgent, model: string | null): Promise<void>;
}

/**
 * The default model per agent (story 11): the app's (Settings → Agents) or
 * a project's (Workspace settings, which wins). One menu per agent with the
 * models it last listed; an agent that hasn't started in a chat yet says so.
 * It applies to new chats only.
 */
export function DefaultModelsSection({ agents, description, testId, valueOf, noneOf, onChoose }: DefaultModelsSectionProps) {
  const queryClient = useQueryClient();
  // The models each agent lists change as its chats start: read them again when the section opens.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: CHAT_AGENTS_QUERY_KEY });
  }, [queryClient]);
  /** The agents whose default is on its way: each agent saves on its own. */
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | undefined>(undefined);
  const choose = (agent: ChatAgent, model: string | null) => {
    if (saving.has(agent.agentId)) return;
    const done = () => setSaving((now) => new Set([...now].filter((id) => id !== agent.agentId)));
    setSaving((now) => new Set([...now, agent.agentId]));
    setStatus(undefined);
    onChoose(agent, model).then(
      () => {
        done();
        const words = model === null ? noneOf(agent).label : modelLabel(agent.models, model);
        setStatus({ kind: 'saved', text: `Saved: new ${agent.displayName} chats start on ${words}.` });
      },
      (failure: unknown) => {
        done();
        setStatus({ kind: 'error', text: failure instanceof Error ? failure.message : "The default model couldn't be saved. Try again." });
      },
    );
  };
  return (
    <PageSection title="Default models" data-testid={`${testId}-section`}>
      <Text id={`${testId}-description`}>{description}</Text>
      <ul className="flex flex-col gap-2" aria-describedby={`${testId}-description`}>
        {agents.map((agent) => {
          const value = valueOf(agent);
          const none = noneOf(agent);
          const text = value === null ? none.label : modelLabel(agent.models, value);
          return (
            <li key={agent.agentId} className="flex flex-wrap items-center justify-between gap-2">
              <Text as="span" id={`${testId}-${agent.agentId}-name`}>
                {agent.displayName}
              </Text>
              <ModelMenu
                testId={`${testId}-${agent.agentId}`}
                variant="outline"
                title={`Default model for ${agent.displayName}`}
                ariaLabel={`Default model for ${agent.displayName}: ${text}`}
                text={text}
                models={agent.models ?? null}
                value={value}
                none={none}
                emptyText={`${agent.displayName}'s models appear here once it has started in a chat.`}
                busy={saving.has(agent.agentId)}
                onChoose={(model) => choose(agent, model)}
              />
            </li>
          );
        })}
      </ul>
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

/** The app's default model for an agent, in words: its saved model, else the agent's own choice. */
export function appDefaultWords(agent: ChatAgent): string {
  return agent.defaultModel === undefined ? agentDefaultLabel(agent.displayName) : modelLabel(agent.models, agent.defaultModel);
}
