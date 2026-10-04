import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import {
  CLAUDE_CODE_AGENT_ID,
  CLAUDE_CODE_DESCRIPTOR,
  createClaudeCodeAgent,
  createClaudeCodeSetup,
  createKeyringSecretStore,
  createMemoryAppShortcut,
  createMemorySecretStore,
  createOsAppShortcut,
  createPtyTerminalPort,
  createUvToolchain,
  errorCode,
  locateClaudeAdapter,
  resolveClaudeAgentAcp,
  type UvScriptRunner,
} from '@ogden-agents/adapters';
import {
  agentEnvKeys,
  AgentSetupError,
  CoreError,
  createAgentSetup,
  createAgentRegistry,
  createChat,
  createDataDir,
  createNewProjectDefaults,
  createOnboarding,
  clampCheckInDelay,
  RESTARTED_REASON,
  createToolchain,
  ensureDataDir,
  openCore,
  PORT_FILE,
  unregisteredAgent,
  type AgentPort,
  type AgentTerminalResume,
  type Core,
} from '@ogden-agents/core';
import { MAX_TERMINAL_INPUT_BYTES, SERVER_STREAM, ServerMessage, type AgentId, type Session } from '@ogden-agents/shared';
import openBrowser from 'open';
import { WebSocketServer } from 'ws';
import { agentHomeDir, checkAgentWiring, describedLike, type AgentWiring } from './agent-wiring.js';
import { createApp, type ServerControl } from './app.js';
import { SHIPPED_BMAD_PIECES } from './bmad-pieces.js';
import { chooseWebSocketProtocol, createLaunchCodes, createTabTokens, retireLegacyAuthKey } from './auth.js';
import { createGate, launchUrl as launchUrlFor } from './gate.js';
import { acquireInstanceLock, type InstanceLock } from './instance-lock.js';
import { createLauncherToken, type LauncherToken } from './launcher-token.js';
import { createLogger, createRotatingFileWriter, LOG_DIR, teeWriters, type Logger } from './log.js';
import { removePortFile, writePortFile } from './port-file.js';
import { createTerminalAvailability } from './terminal-availability.js';
import { resolveTestHooks, testHooksLogFields, type TestHooks } from './test-hooks.js';
import { VERSION } from './version.js';
import { agentEnvironment, agentKeysOf, SUBSCRIPTION_MAX_AGE_MS, uvEnvironment, withoutAgentKeys } from './start-env.js';
import { broadcast, closeServer, HOST, listen, repointAppShortcut } from './start-io.js';
import { bmadSetupFailureLogger, uvPycacheDir, createBmadSourceAndCatalog, createDocumentCards, createPlanAndBoard, stopBmadWork, type BmadWiring } from './start-planning.js';
import type { PortFile, RunningServer, StartOptions, StopReason } from './start-types.js';

// Moved out in story 3.9; still exported from here for the callers that import them from `start.ts`.
export { AGENT_ENV_KEYS, agentEnvironment, agentKeysOf, CHECK_IN_MS_ENV, checkInDelayFromEnv, SECRET_STORE_ENV, SUBSCRIPTION_MAX_AGE_MS, testSecretStore, uvEnvironment, withoutAgentKeys } from './start-env.js';
export type { PortFile, RunningServer, StartOptions, StopReason } from './start-types.js';
// Moved out in entry 4.12; still exported from here.
export { TICKETS_SCRIPT, uvWorkDir } from './start-planning.js';

export { HOST } from './start-io.js';
/** Fixed default so bookmarks usually keep working; falls back to the next free port. */
export const DEFAULT_PORT = 4317;
/** How many consecutive ports to try before giving up. */
export const PORT_ATTEMPTS = 20;

/**
 * Where the built UI is when no `webRoot` is given, in order:
 * - `./web` beside the root bundle (`dist/server.js` next to `dist/web/`, as packed);
 * - `packages/web/dist` in the workspace, resolved from `src/start.ts` or
 *   `packages/server/dist/server.js`.
 * The first that exists wins; if neither does, the workspace path is used and
 * `/` answers that the UI is not built.
 */
