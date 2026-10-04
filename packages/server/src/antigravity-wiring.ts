/**
 * Antigravity's wiring (epic 6 entry 5): its descriptor, its chat port
 * (`acp-antigravity`) and its setup port (`setup-antigravity`) on the data
 * folder, as one `AgentWiring` for `start.ts`'s slot. Entry 7 completes the
 * setup port behind this function, so it never edits `start.ts`.
 */
import { ANTIGRAVITY_DESCRIPTOR, createAntigravityAgent, createAntigravitySetup } from '@ogden-agents/adapters';
import type { AgentPort, AgentSetupPort } from '@ogden-agents/core';
import type { AgentWiring } from './agent-wiring.js';

/** What a test gives in place of Antigravity's own ports (the fake agent's Antigravity personality, a memory setup). */
export interface AntigravityPorts {
  agent?: AgentPort | undefined;
  setup?: AgentSetupPort | undefined;
}

export function antigravityWiring(input: {
  dataDir: string;
  given?: AntigravityPorts | undefined;
  /** Protocol notes for the log; never the environment, stderr or the agent's messages. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}): AgentWiring {
  return {
    descriptor: ANTIGRAVITY_DESCRIPTOR,
    agent: input.given?.agent ?? createAntigravityAgent({ dataDir: input.dataDir, onDiagnostic: input.onDiagnostic }),
    setup: input.given?.setup ?? createAntigravitySetup({ dataDir: input.dataDir }),
  };
}
