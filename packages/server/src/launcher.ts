/**
 * The `npx ogden-agents` launcher (AD-3, AD-20; story 1.7). It finds a running
 * server only through `<dataDir>/server.json` (AD-15) and confirms it with the
 * authenticated handshake; otherwise it starts a detached background server.
 * Either way it gets a fresh single-use launch link from the server, prints
 * it, opens the browser, and returns, so the terminal is free (AD-21).
 *
 * Version rule (AD-20): an older server is asked to restart when idle. With no
 * busy sessions it stops cleanly and a new one starts; with busy sessions it
 * keeps running and is opened as it is. The launcher never stops a running
 * session. A newer server is simply used.
 *
 * The launcher token and launch codes are secrets: they are printed (the link,
 * for the user) but never logged.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDataDir, DATA_DIR_ENV, PORT_FILE } from '@ogden-agents/core';
import pkg from '../package.json' with { type: 'json' };
import { EXIT_ALREADY_RUNNING, isPidAlive } from './instance-lock.js';
import { LAUNCHER_TOKEN_FILE, LAUNCHER_TOKEN_HEADER, readLauncherToken } from './launcher-token.js';
import { createLogger, createRotatingFileWriter, LOG_DIR, type Logger } from './log.js';

/** The launcher's own version: the version it would start. */
export const LAUNCHER_VERSION: string = pkg.version;
/** How long a new server has to answer the handshake. */
export const START_TIMEOUT_MS = 20_000;
/** How long an idle older server has to stop after agreeing to restart. */
export const RESTART_TIMEOUT_MS = 15_000;
/** How long one handshake request may take. */
export const HELLO_TIMEOUT_MS = 3_000;
const POLL_MS = 100;
const HOST = '127.0.0.1';

export interface LauncherOptions {
  /** The background server entry (`dist/serve.js`). */
  serveEntry: string;
  /** The built UI the server serves (`dist/web`). */
  webRoot?: string;
  /** Port a new server tries first. Ignored when attaching. */
  port?: number;
  /** Open the default browser at the launch link. */
  open: boolean;
  /** The data folder. Default: `$OGDEN_AGENTS_DATA_DIR` or the per-user data directory. */
  dataDir?: string;
  /** The launcher's version (tests). Default {@link LAUNCHER_VERSION}. */
  version?: string;
  /** Where user-facing lines go. Default `console.log`. */
  print?: (line: string) => void;
  /** Opens a URL in the browser. Default: the `open` package. */
  openBrowser?: (url: string) => Promise<unknown>;
  startTimeoutMs?: number;
  restartTimeoutMs?: number;
}

export type LaunchAction = 'started' | 'attached' | 'updated' | 'kept-older';

export interface LaunchResult {
  action: LaunchAction;
  url: string;
  /** A fresh single-use link (AD-15). A secret: print it, never log it. */
  launchUrl: string;
  version: string;
  pid: number;
  port: number;
}

/** A failure to show the user as it is, without a stack. */
export class LauncherError extends Error {
  override readonly name = 'LauncherError';
}

/** What `GET /launcher/hello` returns. */
interface Hello {
  version: string;
  pid: number;
  port: number;
  busySessions: number;
  launchUrl?: string;
}

interface PortRecord {
  port: number;
  pid: number;
  version?: string;
}

// ---------------------------------------------------------------------------
// Versions.
// ---------------------------------------------------------------------------

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Compares two semver versions: negative if `a < b`, 0 if equal, positive if
 * `a > b`, `undefined` if either doesn't parse. A pre-release is lower than
 * its release; build metadata is ignored.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const pa = SEMVER.exec(a.trim());
  const pb = SEMVER.exec(b.trim());
  if (pa === null || pb === null) return undefined;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  const preA = pa[4];
  const preB = pb[4];
  if (preA === undefined || preB === undefined) return preA === preB ? 0 : preA === undefined ? 1 : -1;
  const idsA = preA.split('.');
  const idsB = preB.split('.');
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i++) {
    const x = idsA[i];
    const y = idsB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Finding and talking to a running server.
// ---------------------------------------------------------------------------

export { isPidAlive };

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function parsePortRecord(text: string): PortRecord | undefined {
  try {
    const json = JSON.parse(text) as Partial<PortRecord>;
    if (Number.isInteger(json.port) && Number.isInteger(json.pid)) return json as PortRecord;
  } catch {
    // Unreadable: stale.
  }
  return undefined;
}

function isHello(value: unknown): value is Hello {
  const v = value as Partial<Hello> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.version === 'string' &&
    Number.isInteger(v.pid) &&
    Number.isInteger(v.port) &&
    Number.isInteger(v.busySessions) &&
    (v.launchUrl === undefined || typeof v.launchUrl === 'string')
  );
}

