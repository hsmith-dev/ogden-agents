/**
 * `project-commands-node` (AD-38; 8.9): the real `ProjectCommandRunner`.
 * It starts a project's declared command as the argv core gives it, in the
 * project's folder, and owns the process (AD-3) until it exits, is stopped,
 * runs past its time limit, or the server stops.
 *
 * Contained by construction:
 * - the argv is checked again here (`argvShellRefusal`): a shell, a
 *   `NAME=value` prefix, a relative program or a newline never reaches spawn;
 * - the program is resolved to an absolute file on the absolute `PATH`
 *   entries only (`findProgram`), and a Windows `.cmd`/`.bat` shim is
 *   refused in plain words (it needs a shell; deferred);
 * - it is spawned with `shell: false`, stdin ignored, in its own process
 *   group on POSIX (`detached`), with `baseEnvironment()` plus `CI=1`,
 *   `NO_COLOR=1` and `FORCE_COLOR=0`: never `process.env`, never a key;
 * - stdout and stderr together keep only their last
 *   `PROJECT_COMMAND_OUTPUT_MAX_BYTES` (`truncated` past it);
 * - Stop, the time limit and `close()` kill the whole tree
 *   (`killProcessTree`: the group on POSIX, `taskkill /T` on Windows), and
 *   `killAll()` does it synchronously for a server that is crashing;
 * - once the child has exited, Stop no longer changes the outcome: the run
 *   finishes with its own exit code.
 * Every stream and the child have an `error` handler.
 */
import { spawn } from 'node:child_process';
import { argvShellRefusal, type ProjectCommandExit, type ProjectCommandProcess, type ProjectCommandRunner } from '@ogden-agents/core';
import { PROJECT_COMMAND_MAX_RUN_MS, PROJECT_COMMAND_OUTPUT_MAX_BYTES, PROJECT_COMMAND_REFUSALS } from '@ogden-agents/shared';
import { findProgram } from '../acp-base/linked-command.js';
import { baseEnvironment } from '../child-env.js';
import { killProcessTree } from '../process-tree.js';

/** How long a killed tree has to report its exit before the run gives up waiting. */
const KILL_GRACE_MS = 5_000;
/** What a run past the time limit says. */
export const PROJECT_COMMAND_TIMEOUT_TEXT = 'This command ran longer than 30 minutes, so Ogden stopped it.';
/** What a start says once the runner is closed. */
const CLOSED_TEXT = 'Ogden is stopping, so nothing new runs.';

export interface ProjectCommandsNodeOptions {
  /** Where the allowlisted environment is read from. Default `process.env` (only `baseEnvironment`'s names are taken). */
  source?: () => Readonly<Record<string, string | undefined>>;
  /** Default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Default {@link PROJECT_COMMAND_MAX_RUN_MS}. */
  maxRunMs?: number;
  /** Default {@link PROJECT_COMMAND_OUTPUT_MAX_BYTES}. */
  maxOutputBytes?: number;
  /** Stops a process and its tree. Default {@link killProcessTree}. */
  killTree?: (pid: number | undefined) => void;
  /** Told each argv just before it is spawned, with its resolved program (tests). */
  onSpawn?: (file: string, args: readonly string[], env: Readonly<Record<string, string>>) => void;
}

/** A tail buffer: the last `max` bytes of what was pushed. */
function tail(max: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  return {
    push(chunk: Buffer) {
      chunks.push(chunk);
      bytes += chunk.byteLength;
      while (bytes > max && chunks.length > 0) {
        const first = chunks[0]!;
        const over = bytes - max;
        truncated = true;
        if (first.byteLength <= over) {
          chunks.shift();
          bytes -= first.byteLength;
        } else {
          chunks[0] = first.subarray(over);
          bytes -= over;
        }
      }
    },
    read: () => ({ text: Buffer.concat(chunks).toString('utf8'), truncated }),
  };
}

/** A process that never started: settled at once with its plain reason. */
function notStarted(error: string): ProjectCommandProcess {
  return { done: Promise.resolve({ exitCode: null, stopped: false, error }), stop: () => {}, output: () => ({ text: '', truncated: false }) };
}

