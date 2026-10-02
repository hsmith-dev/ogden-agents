/**
 * Running one of BMad Method's Python scripts with `uv` (story 4.1): `uv run`
 * on the script, with its arguments, in a folder, answering the JSON object
 * the script prints, or a {@link ScriptRunError} that says why not.
 *
 * Contained by construction:
 * - `uv` is spawned with an argument array, never through a shell;
 * - the child gets exactly the environment it is given (the server passes an
 *   allowlist), never this process's;
 * - it runs in its own process group (POSIX) and past `timeoutMs` the whole
 *   tree is killed (`taskkill /T` on Windows);
 * - stdout and stderr together may hold at most `maxOutputBytes`; more kills
 *   the tree too;
 * - `close()` (a stopping server, story 4.2) kills every tree still running
 *   and refuses new runs.
 * Each complete line of output can be streamed to the caller as it arrives
 * (`onLine`, story 4.2: setup's progress), besides the JSON answer.
 * Every stream and the child have an `error` handler, so a failure never
 * reaches the server as an unhandled error.
 */
import { spawn } from 'node:child_process';
import { killProcessTree } from '../process-tree.js';

/** How long a script may run by default. */
export const SCRIPT_TIMEOUT_MS = 30_000;
/** How much a script may print, stdout and stderr together, by default. */
export const SCRIPT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
/** How long a killed tree has to report its exit before the run gives up waiting. */
const KILL_GRACE_MS = 5_000;

/**
 * Why a script run gave no answer: no `uv` to run it (`uv_missing`), it
 * exited non-zero (`failed`, with the script's own `{"error"}` text when it
 * printed one), it ran past the time limit (`timeout`), it printed more than
 * allowed (`too_much_output`), its stdout wasn't one JSON value (`bad_output`),
 * or the runner was closed before it finished (`closed`, story 4.2).
 */
export type ScriptRunErrorCode = 'uv_missing' | 'failed' | 'timeout' | 'too_much_output' | 'bad_output' | 'closed';

export class ScriptRunError extends Error {
  override readonly name = 'ScriptRunError';
  constructor(
    readonly code: ScriptRunErrorCode,
    options: { scriptError?: string | undefined; exitCode?: number | null | undefined; cause?: unknown } = {},
  ) {
    super(code);
    this.scriptError = options.scriptError;
    this.exitCode = options.exitCode;
    if (options.cause !== undefined) this.cause = options.cause;
  }
  /** The script's own `{"error": …}` text on a `failed` run (it may name paths: for the caller, never an event). */
  readonly scriptError: string | undefined;
  /** The exit code on a `failed` run. */
  readonly exitCode: number | null | undefined;
}

/** The `uv` to run: a program and the arguments that come before `run` (tests: Node and a fake uv script). */
export interface UvCommand {
  file: string;
  args?: readonly string[];
}

export interface UvScriptRunnerOptions {
  /** Finds `uv` at each run (it may be installed while the server runs); `undefined` when there is none. */
  uvCommand: () => Promise<UvCommand | undefined>;
  /** The child's whole environment, read at each run. */
  env: () => Readonly<Record<string, string>>;
  /** Default {@link SCRIPT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Default {@link SCRIPT_MAX_OUTPUT_BYTES}. */
  maxOutputBytes?: number;
  /** Default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Stops a process and its tree. Default {@link killProcessTree}. */
  killTree?: (pid: number | undefined) => void;
}

/** Which of the child's streams a line came from. */
export type ScriptStream = 'stdout' | 'stderr';

export interface ScriptRun {
  /** The script's absolute path. */
  script: string;
  args: readonly string[];
  /**
   * The folder it runs in. Never a project's repo: `uv run --no-project`
   * still runs a `.venv` it finds there or in a parent (story 4.2 review),
   * so callers pass a neutral folder and name the repo in the arguments.
   */
  cwd: string;
  /**
   * Told each complete line (without its line break, decoded as UTF-8) of
   * stdout and stderr as it arrives, and a last line without a break when
   * the stream ends (story 4.2). A throw is ignored. Lines past
   * `maxOutputBytes` are not told.
   */
  onLine?: (stream: ScriptStream, line: string) => void;
}

export interface UvScriptRunner {
  /** The JSON value the script printed on stdout, or a {@link ScriptRunError}. */
  run(input: ScriptRun): Promise<unknown>;
  /**
   * Kills the process tree of every run still in flight (each rejects with
   * `closed` once its tree has exited, or after a grace period) and makes
   * every later run reject with `closed` at once. Resolves once every run
   * in flight has settled. Safe to call more than once.
   */
  close(): Promise<void>;
}

/** Splits a stream's chunks into lines for `onLine`, keeping a partial line until it ends. */
function lineSplitter(emit: (line: string) => void) {
  let pending = '';
  const decoder = new TextDecoder('utf-8');
  return {
    push(chunk: Buffer) {
      pending += decoder.decode(chunk, { stream: true });
      let index = pending.indexOf('\n');
      while (index !== -1) {
        emit(pending.slice(0, index).replace(/\r$/, ''));
        pending = pending.slice(index + 1);
        index = pending.indexOf('\n');
      }
    },
    end() {
      pending += decoder.decode();
      if (pending !== '') emit(pending.replace(/\r$/, ''));
      pending = '';
    },
  };
}

