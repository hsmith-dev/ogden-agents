/** The builds use-cases and what they are given (story 5.10 split `builds.ts`; the header of `builds.ts` says what each does). */
import { ApproveBuildRequest, RetryRunRequest, StartBuildRequest, type CommitPlanFilesResponse, type ReviewResponse, type Run, type SandboxStatus, type Session, type SessionId, type WorkspaceId, type AllReadyBuildsResponse, type RunResponse, type RunsResponse } from '@ogden-agents/shared';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BuildSettings } from './build-settings.js';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { BmadSourceUseCases } from './bmad-source-port.js';
import { type PathNormalizer } from './build-permission-policy.js';
import type { BuildRunnerPort } from './build-runner-port.js';
import type { BuildSessions } from './build-sessions.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { NotFoundError, NotImplementedError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { SandboxPort } from './sandbox-port.js';
import type { TicketStorePort } from './ticket-store-port.js';
import type { VcsPort } from './vcs-port.js';

export interface BuildsUseCases {
  /** Builds one ticket (see the header). Rejects as the header says; nothing is written then. */
  start(workspaceId: WorkspaceId, request: unknown): Promise<{ run: Run; session: Session }>;
  /** What a build's sandbox is here, in plain words, for the Build dialog (story 5.6). Probes only. */
  sandboxStatus(workspaceId: WorkspaceId): Promise<SandboxStatus>;
  /** The ticket's latest run for the review page. `NotFoundError` without one. */
  review(workspaceId: WorkspaceId, ref: string): Promise<ReviewResponse>;
  /** Approve (see the header): `request` is `ApproveBuildRequest`, the revision the user reviewed. */
  approve(workspaceId: WorkspaceId, ref: string, request: unknown): Promise<ReviewResponse>;
  /**
   * Reject (see the header). With `retry: true` in `request` (Reject and
   * retry, story 5.9) the ticket is built again at once, from a new worktree,
   * with the optional `note` in the agent's first message; the answer is the
   * review of that new run.
   */
  reject(workspaceId: WorkspaceId, ref: string, request?: unknown): Promise<ReviewResponse>;
  /**
   * **Commit plan files** (story 5.5, user decision 2026-10-04): commits the
   * ticket's plan and the `tickets.toml` files above it that have changes,
   * and only those, in one commit. Nothing to commit answers `committed: []`.
   * `checkout_dirty` during a merge, rebase, cherry-pick or revert.
   */
  commitPlanFiles(workspaceId: WorkspaceId, ref: string): Promise<CommitPlanFilesResponse>;
  /**
   * The startup sweep (story 5.5, `build-worktrees.ts`): removes what in
   * `<data>/w` no run needs; then, in the background, branches decided runs
   * left. Run before builds are served. Never throws.
   */
  sweep(): Promise<void>;
  /** The run of `sessionId` (a `build` session of the workspace), behind the full guards. `NotFoundError` otherwise. */
  runOfSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<Run>;
  /**
   * Continues run `runId` paused at a checkpoint (story 5.4): sends its
   * prompt (`checkpoint_plan`) or runs its end checks (`checkpoint_done`).
   * `run_not_active` for a run not at a checkpoint; `sandbox_unavailable`
   * without a sandbox. Returns the run as it then is.
   */
  resume(workspaceId: WorkspaceId, runId: unknown): Promise<Run>;
  /**
   * `POST …/runs/:runId/retry` (`RetryRunRequest`): a run at a checkpoint
   * resumes (story 5.4); any other Retry is 5.8's (`NotImplementedError`).
   */
  retry(workspaceId: WorkspaceId, runId: unknown, request: unknown): Promise<Run>;
  /**
   * Build all ready (story 5.8; `StartBuildRequest` with `all: true`): starts
   * every ready ticket (a ticket with an unmet prerequisite never), the rest
   * queued within the limits, and keeps starting tickets that become ready
   * until none is left. Answers the runs it started and the queue now.
   */
  startAll(workspaceId: WorkspaceId, request: unknown): Promise<AllReadyBuildsResponse>;
  /**
   * Stop (story 5.8): a running run's agent stops (its whole process tree)
   * and the run is `stopped`, its worktree kept; a queued run leaves the
   * queue. `run_not_active` for any other run.
   */
  stop(workspaceId: WorkspaceId, runId: unknown): Promise<Run>;
  /** The workspace's runs, newest first, and its queue (story 5.8: the board's Queued, the session header). */
  runs(workspaceId: WorkspaceId): Promise<RunsResponse>;
  /** One run of the workspace and its verification (the latest `run.verification_completed`). `NotFoundError` for another workspace's. */
  run(workspaceId: WorkspaceId, runId: unknown): Promise<RunResponse>;
  /** Starts the queue's next runs where the limits allow (a server start, a changed limit; story 5.8). */
  dispatchQueued(): Promise<void>;
  /** Resolves once every run's activity handed to the recorder is written (tests). */
  recorded(): Promise<void>;
  /** Resolves once no outcome is being worked out (tests, shutdown). */
  settled(): Promise<void>;
  /** Stops following the event log. */
  close(): void;
}


