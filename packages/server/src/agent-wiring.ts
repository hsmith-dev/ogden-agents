/**
 * How server wiring registers an agent (epic 6 contract, 6.3): one
 * {@link AgentWiring} per agent, built from what its adapters export. A later
 * agent is one more entry in `start.ts`'s list (the wiring slot), never a
 * branch on its id.
 */
import { join } from 'node:path';
import type { AgentDescriptor, AgentPort, AgentSetupPort } from '@ogden-agents/core';
import { PERMISSION_MODES } from '@ogden-agents/shared';
import type { AgentId } from '@ogden-agents/shared';

export interface AgentWiring {
  /** What the agent is: its id, install pin, sign-in methods, modes and folders. */
  descriptor: AgentDescriptor;
  /** Its chat port. Its `displayName` and `permissionModes` must match the descriptor's. */
  agent: AgentPort;
  /** Installing and signing into it; absent for an agent with nothing to set up (a test agent), which is always ready. */
  setup?: AgentSetupPort | undefined;
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