const WEB_ROOT_CANDIDATES = [
  fileURLToPath(new URL('./web', import.meta.url)),
  fileURLToPath(new URL('../../web/dist', import.meta.url)),
] as const;

function defaultWebRoot(): string {
  return WEB_ROOT_CANDIDATES.find((dir) => existsSync(dir)) ?? WEB_ROOT_CANDIDATES[1];
}

/**
 * The Claude Agent ACP adapter's entry script, for a server started without
 * `claudeAdapterPath` (`pnpm dev:chat` sets it). Without either, a dev
 * install's `node_modules` adapter is used, else the one Install put in the
 * data folder (story 9.3).
 */
export const CLAUDE_ACP_PATH_ENV = 'OGDEN_AGENTS_CLAUDE_ACP_PATH';

/** How long a stopping server waits for a killed install to remove its temp folder. */
const INSTALL_STOP_MS = 10_000;

/** Session states that keep the server from restarting (AD-4, AD-20). */
const BUSY_STATES = new Set(['working', 'waiting']);

/** Sessions across every workspace that are `working` or `waiting`. */
export function countBusySessions(core: Core): number {
  let busy = 0;
  for (const workspace of core.entities.listWorkspaces()) {
    for (const session of core.entities.listSessions(workspace.id)) if (BUSY_STATES.has(session.state)) busy++;
  }
  return busy;
}

/**
 * The largest WebSocket frame the server reads (story 3.1 review F1): the
 * terminal's largest input and some room. `/ws` client messages (subscribe,
 * page history, ping) are a few hundred bytes. A larger frame closes the
 * socket (1009) before it is buffered.
 */
export const MAX_WS_PAYLOAD_BYTES = MAX_TERMINAL_INPUT_BYTES + 1024;

/** How long a stop waits after answering Quit or restart, so the reply reaches the client first. */
const STOP_AFTER_REPLY_MS = 50;

/**
 * Starts the server on the data folder. Only one server runs per data folder:
 * if another live one holds it, this throws `ServerAlreadyRunningError`
 * before opening anything.
 */
export function start(options: StartOptions & ({ launch: true } | { open: true })): Promise<RunningServer & { launchUrl: string }>;
export function start(options?: StartOptions): Promise<RunningServer>;
export async function start(options: StartOptions = {}): Promise<RunningServer> {
  // A wiring bug is refused before anything is opened (6.3).
  for (const wiring of options.extraAgents ?? []) checkAgentWiring(wiring);
  const dataDir = options.dataDir === undefined ? ensureDataDir() : createDataDir(options.dataDir);
  const lock = acquireInstanceLock(dataDir);
  try {
    return await startLocked(options, dataDir, lock);
  } catch (error) {
    lock.release();
    throw error;
  }
}

async function startLocked(options: StartOptions, dataDir: string, lock: InstanceLock): Promise<RunningServer> {
  const log =
    options.log ??
    createLogger(
      teeWriters(
        (line) => process.stderr.write(line),
        createRotatingFileWriter({ dir: join(dataDir, LOG_DIR) }),
      ),
    );
  const ownsCore = options.core === undefined;
  // Every environment hook, on a test run only; one the options already decide is not read (story 10.8).
  const hooks = resolveTestHooks(process.env, dataDir, { ...options, ownsCore });
  // What this install ships, plus a test's own (story 10.2): the option, and the environment hook.
  const availableBmadPieces = [...new Set([...SHIPPED_BMAD_PIECES, ...(options.availableBmadPieces ?? []), ...hooks.bmadAvailable])];
  // The pinned BMad Method source, the catalog and setup's script runner holder (`start-planning.ts`).
  const bmadWiring = createBmadSourceAndCatalog(options, dataDir, log, hooks.bmadSource);
  const { bmadCatalog } = bmadWiring;
  const core =
    options.core ??
    openCore(dataDir, {
      availableBmadPieces,
      bmadCatalog,
      onBmadSetupFailure: bmadSetupFailureLogger(log),
      onListenerError: (error) => log.error('event subscriber failed', { reason: String(error) }),
      // The request is declined all the same; the reason names no command.
      onPermissionError: (error) => log.warn('a permission request was declined after a failure', { reason: String(error) }),
    });
  try {
    return await listenAndAnnounce({ options, dataDir, log, core, ownsCore, lock, hooks, bmadWiring });
  } catch (error) {
    if (ownsCore) core.close();
    throw error;
  }
}

