/**
 * Each agent's linked command, install-wide (epic 12, entry 12; CAP-16
 * amended 2026-10-07): a user's own command line Ogden Agents runs in place
 * of its managed install, for the agents whose descriptor allows it (Codex
 * and Grok only; `AgentSetupStatus.supportsLinkedCommand`). This module
 * stores and retrieves the already-validated raw spec exactly as it was
 * typed, the same pattern as `agent-models.ts` storing a `defaultModel`
 * string without checking it names a real model: resolving a command line to
 * an absolute, runnable path is fs work, so it lives in
 * `packages/adapters`' `acp-base/linked-command.ts` (AD-1: core may depend
 * only on `@ogden-agents/shared`) and is called by the server route before
 * it ever reaches here. Core names no agent: which agents may have one is
 * the server wiring's call (the route only lets it through for an agent the
 * caller already knows supports it).
 */
import { AgentId as AgentIdSchema, LinkedCommandSpec, SETTINGS_STREAM, type AgentId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { agentSettings } from './db/schema.js';
import { ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';

export interface AgentLinkedCommands {
  /** The agent's linked command, or `undefined` for none (or a damaged stored value, read as none). */
  get(agentId: AgentId): LinkedCommandSpec | undefined;
  /**
   * Sets (or, with `null`, clears) the agent's linked command, appending
   * `settings.agent_linked_command_changed` when it changed. The caller (the
   * server route) has already resolved and validated `spec`; this module
   * never does. {@link ValidationError} for a value that isn't an agent id.
   */
  set(agentId: AgentId, spec: LinkedCommandSpec | null): { linked: boolean; changed: boolean };
}

/** The stored value, checked; one that isn't a {@link LinkedCommandSpec} (an older shape, a damaged row) reads as none. */
function parseLinkedCommand(value: unknown): LinkedCommandSpec | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = LinkedCommandSpec.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function createAgentLinkedCommands({ db, events }: { db: Database; events: EventLog }): AgentLinkedCommands {
  const { orm } = db;
  const row = (agentId: AgentId) => orm.select().from(agentSettings).where(eq(agentSettings.agentId, agentId)).get();

  const get = (agentId: AgentId): LinkedCommandSpec | undefined => parseLinkedCommand(row(agentId)?.linkedCommand);

  return {
    get,

    set(agentId, spec) {
      if (!AgentIdSchema.safeParse(agentId).success) throw new ValidationError('invalid agent id', [{ path: ['agentId'], message: 'not an agent id' }]);
      const next = spec === null ? null : spec;
      return events.transaction(() => {
        const previousText = JSON.stringify(get(agentId) ?? null);
        const nextText = JSON.stringify(next);
        const linked = next !== null;
        if (previousText === nextText) return { linked, changed: false };
        orm
          .insert(agentSettings)
          .values({ agentId, linkedCommand: next })
          .onConflictDoUpdate({ target: agentSettings.agentId, set: { linkedCommand: next } })
          .run();
        events.append({ type: 'settings.agent_linked_command_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { agentId, linked } });
        return { linked, changed: true };
      });
    },
  };
}