async function request(port: number, token: string, method: 'GET' | 'POST', path: string): Promise<Response> {
  return fetch(`http://${HOST}:${port}${path}`, {
    method,
    headers: { [LAUNCHER_TOKEN_HEADER]: token },
    signal: AbortSignal.timeout(HELLO_TIMEOUT_MS),
  });
}

/** The handshake: the server's version, pid, port and busy sessions, and optionally a fresh launch link. */
async function hello(port: number, token: string, launch: boolean): Promise<Hello | undefined> {
  try {
    const response = await request(port, token, 'GET', `/launcher/hello${launch ? '?launch=1' : ''}`);
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!isHello(body) || (launch && body.launchUrl === undefined)) return undefined;
    return body;
  } catch {
    return undefined;
  }
}

interface Found {
  record: PortRecord;
  token: string;
  hello: Hello;
}

/**
 * The running server named by `server.json`, confirmed by the handshake.
 *
 * A file whose pid is dead, or that can't be read, is stale: it is removed
 * (with its token) and `undefined` is returned. A live pid is never treated
 * as stale, since the server may just be slow: if its handshake fails, this
 * throws a "not responding" {@link LauncherError} and leaves its files alone.
 */
async function findRunning(dataDir: string, log: Logger): Promise<Found | undefined> {
  const portFile = join(dataDir, PORT_FILE);
  const text = readText(portFile);
  if (text === undefined) return undefined;

  const record = parsePortRecord(text);
  const token = readLauncherToken(dataDir);
  let reason: string;
  if (record === undefined) reason = 'unreadable port file';
  else if (!isPidAlive(record.pid)) reason = 'process is gone';
  else {
    const reply = token === undefined ? undefined : await hello(record.port, token, false);
    if (reply !== undefined && reply.pid === record.pid && reply.port === record.port) {
      return { record, token: token!, hello: reply };
    }
    log.warn('running server is not responding', { pid: record.pid, port: record.port, launcherTokenFound: token !== undefined });
    throw new LauncherError(
      `Ogden Agents (process ${record.pid}) is running but not responding. Wait a moment and run this command again. ` +
        `If it stays stuck, restart your computer, or end that process. Its log: ${join(dataDir, LOG_DIR, 'server.log')}`,
    );
  }

  log.warn('removing a stale port file', { reason, pid: record?.pid, port: record?.port });
  // Only if nothing replaced them in the meantime.
  if (readText(portFile) === text) rmSync(portFile, { force: true });
  const tokenFile = join(dataDir, LAUNCHER_TOKEN_FILE);
  if (token !== undefined && readText(tokenFile)?.trim() === token) rmSync(tokenFile, { force: true });
  return undefined;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Stops the spawned server and anything it started (it leads its own process group on POSIX). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

/**
 * Spawns the detached server and waits until a server answers the handshake
 * with a launch link. If another launcher's server won the data folder's lock
 * first, ours exits and this attaches to the winner.
 */
async function startServer(
  options: LauncherOptions,
  dataDir: string,
  log: Logger,
): Promise<{ hello: Hello & { launchUrl: string } }> {
  const args = [options.serveEntry];
  if (options.port !== undefined) args.push('--port', String(options.port));
  if (options.webRoot !== undefined) args.push('--web-root', options.webRoot);
  // Detached: on POSIX a new process group (no SIGHUP when the terminal
  // closes); on Windows its own hidden console. No stdio, so nothing ties it
  // to this terminal; it logs to the data folder.
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    // Not the launcher's folder: the server must not hold it open or depend on it.
    cwd: dataDir,
    env: { ...process.env, [DATA_DIR_ENV]: dataDir },
  });
  let exit: string | undefined;
  let lostTheLock = false;
  child.once('exit', (code, signal) => {
    if (code === EXIT_ALREADY_RUNNING) lostTheLock = true;
    else exit = signal === null ? `exit code ${code}` : `signal ${signal}`;
  });
  child.once('error', (error) => (exit = error.message));
  child.unref();
  log.info('started a background server', { pid: child.pid });

  const logPath = join(dataDir, LOG_DIR, 'server.log');
  const deadline = Date.now() + (options.startTimeoutMs ?? START_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (exit !== undefined) {
      throw new LauncherError(`Ogden Agents stopped while starting (${exit}). See the log: ${logPath}`);
    }
    const record = parsePortRecord(readText(join(dataDir, PORT_FILE)) ?? '');
    const token = readLauncherToken(dataDir);
    // Ours, or, if ours lost the lock, the server that won it.
    if (record !== undefined && (record.pid === child.pid || lostTheLock) && token !== undefined) {
      const reply = await hello(record.port, token, true);
      if (reply?.launchUrl !== undefined && reply.pid === record.pid) {
        if (lostTheLock) log.info('another server started first; attaching to it', { pid: reply.pid });
        return { hello: reply as Hello & { launchUrl: string } };
      }
    }
    await sleep(POLL_MS);
  }
  // Nothing may keep running untracked after we give up on it.
  killTree(child);
  log.warn('gave up on a server that did not start', { pid: child.pid });
  const seconds = Math.round((options.startTimeoutMs ?? START_TIMEOUT_MS) / 1000);
  throw new LauncherError(`Ogden Agents didn't start within ${seconds} seconds. See the log: ${logPath}`);
}

