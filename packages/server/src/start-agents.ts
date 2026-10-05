/**
 * The agents a server runs (epics 2, 9 and 6; moved out of `start.ts` by
 * story 6.9 to keep it under 600 lines): Claude Code's chat and setup ports,
 * Antigravity's wiring slot and any agent a test wires, the agent setup
 * use-case over their setup ports, and each agent's chat environment
 * (AD-16: its own key and home only).
 */
import { chmodSync, mkdirSync } from 'node:fs';
import {
  CLAUDE_CODE_AGENT_ID,
  CLAUDE_CODE_DESCRIPTOR,
  ANTIGRAVITY_DESCRIPTOR,
  CODEX_SHIPPED,
  createAntigravityAgent,
  createAntigravitySetup,
  currentPlatform,
  pinnedServer,
  createClaudeCodeAgent,
  createClaudeCodeSetup,
  createKeyringSecretStore,
  createMemorySecretStore,
  locateClaudeAdapter,
  resolveClaudeAgentAcp,
} from '@ogden-agents/adapters';
import { agentEnvKeys, AgentSetupError, CoreError, createAgentSetup, type AgentPort, type AgentTerminalResume, type Core } from '@ogden-agents/core';
import type { AgentId } from '@ogden-agents/shared';
import { agentHomeDir, checkAgentWiring, describedLike, type AgentWiring } from './agent-wiring.js';
import { antigravityWiring, type AntigravityPorts } from './antigravity-wiring.js';
import { codexWiring } from './codex-wiring.js';
import type { Logger } from './log.js';
import { agentEnvironment, agentKeysOf, SUBSCRIPTION_MAX_AGE_MS, withoutAgentKeys } from './start-env.js';
import type { StartOptions } from './start-types.js';
import { testApiKeyCheck, testHooksLogFields, type TestHooks } from './test-hooks.js';

/**
 * The Claude Agent ACP adapter's entry script, for a server started without
 * `claudeAdapterPath` (`pnpm dev:chat` sets it). Without either, a dev
 * install's `node_modules` adapter is used, else the one Install put in the
 * data folder (story 9.3).
 */
export const CLAUDE_ACP_PATH_ENV = 'OGDEN_AGENTS_CLAUDE_ACP_PATH';

