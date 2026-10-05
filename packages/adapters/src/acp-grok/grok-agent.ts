/**
 * Grok's chat port. A stub until epic 12 entry 7: it is the shared ACP
 * client on Grok's descriptor, whose launch says Grok isn't set up.
 */
import { AgentError, type AgentPort } from '@ogden-agents/core';
import { acpReasons, createAcpAgent, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import { slashSkillInvocation } from '../acp-base/quirks.js';
import { GROK_DESCRIPTOR } from '../setup-grok/descriptor.js';

export interface GrokAgentOptions {
  /** The Ogden Agents data folder, where the pinned binary is found. */
  dataDir: string;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

export function createGrokAgent(options: GrokAgentOptions): AgentPort {
  const reasons = acpReasons(GROK_DESCRIPTOR.displayName, { apiKeyOnly: true });
  const quirks: AcpAgentQuirks = {
    launch() {
      throw new AgentError('agent_unavailable', reasons.notSetUp);
    },
    toolInputPaths: { pathFields: [], patternFields: [] },
    askingModeIds: [GROK_DESCRIPTOR.permissionModes.ask],
    // Its mode is given at chat start (entry 7 fills it in).
    startOptions: () => ({ guardsPaths: false }),
    skillInvocation: slashSkillInvocation,
  };
  return createAcpAgent(GROK_DESCRIPTOR, quirks, { onDiagnostic: options.onDiagnostic });
}
