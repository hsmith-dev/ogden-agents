/**
 * Project commands and Problems (AD-38; epic 8 entry 2's contract only, 8.9
 * implements both halves): the {@link ProjectCommandRunner} an adapter
 * provides (the server owns each process, AD-3: killed on Stop or server
 * stop; AD-16's allowlisted environment, never `process.env`) and the
 * {@link ProjectCommands} use-case the routes call. A command runs only in
 * a trusted project and only with the exact text the user confirmed.
 * Output is masked and stays out of the event log; events carry ids, the
 * state, the exit code and counts.
 */
import type { ProjectCommandRunDetail, ProjectCommandRunResponse, ProjectCommandsResponse } from '@ogden-agents/shared';

/** How one started command ended. */
export interface ProjectCommandExit {
  /** `null` when it was killed, or never started. */
  exitCode: number | null;
  /** Stopped by the user or the server. */
  stopped: boolean;
  /** Why it never started, in plain words ("npm wasn't found on this computer."), never raw output. */
  error?: string | undefined;
}

/** One running command. */
export interface ProjectCommandProcess {
  /** Settles once the process has exited (never rejects). */
  readonly done: Promise<ProjectCommandExit>;
  /** Kills its whole process tree; done settles with `stopped`. */
  stop(): void;
  /** Its output so far, raw (core masks it): the last `PROJECT_COMMAND_OUTPUT_MAX_BYTES`, `truncated` when cut. */
  output(): { text: string; truncated: boolean };
}

export interface ProjectCommandRunner {
  /** Starts `command` (the confirmed text) in `cwd` (the project's real path). */
  start(input: { cwd: string; command: string }): ProjectCommandProcess;
}

/** What the Problems routes call (8.9). Every method refuses an untrusted project and a project of another install. */
export interface ProjectCommands {
  list(workspaceId: unknown): Promise<ProjectCommandsResponse>;
  set(workspaceId: unknown, body: unknown): Promise<ProjectCommandsResponse>;
  run(workspaceId: unknown, commandId: unknown): Promise<ProjectCommandRunResponse>;
  get(workspaceId: unknown, runId: unknown): Promise<ProjectCommandRunDetail>;
  stop(workspaceId: unknown, runId: unknown): Promise<ProjectCommandRunResponse>;
}
