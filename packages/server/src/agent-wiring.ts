/**
 * How server wiring registers an agent (epic 6 contract, 6.3): one
 * {@link AgentWiring} per agent, built from what its adapters export. A later
 * agent is one more entry in `start.ts`'s list (the wiring slot), never a
 * branch on its id.
 */
import { join } from 'node:path';
import { apiKeyMethod, type AgentDescriptor, type AgentPort, type AgentSetupPort } from '@ogden-agents/core';
import { PERMISSION_MODES } from '@ogden-agents/shared';
import type { AgentId } from '@ogden-agents/shared';

export interface AgentWiring {
  /** What the agent is: its id, install pin, sign-in methods, modes and folders. */
  descriptor: AgentDescriptor;
  /** Its chat port. Its `displayName` and `permissionModes` must match the descriptor's. */
  agent: AgentPort;
  /**
   * Installing and signing into it; absent for an agent with nothing to set
   * up (a test agent), which is always ready. Its `agentId` is the
   * descriptor's, and its API key variable the descriptor's first
   * (`checkAgentWiring`). For an agent with a `homeEnv`, the port's own
   * processes (status, sign-in) must run with the same home,
   * {@link agentHomeDir}: `start()` sets it only in chat processes.
   */
  setup?: AgentSetupPort | undefined;
  /**
   * For an agent whose process needs more than its own key and home from the
   * server, decided per start (epic 14: the Local model's endpoint, its
   * generated config and the endpoint's key): called before every start and
   * reopen, resolves with the variables to add to that process's environment
   * (they win over the ones core passes, and are never logged). Rejects with
   * an `AgentError` in plain words when the chat can't start (the endpoint
   * is not running). Absent: nothing is added.
   */
  prepareChat?: ((input: { env: Readonly<Record<string, string>> }) => Promise<Record<string, string>>) | undefined;
}

/**
 * Throws (a wiring bug) when `wiring`'s setup port is for another agent, or
 * gives its key in a variable other than the descriptor's first: the agent
 * would never be refused, or its key would escape the stripping of every
 * other agent's process.
 */
export function checkAgentWiring({ descriptor, setup }: AgentWiring): void {
  if (setup === undefined) return;
  if (setup.agentId !== descriptor.agentId) throw new Error(`agent wiring: ${descriptor.agentId}'s setup port is ${setup.agentId}'s`);
  const envNames = apiKeyMethod(descriptor)?.apiKey.envNames;
  if (setup.apiKey !== undefined && envNames?.[0] !== setup.apiKey.envName) {
    throw new Error(`agent wiring: ${descriptor.agentId}'s setup port gives its key in ${setup.apiKey.envName}, its descriptor in ${envNames?.[0] ?? 'none'}`);
  }
}

/**
 * The folder an agent with a `homeEnv` keeps its own settings, sessions and
 * logs in (`<dataDir>/agents/<id>-home`): inside Ogden's data folder, beside
 * (never inside) its install folder, so a reinstall keeps it.
 */
export function agentHomeDir(dataDir: string, agentId: AgentId): string {
  return join(dataDir, 'agents', `${agentId}-home`);
}

/**
 * `descriptor` for a chat port given in its agent's place (tests): the
 * port's product name, and only the modes it declares (Ask always), each
 * with the descriptor's own id for it.
 */
export function describedLike(descriptor: AgentDescriptor, agent: Pick<AgentPort, 'displayName' | 'permissionModes'>): AgentDescriptor {
  const declared = agent.permissionModes ?? ['ask'];
  const modes = Object.fromEntries(PERMISSION_MODES.filter((mode) => mode === 'ask' || declared.includes(mode)).map((mode) => [mode, descriptor.permissionModes[mode] ?? mode]));
  return { ...descriptor, displayName: agent.displayName, permissionModes: modes as AgentDescriptor['permissionModes'] };
}
