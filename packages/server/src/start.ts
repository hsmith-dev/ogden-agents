import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import { createAcpBuildRunner, createMemoryManager, ANTIGRAVITY_AGENT_ID, CLAUDE_CODE_AGENT_ID, CODEX_AGENT_ID, CODEX_SHIPPED, GROK_AGENT_ID, GROK_SHIPPED, LOCAL_AGENT_ID, LOCAL_SHIPPED, createMemoryAppShortcut, createOsAppShortcut, createPtyTerminalPort, createUvToolchain, createDevToolsAdapter, projectFilesFingerprint } from '@ogden-agents/adapters';
import {
  agentConfigFolders,
  agentProjectFiles,
  createAgentRegistry,
  createBuildableTickets,
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
  type AgentDescriptor,
  type AgentPort,
  type Core,
} from '@ogden-agents/core';
import { channelOf, compareVersions, MAX_TERMINAL_INPUT_BYTES, RUN_REASON_INTERRUPTED, SERVER_STREAM, type AgentId, type LocalEndpointId, type Session } from '@ogden-agents/shared';
import { WebSocketServer } from 'ws';
import { checkAgentWiring } from './agent-wiring.js';
import { createApp, type ServerControl } from './app.js';
import { supportsUnattendedBuild } from './build-agent-sandbox.js';
import { SHIPPED_BMAD_PIECES } from './bmad-pieces.js';
import { SHIPPED_ORCHESTRATION } from './orchestration-routes.js';
import { chooseWebSocketProtocol, createLaunchCodes, createTabTokens, retireLegacyAuthKey } from './auth.js';
import { createGate, launchUrl as launchUrlFor } from './gate.js';
import { acquireInstanceLock, type InstanceLock } from './instance-lock.js';
import { createLauncherToken, type LauncherToken } from './launcher-token.js';
import { logInternalError } from './internal-error-log.js';
import { createLogger, createRotatingFileWriter, LOG_DIR, teeWriters, type Logger } from './log.js';
import { removePortFile, writePortFile } from './port-file.js';
import { createTerminalAvailability } from './terminal-availability.js';
import { resolveTestHooks, type TestHooks } from './test-hooks.js';
import { VERSION } from './version.js';
import { wireAgents } from './start-agents.js';
import { createPanesWiring } from './start-panes.js';
import { uvEnvironment } from './start-env.js';
import { broadcast, closeServer, HOST, listen, repointAppShortcut } from './start-io.js';
import { createBuildsWiring, createServerVcs } from './start-builds.js';
import { createNotificationsWiring } from './start-notifications.js';
import { bmadSetupFailureLogger, uvPycacheDir, createBmadSourceAndCatalog, createDocumentCards, createPlanAndBoard, stopBmadWork, withAgentSkillFolders, type BmadWiring } from './start-planning.js';
import type { PortFile, RunningServer, StartOptions, StopReason } from './start-types.js';
import { openUrl } from './open-url.js';
import { shellModeOf } from './shell-mode.js';
import { installMethodOf, wireUpdateCheck } from './update-check.js';
import { createBusyRule } from './update-notice/busy-rule.js';
import { createDesktopUpdate } from './update-notice/desktop-update.js';

// Moved out in story 3.9; still exported from here for the callers that import them from `start.ts`.
export { AGENT_ENV_KEYS, agentEnvironment, agentKeysOf, CHECK_IN_MS_ENV, checkInDelayFromEnv, SECRET_STORE_ENV, SUBSCRIPTION_MAX_AGE_MS, testSecretStore, uvEnvironment, withoutAgentKeys } from './start-env.js';
export type { PortFile, RunningServer, StartOptions, StopReason } from './start-types.js';
// Moved out in entry 4.12; still exported from here.
export { TICKETS_SCRIPT, uvWorkDir } from './start-planning.js';

export { HOST } from './start-io.js';
// Moved out in story 6.9; still exported from here.
export { CLAUDE_ACP_PATH_ENV } from './start-agents.js';

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


/** How long a stopping server waits for a killed install to remove its temp folder. */
const INSTALL_STOP_MS = 10_000;

/** Session states that keep the server from restarting (AD-4, AD-20). */
const BUSY_STATES = new Set(['working', 'waiting']);

