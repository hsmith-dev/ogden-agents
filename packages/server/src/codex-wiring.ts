/**
 * Codex's wiring (epic 12 entry 4): its descriptor, its chat port
 * (`acp-codex`) and its setup port (`setup-codex`) as one `AgentWiring` for
 * the wiring slot in `start-agents.ts`. Entries 5 and 6 fill the ports behind
 * this function, so they never edit a shared wiring list. A shipped install
 * registers Codex only when `CODEX_SHIPPED` (Codex's own folder) is on; a
 * test registers it through `StartOptions.codex`.
 */
import { CODEX_DESCRIPTOR, createCodexAgent, createCodexSetup, type CodexSetupOptions } from '@ogden-agents/adapters';
import type { AgentPort, AgentSetupPort } from '@ogden-agents/core';
import type { AgentWiring } from './agent-wiring.js';
import { testApiKeyCheck } from './test-hooks.js';

/** What a test gives in place of Codex's own ports (the fake agent's Codex personality, a memory setup). */
export interface CodexPorts {
  agent?: AgentPort | undefined;
  setup?: AgentSetupPort | undefined;
}

export function codexWiring(input: {
  dataDir: string;
  /** The adapter script a test runs in place of the pinned one (`OGDEN_AGENTS_TEST_CODEX_SERVER`), under this Node. */
  serverScript?: string | undefined;
  given?: CodexPorts | undefined;
  /** Codex's install pins and npm, from the test hook (a local fixture lock); absent as shipped. */
  install?: CodexSetupOptions['install'];
  /** Protocol notes for the log; never the environment, stderr or the agent's messages. */
  onDiagnostic?: (message: string, fields?: Record<string, unknown>) => void;
}): AgentWiring {
  const verify = testApiKeyCheck(process.env, input.dataDir);
  return {
    descriptor: CODEX_DESCRIPTOR,
    agent: input.given?.agent ?? createCodexAgent({
        dataDir: input.dataDir,
        ...(input.serverScript === undefined ? {} : { server: () => ({ command: process.execPath, args: [input.serverScript!] }) }),
        onDiagnostic: input.onDiagnostic,
      }),
    setup:
      input.given?.setup ??
      createCodexSetup({
        dataDir: input.dataDir,
        ...(input.install === undefined ? {} : { install: input.install }),
        // The key check never reaches OpenAI in a test (`OGDEN_AGENTS_TEST_API_KEY_CHECK`, behind `testHooksAllowed`).
        ...(verify === undefined ? {} : { apiKey: { verify } }),
        ...(input.onDiagnostic === undefined ? {} : { onDiagnostic: (message: string, fields?: Record<string, unknown>) => input.onDiagnostic!(`setup: ${message}`, fields) }),
      }),
  };
}
