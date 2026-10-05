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

export interface SandboxPort {
  /** Whether a sandbox can contain `agent`'s build here now, and which. Never throws: a failed probe is unavailable. */
  check(request?: SandboxCheckRequest): Promise<SandboxCheck>;
  /**
   * The same answer in plain words for the Build dialog (story 5.6): what
   * was probed, what is missing and what to install, as text. Its
   * `available` always agrees with `check`. Never throws, never installs.
   */
  status(request?: SandboxCheckRequest): Promise<SandboxStatus>;
}
