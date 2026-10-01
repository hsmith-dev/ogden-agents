import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import {
  CLAUDE_CODE_AGENT_ID,
  createClaudeCodeAgent,
  createClaudeCodeSetup,
  createKeyringSecretStore,
  createMemoryAppShortcut,
  createMemorySecretStore,
  createOsAppShortcut,
  createPtyTerminalPort,
  createUvToolchain,
  locateClaudeAdapter,
  resolveClaudeAgentAcp,
} from '@ogden-agents/adapters';
import {
  AgentSetupError,
  CoreError,
  createAgentSetup,
  createChat,
  createDataDir,
  createOnboarding,
  clampCheckInDelay,
  RESTARTED_REASON,
  createToolchain,
  ensureDataDir,
  openCore,
  PORT_FILE,
  type AgentPort,
  type AgentTerminalResume,
  type AppShortcutPort,
  type Core,
} from '@ogden-agents/core';
import { MAX_TERMINAL_INPUT_BYTES, SERVER_STREAM, ServerMessage } from '@ogden-agents/shared';
import openBrowser from 'open';
import { WebSocketServer } from 'ws';
import { createApp, type ServerControl } from './app.js';
import { chooseWebSocketProtocol, createLaunchCodes, createTabTokens, retireLegacyAuthKey } from './auth.js';
import { tightenMode } from './file-mode.js';
import { createGate, launchUrl as launchUrlFor } from './gate.js';
import { acquireInstanceLock, type InstanceLock } from './instance-lock.js';
import { createLauncherToken, type LauncherToken } from './launcher-token.js';
import { createLogger, createRotatingFileWriter, LOG_DIR, teeWriters, type Logger } from './log.js';
import { shortcutErrorCode } from './shortcut-routes.js';
import { createTerminalAvailability } from './terminal-availability.js';
import { testApiKeyCheck, testClaudeCli, testClaudeInstall } from './test-hooks.js';
import { VERSION } from './version.js';
import { agentEnvironment, agentKeysOf, checkInDelayFromEnv, SUBSCRIPTION_MAX_AGE_MS, testSecretStore, withoutAgentKeys } from './start-env.js';
import type { PortFile, RunningServer, StartOptions, StopReason } from './start-types.js';

// Moved out in story 3.9; still exported from here for the callers that import them from `start.ts`.
export { AGENT_ENV_KEYS, agentEnvironment, agentKeysOf, CHECK_IN_MS_ENV, checkInDelayFromEnv, SECRET_STORE_ENV, SUBSCRIPTION_MAX_AGE_MS, testSecretStore, withoutAgentKeys } from './start-env.js';
export type { PortFile, RunningServer, StartOptions, StopReason } from './start-types.js';

