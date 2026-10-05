/**
 * The sandbox port (AD-1, AD-17; story 5.2's tracer, the minimal shape 5.3
 * freezes): which sandbox can contain an unattended build on this computer.
 * Core names no OS or sandbox here; the `sandbox-*` adapters do. Without
 * one, a build is refused (`sandbox_unavailable`), never run unsandboxed
 * (user decision 2026-10-04, fail closed).
 */

/** The sandbox a run gets: the agent's own, with only these roots writable and no network. */
export interface AgentSandbox {
  /** The sandbox's kind (`seatbelt`, `bubblewrap`, …), stored on the run. */
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

export type SandboxCheck = { available: true; kind: string } | { available: false; reason: string };

export interface SandboxPort {
  /** Whether a sandbox can contain a build here now, and which. Never throws: a failed probe is unavailable. */
  check(): Promise<SandboxCheck>;
}