/** Waits until `pid` has exited. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await sleep(POLL_MS);
  }
  return !isPidAlive(pid);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Starts or attaches to the background server, applies the version rule,
 * prints the URL and a fresh launch link, and opens the browser.
 */
export async function launch(options: LauncherOptions): Promise<LaunchResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  const version = options.version ?? LAUNCHER_VERSION;
  const dataDir = options.dataDir === undefined ? ensureDataDir() : options.dataDir;
  const log = createLogger(createRotatingFileWriter({ dir: join(dataDir, LOG_DIR), name: 'launcher.log' }));

  let action: LaunchAction;
  let reply: Hello & { launchUrl: string };

  const found = await findRunning(dataDir, log);
  const attach = async (f: Found): Promise<Hello & { launchUrl: string }> => {
    const fresh = await hello(f.record.port, f.token, true);
    if (fresh?.launchUrl === undefined) throw new LauncherError('Ogden Agents is running but did not answer. Run the command again.');
    return fresh as Hello & { launchUrl: string };
  };

  if (found === undefined) {
    print('Starting Ogden Agents in the background...');
    reply = (await startServer(options, dataDir, log)).hello;
    action = 'started';
  } else {
    const order = compareVersions(found.hello.version, version);
    log.info('found a running server', { pid: found.hello.pid, port: found.hello.port, version: found.hello.version, launcher: version });
    if (order === undefined) log.warn('could not compare versions; attaching', { server: found.hello.version, launcher: version });

    if (order !== undefined && order < 0) {
      // Older server: ask it to restart once idle. It never stops under a busy session.
      let restarting = false;
      let busySessions = found.hello.busySessions;
      try {
        const response = await request(found.record.port, found.token, 'POST', '/launcher/restart-when-idle');
        const body = (await response.json().catch(() => ({}))) as { restarting?: boolean; busySessions?: number };
        restarting = response.status === 202 && body.restarting === true;
        if (typeof body.busySessions === 'number') busySessions = body.busySessions;
      } catch (error) {
        log.warn('restart request failed', { reason: String(error) });
      }

      if (restarting) {
        print(`Updating Ogden Agents from ${found.hello.version} to ${version}...`);
        log.info('older server is stopping for the update', { pid: found.hello.pid });
        if (await waitForExit(found.hello.pid, options.restartTimeoutMs ?? RESTART_TIMEOUT_MS)) {
          reply = (await startServer(options, dataDir, log)).hello;
          action = 'updated';
        } else {
          // It aborted the restart: a session became busy just before it stopped.
          log.info('older server did not stop for the update', { pid: found.hello.pid });
          print(`The running version (${found.hello.version}) is busy, so the update waits: run this command again when your agents finish. Opening it now.`);
          reply = await attach(found);
          action = 'kept-older';
        }
      } else {
        log.info('older server kept: sessions are busy', { busySessions });
        print(
          busySessions > 0
            ? `Ogden Agents ${version} is installed, but ${plural(busySessions, 'session is', 'sessions are')} still working in the running version (${found.hello.version}). ` +
                'The update applies when they finish: run this command again then. Opening the running version now.'
            : `Ogden Agents ${version} is installed, but the running version (${found.hello.version}) couldn't restart. Opening it as it is.`,
        );
        reply = await attach(found);
        action = 'kept-older';
      }
    } else {
      print(`Ogden Agents is already running (version ${found.hello.version}).`);
      reply = await attach(found);
      action = 'attached';
    }
  }

  const url = `http://${HOST}:${reply.port}`;
  print(`Ogden Agents is running at ${url}`);
  // The link signs this browser in once, within 60 seconds (AD-15). Printed so
  // a user whose browser didn't open can click it; running this command again
  // always gives a new one.
  print(`Open it with this one-time link: ${reply.launchUrl}`);
  print('It keeps running after you close this terminal. To stop it, choose Quit Ogden Agents in the app.');

  if (options.open) {
    try {
      const openBrowser = options.openBrowser ?? (async (target: string) => (await import('open')).default(target));
      await openBrowser(reply.launchUrl);
    } catch (error) {
      log.warn('could not open a browser', { reason: String(error) });
      print('Could not open a browser. Open the link above yourself.');
    }
  }

  return { action, url, launchUrl: reply.launchUrl, version: reply.version, pid: reply.pid, port: reply.port };
}
