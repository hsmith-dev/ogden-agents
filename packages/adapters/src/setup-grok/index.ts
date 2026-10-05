/**
 * `setup-grok` (epic 12 entries 4 and 8): installing Grok and giving it an
 * xAI API access token, behind core's `AgentSetupPort`. Entry 4 adds the slot
 * with an in-memory stub; entry 8 completes the port (install, token).
 */
import { GROK, GROK_AGENT_ID } from '../acp-grok/constants.js';
import { createMemoryAgentSetup, type MemoryAgentSetup } from '../setup-memory/index.js';

export { GROK_DESCRIPTOR, GROK_PROJECT_FILES } from './descriptor.js';
export {
  decompressBinary,
  GROK_CHECKED_DIR,
  GROK_DIR,
  GROK_INSTALL_SPEC,
  GROK_MAX_BINARY_BYTES,
  GROK_PINS,
  grokInstallSpec,
  installedGrok,
  installGrok,
  pinnedGrokVersion,
  removeStaleGrokInstalls,
  type GrokBinaryHashes,
  type InstalledGrok,
  type InstallGrokOptions,
} from './install.js';

/** Grok's setup port: an in-memory stub until entry 8. */
export function createGrokSetup(): MemoryAgentSetup {
  return createMemoryAgentSetup({ agentId: GROK_AGENT_ID, displayName: GROK });
}
