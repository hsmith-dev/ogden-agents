/**
 * The ACP agents the user brings, kept install-wide (epic 21, story 21.2;
 * CAP-27, E21-R1, E21-R3; AD-11): their name, the command line exactly as
 * typed and, when they have one, the variable their API key reaches them
 * under. The key itself is only in the secret store, as
 * `agent-api-key/<agentId>` (AD-16), never in a row, an event or a view.
 *
 * Core names no agent: the server picks the id (`custom-<slug>`), resolves
 * the command (fs work, `packages/adapters`) before it reaches here, and
 * registers the agent; this module only keeps what was saved.
 */
import {
  AgentId as AgentIdSchema,
  CustomAgentCreateRequest,
  CustomAgentUpdateRequest,
  SETTINGS_STREAM,
  type AgentId,
  type CustomAgent,
  type CustomAgentKeyInput,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { apiKeySecretName } from './agent-setup-types.js';
import type { Database } from './db/database.js';
import { customAgents } from './db/schema.js';
import { NotFoundError, SecretsUnavailableError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { SecretStorePort } from './secret-store-port.js';

/** A custom agent's key and the variable it reaches the agent's process under. */
export interface CustomAgentKey {
  envName: string;
  value: string;
}

export interface CustomAgents {
  /** Every stored custom agent, oldest first. A damaged row is left out. */
  list(): CustomAgent[];
  /** The stored agent, or `undefined`. */
  get(agentId: AgentId): CustomAgent | undefined;
  /** Its key, read from the secret store; `undefined` when it has none. Rejects `SecretsUnavailableError`. */
  key(agentId: AgentId): Promise<CustomAgentKey | undefined>;
  /**
   * Stores a new agent under `agentId` (`CustomAgentCreateRequest`), its key
   * first: where the keychain can't hold it, nothing is stored. Appends
   * `settings.custom_agent_changed` (`added`). `ValidationError` for a bad
   * body or an id already stored; `SecretsUnavailableError`.
   */
  create(agentId: AgentId, request: unknown): Promise<CustomAgent>;
  /** Changes it (`CustomAgentUpdateRequest`; `apiKey: null` removes the key). `NotFoundError`, `ValidationError`, `SecretsUnavailableError`. */
  update(agentId: AgentId, request: unknown): Promise<CustomAgent>;
  /** Removes it and its key. `NotFoundError`; `SecretsUnavailableError` when the key can't be removed (nothing is). */
  remove(agentId: AgentId): Promise<void>;
}

export interface CustomAgentsOptions {
  db: Database;
  events: EventLog;
  secrets: SecretStorePort;
  now?: () => Date;
}

type Row = typeof customAgents.$inferSelect;

const viewOf = (row: Row): CustomAgent => ({ agentId: row.agentId, displayName: row.displayName, commandLine: row.commandLine, keyEnvName: row.keyEnvName, hasKey: row.keyEnvName !== null });

export function createCustomAgents({ db, events, secrets, now = () => new Date() }: CustomAgentsOptions): CustomAgents {
  const { orm } = db;
  const refuse = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): never => {
    const issue = error.issues[0];
    throw new ValidationError(issue?.message ?? fallback, error.issues.map((each) => ({ path: each.path, message: each.message })));
  };
  const unavailable = (error: unknown): SecretsUnavailableError => (error instanceof SecretsUnavailableError ? error : new SecretsUnavailableError(undefined, { cause: 'unexpected' }));
  const checkId = (agentId: AgentId) => {
    if (!AgentIdSchema.safeParse(agentId).success) throw new ValidationError('invalid agent id', [{ path: ['agentId'], message: 'not an agent id' }]);
  };
  const rowOf = (agentId: AgentId): Row | undefined => orm.select().from(customAgents).where(eq(customAgents.agentId, agentId)).get();
  const existing = (agentId: AgentId): Row => {
    const row = rowOf(agentId);
    if (row === undefined) throw new NotFoundError('custom agent', agentId);
    return row;
  };
  const note = (agentId: AgentId, change: 'added' | 'updated' | 'removed') =>
    events.append({ type: 'settings.custom_agent_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { agentId, change } });
  const setKey = async (agentId: AgentId, key: CustomAgentKeyInput) => {
    try {
      await secrets.set(apiKeySecretName(agentId), key.value);
    } catch (error) {
      throw unavailable(error);
    }
  };
  const dropKey = async (agentId: AgentId) => {
    try {
      await secrets.delete(apiKeySecretName(agentId));
    } catch (error) {
      throw unavailable(error);
    }
  };

  return {
    list: () =>
      orm
        .select()
        .from(customAgents)
        .all()
        .filter((row) => AgentIdSchema.safeParse(row.agentId).success)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.agentId.localeCompare(b.agentId))
        .map(viewOf),

    get(agentId) {
      const row = rowOf(agentId);
      return row === undefined ? undefined : viewOf(row);
    },

    async key(agentId) {
      const row = rowOf(agentId);
      if (row?.keyEnvName === null || row === undefined) return undefined;
      let value: string | undefined;
      try {
        value = await secrets.get(apiKeySecretName(agentId));
      } catch (error) {
        throw unavailable(error);
      }
      return value === undefined ? undefined : { envName: row.keyEnvName, value };
    },

    async create(agentId, request) {
      checkId(agentId);
      const parsed = CustomAgentCreateRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'That agent can not be added.');
      const input = parsed.data;
      if (rowOf(agentId) !== undefined) throw new ValidationError(`${agentId} is already added`, [{ path: ['agentId'], message: 'already added' }]);
      // The key first: where the keychain can't hold it, nothing is added (AD-16).
      if (input.apiKey !== undefined) await setKey(agentId, input.apiKey);
      try {
        return events.transaction(() => {
          const at = now().toISOString();
          orm
            .insert(customAgents)
            .values({ agentId, displayName: input.displayName, commandLine: input.commandLine, keyEnvName: input.apiKey?.envName ?? null, createdAt: at, updatedAt: at })
            .run();
          note(agentId, 'added');
          return viewOf(existing(agentId));
        });
      } catch (error) {
        if (input.apiKey !== undefined) await secrets.delete(apiKeySecretName(agentId)).catch(() => {});
        throw error;
      }
    },

    async update(agentId, request) {
      const before = existing(agentId);
      const parsed = CustomAgentUpdateRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Choose something to change.');
      const input = parsed.data;
      // A new key is kept before the row names it (the old one read first, to put back if the row can't change);
      // a removed one goes only after the row stops naming it.
      const newKey = input.apiKey !== undefined && input.apiKey !== null ? input.apiKey : undefined;
      let previousKey: string | undefined;
      if (newKey !== undefined) {
        if (before.keyEnvName !== null) {
          try {
            previousKey = await secrets.get(apiKeySecretName(agentId));
          } catch (error) {
            throw unavailable(error);
          }
        }
        await setKey(agentId, newKey);
      }
      let view: CustomAgent;
      try {
        view = events.transaction(() => {
          const current = existing(agentId);
          const keyEnvName = input.apiKey === undefined ? current.keyEnvName : input.apiKey === null ? null : input.apiKey.envName;
          orm
            .update(customAgents)
            .set({ displayName: input.displayName ?? current.displayName, commandLine: input.commandLine ?? current.commandLine, keyEnvName, updatedAt: now().toISOString() })
            .where(eq(customAgents.agentId, agentId))
            .run();
          note(agentId, 'updated');
          return viewOf(existing(agentId));
        });
      } catch (error) {
        if (newKey !== undefined) {
          const name = apiKeySecretName(agentId);
          await (previousKey === undefined ? secrets.delete(name) : secrets.set(name, previousKey)).catch(() => {});
        }
        throw error;
      }
      if (input.apiKey === null) await secrets.delete(apiKeySecretName(agentId)).catch(() => {});
      return view;
    },

    async remove(agentId) {
      const before = existing(agentId);
      // The key goes first: a key the keychain can't let go of keeps the agent, so it is never left behind unnamed.
      // One with no key named is still tried: a removal or a timed-out write earlier may have left one.
      if (before.keyEnvName !== null) await dropKey(agentId);
      else await secrets.delete(apiKeySecretName(agentId)).catch(() => {});
      events.transaction(() => {
        orm.delete(customAgents).where(eq(customAgents.agentId, agentId)).run();
        note(agentId, 'removed');
      });
    },
  };
}
