/**
 * The server's Unattended builds wiring (story 5.2): git (`vcs-git`, with an
 * empty hooks folder of Ogden Agents' own), the sandbox check (Claude Code's
 * native sandbox, or a test's answer), the build runner (`buildrunner-acp`)
 * and core's builds use-cases over the chat and the ticket store. Each port
 * is a wiring slot a test (or a later lane) fills through `StartOptions`.
 */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createAcpBuildRunner, BUILD_AUTO_SKILL, createAntigravityBuildRunner, createCodexBuildRunner, createGrokBuildRunner, createDockerStep, createFixedSandbox, createGitVcs, createNativeSandboxStep, createSandboxChain, errorCode, maskSecrets, secretValues } from '@ogden-agents/adapters';
import { redactApiKeys } from '@ogden-agents/shared';
import { createBuilds, type SandboxPort, RUNS_DIR, worktreesRootOf, type BmadSourceUseCases, type VcsPort, type BuildsUseCases, type Chat, type Core, type TicketStorePort } from '@ogden-agents/core';
import type { Logger } from './log.js';
import { agentEnvironment, withoutAgentKeys } from './start-env.js';
import type { StartOptions } from './start-types.js';
import type { TestHooks } from './test-hooks.js';

/** Why an agent that cannot take the build's sandbox here is refused an unattended build (plain words, no dashes). */
export const AGENT_ATTENDED_ONLY_REASON = "This agent can't build unattended on this computer yet. It can build with you watching.";

/** The empty folder every git call gets as `core.hooksPath`, so no repo or agent-written hook runs (story 5.2). */
export function gitHooksDir(dataDir: string): string {
  return join(dataDir, 'tools', 'git-hooks-none');
}

/**
 * The one git the server uses (builds, and Save the lessons in epic 7): it
 * runs as the user with the agents' allowlist and never an API key (AD-16),
 * with no hook run, removals only ever in `<data>/w` (story 5.5). A test's
 * own (`StartOptions.vcs`) replaces it.
 */
export function createServerVcs(options: StartOptions, dataDir: string): VcsPort {
  return options.vcs ?? createGitVcs({ hooksDir: gitHooksDir(dataDir), env: () => withoutAgentKeys(agentEnvironment()), worktreesRoot: worktreesRootOf(dataDir), runsRoot: join(dataDir, RUNS_DIR) });
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
  vcs: sharedVcs,
  registeredAgents,
  unattendedAgents,
  describeAgent,
  attendedOnlyReason,
}: {
  vcs?: VcsPort;
  options: StartOptions;
  core: Core;
  dataDir: string;
  log: Logger;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage' | 'releaseAgent' | 'chatAgents'>;
  tickets: TicketStorePort;
  /** The board's store: a ticket with an active run is read and marked in its worktree (story 5.8: prerequisites, Retry's mark). */
  runAwareTickets: TicketStorePort;
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  hooks: Pick<TestHooks, 'sandbox'>;
  /** The agents a chat can start with: a runner for an agent that is not wired is never offered. */
  registeredAgents: (agentId: string) => boolean;
  /** Whether an agent can run an unattended build here (its port says so; `AgentPort.unattendedBuild`). */
  unattendedAgents: (agentId: string) => boolean;
  /** An agent's product name and where its skills go in a project (its descriptor). */
  /** An agent's own plain reason it builds only with the user watching, when it says one. */
  attendedOnlyReason: (agentId: string) => string | undefined;
  describeAgent: (agentId: string) => { displayName: string; skillsFolder: string } | undefined;
}): BuildsUseCases {
  // Git runs as the user, with the agents' allowlist and never an API key (AD-16).
  // Removals only ever in `<data>/w` (story 5.5).
  const vcs = sharedVcs ?? createServerVcs(options, dataDir);
  const machineSandbox = options.sandbox ?? (hooks.sandbox === undefined
      ? // The chain (story 5.6): Claude Code's own sandbox, then Docker if it is already there; probes only, nothing installed.
        createSandboxChain({
          steps: [createNativeSandboxStep({ path: () => agentEnvironment().PATH ?? agentEnvironment().Path }), createDockerStep({ env: () => withoutAgentKeys(agentEnvironment()) })],
        })
      : createFixedSandbox(hooks.sandbox));
  // The sandbox answer is per agent (epic 17): an agent that cannot take the build's sandbox at start, or whose own sandbox is
  // not verified yet, builds only with the user watching, whatever this computer's sandbox is. Never a guess that it can.
  const sandbox: SandboxPort = {
    async check(request) {
      const agent = request?.agent;
      if (agent !== undefined && !unattendedAgents(agent)) return { available: false, reason: attendedOnlyReason(agent) ?? AGENT_ATTENDED_ONLY_REASON, choices: ['attended', 'other_agent'] };
      return machineSandbox.check(request);
    },
    async status(request) {
      const agent = request?.agent;
      const status = await machineSandbox.status(request);
      if (agent === undefined || unattendedAgents(agent)) return status;
      return { ...status, available: false, kind: null, summary: attendedOnlyReason(agent) ?? AGENT_ATTENDED_ONLY_REASON, choices: ['attended', 'other_agent'], installHint: null };
    },
    run: (request) => machineSandbox.run(request),
  };
  // The build skill must be where the agent reads skills, in the run's worktree (committed): a plain refusal naming it otherwise.
  const skillReach = (agent: string, worktree: string): string | undefined => {
    const described = describeAgent(agent);
    // An agent with no descriptor cannot be known to find the skill: refused, never assumed.
    if (described === undefined) return `That agent can't find the ${BUILD_AUTO_SKILL} skill in this project.`;
    const file = join(worktree, ...described.skillsFolder.split('/'), BUILD_AUTO_SKILL, 'SKILL.md');
    // A regular file that is the project's own: never a link (the agent would read what it points at).
    let present = false;
    try {
      present = lstatSync(file).isFile();
    } catch {
      present = false;
    }
    return present ? undefined : `${described.displayName} can't find the ${BUILD_AUTO_SKILL} skill in this project (${described.skillsFolder}). Add the BMad skills for ${described.displayName} and commit them, then build again.`;
  };
  return createBuilds({
    skillReach,
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
    // The other agents that can build (epic 17); a test's own list replaces them.
    runners: (options.buildRunners ?? [createCodexBuildRunner(), createGrokBuildRunner(), createAntigravityBuildRunner()]).filter((each) => registeredAgents(each.agent)),
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