/** The `"error"` of the last stderr line that is a JSON object with one, if any. */
function scriptErrorOf(stderr: string): string | undefined {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim() !== '');
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const value = JSON.parse(lines[index]!) as { error?: unknown } | null;
      if (value !== null && typeof value === 'object' && typeof value.error === 'string') return value.error;
    } catch {
      // Not JSON: uv's own output, say.
    }
  }
  return undefined;
}

export function createUvScriptRunner(options: UvScriptRunnerOptions): UvScriptRunner {
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? SCRIPT_MAX_OUTPUT_BYTES;
  const platform = options.platform ?? process.platform;
  const killTree = options.killTree ?? ((pid) => killProcessTree(pid));
  let closed = false;
  /** The kill of each run in flight, by run; each run removes itself once settled. */
  const inFlight = new Map<object, { kill: (error: ScriptRunError) => void; settled: Promise<unknown> }>();

  return {
    async close() {
      closed = true;
      const runs = [...inFlight.values()];
      for (const entry of runs) entry.kill(new ScriptRunError('closed'));
      await Promise.all(runs.map((entry) => entry.settled.catch(() => undefined)));
    },

    async run({ script, args, cwd, onLine }) {
      if (closed) throw new ScriptRunError('closed');
      const uv = await options.uvCommand();
      if (uv === undefined) throw new ScriptRunError('uv_missing');
      // Closed while uv was being found: nothing is spawned.
      if (closed) throw new ScriptRunError('closed');
      const argv = [...(uv.args ?? []), 'run', '--no-project', '--quiet', script, ...args];
      const key = {};
      const tell = (stream: ScriptStream) => (line: string) => {
        try {
          onLine?.(stream, line);
        } catch {
          // The caller's listener never changes the run.
        }
      };

      let killRun: (error: ScriptRunError) => void = () => {};
      /** Set once the run has settled, so a spawn that failed at once is never registered. */
      let done = false;
      const outcome = new Promise<unknown>((resolve, reject) => {
        let settled = false;
        /** The failure a kill is waiting to report once the tree has exited. */
        let failure: ScriptRunError | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bytes = 0;

        const finish = (result: { value: unknown } | { error: ScriptRunError }) => {
          if (settled) return;
          settled = true;
          done = true;
          inFlight.delete(key);
          clearTimeout(timer);
          clearTimeout(grace);
          if ('error' in result) reject(result.error);
          else resolve(result.value);
        };

        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(uv.file, argv, {
            cwd,
            env: { ...options.env() },
            shell: false,
            windowsHide: true,
            // Its own process group, so the whole tree can be killed (POSIX).
            detached: platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        } catch (error) {
          finish({ error: new ScriptRunError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'uv_missing' : 'failed', { cause: error }) });
          return;
        }

        /** Kills the tree and reports `error` once it has exited (or after a grace period). */
        const kill = (error: ScriptRunError) => {
          if (settled || failure !== undefined) return;
          failure = error;
          clearTimeout(timer);
          killTree(child.pid);
          grace = setTimeout(() => finish({ error }), KILL_GRACE_MS);
        };
        killRun = kill;

        const lines = { stdout: lineSplitter(tell('stdout')), stderr: lineSplitter(tell('stderr')) };
        const collect = (into: Buffer[], stream: ScriptStream) => (chunk: Buffer) => {
          if (failure !== undefined) return;
          bytes += chunk.byteLength;
          if (bytes > maxOutputBytes) {
            kill(new ScriptRunError('too_much_output'));
            return;
          }
          into.push(chunk);
          if (onLine !== undefined) lines[stream].push(chunk);
        };
        child.stdout?.on('data', collect(stdout, 'stdout'));
        child.stderr?.on('data', collect(stderr, 'stderr'));
        // A broken pipe is reported by the exit; it must never be unhandled.
        child.stdout?.on('error', () => {});
        child.stderr?.on('error', () => {});

        child.on('error', (error: NodeJS.ErrnoException) => {
          finish({ error: new ScriptRunError(error.code === 'ENOENT' ? 'uv_missing' : 'failed', { cause: error }) });
        });

        child.on('close', (exitCode) => {
          if (failure !== undefined) {
            finish({ error: failure });
            return;
          }
          if (onLine !== undefined) {
            lines.stdout.end();
            lines.stderr.end();
          }
          const err = Buffer.concat(stderr).toString('utf8');
          if (exitCode !== 0) {
            finish({ error: new ScriptRunError('failed', { scriptError: scriptErrorOf(err), exitCode }) });
            return;
          }
          const out = Buffer.concat(stdout).toString('utf8');
          try {
            finish({ value: JSON.parse(out) as unknown });
          } catch (error) {
            finish({ error: new ScriptRunError('bad_output', { cause: error }) });
          }
        });

        timer = setTimeout(() => kill(new ScriptRunError('timeout')), timeoutMs);
      });
      // Registered unless the run already settled (a spawn that failed at once).
      if (!done) inFlight.set(key, { kill: (error) => killRun(error), settled: outcome });
      return outcome;
    },
  };
}
