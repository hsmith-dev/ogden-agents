/**
 * Grok's wiring (epic 12 entry 4): its descriptor, its chat port
 * (`acp-grok`) and its setup port (`setup-grok`) as one `AgentWiring` for
 * the wiring slot in `start-agents.ts`. Entries 7 and 8 fill the ports behind
 * this function, so they never edit a shared wiring list. A shipped install
 * registers Grok only when `GROK_SHIPPED` (Grok's own folder) is on; a
 * test registers it through `StartOptions.grok`.
 */
import { createGrokAgent, createGrokSetup, GROK_DESCRIPTOR } from '@ogden-agents/adapters';
import type { AgentPort, AgentSetupPort } from '@ogden-agents/core';
import type { AgentWiring } from './agent-wiring.js';

/** What a test gives in place of Grok's own ports (the fake agent's Grok personality, a memory setup). */
export interface GrokPorts {
  agent?: AgentPort | undefined;
  setup?: AgentSetupPort | undefined;
}

export function grokWiring(input: {
  dataDir: string;
  given?: GrokPorts | undefined;
  /** Protocol notes for the log; never the environment, stderr or the agent's messages. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}): AgentWiring {
  return {
    descriptor: GROK_DESCRIPTOR,
    agent: input.given?.agent ?? createGrokAgent({ dataDir: input.dataDir, onDiagnostic: input.onDiagnostic }),
    setup: input.given?.setup ?? createGrokSetup(),
  };
}
