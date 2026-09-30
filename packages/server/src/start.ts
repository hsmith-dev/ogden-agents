import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdaptorServer } from '@hono/node-server';
import { createDataDir, ensureDataDir, openCore, PORT_FILE, type Core } from '@ogden-agents/core';
import { SERVER_STREAM } from '@ogden-agents/shared';
import openBrowser from 'open';
import { WebSocketServer } from 'ws';
import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app.js';
import { createLaunchCodes, createSessions, loadOrCreateAuthKey, tightenMode, type Clock } from './auth.js';
import { AUTH_PATH, createGate } from './gate.js';
import { createLogger, createRotatingFileWriter, LOG_DIR, teeWriters, type Logger } from './log.js';

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

export interface StartOptions {
  /** Port to try first. `0` asks the OS for any free port. Default {@link DEFAULT_PORT}. */
  port?: number;
  /** Open the default browser at the single-use launch URL (`launchUrl`). Default `false`. */
  open?: boolean;
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
  /** Override the clock for launch code and session expiry (tests). Default `Date.now`. */
  now?: Clock;
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
  /** The base URL. Opening it without the session cookie shows how to get in. */
  url: string;
  /**
   * `<url>/auth?code=…`: a single-use link, valid for 60 seconds, that signs a
   * browser in (AD-15). It is a secret: print it for the user, never log it.
   */
  launchUrl: string;
  port: number;
  version: string;
  /** The data folder in use. */
  dataDir: string;
  /** Core as wired into this server: the event log and entity model. */
  core: Core;
  close(): Promise<void>;
}

export async function start(options: StartOptions = {}): Promise<RunningServer> {
  const dataDir = options.dataDir === undefined ? ensureDataDir() : createDataDir(options.dataDir);
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
    return await listenAndAnnounce({ options, dataDir, log, core, ownsCore });
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
}: {
  options: StartOptions;
  dataDir: string;
  log: Logger;
  core: Core;
  ownsCore: boolean;
}): Promise<RunningServer> {
  const requested = options.port ?? DEFAULT_PORT;
  const now = options.now ?? Date.now;
  const codes = createLaunchCodes(now);
  const sessions = createSessions(loadOrCreateAuthKey(dataDir), now);
  // The gate refuses everything until the port is known.
  let boundPort: number | undefined;
  const gate = createGate({ port: () => boundPort, codes, sessions, log });
  const app = createApp({ events: core.events, webRoot: options.webRoot ?? defaultWebRoot(), log, gate });

  let bound: { server: ReturnType<typeof createAdaptorServer>; wss: WebSocketServer; port: number } | undefined;
  let lastTried = requested;

  for (let attempt = 0; attempt < PORT_ATTEMPTS && bound === undefined; attempt++) {
    const candidate = requested === 0 ? 0 : requested + attempt;
    if (candidate > 65535) break;
    lastTried = candidate;
    const wss = new WebSocketServer({ noServer: true });
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
  const version = pkg.version;
  const portFile = join(dataDir, PORT_FILE);
  if (port !== requested && requested !== 0) {
    log.warn('requested port was busy', { requested, port });
  }
  log.info('server listening', { url, port, version, dataDir });

  const identity: PortFile = { port, pid: process.pid, version, startedAt: new Date().toISOString() };
  try {
    writePortFile(portFile, identity);
    core.events.append({ type: 'server.started', workspaceId: null, streamId: SERVER_STREAM, payload: { version } });
  } catch (error) {
    // Nothing may stay listening on a server that failed to start.
    await closeServer(server, wss);
    removePortFile(portFile, identity);
    throw error;
  }

  const launchUrl = `${url}${AUTH_PATH}?code=${codes.issue()}`;
  log.info('launch code issued');

  if (options.open === true) {
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
    close: () =>
      closeServer(server, wss).finally(() => {
        try {
          removePortFile(portFile, identity);
        } finally {
          if (ownsCore) core.close();
        }
      }),
  };
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
