/**
 * The server's Unattended builds wiring (story 5.2): git (`vcs-git`, with an
 * empty hooks folder of Ogden Agents' own), the sandbox check (Claude Code's
 * native sandbox, or a test's answer), the build runner (`buildrunner-acp`)
 * and core's builds use-cases over the chat and the ticket store. Each port
 * is a wiring slot a test (or a later lane) fills through `StartOptions`.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createAcpBuildRunner, createDockerStep, createFixedSandbox, createGitVcs, createNativeSandboxStep, createSandboxChain, errorCode, maskSecrets, secretValues } from '@ogden-agents/adapters';
import { redactApiKeys } from '@ogden-agents/shared';
import { createBuilds, RUNS_DIR, worktreesRootOf, type BmadSourceUseCases, type BuildsUseCases, type Chat, type Core, type TicketStorePort } from '@ogden-agents/core';
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
  runAwareTickets,
  source,
  hooks,
}: {
  options: StartOptions;
  core: Core;
  dataDir: string;
  log: Logger;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage' | 'releaseAgent'>;
  tickets: TicketStorePort;
  /** The board's store: a ticket with an active run is read and marked in its worktree (story 5.8: prerequisites, Retry's mark). */
  runAwareTickets: TicketStorePort;
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  hooks: Pick<TestHooks, 'sandbox'>;
}): BuildsUseCases {
  // Git runs as the user, with the agents' allowlist and never an API key (AD-16).
  // Removals only ever in `<data>/w` (story 5.5).
  const vcs = options.vcs ?? createGitVcs({ hooksDir: gitHooksDir(dataDir), env: () => withoutAgentKeys(agentEnvironment()), worktreesRoot: worktreesRootOf(dataDir), runsRoot: join(dataDir, RUNS_DIR) });
  const sandbox = options.sandbox ?? (hooks.sandbox === undefined
      ? // The chain (story 5.6): Claude Code's own sandbox, then Docker if it is already there; probes only, nothing installed.
        createSandboxChain({
          steps: [createNativeSandboxStep({ path: () => agentEnvironment().PATH ?? agentEnvironment().Path }), createDockerStep({ env: () => withoutAgentKeys(agentEnvironment()) })],
        })
      : createFixedSandbox(hooks.sandbox));
  return createBuilds({
    settings: core.buildSettings,
    // The re-run of a project's tests gets the agents' allowlist and never an API key (AD-16).
    commandEnv: () => withoutAgentKeys(agentEnvironment()),
    bmad: core.bmad,
    trust: core.bmadScriptTrust,
    source,
    entities: core.entities,
    events: core.events,
    tickets,
    runAwareTickets,
    vcs,
    sandbox,
    runner: options.buildRunner ?? createAcpBuildRunner(),
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
