/**
 * Antigravity's wiring (epic 6 entry 5): its descriptor, its chat port
 * (`acp-antigravity`) and its setup port (`setup-antigravity`) on the data
 * folder, as one `AgentWiring` for `start.ts`'s slot. Entry 7 completes the
 * setup port behind this function, so it never edits `start.ts`: its setup
 * processes get the agent allowlist without any agent's key (AD-16), its home
 * is the one chats use, and a test run on a temp data folder may stub the key
 * check (`testApiKeyCheck`, behind `testHooksAllowed`).
 */
import { ANTIGRAVITY_DESCRIPTOR, createAntigravityAgent, createAntigravitySetup } from '@ogden-agents/adapters';
import type { AgentPort, AgentSetupPort } from '@ogden-agents/core';
import { agentHomeDir, type AgentWiring } from './agent-wiring.js';
import { agentEnvironment, withoutAgentKeys } from './start-env.js';
import { testApiKeyCheck } from './test-hooks.js';

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
    setup: input.given?.setup ?? defaultSetup(input.dataDir, input.onDiagnostic),
  };
}

function defaultSetup(dataDir: string, onDiagnostic: ((message: string, fields?: Record<string, unknown>) => void) | undefined): AgentSetupPort {
  const verify = testApiKeyCheck(process.env, dataDir);
  return createAntigravitySetup({
    dataDir,
    homeDir: agentHomeDir(dataDir, ANTIGRAVITY_DESCRIPTOR.agentId),
    // Install, sign-in and sign-out never see an API key (story 9.2's rule, AD-16).
    env: () => withoutAgentKeys(agentEnvironment()),
    ...(verify === undefined ? {} : { apiKey: { verify } }),
    ...(onDiagnostic === undefined ? {} : { onDiagnostic: (message: string, fields?: Record<string, unknown>) => onDiagnostic(`setup: ${message}`, fields) }),
  });
}