async function listenAndAnnounce({
  options,
  dataDir,
  log,
  core,
  ownsCore,
  lock,
  hooks,
  bmadWiring,
}: {
  options: StartOptions;
  dataDir: string;
  log: Logger;
  core: Core;
  ownsCore: boolean;
  lock: InstanceLock;
  /** The environment's test hooks in use (`resolveTestHooks`). */
  hooks: TestHooks;
  /** The server's one pinned BMad Method source (story 4.14), the catalog over it (story 4.1) and setup's runner holder (story 4.3). */
  bmadWiring: BmadWiring;
}): Promise<RunningServer> {
  const { bmadCatalog, bmadSourcePort, setupRunner } = bmadWiring;
  const requested = options.port ?? DEFAULT_PORT;
  const now = options.now ?? Date.now;
  const codes = createLaunchCodes(now);
  const tabs = createTabTokens(now);
  retireLegacyAuthKey(dataDir);
  // The gate refuses everything until the port is known, and the handshake until the token exists.
  let boundPort: number | undefined;
  let launcherToken: LauncherToken | undefined;
  const version = VERSION;
  /** Set once the server is running; the routes only run after that. */
  let lifecycle: { issueLaunchUrl(origin?: string): string; stop(reason: 'quit' | 'restart'): void } | undefined;
  const control: ServerControl = {
    info: () => ({ version, pid: process.pid, port: boundPort ?? 0, busySessions: countBusySessions(core) }),
    issueLaunchUrl: (origin) => lifecycle!.issueLaunchUrl(origin),
    restartWhenIdle: () => {
      const busySessions = countBusySessions(core);
      if (busySessions > 0) {
        log.info('restart declined: sessions are busy', { busySessions });
        return { restarting: false, busySessions };
      }
      log.info('restarting for a newer version');
      lifecycle!.stop('restart');
      return { restarting: true, busySessions };
    },
    quit: (force) => {
      const busySessions = countBusySessions(core);
      if (busySessions > 0 && !force) {
        log.info('quit declined: sessions are busy and it was not confirmed', { busySessions });
        return { stopping: false, busySessions };
      }
      log.info('quit requested', { busySessions });
      lifecycle!.stop('quit');
      return { stopping: true, busySessions };
    },
  };
  const gate = createGate({
    port: () => boundPort,
    codes,
    tabs,
    launcherToken: { verify: (given) => launcherToken?.verify(given) ?? false },
    log,
  });
  // The one environment of every `uv` child, the version probe's and every script run's (story 4.2): an
  // allowlist, never this server's environment (AD-16), plus a test's own additions.
  // Python's bytecode cache lives in Ogden Agents' own folder, never a project's `__pycache__`, which it then
  // never reads either (story 4.13: the script trust hashes the project's scripts without it).
  const pycache = uvPycacheDir(dataDir);
  const uvChildEnv = () => ({ ...uvEnvironment(), PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: pycache, ...hooks.bmadSource?.uvEnv, ...options.extraUvEnv });
  // One uv adapter: the toolchain's status and install, and the uv BMad Method's scripts run with (story 4.1).
  const uvToolchain = createUvToolchain({
    dataDir,
    childEnv: uvChildEnv,
    onCleanupError: (error) => log.warn('could not remove uv install temp files', { reason: String(error) }),
  });
  const toolchain = createToolchain(core.events, options.toolchain ?? uvToolchain, {
    // The event carries the plain reason; the log also gets the target, URL and (on a mismatch) both hashes.
    onFailure: (error) => log.warn('uv install failed', { code: error.code, reason: error.message, ...error.details }),
  });
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
  const extraAgents = options.extraAgents ?? [];
  // Every registered agent's API key variables (6.3): each is kept out of every process but its own agent's chat.
  const envKeys = agentEnvKeys([claudeDescriptor, ...extraAgents.map((wiring) => wiring.descriptor)]);
  // Agents from before this start are gone with their processes (AD-3): their sessions can be resumed, not left working.
  const settled = core.entities.settleInterruptedSessions(RESTARTED_REASON);
  if (settled.length > 0) log.info('sessions left working by a stopped server are idle and resumable', { sessions: settled.length });
  // Their terminals are gone too (story 3.1 review F3): those chats drive again.
  const released = core.entities.releaseTerminalDrivers();
  if (released.length > 0) log.info('sessions a stopped server left in the terminal are back in the chat', { sessions: released.length });
  // No permission mode but Ask outlives the run it was chosen in (cause `restart`).
  const reset = core.entities.resetPermissionModes();
  if (reset.length > 0) log.info('chats in Auto or Skip all are back in Ask after the restart', { sessions: reset.length });
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
  // One instance for the chat that asks and the routes that answer: core's (story 2.6).
  const permissions = core.permissions;
  const configuredCheckIn = options.checkInDelayMs ?? hooks.checkInMs;
  const checkInDelayMs = configuredCheckIn === undefined ? undefined : clampCheckInDelay(configuredCheckIn);
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
    startSession: async (input) => agent.startSession({ ...input, env: await freshChatEnv(agentId, input.env) }),
    reopenSession: async (input) => agent.reopenSession({ ...input, env: await freshChatEnv(agentId, input.env) }),
    listAuthMethods: (input) => agent.listAuthMethods(input),
    skillInvocation: (skill, idea) => agent.skillInvocation(skill, idea),
    // The terminal runs, and its transcript is read, with the chat's environment rules, the API key's included (stories 3.1, 3.2).
    ...(agent.terminalResume === undefined ? {} : { terminalResume: withChatEnv(agentId, agent.terminalResume) }),
  });
  /** Claude Code as a chat runs it: the default agent, and the one Plan and the document cards use (stories 4.1, 4.7). */
  const chatAgent = forChat(CLAUDE_CODE_AGENT_ID, agent);
  const unwrapped = new Map(wirings.map(({ descriptor, agent: port }) => [descriptor.agentId, port]));
  const agents = createAgentRegistry(
    wirings.map(({ descriptor, agent: port }) => ({ descriptor, agent: descriptor.agentId === CLAUDE_CODE_AGENT_ID ? chatAgent : forChat(descriptor.agentId, port) })),
    { defaultAgentId: CLAUDE_CODE_AGENT_ID, legacyAgentId: CLAUDE_CODE_AGENT_ID },
  );
  /** A session's agent id: its own, else (stored before agents could be chosen) Claude Code's. */
  const agentIdOf = (session: Session): AgentId => session.agentId ?? agents.legacyAgentId;
  // One terminal port for the chat and the toggle's availability check (story 3.7): they agree on node-pty.
  const terminal = createPtyTerminalPort(options.loadPty);
  // Document cards (story 4.7, `start-planning.ts`).
  const planningDocuments = createDocumentCards({ core, catalog: bmadCatalog, agent: chatAgent, log });
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agents,
    permissions,
    agentEnv: chatEnv,
    // A new chat with an agent that isn't installed or signed in is refused (6.3); its status is read at most every 30 s.
    agentReadiness: (agentId) => agentSetup.readiness(agentId, subscriptionMaxAgeMs),
    // The per-project trust (story 4.2), as it stands now: trusted, and its scripts the ones the user allowed (4.13).
    // An agent that needs a trusted project is refused until then, and again once the scripts change.
    projectTrusted: (workspaceId) => core.bmadScriptTrust.scriptsUnchanged(workspaceId),
    terminal,
    // The chat follows the log (a mode changed by Developer mode reaches its agent) and gates Skip all on Developer mode.
    events: core.events,
    installSettings: core.installSettings,
    // The event carries the plain reason; the log also gets the details (never the environment).
    onAgentError: (sessionId, error) => log.warn('agent failed', { sessionId, code: error.code, reason: error.message, ...error.details }),
    onInternalError: (sessionId, error) => log.error('applying an agent event failed', { sessionId, reason: String(error) }),
    onToolCallCompleted: (sessionId, toolCallId, diffs) => planningDocuments.toolCallCompleted(sessionId, toolCallId, diffs),
    ...(checkInDelayMs === undefined ? {} : { checkInDelayMs }),
  });
  // Plan and Board (story 4.1, `start-planning.ts`): planning sessions, the script runner, the tickets and their watch.
  const { planning, scriptRunner, bmadSource, board, ticketWatcher } = createPlanAndBoard({
    options,
    core,
    dataDir,
    log,
    bmadCatalog,
    bmadSourcePort,
    setupRunner,
    chat,
    agent: chatAgent,
    uvToolchain,
    uvChildEnv,
  });
  const appShortcut =
    options.appShortcut ??
    (options.launcherEntry === undefined
      ? createMemoryAppShortcut({ platform: process.platform })
      : createOsAppShortcut({ platform: process.platform, launcherEntry: options.launcherEntry, nodePath: process.execPath, stateDir: dataDir }));
  // Whether Welcome is done (9.5): a data folder that already has projects counts it as done.
  const onboarding = createOnboarding({
    dataDir,
    hasProjects: () => core.entities.listWorkspaces().length > 0,
    onError: (code) => log.warn('onboarding record unusable', { code }),
  });
  // The app-wide default for new projects (10.4): Simple until the user changes it in Settings.
  const newProjectDefaults = createNewProjectDefaults({
    dataDir,
    bmad: core.bmad,
    onError: (code) => log.warn('new project defaults unusable', { code }),
  });
  const app = createApp({
    events: core.events,
    webRoot: options.webRoot ?? defaultWebRoot(),
    log,
    gate,
    control,
    toolchain,
    chat,
    // The session's unwrapped agent and `chatEnv`: core's checks, without reading sign-in again on every GET (story 3.7).
    terminalAvailability: createTerminalAvailability({
      agent: (session) => unwrapped.get(agentIdOf(session)) ?? unregisteredAgent(),
      terminal,
      env: (session) => chatEnv(agentIdOf(session)),
    }),
    permissions,
    bmad: core.bmad,
    // The test-only BMad probe route (story 10.1): a test run on a temp data folder, with its own variable set.
    bmadProbe: hooks.bmadProbe,
    bmadDetection: core.bmadDetection,
    bmadScriptTrust: core.bmadScriptTrust,
    planning,
    board,
    bmadSource,
    bmadSetup: core.bmadSetup,
    agentSetup,
    onboarding,
    newProjectDefaults,
    installSettings: core.installSettings,
    appShortcut,
    tabs,
  });

  // Saved API keys and, for an agent with one, its subscription state, before the first chat (story 9.2).
  await agentSetup.load();
  log.info('secrets store', { backend: secrets.backend });

  let bound: { server: ReturnType<typeof createAdaptorServer>; wss: WebSocketServer; port: number } | undefined;
  let lastTried = requested;

  for (let attempt = 0; attempt < PORT_ATTEMPTS && bound === undefined; attempt++) {
    const candidate = requested === 0 ? 0 : requested + attempt;
    if (candidate > 65535) break;
    lastTried = candidate;
    // Echo only `ogden.v1`, never the offer that carries the tab token (AD-15).
    // No frame over the terminal's largest input (story 3.1 review F1) is ever buffered, on any socket.
    const wss = new WebSocketServer({ noServer: true, handleProtocols: chooseWebSocketProtocol, maxPayload: MAX_WS_PAYLOAD_BYTES });
    const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } });
    try {
      const port = await listen(server, candidate);
      bound = { server, wss, port };
    } catch (error) {
      wss.close();
      // Windows answers EACCES for ports in a range the system reserved (for
      // example for Hyper-V), so that port is as unusable as a busy one.
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EADDRINUSE' && code !== 'EACCES') || requested === 0) throw error;
      log.info('port busy, trying the next one', { port: candidate, code });
    }
  }

  if (bound === undefined) {
    throw new Error(`No free port on ${HOST} in ${requested}-${lastTried}`);
  }

  const { server, wss, port } = bound;
  boundPort = port;
  const url = `http://${HOST}:${port}`;
  const portFile = join(dataDir, PORT_FILE);
  if (port !== requested && requested !== 0) {
    log.warn('requested port was busy', { requested, port });
  }
  log.info('server listening', { url, port, version, dataDir });

  const identity: PortFile = { port, pid: process.pid, version, startedAt: new Date().toISOString() };
  try {
    // The token before the port file: once a launcher can find the server, it can also reach it.
    launcherToken = createLauncherToken(dataDir);
    writePortFile(portFile, identity);
    core.events.append({ type: 'server.started', workspaceId: null, streamId: SERVER_STREAM, payload: { version } });
    ticketWatcher.start();
  } catch (error) {
    // As on stop: the runner's close kills any run a watch waits on.
    const watching = ticketWatcher.close();
    await scriptRunner.close().catch(() => {});
    await watching;
    // Nothing may stay listening on a server that failed to start.
    await closeServer(server, wss);
    removePortFile(portFile, identity);
    launcherToken?.remove();
    throw error;
  }

  const issueLaunchUrl = (origin: string = url) => {
    const launchUrl = launchUrlFor(origin, codes.issue());
    log.info('launch code issued');
    return launchUrl;
  };
  // Only when asked: a code nobody redeems is a live secret for nothing.
  const launchUrl = options.launch === true || options.open === true ? issueLaunchUrl() : undefined;

  let resolveStopped!: (reason: StopReason) => void;
  const stopped = new Promise<StopReason>((resolve) => (resolveStopped = resolve));
  let closing: Promise<void> | undefined;
  const shutdown = (reason: StopReason): Promise<void> => {
    closing ??= closeServer(server, wss)
      // The server owns agent processes (AD-3): none outlives it, a hidden sign-in terminal included.
      .finally(async () => {
        // Kills a running npm too; its temp folder goes once it has exited.
        claudeSetup?.close();
        await agentSetup.dispose().catch((error: unknown) => log.warn('stopping sign-ins failed', { reason: String(error) }));
        await Promise.race([agentSetup.settled(), new Promise((resolve) => setTimeout(resolve, INSTALL_STOP_MS).unref())]);
      })
      .finally(() => chat.close().catch((error: unknown) => log.warn('stopping agents failed', { reason: String(error) })))
      // Document detection, a setup in progress, the ticket watches and every BMad Method script (`start-planning.ts`).
      .finally(() => stopBmadWork({ planningDocuments, bmadSetup: core.bmadSetup, ticketWatcher, scriptRunner, log }))
      .finally(() => {
        try {
          removePortFile(portFile, identity);
          launcherToken?.remove();
        } finally {
          try {
            if (ownsCore) core.close();
          } finally {
            lock.release();
          }
        }
      })
      .finally(() => {
        log.info('server stopped', { reason });
        resolveStopped(reason);
      });
    return closing;
  };
  let stopRequested = false;
  lifecycle = {
    issueLaunchUrl,
    stop: (reason) => {
      if (stopRequested) return;
      stopRequested = true;
      // After the reply to Quit or restart has been written.
      setTimeout(() => {
        // A session may have started working since the launcher asked: a
        // restart never stops the server under a busy session (AD-20).
        if (reason === 'restart') {
          const busySessions = countBusySessions(core);
          if (busySessions > 0) {
            log.info('restart aborted: a session became busy', { busySessions });
            stopRequested = false;
            return;
          }
        }
        // Every open tab shows the stopped state instead of reconnecting.
        broadcast(wss, { type: 'server.stopping', reason }, log);
        setTimeout(() => {
          shutdown(reason).then(
            () => options.onStop?.(reason),
            (error: unknown) => {
              log.error('clean stop failed', { reason: String(error) });
              options.onStop?.(reason);
            },
          );
        }, STOP_AFTER_REPLY_MS);
      }, STOP_AFTER_REPLY_MS);
    },
  };

  // Off the start path: a shortcut already there follows this install's Node and launcher (story 2.4).
  void repointAppShortcut(appShortcut, log);

  if (options.open === true && launchUrl !== undefined) {
    try {
      await openBrowser(launchUrl);
    } catch (error) {
      log.warn('could not open a browser', { url, reason: String(error) });
    }
  }

  return {
    url,
    launchUrl,
    port,
    version,
    dataDir,
    core,
    tabs,
    issueLaunchUrl: () => issueLaunchUrl(),
    stopped,
    close: () => shutdown('close'),
  };
}
