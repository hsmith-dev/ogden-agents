/**
 * Each agent's models, install-wide (story 11: each chat runs on a model the
 * user can switch): the model new chats with it start on (Settings → Agents;
 * a project's own default wins) and the models it last listed, kept so
 * Settings and a chat's picker can offer them before the agent starts again.
 * Core names no agent and no model: both are the agents' own data.
 */
import { AgentId as AgentIdSchema, AgentModel as AgentModelSchema, ModelId as ModelIdSchema, SETTINGS_STREAM, type AgentId, type AgentModel } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/database.js';
import { agentSettings } from './db/schema.js';
import { ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';

/** The most models kept for one agent (an agent listing more is cut, in its own order). */
export const MAX_AGENT_MODELS = 100;

export interface AgentModels {
  /** The install's default model for the agent's new chats; `undefined`: its own choice. */
  defaultModel(agentId: AgentId): string | undefined;
  /**
   * Sets or clears (`null`) the install's default model for the agent,
   * appending `settings.agent_default_model_changed` when it changed.
   * {@link ValidationError} for a value that isn't an agent id or a model id.
   * Whether the agent is registered is the caller's to check.
   */
  setDefaultModel(agentId: AgentId, model: string | null): { model: string | null; changed: boolean };
  /** The models the agent last listed on this install; `undefined` before it listed any. */
  lastModels(agentId: AgentId): AgentModel[] | undefined;
  /** Keeps `models` as the agent's last list (no event: what it offers, not a choice). Invalid entries are left out. */
  rememberModels(agentId: AgentId, models: readonly AgentModel[]): void;
}

const StoredModels = z.array(z.unknown());

/** The stored list, keeping only valid entries; a damaged value reads as none. */
function parseModels(text: string): AgentModel[] | undefined {
  try {
    const parsed = StoredModels.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    const models = parsed.data.flatMap((entry) => {
      const model = AgentModelSchema.safeParse(entry);
      return model.success ? [model.data] : [];
    });
    return models.length === 0 ? undefined : models;
  } catch {
    return undefined;
  }
}

/** Valid, unique by id, at most {@link MAX_AGENT_MODELS}. */
export function cleanModels(models: readonly AgentModel[]): AgentModel[] {
  const seen = new Set<string>();
  const kept: AgentModel[] = [];
  for (const model of models) {
    const parsed = AgentModelSchema.safeParse(model);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    kept.push(parsed.data);
    if (kept.length >= MAX_AGENT_MODELS) break;
  }
  return kept;
}

export function createAgentModels({ db, events }: { db: Database; events: EventLog }): AgentModels {
  const { orm } = db;
  const row = (agentId: AgentId) => orm.select().from(agentSettings).where(eq(agentSettings.agentId, agentId)).get();
  /** In memory too: the list is read for every session answered. */
  const cache = new Map<AgentId, AgentModel[] | undefined>();

  const defaultModel = (agentId: AgentId): string | undefined => {
    const parsed = ModelIdSchema.safeParse(row(agentId)?.defaultModel);
    return parsed.success ? parsed.data : undefined;
  };

  return {
    defaultModel,

    setDefaultModel(agentId, model) {
      if (!AgentIdSchema.safeParse(agentId).success) throw new ValidationError('invalid agent id', [{ path: ['agentId'], message: 'not an agent id' }]);
      const parsed = ModelIdSchema.nullable().safeParse(model);
      if (!parsed.success) throw new ValidationError("Choose a model the agent offers, or the agent's default.", [{ path: ['model'], message: 'not a model id' }]);
      const next = parsed.data;
      return events.transaction(() => {
        const previous = defaultModel(agentId) ?? null;
        if (previous === next) return { model: next, changed: false };
        orm
          .insert(agentSettings)
          .values({ agentId, defaultModel: next })
          .onConflictDoUpdate({ target: agentSettings.agentId, set: { defaultModel: next } })
          .run();
        events.append({ type: 'settings.agent_default_model_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { agentId, model: next, previous } });
        return { model: next, changed: true };
      });
    },

    lastModels(agentId) {
      if (!cache.has(agentId)) cache.set(agentId, parseModels(row(agentId)?.models ?? '[]'));
      return cache.get(agentId);
    },

    rememberModels(agentId, models) {
      const kept = cleanModels(models);
      if (kept.length === 0 || !AgentIdSchema.safeParse(agentId).success) return;
      const text = JSON.stringify(kept);
      if (JSON.stringify(this.lastModels(agentId) ?? []) === text) return;
      orm.insert(agentSettings).values({ agentId, models: text }).onConflictDoUpdate({ target: agentSettings.agentId, set: { models: text } }).run();
      cache.set(agentId, kept);
    },
  };
}
