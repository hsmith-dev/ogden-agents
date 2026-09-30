import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import {
  createClaudeCodeAgent,
  createMemoryAgentSetup,
  createMemoryAppShortcut,
  createMemorySecretStore,
  createUvToolchain,
} from '@ogden-agents/adapters';
import {
  createChat,
  createDataDir,
  createDecliningPermissions,
  RESTARTED_REASON,
  createToolchain,
  ensureDataDir,
  openCore,
  PORT_FILE,
  type AgentPort,
  type AgentSetupPort,
  type AppShortcutPort,
  type Core,
  type SecretStorePort,
  type ToolchainPort,
} from '@ogden-agents/core';
import { SERVER_STREAM, ServerMessage } from '@ogden-agents/shared';
import openBrowser from 'open';
import { WebSocketServer } from 'ws';
import { createApp, type ServerControl } from './app.js';
import { chooseWebSocketProtocol, createLaunchCodes, createTabTokens, retireLegacyAuthKey, type Clock, type TabTokens } from './auth.js';
import { tightenMode } from './file-mode.js';
import { createGate, launchUrl as launchUrlFor } from './gate.js';
import { acquireInstanceLock, type InstanceLock } from './instance-lock.js';
import { createLauncherToken, type LauncherToken } from './launcher-token.js';
import { createLogger, createRotatingFileWriter, LOG_DIR, teeWriters, type Logger } from './log.js';
import { VERSION } from './version.js';

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
 * `claudeAdapterPath` (`pnpm dev:chat` sets it). Until onboarding installs
 * the adapter (story 9.3), a server without it finds it only in a dev install.
 */
export const CLAUDE_ACP_PATH_ENV = 'OGDEN_AGENTS_CLAUDE_ACP_PATH';

/** What an agent process needs from this server's environment to run as the user (AD-16). */
const AGENT_ENV_ALLOWED = ['PATH', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LANG', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SHELL'];
/** The same on Windows only, where a process can't start without them. */
const AGENT_ENV_ALLOWED_WINDOWS = ['SystemRoot', 'ComSpec', 'PATHEXT'];
/** Agent credentials passed on when the user has set them (AD-16: the keychain replaces this in epic 9). */
export const AGENT_ENV_KEYS = ['ANTHROPIC_API_KEY'];

/**
 * The environment agent processes get (AD-16): an allowlist of what a CLI
 * needs to run as the user (`PATH`, home, user, locale, terminal, temp,
 * shell), plus the agent keys the user set, and nothing else of this
 * server's environment. Never logged.
 */
export function agentEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const allowed = new Set([...AGENT_ENV_ALLOWED, ...AGENT_ENV_KEYS, ...(platform === 'win32' ? AGENT_ENV_ALLOWED_WINDOWS : [])]);
  // Windows variable names are case-insensitive (`Path`, `SYSTEMROOT`).
  const fold = (name: string) => (platform === 'win32' ? name.toUpperCase() : name);
  const allowedFolded = new Set([...allowed].map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (allowedFolded.has(fold(name)) || name === 'LC_ALL' || name.startsWith('LC_')) env[name] = value;
  }
  return env;
}

export interface StartOptions {
  /** Port to try first. `0` asks the OS for any free port. Default {@link DEFAULT_PORT}. */
  port?: number;
  /** Open the default browser at the single-use launch URL (`launchUrl`); implies `launch`. Default `false`. */
  open?: boolean;
  /**
   * Issue a single-use launch link as the server starts (`launchUrl`), for
   * `--foreground`, which prints it, and tests. Default `false`: the
   * background server issues codes only on request (the launcher's
   * `/launcher/hello?launch=1`, New tab), so none goes unused.
   */
  launch?: boolean;
  /** Override the built UI directory. */
  webRoot?: string;
  /**
   * The data folder for the database and logs, created readable only by the
   * user if missing. Default: the per-user data directory, or
   * `$OGDEN_AGENTS_DATA_DIR` (see `ensureDataDir`).
   */
  dataDir?: string;
  /** Use this already-open core instead of opening one in `dataDir` (tests). The caller closes it. */
  core?: Core;
  /** Override the logger (tests). Default: stderr plus a rotating file in `<dataDir>/logs`. */
  log?: Logger;
  /** Override the clock for launch code and tab token expiry (tests). Default `Date.now`. */
  now?: Clock;
  /**
   * Override how `uv` is found and installed (tests). Default: the
   * `toolchain-uv` adapter on `dataDir`, which downloads only when the user
   * clicks Install.
   */
  toolchain?: ToolchainPort;
  /** Override the chat agent (tests). Default: the `acp-claude-code` adapter. */
  agent?: AgentPort;
  /**
   * The Claude Agent ACP adapter's entry script (or, in tests, any script
   * that speaks ACP over stdio, such as the fake agent). Default:
   * `$OGDEN_AGENTS_CLAUDE_ACP_PATH`, else the adapter in `node_modules` if
   * this is a dev install.
   */
  claudeAdapterPath?: string;
  /** Variables added to every agent's environment on top of {@link agentEnvironment} (tests: the fake agent's switches). */
  extraAgentEnv?: Readonly<Record<string, string>>;
  /**
   * Installing and signing into each agent. Default: the in-memory
   * `setup-memory` stub, until onboarding (9.x) brings the real adapters.
   */
  agentSetup?: readonly AgentSetupPort[];
  /** Where API keys are kept (AD-16). Default: the in-memory `secrets-memory` stub, until 9.4 brings the keychain. */
  secrets?: SecretStorePort;
  /** The Ogden Agents app shortcut (E2-R10). Default: the in-memory `shortcut-memory` stub, until 2.4. */
  appShortcut?: AppShortcutPort;
  /**
   * Called once the server has stopped by itself (Quit, or a restart the
   * launcher asked for) and everything is closed. A server process exits here.
   */
  onStop?: (reason: StopReason) => void;
}