export interface BuildsDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  trust: Pick<BmadScriptTrust, 'requireScriptsTrusted' | 'requireScriptsUnchanged' | 'requireScriptsMatch'>;
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  entities: Pick<
    Entities,
    | 'getWorkspace'
    | 'getSession'
    | 'createRun'
    | 'getRun'
    | 'getRunBySession'
    | 'latestRunForTicket'
    | 'activeRunForTicket'
    | 'setRunOutcome'
    | 'setRunDecision'
    | 'listRunsWithWorktree'
    | 'listRunningRuns'
    | 'listRuns'
    | 'listSessionEvents'
    | 'listQueuedRuns'
    | 'queueOf'
    | 'queueRun'
    | 'dispatchRun'
    | 'leaveQueue'
    | 'setRunBase'
  >;
  events: Pick<EventLog, 'subscribe' | 'lastSeq' | 'append'>;
  /** The install's run limits and a project's build settings (story 5.8), read at each dispatch. */
  settings: Pick<BuildSettings, 'runLimits' | 'workspaceSettings'>;
  /** The environment a re-run command gets: the agents' allowlist, never a key (AD-16; story 5.8). Default: none. */
  commandEnv?: () => Record<string, string>;
  /** Sets a timer (the time limit; tests inject one). Default: `setTimeout`, unreferenced. */
  setTimer?: (run: () => void, ms: number) => { cancel(): void };
  /** The main checkout's tickets, and a run's worktree when given its path (the store itself, never run-aware). */
  tickets: TicketStorePort;
  /**
   * The same store as the board reads it (story 5.8, AD-10): a ticket with an
   * active run is read and marked in its worktree. For prerequisites (a
   * ticket built in a worktree is in review) and Retry's mark. Default: `tickets`.
   */
  runAwareTickets?: TicketStorePort;
  vcs: VcsPort;
  sandbox: SandboxPort;
  runner: BuildRunnerPort;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage' | 'releaseAgent'>;
  buildSessions: BuildSessions;
  /** Ogden Agents' data folder: worktrees go in `<dataDir>/w/`. */
  dataDir: string;
  /** The user's home folder, for the credential folders a build may never read. Default: none listed. */
  homeDir?: string | undefined;
  /** How paths resolve, for the permission policy (tests inject one). Default: this computer's. */
  paths?: PathNormalizer;
  /** Masks secrets in a reason stored from the agent's own words (AGENTS.md). Default: Anthropic keys redacted. */
  mask?: (text: string) => string;
  /** The free bytes on the disk holding a folder, `undefined` when unknown (story 5.5; tests inject one). Default: the OS's. */
  freeBytes?: (dir: string) => number | undefined;
  /** Told about a failure the user sees only as a run's reason (for the log: codes only). */
  onError?: (runId: string, step: string, error: unknown) => void;
}
