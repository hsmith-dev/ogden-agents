/**
 * The server's Unattended builds wiring (story 5.2): git (`vcs-git`, with an
 * empty hooks folder of Ogden Agents' own), the sandbox check (Claude Code's
 * native sandbox, or a test's answer), the build runner (`buildrunner-acp`)
 * and core's builds use-cases over the chat and the ticket store.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createAcpBuildRunner, createClaudeNativeSandbox, createFixedSandbox, createGitVcs, errorCode, maskSecrets, secretValues } from '@ogden-agents/adapters';
import { redactApiKeys } from '@ogden-agents/shared';
import { createBuilds, type BmadSourceUseCases, type BuildsUseCases, type Chat, type Core, type TicketStorePort } from '@ogden-agents/core';
import type { Logger } from './log.js';
import { agentEnvironment, withoutAgentKeys } from './start-env.js';
import type { StartOptions } from './start-types.js';
import type { TestHooks } from './test-hooks.js';

/** The empty folder every git call gets as `core.hooksPath`, so no repo or agent-written hook runs (story 5.2). */
export function gitHooksDir(dataDir: string): string {
  return join(dataDir, 'tools', 'git-hooks-none');
}

export function createBuildsWiring({
  options,
  core,
  dataDir,
  log,
  chat,
  tickets,
  source,
  hooks,
}: {
  options: StartOptions;
  core: Core;
  dataDir: string;
  log: Logger;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage' | 'releaseAgent'>;
  tickets: TicketStorePort;
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  hooks: Pick<TestHooks, 'sandbox'>;
}): BuildsUseCases {
  // Git runs as the user, with the agents' allowlist and never an API key (AD-16).
  const vcs = options.vcs ?? createGitVcs({ hooksDir: gitHooksDir(dataDir), env: () => withoutAgentKeys(agentEnvironment()) });
  const sandbox = options.sandbox ?? (hooks.sandbox === undefined ? createClaudeNativeSandbox({ path: () => agentEnvironment().PATH ?? agentEnvironment().Path }) : createFixedSandbox(hooks.sandbox));
  return createBuilds({
    bmad: core.bmad,
    trust: core.bmadScriptTrust,
    source,
    entities: core.entities,
    events: core.events,
    tickets,
    vcs,
    sandbox,
    runner: createAcpBuildRunner(),
    chat,
    buildSessions: core.buildSessions,
    dataDir,
    homeDir: homedir(),
    // A reason the agent wrote is stored masked: no secret of the agents' environment, no Anthropic key (AD-16).
    mask: (text) => redactApiKeys(maskSecrets(text, secretValues({ ...process.env, ...agentEnvironment() }))),
    // Codes only: never a path, git's output or the agent's.
    onError: (runId, step, error) => log.warn('build step failed', { runId, step, code: errorCode(error, 'unexpected') }),
  });
}