/** The only interface the server ever binds (AD-15). */
export const HOST = '127.0.0.1';
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
  const core =
    options.core ??
    openCore(dataDir, {
      onListenerError: (error) => log.error('event subscriber failed', { reason: String(error) }),
      // The request is declined all the same; the reason names no command.
      onPermissionError: (error) => log.warn('a permission request was declined after a failure', { reason: String(error) }),
    });
  try {
    return await listenAndAnnounce({ options, dataDir, log, core, ownsCore, lock });
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
}: {
  options: StartOptions;
  dataDir: string;
  log: Logger;
  core: Core;
  ownsCore: boolean;
  lock: InstanceLock;
}): Promise<RunningServer> {
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
  const toolchain = createToolchain(core.events, options.toolchain ??
      createUvToolchain({
        dataDir,
        onCleanupError: (error) => log.warn('could not remove uv install temp files', { reason: String(error) }),
      }), {
    // The event carries the plain reason; the log also gets the target, URL and (on a mismatch) both hashes.
    onFailure: (error) => log.warn('uv install failed', { code: error.code, reason: error.message, ...error.details }),
  });
  // Install's source: the option, else (a test run only) a local fixture from the environment, which also ignores a dev install's adapter (story 9.7).
  const testInstall = options.claudeInstall === undefined ? testClaudeInstall(process.env, dataDir) : undefined;
  const claudeInstallOption = options.claudeInstall ?? (testInstall === undefined ? undefined : { ...testInstall, devAdapter: false });
  // The adapter given, else a dev install's; else (read at each use) the one Install put in the data folder (story 9.3).
  const givenClaudeAdapter =
    options.claudeAdapterPath ??
    (process.env[CLAUDE_ACP_PATH_ENV] || undefined) ??
    (claudeInstallOption?.devAdapter === false ? undefined : resolveClaudeAgentAcp());
  const { devAdapter: _devAdapter, ...claudeInstall } = claudeInstallOption ?? {};
  // The API key check: the option, else (a test run only) one that accepts without the network (story 9.7).
  const testVerify = options.verifyApiKey === undefined ? testApiKeyCheck(process.env, dataDir) : undefined;
  const verifyApiKey = options.verifyApiKey ?? testVerify;
  // The terminal's `claude`: the option's, else (a test run only) a stand-in from the environment (story 3.10).
  const testCli = options.extraAgentEnv?.CLAUDE_CODE_EXECUTABLE === undefined ? testClaudeCli(process.env, dataDir) : undefined;
  if (testInstall !== undefined || testVerify !== undefined || testCli !== undefined) {
    log.info('test hooks in use', { claudeInstall: testInstall !== undefined, apiKeyCheck: testVerify !== undefined, claudeCli: testCli !== undefined });
  }
  const claudeAdapter = () => locateClaudeAdapter({ adapterPath: givenClaudeAdapter, dataDir, pins: claudeInstall.pins })?.path;
  const agent =
    options.agent ??
    createClaudeCodeAgent({
      adapterPath: claudeAdapter,
      ...(options.claudeExecutable === undefined ? {} : { claudeExecutable: options.claudeExecutable }),
      onDiagnostic: (message, fields) => log.info(`agent: ${message}`, fields),
    });
  // Agents from before this start are gone with their processes (AD-3): their sessions can be resumed, not left working.
  const settled = core.entities.settleInterruptedSessions(RESTARTED_REASON);
  if (settled.length > 0) log.info('sessions left working by a stopped server are idle and resumable', { sessions: settled.length });
  // Their terminals are gone too (story 3.1 review F3): those chats drive again.
  const released = core.entities.releaseTerminalDrivers();
  if (released.length > 0) log.info('sessions a stopped server left in the terminal are back in the chat', { sessions: released.length });
  const extraAgentEnv = { ...(testCli === undefined ? {} : { CLAUDE_CODE_EXECUTABLE: testCli }), ...options.extraAgentEnv };
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
          env: () => withoutAgentKeys(agentEnv()),
          ...(verifyApiKey === undefined ? {} : { apiKey: { verify: verifyApiKey } }),
          listAuthMethods: (env) => agent.listAuthMethods({ env }),
          ...(options.loadPty === undefined ? {} : { loadPty: options.loadPty }),
          ...(options.claudeCliBrowser === undefined ? {} : { cliBrowser: options.claudeCliBrowser }),
          // Step names, exit codes and load failures only: never the terminal's output, the URL or a code (AD-16).
          onDiagnostic: (message, fields) => log.info(`agent setup: ${message}`, fields),
        })
      : undefined;
  const secrets = options.secrets ?? (testSecretStore(process.env, dataDir) === 'memory' ? createMemorySecretStore() : createKeyringSecretStore());
  const agentSetup = createAgentSetup(core.events, options.agentSetup ?? (claudeSetup === undefined ? [] : [claudeSetup]), {
    secrets,
    // A key in this server's own environment follows the same rule as a saved one (review F1).
    inheritedEnv: () => agentKeysOf({ ...process.env, ...extraAgentEnv }),
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
  const configuredCheckIn = options.checkInDelayMs ?? checkInDelayFromEnv();
  const checkInDelayMs = configuredCheckIn === undefined ? undefined : clampCheckInDelay(configuredCheckIn);
  /**
   * The chat runs Claude Code: its API key (saved, else from this server's
   * environment) joins only while its subscription is known to be signed out
   * (story 9.2). Every case variant of the key's name is removed first, so
   * Windows never sees two.
   */
  const chatEnv = () => ({ ...withoutAgentKeys(agentEnv()), ...agentSetup.agentEnv(CLAUDE_CODE_AGENT_ID) });
  /** The same, with the subscription state read again first when it is older than {@link SUBSCRIPTION_MAX_AGE_MS} (review F4). */
  const freshChatEnv = async (env: Readonly<Record<string, string>>) => {
    await agentSetup.refreshIfStale(CLAUDE_CODE_AGENT_ID, options.subscriptionMaxAgeMs ?? SUBSCRIPTION_MAX_AGE_MS);
    return { ...withoutAgentKeys(env), ...agentSetup.agentEnv(CLAUDE_CODE_AGENT_ID) };
  };
  /** The agent's terminal resume with {@link freshChatEnv} applied to each environment. */
  const withChatEnv = (resume: AgentTerminalResume): AgentTerminalResume => {
    const transcript = resume.transcript?.bind(resume);
    return {
      command: async (id, env) => resume.command(id, await freshChatEnv(env)),
      locate: async (env) => resume.locate(await freshChatEnv(env)),
      ...(transcript === undefined ? {} : { transcript: async (input) => transcript({ ...input, env: await freshChatEnv(input.env) }) }),
    };
  };
  const chatAgent: AgentPort = {
    get displayName() {
      return agent.displayName;
    },
    startSession: async (input) => agent.startSession({ ...input, env: await freshChatEnv(input.env) }),
    reopenSession: async (input) => agent.reopenSession({ ...input, env: await freshChatEnv(input.env) }),
    listAuthMethods: (input) => agent.listAuthMethods(input),
    // The terminal runs, and its transcript is read, with the chat's environment rules, the API key's included (stories 3.1, 3.2).
    ...(agent.terminalResume === undefined ? {} : { terminalResume: withChatEnv(agent.terminalResume) }),
  };
  // One terminal port for the chat and the toggle's availability check (story 3.7): they agree on node-pty.
  const terminal = createPtyTerminalPort(options.loadPty);
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agent: chatAgent,
    permissions,
    agentEnv: chatEnv,
    terminal,
    // The event carries the plain reason; the log also gets the details (never the environment).
    onAgentError: (sessionId, error) => log.warn('agent failed', { sessionId, code: error.code, reason: error.message, ...error.details }),
    onInternalError: (sessionId, error) => log.error('applying an agent event failed', { sessionId, reason: String(error) }),
    ...(checkInDelayMs === undefined ? {} : { checkInDelayMs }),
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
  const app = createApp({
    events: core.events,
    webRoot: options.webRoot ?? defaultWebRoot(),
    log,
    gate,
    control,
    toolchain,
    chat,
    // The unwrapped agent and `chatEnv`: core's checks, without reading sign-in again on every GET (story 3.7).
    terminalAvailability: createTerminalAvailability({ agent, terminal, env: chatEnv }),
    permissions,
    agentSetup,
    onboarding,
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
  } catch (error) {
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

/**
 * Re-points an app shortcut that is already there at this server's Node and
 * launcher, which may have moved since it was added (a Node upgrade, a new
 * npx cache). It never creates one; a failure is logged, without paths, and
 * the server runs on.
 */
async function repointAppShortcut(appShortcut: AppShortcutPort, log: Logger): Promise<void> {
  try {
    if (!(await appShortcut.status()).installed) return;
    await appShortcut.add();
  } catch (error) {
    log.warn('could not re-point the app shortcut', { code: shortcutErrorCode(error) });
  }
}

/** Sends one schema-checked message to every connected WebSocket client. */
function broadcast(wss: WebSocketServer, message: ServerMessage, log: Logger): void {
  const parsed = ServerMessage.safeParse(message);
  if (!parsed.success) {
    log.error('refusing to broadcast a message that fails the shared schema', { issues: parsed.error.issues });
    return;
  }
  const text = JSON.stringify(parsed.data);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(text);
  }
}

/** Writes the port file readable only by the user, replacing any stale one in one step. */
function writePortFile(file: string, identity: PortFile): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
  tightenMode(temp);
  renameSync(temp, file);
}

/** Removes the port file only if it is still this server's; another server may have replaced it. */
function removePortFile(file: string, identity: PortFile): void {
  let current: Partial<PortFile>;
  try {
    current = JSON.parse(readFileSync(file, 'utf8')) as Partial<PortFile>;
  } catch {
    return;
  }
  if (current.pid === identity.pid && current.port === identity.port && current.startedAt === identity.startedAt) {
    rmSync(file, { force: true });
  }
}

/** Stops the WebSocket clients and the HTTP server, and resolves once the port is released. */
function closeServer(server: ReturnType<typeof createAdaptorServer>, wss: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.close((error) => (error ? reject(error) : resolve()));
    if ('closeAllConnections' in server) server.closeAllConnections();
  });
}

function listen(server: ReturnType<typeof createAdaptorServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
