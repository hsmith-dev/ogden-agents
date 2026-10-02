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
 *   the tree too.
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
 * allowed (`too_much_output`), or its stdout wasn't one JSON value (`bad_output`).
 */
export type ScriptRunErrorCode = 'uv_missing' | 'failed' | 'timeout' | 'too_much_output' | 'bad_output';

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

export interface ScriptRun {
  /** The script's absolute path. */
  script: string;
  args: readonly string[];
  /** The folder it runs in. */
  cwd: string;
}

export interface UvScriptRunner {
  /** The JSON value the script printed on stdout, or a {@link ScriptRunError}. */
  run(input: ScriptRun): Promise<unknown>;
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

  return {
    async run({ script, args, cwd }) {
      const uv = await options.uvCommand();
      if (uv === undefined) throw new ScriptRunError('uv_missing');
      const argv = [...(uv.args ?? []), 'run', '--no-project', '--quiet', script, ...args];

      return new Promise<unknown>((resolve, reject) => {
        let settled = false;
        /** The failure a kill is waiting to report once the tree has exited. */
        let failure: ScriptRunError | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bytes = 0;

        const finish = (outcome: { value: unknown } | { error: ScriptRunError }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(grace);
          if ('error' in outcome) reject(outcome.error);
          else resolve(outcome.value);
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

        const collect = (into: Buffer[]) => (chunk: Buffer) => {
          if (failure !== undefined) return;
          bytes += chunk.byteLength;
          if (bytes > maxOutputBytes) {
            kill(new ScriptRunError('too_much_output'));
            return;
          }
          into.push(chunk);
        };
        child.stdout?.on('data', collect(stdout));
        child.stderr?.on('data', collect(stderr));
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
    },
  };
}
