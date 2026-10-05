/**
 * `setup-codex` (epic 12 entries 4 and 6): installing Codex and signing into
 * it, behind core's `AgentSetupPort`. Entry 4 adds the slot with an in-memory
 * stub; entry 6 completes the port (install, ChatGPT sign-in, API key, sign out).
 */
import { createMemoryAgentSetup, type MemoryAgentSetup } from '../setup-memory/index.js';
import { CODEX, CODEX_AGENT_ID } from '../acp-codex/constants.js';

export { CODEX_DESCRIPTOR } from './descriptor.js';
export {
  CODEX_DIR,
  CODEX_INSTALL_SPEC,
  CODEX_PINS,
  installCodex,
  installedCodex,
  pinnedCodexVersion,
  removeStaleCodexInstalls,
  type InstalledCodex,
  type InstallCodexOptions,
} from './install.js';

/** Codex's setup port: an in-memory stub until entry 6. */
export function createCodexSetup(): MemoryAgentSetup {
  return createMemoryAgentSetup({ agentId: CODEX_AGENT_ID, displayName: CODEX });
}