/** Wires every agent the server registers, and what a chat runs each with. */
export function wireAgents({ options, dataDir, log, hooks, core }: { options: StartOptions; dataDir: string; log: Logger; hooks: TestHooks; core: Core }) {
  // Install's source: the option, else (a test run only) a local fixture from the environment, which also ignores a dev install's adapter (story 9.7).
  const claudeInstallOption = options.claudeInstall ?? (hooks.claudeInstall === undefined ? undefined : { ...hooks.claudeInstall, devAdapter: false });
  // The adapter given, else a dev install's; else (read at each use) the one Install put in the data folder (story 9.3).
  const givenClaudeAdapter =
    options.claudeAdapterPath ??
    (process.env[CLAUDE_ACP_PATH_ENV] || undefined) ??
    (claudeInstallOption?.devAdapter === false ? undefined : resolveClaudeAgentAcp());
  const { devAdapter: _devAdapter, ...claudeInstall } = claudeInstallOption ?? {};
  // The API key check: the option, else (a test run only) one that accepts without the network (story 9.7).
  const verifyApiKey = options.verifyApiKey ?? hooks.apiKeyCheck;
  const hooksInUse = testHooksLogFields(hooks);
  if (hooksInUse !== undefined) log.info('test hooks in use', hooksInUse);
  const claudeAdapter = () => locateClaudeAdapter({ adapterPath: givenClaudeAdapter, dataDir, pins: claudeInstall.pins })?.path;
  const agent =
    options.agent ??
    createClaudeCodeAgent({
      adapterPath: claudeAdapter,
      ...(options.claudeExecutable === undefined ? {} : { claudeExecutable: options.claudeExecutable }),
      onDiagnostic: (message, fields) => log.info(`agent: ${message}`, fields),
    });
  // What Claude Code is (6.3); a chat port given in its place (tests) keeps its name and modes.
  const claudeDescriptor = options.agent === undefined ? CLAUDE_CODE_DESCRIPTOR : describedLike(CLAUDE_CODE_DESCRIPTOR, agent);
  // Antigravity (epic 6 entry 5), unless a test leaves it out; then any agent a test wires.
  const antigravity =
    options.antigravity === false
      ? []
      : [antigravityWiring({ dataDir, given: options.antigravity ?? testAntigravityPorts(dataDir, hooks, log), onDiagnostic: (message, fields) => log.info(`agent: ${message}`, fields) })];
  for (const wiring of antigravity) checkAgentWiring(wiring);
  // Codex (epic 12 entry 4): a shipped install registers it only once its own folder says so; a test gives ports.
  const codex =
    options.codex === false || (options.codex === undefined && !CODEX_SHIPPED && hooks.codexServer === undefined)
      ? []
      : [codexWiring({ dataDir, given: options.codex, serverScript: hooks.codexServer, onDiagnostic: (message, fields) => log.info(`agent: ${message}`, fields) })];
  for (const wiring of codex) checkAgentWiring(wiring);
  const extraAgents = [...antigravity, ...codex, ...(options.extraAgents ?? testTrustAgentWiring(hooks, log))];
  // Every registered agent's API key variables (6.3): each is kept out of every process but its own agent's chat.
  const envKeys = agentEnvKeys([claudeDescriptor, ...extraAgents.map((wiring) => wiring.descriptor)]);
  // The terminal's `claude`: the option's, else (a test run only) a stand-in from the environment (story 3.10).
  const extraAgentEnv = { ...(hooks.claudeCli === undefined ? {} : { CLAUDE_CODE_EXECUTABLE: hooks.claudeCli }), ...options.extraAgentEnv };
  const agentEnv = () => ({ ...agentEnvironment(), ...extraAgentEnv });
  const claudeSetup =
    options.agentSetup === undefined
      ? createClaudeCodeSetup({
          adapterPath: givenClaudeAdapter,
          dataDir,
          install: {
            // The npm that launched Ogden Agents (`npx ogden-agents`), read here before any child environment drops npm_* (story 9.3).
            launcherNpm: process.env.npm_execpath,
            ...claudeInstall,
            onCleanupError: (error) => log.warn('could not remove Claude Code install temp files', { code: (error as NodeJS.ErrnoException).code ?? 'unknown' }),
          },
          ...(options.claudeExecutable === undefined ? {} : { claudeExecutable: options.claudeExecutable }),
          // Sign-in and `auth status` never see an API key (story 9.2).
          env: () => withoutAgentKeys(agentEnv(), envKeys),
          ...(verifyApiKey === undefined ? {} : { apiKey: { verify: verifyApiKey } }),
          listAuthMethods: (env) => agent.listAuthMethods({ env }),
          ...(options.loadPty === undefined ? {} : { loadPty: options.loadPty }),
          ...(options.claudeCliBrowser === undefined ? {} : { cliBrowser: options.claudeCliBrowser }),
          // Step names, exit codes and load failures only: never the terminal's output, the URL or a code (AD-16).
          onDiagnostic: (message, fields) => log.info(`agent setup: ${message}`, fields),
        })
      : undefined;
  const secrets = options.secrets ?? (hooks.secretStore === 'memory' ? createMemorySecretStore() : createKeyringSecretStore());
  // Claude Code's setup (or the ports given in its place), then each extra agent's own (6.3).
  const setupPorts = [...(options.agentSetup ?? (claudeSetup === undefined ? [] : [claudeSetup])), ...extraAgents.flatMap((wiring) => (wiring.setup === undefined ? [] : [wiring.setup]))];
  const agentSetup = createAgentSetup(core.events, setupPorts, {
    secrets,
    // Who makes each agent, from its descriptor (epic 6, entry 6): the agent card names it.
    providerOf: (agentId) => [claudeDescriptor, ...extraAgents.map((wiring) => wiring.descriptor)].find((descriptor) => descriptor.agentId === agentId)?.provider,
    // A key in this server's own environment follows the same rule as a saved one (review F1).
    inheritedEnv: () => agentKeysOf({ ...process.env, ...extraAgentEnv }, envKeys),
    // Codes and plain reasons only: never a URL, a code or a key.
    onFailure: (agentId, step, error) =>
      log.warn('agent setup step failed', {
        agentId,
        step,
        code: error instanceof CoreError ? error.code : 'unexpected',
        ...(error instanceof CoreError ? { reason: error.message } : {}),
        // An install's step and npm's error code only (story 9.3): never npm's output.
        ...(error instanceof AgentSetupError ? error.details : {}),
      }),
  });
  const subscriptionMaxAgeMs = options.subscriptionMaxAgeMs ?? SUBSCRIPTION_MAX_AGE_MS;
  // The agents a chat can be started with (epic 6): Claude Code first, the default and the agent of
  // every session stored before agents could be chosen; then any a test registers (the fake second agent).
  // A later agent is one more entry here (the wiring slot, 6.3).
  const wirings: AgentWiring[] = [{ descriptor: claudeDescriptor, agent, setup: claudeSetup }, ...extraAgents];
  /**
   * Each agent's home variable (6.3), for an agent whose descriptor has one:
   * its own folder in the data folder (made here, owner-only), so its
   * settings, sessions and logs never land in the user's real profile.
   */
  const homeEnvs = new Map<AgentId, Record<string, string>>();
  for (const { descriptor } of wirings) {
    if (descriptor.homeEnv === undefined) continue;
    const home = agentHomeDir(dataDir, descriptor.agentId);
    mkdirSync(home, { recursive: true, mode: 0o700 });
    // Owner-only even when it was there already (mode applies only to a folder made now).
    if (process.platform !== 'win32') chmodSync(home, 0o700);
    homeEnvs.set(descriptor.agentId, { [descriptor.homeEnv]: home });
  }
  const homeEnvOf = (agentId: AgentId): Record<string, string> => homeEnvs.get(agentId) ?? {};
  /**
   * Each agent's chat environment (epic 6; AD-16 note): its own API key
   * (saved, else from this server's environment) joins only while its
   * subscription is known to be signed out (story 9.2), and no other agent's
   * key reaches it. Every case variant of a key's name is removed first, so
   * Windows never sees two.
   */
  const chatEnv = (agentId: AgentId) => ({ ...withoutAgentKeys(agentEnv(), envKeys), ...homeEnvOf(agentId), ...agentSetup.agentEnv(agentId) });
  /** The same, with the subscription state read again first when it is older than {@link SUBSCRIPTION_MAX_AGE_MS} (review F4). */
  const freshChatEnv = async (agentId: AgentId, env: Readonly<Record<string, string>>) => {
    await agentSetup.refreshIfStale(agentId, subscriptionMaxAgeMs);
    return { ...withoutAgentKeys(env, envKeys), ...homeEnvOf(agentId), ...agentSetup.agentEnv(agentId) };
  };
  /** The agent's terminal resume with {@link freshChatEnv} applied to each environment. */
  const withChatEnv = (agentId: AgentId, resume: AgentTerminalResume): AgentTerminalResume => {
    const transcript = resume.transcript?.bind(resume);
    return {
      command: async (id, env, options) => resume.command(id, await freshChatEnv(agentId, env), options),
      locate: async (env) => resume.locate(await freshChatEnv(agentId, env)),
      ...(transcript === undefined ? {} : { transcript: async (input) => transcript({ ...input, env: await freshChatEnv(agentId, input.env) }) }),
    };
  };
  /** `agent` as a chat runs it: every start, and its terminal, with its own environment rules (stories 3.1, 3.2, 9.2). */
  const forChat = (agentId: AgentId, agent: AgentPort): AgentPort => ({
    get displayName() {
      return agent.displayName;
    },
    get permissionModes() {
      return agent.permissionModes;
    },
    ...(agent.modeFixedAtStart === true ? { modeFixedAtStart: true } : {}),
    startSession: async (input) => agent.startSession({ ...input, env: await freshChatEnv(agentId, input.env) }),
    reopenSession: async (input) => agent.reopenSession({ ...input, env: await freshChatEnv(agentId, input.env) }),
    listAuthMethods: (input) => agent.listAuthMethods(input),
    skillInvocation: (skill, idea) => agent.skillInvocation(skill, idea),
    // The terminal runs, and its transcript is read, with the chat's environment rules, the API key's included (stories 3.1, 3.2).
    ...(agent.terminalResume === undefined ? {} : { terminalResume: withChatEnv(agentId, agent.terminalResume) }),
  });
  /** Claude Code as a chat runs it: the default agent, and the one Plan and the document cards fall back to (stories 4.1, 4.7). */
  const chatAgent = forChat(CLAUDE_CODE_AGENT_ID, agent);
  return { claudeSetup, secrets, agentSetup, subscriptionMaxAgeMs, wirings, chatEnv, forChat, chatAgent };
}

