/**
 * An ACP agent's models (story 11): the session config option it lists them
 * in, read agent-neutrally (category `model`, or an uncategorized select whose
 * id is `model`), and its choices flattened out of their groups. Names no agent.
 */
import type * as acp from '@agentclientprotocol/sdk';
import type { AgentModel } from '@ogden-agents/shared';
import { cleanModels } from '@ogden-agents/core';

type SelectOption = acp.SessionConfigOption & { type: 'select' };

/** The select option that holds the session's model, if it lists one. */
export function modelOptionOf(options: readonly acp.SessionConfigOption[] | null | undefined): SelectOption | undefined {
  const selects = (options ?? []).filter((option): option is SelectOption => option.type === 'select');
  return selects.find((option) => option.category === 'model') ?? selects.find((option) => (option.category ?? null) === null && option.id === 'model');
}

/** Its choices, out of their groups, as Ogden's models (invalid ids left out). */
export function modelsOf(option: SelectOption, mask: (text: string) => string): AgentModel[] {
  const flat = option.options.flatMap((entry) => ('group' in entry ? entry.options : [entry]));
  return cleanModels(
    flat.map((choice) => ({
      id: choice.value,
      name: mask(choice.name).slice(0, 200) || choice.value,
      ...(choice.description == null || choice.description === '' ? {} : { description: mask(choice.description).slice(0, 500) }),
    })),
  );
}

/** The agent's own words for a refused request (a thrown error's `data.details`, else its message). */
export function agentWords(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as { data?: unknown }).data;
  const details = typeof data === 'object' && data !== null ? (data as { details?: unknown }).details : undefined;
  if (typeof details === 'string' && details.trim() !== '') return details.trim();
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() !== '' && message !== 'Internal error' ? message.trim() : undefined;
}
