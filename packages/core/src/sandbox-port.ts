/**
 * The sandbox port (AD-1, AD-17; story 5.2's tracer, completed and frozen
 * by story 5.3 for 5.6 and epic 6): which sandbox can contain an unattended
 * build of an agent on this computer. Core names no OS or sandbox here; the
 * `sandbox-*` adapters do, tried in order (the agent's native sandbox, then
 * Docker if it is already installed). Without one, a build is refused
 * (`sandbox_unavailable`) with the Build dialog's choices, never run
 * unsandboxed (user decision 2026-10-04, fail closed).
 */
import type { BuildAgent, SandboxChoice, SandboxStatus } from '@ogden-agents/shared';

/** The sandbox a run gets: the agent's own, with only these roots writable and no network. */
export interface AgentSandbox {
  /** The sandbox's kind (a `SandboxKind`: `seatbelt`, `bubblewrap`, `docker`), stored on the run. */
  kind: string;
  /** Absolute paths the agent's commands may write (the worktree, the git paths a commit needs). */
  writableRoots: readonly string[];
  /** Absolute paths inside those roots it may never write (protected paths, `.git/hooks`, `.git/config`). */
  deniedPaths: readonly string[];
  /** Absolute paths it may never read (Ogden Agents' data folder, the user's credential folders; review loop 1). */
  deniedReads: readonly string[];
  /** Absolute paths inside {@link deniedReads} it may read again (the run's own worktree). */
  allowedReads: readonly string[];
}

/**
 * The answer: a sandbox's kind, or why there is none and what the Build
 * dialog offers instead (default all three: another agent, Install
 * Docker, Build with me watching; 5.6).
 */
export type SandboxCheck = { available: true; kind: string } | { available: false; reason: string; choices?: readonly SandboxChoice[] };

/** What a check is for (story 5.3): the agent that would build. Default Claude Code. */
export interface SandboxCheckRequest {
  agent?: BuildAgent;
}

/** One command to run inside a run's sandbox (story 5.8: the verification's test re-run). */
export interface SandboxRunRequest {
  /** The run's sandbox: only its roots are writable, no network. Its `kind` says which sandbox runs it. */
  sandbox: AgentSandbox;
  /** The run's worktree: the command's folder. */
  cwd: string;
  /** One line, run by the shell. From the user's own project files, never from the worktree. */
  command: string;
  /** The environment the command gets and nothing else (the allowlist and the run's own git object store). */
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  /** The most output kept, from the end. */
  maxOutputBytes: number;
  /** Aborted when the run is stopped or the server quits: the command's whole process tree stops and the result is `{ exitCode: null, timedOut: false }`. */
  signal?: AbortSignal | undefined;
}

/** What the command did: its exit code (`null` when it timed out or could not start), whether it timed out, and the end of its output. */
export interface SandboxRunResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export interface SandboxPort {
  /** Whether a sandbox can contain `agent`'s build here now, and which. Never throws: a failed probe is unavailable. */
  check(request?: SandboxCheckRequest): Promise<SandboxCheck>;
  /**
   * The same answer in plain words for the Build dialog (story 5.6): what
   * was probed, what is missing and what to install, as text. Its
   * `available` always agrees with `check`. Never throws, never installs.
   */
  status(request?: SandboxCheckRequest): Promise<SandboxStatus>;
  /**
   * Runs one command inside `request.sandbox` (story 5.8), with no network
   * and only its writable roots writable. `undefined` when no sandbox here
   * can run a command of that kind (the run's sandbox is gone, or it is a
   * kind this port does not run): never run unsandboxed instead. Never throws.
   */
  run(request: SandboxRunRequest): Promise<SandboxRunResult | undefined>;
}