/**
 * Antigravity's ports on the test hooks (epic 6 entries 8 and 10), or
 * `undefined` (the shipped ports) when the server hook is not in use. Its
 * chat runs the hook's server script under this Node in place of the pinned
 * server. With the install hook too, its setup is the shipped one on the
 * hook's pins (a local fixture archive, hash-checked), its installed server
 * is that script, and a chat runs only once Install put a copy matching
 * those pins in the data folder; without it, the setup port stays the
 * shipped one.
 */
function testAntigravityPorts(dataDir: string, hooks: TestHooks, log: Logger): AntigravityPorts | undefined {
  const script = hooks.antigravityServer;
  if (script === undefined) return undefined;
  const fake = { command: process.execPath, args: [script, '--uid='] };
  const onDiagnostic = (message: string, fields?: Record<string, unknown>) => log.info(`agent: ${message}`, fields);
  const pins = hooks.antigravityInstall?.pins;
  if (pins === undefined) return { agent: createAntigravityAgent({ dataDir, server: () => fake, onDiagnostic }) };
  const verify = testApiKeyCheck(process.env, dataDir);
  return {
    agent: createAntigravityAgent({ dataDir, server: () => (pinnedServer(dataDir, currentPlatform(), pins) === undefined ? undefined : fake), onDiagnostic }),
    setup: createAntigravitySetup({
      dataDir,
      pins,
      homeDir: agentHomeDir(dataDir, ANTIGRAVITY_DESCRIPTOR.agentId),
      // Install, sign-in and sign-out never see an API key (AD-16), as shipped.
      env: () => withoutAgentKeys(agentEnvironment()),
      serverCommand: () => fake,
      ...(verify === undefined ? {} : { apiKey: { verify } }),
      onDiagnostic: (message, fields) => onDiagnostic(`setup: ${message}`, fields),
    }),
  };
}