/**
 * Work that stopping the server would cut off: sessions across every workspace that are `working` or `waiting`,
 * and each build run still running whose session is not (the tests' re-run and the end checks have no agent
 * working, story 5.8 review). Queued runs are not counted: they start again with the server. One rule for Quit
 * and "Restart to update".
 */
export function countBusySessions(core: Core): number {
  let busy = 0;
  const counted = new Set<string>();
  for (const workspace of core.entities.listWorkspaces()) {
    for (const session of core.entities.listSessions(workspace.id)) {
      if (BUSY_STATES.has(session.state)) {
        busy++;
        counted.add(session.id);
      }
    }
  }
  for (const run of core.entities.listRunningRuns()) if (!counted.has(run.sessionId)) busy++;
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

/** The agents' descriptors, set once they are wired. */
interface DescriptorsRef {
  current: readonly AgentDescriptor[];
}

/** Whether `agentId` is one this server registers (epic 6, entry 6): Claude Code, Antigravity unless left out (entry 5), then any extra agent a test wires. */
const registeredAgent =
  (options: Pick<StartOptions, 'extraAgents' | 'antigravity' | 'codex' | 'grok' | 'local'>, hooks: Pick<TestHooks, 'codexServer' | 'codexInstall' | 'grokServer' | 'grokInstall' | 'localServer' | 'localEndpoint'>) =>
  (agentId: string): boolean =>
    agentId === CLAUDE_CODE_AGENT_ID ||
    (options.antigravity !== false && agentId === ANTIGRAVITY_AGENT_ID) ||
    (options.codex !== undefined && options.codex !== false && agentId === CODEX_AGENT_ID) ||
    (options.codex === undefined && (CODEX_SHIPPED || hooks.codexServer !== undefined || hooks.codexInstall !== undefined) && agentId === CODEX_AGENT_ID) ||
    (options.grok !== undefined && options.grok !== false && agentId === GROK_AGENT_ID) ||
    (options.grok === undefined && (GROK_SHIPPED || hooks.grokServer !== undefined || hooks.grokInstall !== undefined) && agentId === GROK_AGENT_ID) ||
    (agentId === LOCAL_AGENT_ID && (options.local === undefined ? LOCAL_SHIPPED || hooks.localServer !== undefined || hooks.localEndpoint !== undefined : options.local !== false)) ||
    (options.extraAgents ?? []).some((wiring) => wiring.descriptor.agentId === agentId);

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
  // The registered agents' descriptors, set once they are wired (core is opened first): their own config folders
  // join the protected paths, and the project files they run bind the project trust (epic 12, 12.3).
  const descriptors: DescriptorsRef = { current: [] };
  // Every environment hook, on a test run only; one the options already decide is not read (story 10.8).
  const hooks = resolveTestHooks(process.env, dataDir, { ...options, ownsCore });
  // What this install ships, plus a test's own (story 10.2): the option, and the environment hook.
  const availableBmadPieces = [...new Set([...(options.shippedBmadPieces ?? SHIPPED_BMAD_PIECES), ...(options.availableBmadPieces ?? []), ...hooks.bmadAvailable])];
  // The pinned BMad Method source, the catalog and setup's script runner holder (`start-planning.ts`).
  const bmadWiring = createBmadSourceAndCatalog(options, dataDir, log, hooks.bmadSource);
  const { bmadCatalog } = bmadWiring;
  const core =
    options.core ??
    openCore(dataDir, {
      // The version, so an upgrade is backed up and a newer database refused (story 13.6).
      appVersion: VERSION,
      availableBmadPieces,
      // Whether Orchestration (epic 15) can be turned on: not until its tracer ships, or a test says so.
      orchestrationAvailable: options.orchestrationAvailable ?? SHIPPED_ORCHESTRATION,
      bmadCatalog,
      onBmadSetupFailure: bmadSetupFailureLogger(log),
      onListenerError: (error) => log.error('event subscriber failed', { reason: String(error) }),
      // The request is declined all the same; the reason names no command.
      onPermissionError: (error) => log.warn('a permission request was declined after a failure', { reason: String(error) }),
      // A project's default agent (epic 6, entry 6) is one this server registers: Claude Code and any extra agent.
      isAgentRegistered: registeredAgent(options, hooks),
      // Generic developer CLI tools (CAP-25): the real adapter, or a test's own.
      devToolsPort: options.devToolsPort ?? createDevToolsAdapter(),
      agentConfigFolders: () => agentConfigFolders(descriptors.current),
      agentProjectFiles: () => agentProjectFiles(descriptors.current),
      projectFilesFingerprint,
    });
  try {
    return await listenAndAnnounce({ options, dataDir, log, core, ownsCore, lock, hooks, bmadWiring, descriptors });
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
  descriptors,
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
  /** Filled with the registered agents' descriptors once they are wired. */
  descriptors: DescriptorsRef;
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
  // Every agent is wired before the stored sessions are settled, as before story 6.9's split: a wiring error leaves the database untouched.
  const { endpointApi, localModelPort, claudeSetup, secrets, remoteMachines, agentSetup, subscriptionMaxAgeMs, wirings, chatEnv, forChat, chatAgent } = wireAgents({ options, dataDir, log, hooks, core });
  const { localEndpoints, localModels } = endpointApi;
  descriptors.current = wirings.map((wiring) => wiring.descriptor);
  // Agents from before this start are gone with their processes (AD-3): their sessions can be resumed, not left working.
  const settled = core.entities.settleInterruptedSessions(RESTARTED_REASON);
  if (settled.length > 0) log.info('sessions left working by a stopped server are idle and resumable', { sessions: settled.length });
  // Their terminals are gone too (story 3.1 review F3): those chats drive again.
  const released = core.entities.releaseTerminalDrivers();
  if (released.length > 0) log.info('sessions a stopped server left in the terminal are back in the chat', { sessions: released.length });
  // Unattended runs are not resumed (AD-3 note): a run left running by a stopped server is blocked, its worktree kept (story 5.2).
  const interrupted = core.entities.settleInterruptedRuns(RUN_REASON_INTERRUPTED);
  if (interrupted.length > 0) log.info('runs left running by a stopped server are blocked', { runs: interrupted.length });
  // No permission mode but Ask outlives the run it was chosen in (cause `restart`).
  const reset = core.entities.resetPermissionModes();
  if (reset.length > 0) log.info('chats in Auto or Skip all are back in Ask after the restart', { sessions: reset.length });
  // Chats from before chat names get their automatic name from their first message (backlog story 12).
  const named = core.entities.backfillAutoTitles();
  if (named.length > 0) log.info('older chats were named from their first message', { sessions: named.length });
  // One instance for the chat that asks and the routes that answer: core's (story 2.6).
  const permissions = core.permissions;
  const configuredCheckIn = options.checkInDelayMs ?? hooks.checkInMs;
  const checkInDelayMs = configuredCheckIn === undefined ? undefined : clampCheckInDelay(configuredCheckIn);
  const unwrapped = new Map(wirings.map(({ descriptor, agent: port }) => [descriptor.agentId, port]));
  const agents = createAgentRegistry(
    wirings.map(({ descriptor, agent: port }) => ({ descriptor, agent: descriptor.agentId === CLAUDE_CODE_AGENT_ID ? chatAgent : forChat(descriptor.agentId, port) })),
    { defaultAgentId: CLAUDE_CODE_AGENT_ID, legacyAgentId: CLAUDE_CODE_AGENT_ID },
  );
  /** A session's agent id: its own, else (stored before agents could be chosen) Claude Code's. */
  const agentIdOf = (session: Session): AgentId => session.agentId ?? agents.legacyAgentId;
  /** A session's agent as a chat runs it (epic 6 entry 8: a planning session's first message is in its own syntax). */
  const agentOf = (session: Session): AgentPort | undefined => agents.get(agentIdOf(session));
  // One terminal port for the chat and the toggle's availability check (story 3.7): they agree on node-pty.
  const terminal = createPtyTerminalPort(options.loadPty);
  // Terminal panes (epic 16): in memory, Developer mode only, stopped with the server.
  const panes = createPanesWiring({ options, hooks, core, terminal, dataDir, onError: (error) => log.warn('a terminal pane listener failed', { error: error instanceof Error ? error.name : 'unknown' }), onSweep: (result) => log.info('terminal panes left running by a hard stop were cleaned up', result) });
  // Document cards (story 4.7, `start-planning.ts`).
  const planningDocuments = createDocumentCards({ core, catalog: bmadCatalog, agent: chatAgent, agentOf, log });
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
    // The ACP adapters never see trust (6.4): it is checked here, before a chat is created.
    // With the files an agent runs (`.claude/settings.json`, `.mcp.json`, from its descriptor), since epic 12 (12.3).
    projectTrusted: (workspaceId) => core.bmadScriptTrust.trustedForAgents(workspaceId),
    terminal,
    // The chat follows the log (a mode changed by Developer mode reaches its agent) and gates Skip all on Developer mode.
    events: core.events,
    installSettings: core.installSettings,
    // Each agent's install-wide default model and last model list (story 11).
    agentModels: core.agentModels,
    // The event carries the plain reason; the log also gets the details (never the environment).
    onAgentError: (sessionId, error) => log.warn('agent failed', { sessionId, code: error.code, reason: error.message, ...error.details }),
    onInternalError: (sessionId, error) => logInternalError(log, sessionId, error),
    onToolCallCompleted: (sessionId, toolCallId, diffs) => planningDocuments.toolCallCompleted(sessionId, toolCallId, diffs),
    // Unattended build sessions (story 5.2): their worktree, sandbox and permission policy, registered by the builds use-cases.
    buildSessions: core.buildSessions,
    ...(checkInDelayMs === undefined ? {} : { checkInDelayMs }),
  });
  // Plan and Board (story 4.1, `start-planning.ts`): planning sessions, the script runner, the tickets and their watch.
  // One git for builds and for Save the lessons (epic 7).
  const vcs = createServerVcs(options, dataDir);
  const { planning, scriptRunner, bmadSource, board, retrospectives, ticketWatcher, ticketStore, boardTickets } = createPlanAndBoard({
    vcs,
    options,
    core,
    dataDir,
    log,
    bmadCatalog,
    bmadSourcePort,
    setupRunner,
    chat,
    agent: chatAgent,
    agentOf,
    uvToolchain,
    uvChildEnv,
  });
  // Inside the desktop app (story 13.11) there is no shortcut to offer: the app is the shortcut.
  const shell = options.shell === undefined ? shellModeOf() : options.shell;
  // Unattended builds (story 5.2, `start-builds.ts`): git, the sandbox check and the build runner.
  const builds = createBuildsWiring({ options, core, dataDir, log, chat, tickets: ticketStore, runAwareTickets: boardTickets, source: bmadSource, hooks, vcs, registeredAgents: (agentId) => agents.get(agentId) !== undefined, unattendedAgents: (agentId) => supportsUnattendedBuild(unwrapped.get(agentId)), describeAgent: (agentId) => agents.describe(agentId), attendedOnlyReason: (agentId) => unwrapped.get(agentId)?.attendedOnlyReason });
  // Worktrees no run needs any more (a removal that failed, a start cut off) go before builds are served (story 5.5).
  await builds.sweep();
  // Queued runs a stopped server left start where the limits allow (story 5.8).
  void builds.dispatchQueued().catch((error: unknown) => log.warn('starting queued builds failed', { reason: String(error) }));
  // Notifications for builds (story 11.4, `start-notifications.ts`): webhooks whose URLs live in the keychain.
  const notifications = createNotificationsWiring({ options, core, log, secrets, ticketStore, hooks });
  const appShortcut =
    shell === 'desktop'
      ? undefined
      : (options.appShortcut ??
    (options.launcherEntry === undefined
      ? createMemoryAppShortcut({ platform: process.platform })
      : createOsAppShortcut({ platform: process.platform, launcherEntry: options.launcherEntry, nodePath: process.execPath, stateDir: dataDir })));
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
    // Welcome's agent choice (epic 6, entry 6) names an agent this server registers.
    isAgentRegistered: registeredAgent(options, hooks),
    // Skip all as the default for new projects needs Developer mode (default permission mode).
    developerMode: core.installSettings.developerMode,
    onError: (code) => log.warn('new project defaults unusable', { code }),
  });
  // The "newer version" notice (story 13.7): checks once after the server is up, never on the start path.
  // Inside the desktop app (shell mode) the npm source never runs: the app finds updates through its own channel.
  const updates = wireUpdateCheck(shell === 'desktop' ? false : options.updates, { dataDir, version, installMethod: installMethodOf(options.launcherEntry), events: core.events, log });
  // The desktop app's update (story 13.3): only when the app started this server. One busy rule decides when a restart may go ahead.
  const busyRule = createBusyRule(() => countBusySessions(core));
  const desktopUpdate =
    shell === 'desktop'
      ? createDesktopUpdate({ dataDir, version, isNewer: (a, b) => (compareVersions(a, b) ?? 0) > 0, defaultChannel: channelOf(version) === 'preview' ? 'next' : 'stable', busy: busyRule, events: core.events, log })
      : undefined;
  // Orchestration (epic 15) over the chat. The manager is a test's stub when one is given (test hooks keep the memory fake); else each
  // project's own, read from its roster: a model on one of its endpoints, called through the endpoints' confirmation rule (15.4).
  const managerTests = () => ({ result: (endpointId: string, model: string) => localModels.managerTestResult(endpointId as LocalEndpointId, model), all: () => localModels.managerTestResults() });
  const managers = core.createManagerSource({ endpoints: () => localEndpoints, port: localModelPort, tests: managerTests });
  // The team roster (15.5): who takes each role, over the chat's agents, the endpoints, the manager tests and the new project defaults.
  const team = core.createTeam({ chat, endpoints: () => localEndpoints, tests: managerTests, defaults: newProjectDefaults });
  // The install's mode default and run limits (15.8), beside the defaults for new projects; a new run takes the limits as they are then.
  const orchestrationDefaults = core.createOrchestrationDefaults({ defaults: newProjectDefaults });
  const orchestrationRuns = core.createOrchestration({
    chat,
    manager: options.manager ?? (hooks.manager === 'memory' ? createMemoryManager() : undefined),
    managers,
    team,
    limits: () => orchestrationDefaults.get().limits,
    // The board's tickets ready to build now (15.11): a read only list for the manager's proposals. Nothing here can start a build.
    buildable: createBuildableTickets({ bmad: core.bmad, board, entities: core.entities }),
    // The agent builds run on, so a build step is stored under it and its reviewer is another agent where one is ready.
    builder: (options.buildRunner ?? createAcpBuildRunner()).agent,
  });
  // A run that was going when the last server stopped is picked up from its rows and events: it re-arms, settles what finished, asks for a decision
  // that was owed and never sends an instruction twice (15.9). The stored sessions were settled above, so a worker cut off by the restart reads so.
  void orchestrationRuns.resume().then(
    (picked) => {
      if (picked > 0) log.info('orchestration runs picked up after the start', { runs: picked });
    },
    (error: unknown) => log.warn('orchestration runs could not be picked up', { reason: String(error) }),
  );
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
    orchestration: core.orchestration,
    orchestrationRuns,
    orchestrationDefaults,
    team,
    // The test-only BMad probe route (story 10.1): a test run on a temp data folder, with its own variable set.
    bmadProbe: hooks.bmadProbe,
    bmadDetection: core.bmadDetection,
    bmadScriptTrust: core.bmadScriptTrust,
    planning,
    board,
    retrospectives,
    builds,
    buildSettings: core.buildSettings,
    devTools: core.devTools,
    notifications,
    remoteMachines,
    ...endpointApi,
    bmadSource,
    // Setup also places the skills in each other agent's folder the project uses (epic 6 entry 8).
    bmadSetup: withAgentSkillFolders(core.bmadSetup, { core, agents }),
    agentSetup,
    agentLinkedCommands: core.agentLinkedCommands,
    onboarding,
    newProjectDefaults,
    installSettings: core.installSettings,
    updates,
    ...(desktopUpdate === undefined ? {} : { desktopUpdate }),
    shell,
    agentDefaults: { models: core.agentModels, isAgentRegistered: (agentId) => agents.get(agentId) !== undefined },
    appShortcut,
    panes,
    terminalsSettings: core.terminalsSettings,
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
    builds.close();
    notifications.close();
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
        updates.close();
        claudeSetup?.close();
        await agentSetup.dispose().catch((error: unknown) => log.warn('stopping sign-ins failed', { reason: String(error) }));
        await Promise.race([agentSetup.settled(), new Promise((resolve) => setTimeout(resolve, INSTALL_STOP_MS).unref())]);
      })
      // Every terminal pane and what it started stops with the server (AD-3).
      .finally(() => panes.dispose())
      .finally(() => chat.close().catch((error: unknown) => log.warn('stopping agents failed', { reason: String(error) })))
      // An outcome being worked out finishes (bounded by its own reads), then the builds stop following the log.
      .finally(async () => {
        await builds.settled().catch(() => undefined);
        builds.close();
        notifications.close();
      })
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
  if (appShortcut !== undefined) void repointAppShortcut(appShortcut, log);
  void updates.runOnStart();

  if (options.open === true && launchUrl !== undefined) {
    try {
      await openUrl(launchUrl);
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
