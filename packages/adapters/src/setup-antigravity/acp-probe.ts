/**
 * A short-lived connection to Antigravity's ACP server for setup (epic 6
 * entry 7): `initialize` to read the version an install reports (never
 * `--version`, which hangs on Windows), `authenticate` for Google sign-in,
 * and `logout`. No session is ever opened, and every permission request is
 * cancelled.
 *
 * - It runs exactly the environment it is given (no API key: the caller's
 *   job) in its own process group, so {@link SetupServer.stop} ends the
 *   whole tree (`killProcessTree`).
 * - Its stderr is never logged or stored; each line is handed, in memory
 *   only, to `onStderrLine` (the sign-in looks for its URL there) and then
 *   dropped.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { killProcessTree } from '../process-tree.js';

/** How to start a server: a program by absolute path and its arguments. */
export interface ServerCommand {
  command: string;
  args: readonly string[];
}

export interface SetupServer {
  connection: acp.ClientSideConnection;
  /** Resolves when the process exits, with its code (or `null` when killed by a signal). */
  exited: Promise<number | null>;
  /** Kills the server's whole tree. Safe to call more than once. */
  stop(): void;
}

/** The longest stderr line kept while looking for something in it. */
const MAX_LINE = 16 * 1024;

/** Starts `server` with exactly `env` in `cwd` and connects to it over stdio. Throws when it can't be spawned. */
export function startSetupServer(input: {
  server: ServerCommand;
  env: Readonly<Record<string, string>>;
  cwd: string;
  onStderrLine?: (line: string) => void;
}): SetupServer {
  const child: ChildProcessWithoutNullStreams = spawn(input.server.command, [...input.server.args], {
    cwd: input.cwd,
    env: { ...input.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    killProcessTree(child.pid);
  };
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(null));
  });
  child.stdin.on('error', () => {});
  child.stdout.on('error', () => {});
  let pending = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    pending = (pending + chunk).slice(-MAX_LINE);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      try {
        input.onStderrLine?.(line);
      } catch {
        // A listener never breaks the server.
      }
    }
  });
  const client: acp.Client = {
    // Setup opens no session; nothing it asks to run, runs.
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    sessionUpdate: async () => {},
  };
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);
  const connection = new acp.ClientSideConnection(() => client, stream);
  return { connection, exited, stop };
}

/** `promise`, or a rejection after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${what} timed out`), { code: 'timeout' })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The `initialize` Ogden sends for setup: no file system or terminal for the agent. */
export const SETUP_INITIALIZE: acp.InitializeRequest = {
  protocolVersion: acp.PROTOCOL_VERSION,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  clientInfo: { name: 'ogden-agents', version: '1' },
};

/**
 * Starts `server`, asks `initialize`, stops it, and resolves with
 * `agentInfo.version` (or `undefined` when it gives none). Rejects when it
 * can't start, exits, or doesn't answer in `timeoutMs`.
 */
export async function readServerVersion(input: { server: ServerCommand; env: Readonly<Record<string, string>>; cwd: string; timeoutMs: number }): Promise<string | undefined> {
  const server = startSetupServer(input);
  try {
    const exited = server.exited.then((code) => {
      throw Object.assign(new Error('the server exited'), { code: `exit_${code ?? 'signal'}` });
    });
    exited.catch(() => {});
    const init = await withTimeout(Promise.race([server.connection.initialize(SETUP_INITIALIZE), exited]), input.timeoutMs, 'initialize');
    return init.agentInfo?.version ?? undefined;
  } finally {
    server.stop();
  }
}