export function createProjectCommandsNode(options: ProjectCommandsNodeOptions = {}): ProjectCommandRunner {
  const platform = options.platform ?? process.platform;
  const maxRunMs = options.maxRunMs ?? PROJECT_COMMAND_MAX_RUN_MS;
  const maxOutputBytes = options.maxOutputBytes ?? PROJECT_COMMAND_OUTPUT_MAX_BYTES;
  const killTree = options.killTree ?? ((pid) => killProcessTree(pid));
  const source = options.source ?? (() => process.env);
  let closed = false;
  const inFlight = new Set<ProjectCommandProcess>();
  /** How to kill each in-flight tree at once, synchronously (a crashing server's `exit` handler). */
  const killNow = new Map<ProjectCommandProcess, () => void>();

  return {
    start({ cwd, argv }) {
      if (closed) return notStarted(CLOSED_TEXT);
      const refusal = argvShellRefusal(argv);
      if (refusal !== undefined) return notStarted(PROJECT_COMMAND_REFUSALS[refusal]);
      const from = source();
      const found = findProgram(argv[0]!, from, { platform });
      if (!found.ok) return notStarted(found.reason);
      const env: Record<string, string> = { ...baseEnvironment(from, platform), CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
      const args = argv.slice(1);
      const output = tail(maxOutputBytes);

      let settle!: (exit: ProjectCommandExit) => void;
      const done = new Promise<ProjectCommandExit>((resolve) => {
        settle = resolve;
      });
      let settled = false;
      /** Why it is being killed, once it is: reported when the tree has exited. */
      let killed: ProjectCommandExit | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = (exit: ProjectCommandExit) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(grace);
        inFlight.delete(handle);
        killNow.delete(handle);
        settle(exit);
      };

      let child: ReturnType<typeof spawn> | undefined;
      /** The child's own exit code, once it has exited: from then on Stop changes nothing. */
      let exited: number | null | undefined;
      const kill = (exit: ProjectCommandExit) => {
        if (settled || killed !== undefined || exited !== undefined) return;
        killed = exit;
        clearTimeout(timer);
        killTree(child?.pid);
        grace = setTimeout(() => finish(exit), KILL_GRACE_MS);
        grace.unref?.();
      };
      const handle: ProjectCommandProcess = {
        done,
        stop: () => kill({ exitCode: null, stopped: true }),
        output: () => output.read(),
      };

      try {
        options.onSpawn?.(found.file, args, env);
        child = spawn(found.file, args, {
          cwd,
          env,
          shell: false,
          windowsHide: true,
          // Its own process group, so Stop kills what it started too (POSIX).
          detached: platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        return notStarted(`Ogden couldn't start ${argv[0]!}.`);
      }
      inFlight.add(handle);
      killNow.set(handle, () => killTree(child?.pid));
      child.stdout?.on('data', (chunk: Buffer) => output.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => output.push(chunk));
      child.stdout?.on('error', () => {});
      child.stderr?.on('error', () => {});
      child.on('error', (error: NodeJS.ErrnoException) => {
        finish({ exitCode: null, stopped: false, error: error.code === 'ENOENT' ? `${argv[0]!} wasn't found on this computer.` : `Ogden couldn't start ${argv[0]!}.` });
      });
      child.on('exit', (exitCode) => {
        exited = exitCode;
        if (killed !== undefined) return;
        // What it left behind in its group (a watcher, a server) goes with it, so its pipes close.
        killTree(child?.pid);
        clearTimeout(timer);
        grace = setTimeout(() => finish({ exitCode, stopped: false }), KILL_GRACE_MS);
        grace.unref?.();
      });
      child.on('close', (exitCode) => {
        if (killed !== undefined) {
          finish(killed);
          return;
        }
        finish({ exitCode: exited !== undefined ? exited : exitCode, stopped: false });
      });
      timer = setTimeout(() => kill({ exitCode: null, stopped: false, error: PROJECT_COMMAND_TIMEOUT_TEXT }), maxRunMs);
      timer.unref?.();
      return handle;
    },

    killAll() {
      closed = true;
      for (const kill of [...killNow.values()]) kill();
    },

    async close() {
      closed = true;
      const going = [...inFlight];
      for (const one of going) one.stop();
      await Promise.all(going.map((one) => one.done));
    },
  };
}