/**
 * Why the server stopped: `quit` from the UI, `restart` for a newer version
 * (the launcher starts it), or `close` from its owner.
 */
export type StopReason = 'quit' | 'restart' | 'close';

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

/** The contents of the port file `<dataDir>/server.json` (AD-15). */
export interface PortFile {
  port: number;
  pid: number;
  version: string;
  /** ISO 8601 UTC. */
  startedAt: string;
}

export interface RunningServer {
  /** The base URL. A tab opened on it without a token shows how to get in. */
  url: string;
  /**
   * `<url>/#c=…`: a single-use link, valid for 60 seconds, that opens one
   * connected tab (AD-15: the page exchanges the code for its token over
   * POST), issued at start only with `launch` or `open`. It is a secret:
   * print it for the user, never log it.
   */
  launchUrl: string | undefined;
  port: number;
  version: string;
  /** The data folder in use. */
  dataDir: string;
  /** Core as wired into this server: the event log and entity model. */
  core: Core;
  /** The live tab tokens (in memory only; gone when the server stops). */
  tabs: TabTokens;
  /** A fresh single-use launch link, as `launchUrl`. A secret: never log it. */
  issueLaunchUrl(): string;
  /** Resolves once the server has stopped, however it stopped, with the reason. */
  stopped: Promise<StopReason>;
  /**
   * Stops the server: closes the port and the sockets, removes `server.json`
   * and `launcher.token`, and closes core if the server opened it. Safe to call
   * more than once.
   */
  close(): Promise<void>;
}

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
  const agent =
    options.agent ??
    createClaudeCodeAgent({
      adapterPath: options.claudeAdapterPath ?? (process.env[CLAUDE_ACP_PATH_ENV] || undefined),
      onDiagnostic: (message, fields) => log.info(`agent: ${message}`, fields),
    });
  // Agents from before this start are gone with their processes (AD-3): their sessions can be resumed, not left working.
  const settled = core.entities.settleInterruptedSessions(RESTARTED_REASON);
  if (settled.length > 0) log.info('sessions left working by a stopped server are idle and resumable', { sessions: settled.length });
  const extraAgentEnv = options.extraAgentEnv ?? {};
  // One instance for the chat that asks and the routes that answer (2.6 replaces the stub in core).
  const permissions = createDecliningPermissions();
  const chat = createChat({
    dataDir,
    entities: core.entities,
    sessionEvents: core.sessionEvents,
    agent,
    permissions,
    agentEnv: () => ({ ...agentEnvironment(), ...extraAgentEnv }),
    // The event carries the plain reason; the log also gets the details (never the environment).
    onAgentError: (sessionId, error) => log.warn('agent failed', { sessionId, code: error.code, reason: error.message, ...error.details }),
    onInternalError: (sessionId, error) => log.error('applying an agent event failed', { sessionId, reason: String(error) }),
  });
  const app = createApp({
    events: core.events,
    webRoot: options.webRoot ?? defaultWebRoot(),
    log,
    gate,
    control,
    toolchain,
    chat,
    permissions,
    agentSetup: options.agentSetup ?? [createMemoryAgentSetup()],
    secrets: options.secrets ?? createMemorySecretStore(),
    appShortcut: options.appShortcut ?? createMemoryAppShortcut({ platform: process.platform }),
    tabs,
  });

  let bound: { server: ReturnType<typeof createAdaptorServer>; wss: WebSocketServer; port: number } | undefined;
  let lastTried = requested;

  for (let attempt = 0; attempt < PORT_ATTEMPTS && bound === undefined; attempt++) {
    const candidate = requested === 0 ? 0 : requested + attempt;
    if (candidate > 65535) break;
    lastTried = candidate;
    // Echo only `ogden.v1`, never the offer that carries the tab token (AD-15).
    const wss = new WebSocketServer({ noServer: true, handleProtocols: chooseWebSocketProtocol });
    const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } });
    try {
      const port = await listen(server, candidate);
      bound = { server, wss, port };
    } catch (error) {
      wss.close();
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || requested === 0) throw error;
      log.info('port busy, trying the next one', { port: candidate });
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
      // The server owns agent processes (AD-3): none outlives it.
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
