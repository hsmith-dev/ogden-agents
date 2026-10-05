/**
 * Codex's chat port. A stub until epic 12 entry 5: it is the shared ACP
 * client on Codex's descriptor, whose launch says Codex isn't set up.
 */
import { AgentError, type AgentPort } from '@ogden-agents/core';
import { acpReasons, createAcpAgent, type AcpAgentQuirks } from '../acp-base/acp-agent.js';
import { CODEX_DESCRIPTOR } from '../setup-codex/descriptor.js';

export interface CodexAgentOptions {
  /** The Ogden Agents data folder, where the pinned adapter is found. */
  dataDir: string;
  /** Called with protocol notes, for the log. Never includes the environment. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}

export function createCodexAgent(options: CodexAgentOptions): AgentPort {
  const reasons = acpReasons(CODEX_DESCRIPTOR.displayName);
  const quirks: AcpAgentQuirks = {
    launch() {
      throw new AgentError('agent_unavailable', reasons.notSetUp);
    },
    toolInputPaths: { pathFields: [], patternFields: [] },
    askingModeIds: [CODEX_DESCRIPTOR.permissionModes.ask],
    skillInvocation: (skill, idea) => (idea === undefined || idea === '' ? `$${skill}` : `$${skill} ${idea}`),
  };
  return createAcpAgent(CODEX_DESCRIPTOR, quirks, { onDiagnostic: options.onDiagnostic });
}
