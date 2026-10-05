/**
 * Grok's wiring (epic 12 entry 4): its descriptor, its chat port
 * (`acp-grok`) and its setup port (`setup-grok`) as one `AgentWiring` for
 * the wiring slot in `start-agents.ts`. Entries 7 and 8 fill the ports behind
 * this function, so they never edit a shared wiring list. A shipped install
 * registers Grok only when `GROK_SHIPPED` (Grok's own folder) is on; a
 * test registers it through `StartOptions.grok`.
 */
import { createGrokAgent, createGrokSetup, GROK_DESCRIPTOR, type GrokSetupOptions } from '@ogden-agents/adapters';
import type { AgentPort, AgentSetupPort } from '@ogden-agents/core';
import type { AgentWiring } from './agent-wiring.js';
import { testApiKeyCheck } from './test-hooks.js';

/** What a test gives in place of Grok's own ports (the fake agent's Grok personality, a memory setup). */
export interface GrokPorts {
  agent?: AgentPort | undefined;
  setup?: AgentSetupPort | undefined;
}

export function grokWiring(input: {
  dataDir: string;
  /** The script a test runs in place of Grok's checked binary (`OGDEN_AGENTS_TEST_GROK_SERVER`), under this Node. */
  serverScript?: string | undefined;
  given?: GrokPorts | undefined;
  /** Grok's install pins, npm, binary hashes and token probe, from the test hook (a local fixture lock); absent as shipped. */
  install?: GrokSetupOptions['install'];
  /** Protocol notes for the log; never the environment, stderr or the agent's messages. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}): AgentWiring {
  const verify = testApiKeyCheck(process.env, input.dataDir);
  return {
    descriptor: GROK_DESCRIPTOR,
    agent:
      input.given?.agent ??
      createGrokAgent({
        dataDir: input.dataDir,
        ...(input.serverScript === undefined ? {} : { server: () => ({ command: process.execPath, args: [input.serverScript!] }) }),
        onDiagnostic: input.onDiagnostic,
      }),
    setup:
      input.given?.setup ??
      createGrokSetup({
        dataDir: input.dataDir,
        ...(input.install === undefined ? {} : { install: input.install }),
        // The token check never reaches xAI in a test (`OGDEN_AGENTS_TEST_API_KEY_CHECK`, behind `testHooksAllowed`).
        ...(verify === undefined ? {} : { apiKey: { verify } }),
        ...(input.onDiagnostic === undefined ? {} : { onDiagnostic: (message: string, fields?: Record<string, unknown>) => input.onDiagnostic!(`setup: ${message}`, fields) }),
      }),
  };
}