/** The trust-needing test agent's id and product name (the tests' second agent, `tests/support.ts`). */
const TRUST_AGENT = { agentId: 'fake-agent', displayName: 'Fake Agent' } as const;

/**
 * The test agent from {@link TestHooks.trustAgent} (epic 6 entry 10): the
 * fake ACP agent registered as "Fake Agent", Ask only, with nothing to set
 * up, whose descriptor says it needs a trusted project, so core refuses its
 * chats until the project is trusted. None when the hook is not in use.
 */
function testTrustAgentWiring(hooks: TestHooks, log: Logger): AgentWiring[] {
  const script = hooks.trustAgent;
  if (script === undefined) return [];
  const base = createClaudeCodeAgent({ adapterPath: script, claudeExecutable: null, onDiagnostic: (message, fields) => log.info(`agent: ${message}`, fields) });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: TRUST_AGENT.agentId } });
  return [
    {
      descriptor: {
        ...TRUST_AGENT,
        provider: 'Test',
        install: { kind: 'npm', package: '@fake/agent', version: '1.0.0' },
        signInMethods: [{ id: 'fake-login', kind: 'subscription', label: 'Sign in with your account' }],
        permissionModes: { ask: 'default' },
        needsProjectTrust: true,
        // The files it would run from the project: the trust is bound to them too (epic 12, 12.3).
        projectFiles: ['.claude/settings.json', '.mcp.json'],
        skillsFolder: '.fake/skills',
      },
      agent: {
        displayName: TRUST_AGENT.displayName,
        permissionModes: ['ask'],
        skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
        startSession: (input) => base.startSession(named(input)),
        reopenSession: (input) => base.reopenSession(named(input)),
        listAuthMethods: (input) => base.listAuthMethods(input),
      },
    },
  ];
}
