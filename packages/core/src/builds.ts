/**
 * Unattended builds (CAP-8, CAP-9, CAP-10, CAP-12; story 5.2, epic 5's
 * tracer bullet, hardened by its review loop 1): one ticket built in its own
 * worktree by a `build` session, reviewed, and approved (a local merge with
 * the ticket's `done` mark in the merge commit) or rejected.
 *
 * Every use-case serves the `builds` piece and calls the guards in board's
 * order (AD-22): the piece, the project's script trust, the pinned BMad
 * Method, then the project's scripts unchanged. The repo is the workspace's
 * stored real path, never request input.
 *
 * - `start`: refuses without a sandbox (`sandbox_unavailable` with the
 *   sandbox's own reason, fail closed), with a run of the ticket still
 *   running (`run_active`), a ticket that isn't `ready-for-dev`
 *   (`not_ready`), one waiting on a ticket (or epic) not done or in review
 *   (`prerequisite_unmet`), a project that isn't a git repository's top
 *   folder with a branch that has a commit (`vcs_unavailable`), or a plan or
 *   `tickets.toml` with uncommitted changes (`plan_uncommitted`); nothing is
 *   written then. Otherwise it adds a worktree under `<data>/w/<run8>` on
 *   `ogden/<run8>/<ref>-<slug>` from the checked-out branch; a worktree whose
 *   `_bmad/scripts/` aren't the trusted ones (BMad files not committed) is
 *   removed and the build refused. Then a `build` session with its run, what
 *   the session's agent starts with (the worktree, the sandbox, the build
 *   permission policy), and the build runner's invocation. Any failure after
 *   the worktree exists removes it (and ends a created run `failed`).
 * - When the session's turn ends, core checks the worktree's
 *   `_bmad/scripts/` are the trusted ones, reads the plan's status there,
 *   releases the agent and sets the outcome: `verified` for `built` with a
 *   non-empty diff that touches no protected path, no `tickets.toml` and no
 *   other ticket's plan (5.8 adds the test re-run), `blocked` with the plan's
 *   reason, else `failed`. Stored reasons are masked.
 * - `approve`: only a `verified`, unmerged run whose branch still points at
 *   the revision the user reviewed. Refused (`checkout_dirty`, the run
 *   unchanged) on a checkout with uncommitted changes outside
 *   `_bmad-output/`, any staged change, a changed plan file, or a merge,
 *   rebase, cherry-pick or revert in progress. Merges that revision with
 *   `--no-ff --no-commit --no-overwrite-ignore`; a real conflict aborts it
 *   (the checkout unchanged) and blocks the run (`merge_conflict`), another
 *   refusal leaves it `verified`. Then the project's scripts must still be
 *   the trusted ones, the ticket is marked `done` (the only path to it,
 *   AD-10), its plan staged, and one merge commit made; a failure after the
 *   mark restores the plan, then aborts the merge. Never a push or a force.
 *   The worktree and the merged branch go (story 5.5). One operation per
 *   repo at a time, shared with the board's marks.
 * - `reject`: stops the run and removes its worktree and branch (a discard,
 *   story 5.5); the ticket is untouched.
 * - Story 5.5 (`build-worktrees.ts`): Build and approve need git
 *   `MIN_GIT_VERSION` or newer (`vcs_unavailable` with a plain reason);
 *   Build needs 1 GB free (`disk_space_low`); approve needs the branch the
 *   build started from still checked out (`checkout_dirty`); a removal that
 *   fails is retried by `sweep` at the next server start; `commitPlanFiles`
 *   is **Commit plan files**.
 * - Story 5.4: each run has a folder in the data folder (`<data>/r/<runId>`,
 *   `build-run-folder.ts`) with its NDJSON activity and its per-run JSON
 *   result, written each time the session stops. Checkpoint pauses are
 *   Ogden's own (user decision 2026-10-04): with the ticket's
 *   `plan_checkpoint` the run is `blocked` (`checkpoint_plan`) before its
 *   prompt is sent; with `done_checkpoint` it is `blocked`
 *   (`checkpoint_done`) when the plan ends `built`, before the end checks.
 *   `resume` continues either (sends the prompt, or runs the end checks),
 *   after the guards, a fresh sandbox check (fail closed) and the worktree's
 *   scripts check; after a server restart it rebuilds the session's setup
 *   from the run, so the next prompt starts a fresh agent there. A run at a
 *   checkpoint counts as active: no second build of its ticket starts.
 *
 * Core names no skill, VCS, sandbox or agent (AD-1, AD-12).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative } from 'node:path';
import {
  ALL_READY_NOT_AVAILABLE_MESSAGE,
  ALREADY_MERGED_MESSAGE,
  ApproveBuildRequest,
  BUILD_RESULT_STATUSES,
  blockedSentence,
  CHECKPOINT_BLOCKED_CODES,
  RetryRunRequest,
  RETRY_NOT_AVAILABLE_MESSAGE,
  RUN_NOT_ACTIVE_MESSAGE,
  RunId,
  BMAD_FILES_UNCOMMITTED_MESSAGE,
  BUILD_BRANCH_PREFIX,
  WORKTREES_FOLDER_NOT_REAL_MESSAGE,
  CHECKOUT_BUSY_MESSAGE,
  CHECKOUT_MOVED_MESSAGE,
  DISK_SPACE_LOW_MESSAGE,
  GIT_MISSING_MESSAGE,
  gitTooOldMessage,
  MIN_FREE_DISK_BYTES,
  CHECKOUT_DIRTY_MESSAGE,
  CHECKS_FAILED_MESSAGE,
  MAX_REVIEW_DIFF_BYTES,
  MERGE_CONFLICT_MESSAGE,
  MERGE_REFUSED_MESSAGE,
  NOT_READY_MESSAGE,
  PLAN_UNCOMMITTED_MESSAGE,
  PREREQUISITE_UNMET_MESSAGE,
  redactApiKeys,
  REVIEW_STALE_MESSAGE,
  RUN_ACTIVE_MESSAGE,
  RUN_REASON_AGENT_ERROR,
  RUN_REASON_EMPTY_DIFF,
  RUN_REASON_NO_NETWORK,
  RUN_REASON_NOT_BUILT,
  RUN_REASON_PROTECTED_DIFF,
  RUN_REASON_SCRIPTS_CHANGED,
  RUN_REASON_START_FAILED,
  RUN_REASON_UNREADABLE,
  SANDBOX_UNAVAILABLE_MESSAGE,
  StartBuildRequest,
  TICKET_REF_PATTERN,
  UNKNOWN_BUILD_AGENT_MESSAGE,
  VCS_NOT_TOP_LEVEL_MESSAGE,
  VCS_UNAVAILABLE_MESSAGE,
  type BlockedCode,
  type BuildAgent,
  type BuildRunResult,
  type CommitPlanFilesResponse,
  type ReviewResponse,
  type Run,
  type Session,
  type SessionId,
  type TicketDetail,
  type TicketRow,
  type TicketsResponse,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { BmadSourceUseCases } from './bmad-source-port.js';
import { BUILD_PERMISSION_DENIED, decideBuildPermission, nodePathNormalizer, type PathNormalizer } from './build-permission-policy.js';
import type { BuildRunnerPort } from './build-runner-port.js';
import { createRunActivityRecorder, runFolderOf, runShortOf, writeRunResult } from './build-run-folder.js';
import { ensureWorktreesRoot, freeBytesOf, removeRunWorktree, sweepRunBranches, sweepWorktrees } from './build-worktrees.js';
import type { BuildSessions } from './build-sessions.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { BuildRefusedError, NotFoundError, NotImplementedError, ScriptsChangedError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { isProtectedSegment, PROTECTED_PATHS } from './permission-matching.js';
import { workspaceRepoPath } from './planning.js';
import { serializedByRepo } from './repo-serialization.js';
import type { AgentSandbox, SandboxPort } from './sandbox-port.js';
import type { TicketRunGuard, TicketStorePort } from './ticket-store-port.js';
import type { VcsPort } from './vcs-port.js';

export { BUILD_PERMISSION_DENIED };


/** The BMad output folder whose uncommitted changes never block approve (user decision 2026-10-01). */
export const BMAD_OUTPUT_PREFIX = '_bmad-output/';

/** The plan status a ticket must have to be built. */
const READY_STATUS = 'ready-for-dev';

/** The ticket states a prerequisite may be in: done, or in review (`in-review`, `built`). */
const PREREQUISITE_MET_STATES: ReadonlySet<string> = new Set(['done', 'review']);

/** Empty protected folders made in a new worktree, so the sandbox's read-only binds exist (review loop 1). */
const PRECREATED_FOLDERS = ['.claude', '.vscode', '.idea', '_bmad'];

/** The user's credential folders a build's commands may never read (review loop 1), under the home folder. */
const CREDENTIAL_FOLDERS = ['.ssh', '.aws', '.gnupg', join('.config', 'gh'), '.netrc', '.docker'];

export interface BuildsUseCases {
  /** Builds one ticket (see the header). Rejects as the header says; nothing is written then. */
  start(workspaceId: WorkspaceId, request: unknown): Promise<{ run: Run; session: Session }>;
  /** The ticket's latest run for the review page. `NotFoundError` without one. */
  review(workspaceId: WorkspaceId, ref: string): Promise<ReviewResponse>;
  /** Approve (see the header): `request` is `ApproveBuildRequest`, the revision the user reviewed. */
  approve(workspaceId: WorkspaceId, ref: string, request: unknown): Promise<ReviewResponse>;
  /** Reject (see the header). */
  reject(workspaceId: WorkspaceId, ref: string): Promise<ReviewResponse>;
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
  entities: Pick<Entities, 'getWorkspace' | 'getSession' | 'createRun' | 'getRun' | 'getRunBySession' | 'latestRunForTicket' | 'activeRunForTicket' | 'setRunOutcome' | 'setRunDecision' | 'listRunsWithWorktree'>;
  events: Pick<EventLog, 'subscribe' | 'lastSeq'>;
  tickets: TicketStorePort;
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

/** `ref` as the store takes it, or {@link ValidationError}. */
function checkedRef(ref: unknown): string {
  if (typeof ref !== 'string' || !TICKET_REF_PATTERN.test(ref)) {
    throw new ValidationError('That is not a ticket reference.', [{ path: ['ref'], message: 'That is not a ticket reference.' }]);
  }
  return ref;
}

/** A git-safe branch name for run `runId` (8 characters) of ticket `ref` titled `title`: `ogden/<run8>/<ref>-<slug>`, unique per run. */
export function buildBranchName(runId: string, ref: string, title: string): string {
  const safeRef = ref.replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '') || 'ticket';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const name = `${BUILD_BRANCH_PREFIX}${runId}/${safeRef}${slug === '' ? '' : `-${slug}`}`;
  return name.endsWith('.lock') ? `${name}-1` : name;
}

/** Whether `name` is a branch name Ogden made (checked before every use). */
export function isBuildBranch(name: string): boolean {
  return /^ogden\/[a-z2-7]{8}\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..') && !name.endsWith('.lock') && !name.endsWith('.');
}

/**
 * Whether every prerequisite `row` names is met: a ticket done or in review
 * (a sibling's id `2` in epic `1` is `1.2`), or an epic, named by its slug,
 * that is done (the board's rule; review loop 1).
 */
export function prerequisitesMet(row: Pick<TicketRow, 'ref' | 'after'>, tree: Pick<TicketsResponse, 'tickets' | 'epics'>): boolean {
  const dot = row.ref.lastIndexOf('.');
  const epic = dot === -1 ? undefined : row.ref.slice(0, dot);
  return row.after.every((link) => {
    const text = String(link);
    const named = tree.epics.find((each) => each.slug === text);
    if (named !== undefined) return named.status === 'done';
    const ref = text.includes('.') || epic === undefined ? text : `${epic}.${text}`;
    const found = tree.tickets.find((each) => each.ref === ref);
    return found !== undefined && PREREQUISITE_MET_STATES.has(found.state);
  });
}

/** An 8-character lowercase id for a run's worktree folder and branch. */
const runShortId = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return [...randomBytes(8)].map((byte) => alphabet[byte % 32]).join('');
};

/** Whether the build's diff touches what it may not (review loop 1): a protected name, any `tickets.toml`, another ticket's plan. */
export function forbiddenChanges(files: readonly string[], ownPlan: string | null): string[] {
  return files.filter((file) => {
    const segments = file.split('/');
    if (segments.some((segment) => isProtectedSegment(segment))) return true;
    const base = segments.at(-1) ?? '';
    if (base.toLowerCase() === 'tickets.toml') return true;
    return file.startsWith(BMAD_OUTPUT_PREFIX) && base.endsWith('-plan.md') && file !== ownPlan;
  });
}

/** A run id as core takes it, or {@link ValidationError}. */
function checkedRunId(runId: unknown): RunId {
  const parsed = RunId.safeParse(runId);
  if (!parsed.success) throw new ValidationError('That is not a run.', [{ path: ['runId'], message: 'That is not a run.' }]);
  return parsed.data;
}

/** Whether `run` is paused at a checkpoint (story 5.4). */
export function atCheckpoint(run: Pick<Run, 'outcome' | 'blockedCode' | 'decision'>): boolean {
  return run.outcome === 'blocked' && run.decision === null && run.blockedCode !== null && CHECKPOINT_BLOCKED_CODES.includes(run.blockedCode);
}

/**
 * The intent-gap patch beside `plan` in `worktree` (the skill saves it named
 * after the plan, `.patch` for `.md`), repo-relative, when it is a regular
 * file whose real path is under the worktree's own `_bmad-output/` (never
 * through a link out of it); else `null`.
 */
export function intentGapPatchOf(worktree: string, plan: string | null): string | null {
  if (plan === null || !plan.startsWith(BMAD_OUTPUT_PREFIX) || !plan.endsWith('.md')) return null;
  const patch = `${plan.slice(0, -'.md'.length)}.patch`;
  if (patch.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) return null;
  try {
    const file = join(worktree, ...patch.split('/'));
    if (!lstatSync(file).isFile()) return null;
    const output = realpathSync.native(join(worktree, BMAD_OUTPUT_PREFIX));
    const real = realpathSync.native(file);
    const rel = relative(output, real);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && realpathSync.native(worktree) === dirname(output) ? patch : null;
  } catch {
    return null;
  }
}

/** The plan statuses a per-run result may name. */
const RESULT_STATUSES: ReadonlySet<string> = new Set(BUILD_RESULT_STATUSES);

/** At most this many characters of a reason go into a per-run result (its schema's bound). */
const MAX_RESULT_TEXT = 2000;

export function createBuilds(deps: BuildsDeps): BuildsUseCases {
  const { bmad, trust, source, entities, events, tickets, vcs, sandbox, runner, chat, buildSessions, dataDir } = deps;
  const paths = deps.paths ?? nodePathNormalizer();
  const mask = deps.mask ?? redactApiKeys;
  const report = (runId: string, step: string, error: unknown) => {
    try {
      deps.onError?.(runId, step, error);
    } catch {
      // Logging must never break a run.
    }
  };

  // Every build run's session stream, as NDJSON in its run folder (story 5.4).
  const recorder = createRunActivityRecorder({ events, entities, dataDir, mask, onError: (runId, error) => report(runId, 'activity', error) });

  /**
   * Writes run `run`'s per-run JSON result (story 5.4) from the plan as
   * `ticket` read it in the worktree (`undefined`: unreadable), the branch's
   * head and `reason` (the run's reason when it is blocked). Never throws: a
   * result that can't be written is reported, and the run goes on.
   */
  const writeResult = async (run: Run, repoPath: string, ticket: TicketDetail | undefined, reason: string | null, blocked: boolean): Promise<void> => {
    const short = runShortOf(run);
    if (short === undefined) return;
    try {
      await recorder.flushed(run.id);
      const status = ticket?.status ?? null;
      const known = status !== null && RESULT_STATUSES.has(status) ? (status as BuildRunResult['status']) : null;
      const commit = run.branch !== null && isBuildBranch(run.branch) ? ((await vcs.branchRevision(repoPath, run.branch)) ?? null) : null;
      const condition = known === 'blocked' && ticket !== undefined && (ticket.blocked_reason ?? '').trim() !== '' ? mask(ticket.blocked_reason ?? '').slice(0, MAX_RESULT_TEXT) : null;
      await writeRunResult(runFolderOf(dataDir, short), {
        version: 1,
        runId: run.id,
        ticketRef: run.ticketRef,
        status: known,
        commit,
        baseRevision: run.baseRevision,
        blockedCondition: condition,
        blockedReason: blocked && reason !== null ? mask(reason).slice(0, MAX_RESULT_TEXT) : null,
        intentGapPatch: known === 'blocked' && ticket !== undefined && run.worktreePath !== null ? intentGapPatchOf(run.worktreePath, ticket.plan) : null,
        networkFailure: recorder.networkFailure(run.id),
        endedAt: new Date().toISOString(),
      });
    } catch (error) {
      report(run.id, 'result', error);
    }
  };

  /** The guards in board's order (the piece, the trust, the pinned BMad Method, the scripts unchanged), then the repo. */
  const guarded = async (workspaceId: WorkspaceId): Promise<{ repoPath: string; guard: TicketRunGuard }> => {
    bmad.requireBmadFeature(workspaceId, 'builds');
    trust.requireScriptsTrusted(workspaceId);
    source.requireReady();
    const repoPath = workspaceRepoPath(entities, workspaceId);
    const scripts = await trust.requireScriptsUnchanged(workspaceId);
    return { repoPath, guard: { scripts } };
  };

  /** The ticket's plan files with uncommitted changes: the plan, its epic's `tickets.toml` and the initiative's. */
  const uncommittedPlanFiles = async (repoPath: string, plan: string | null): Promise<string[]> => {
    if (plan === null) return [];
    const changed = new Set(await vcs.status(repoPath));
    const epicFolder = posix.dirname(plan);
    const watched = [plan, posix.join(epicFolder, 'tickets.toml'), posix.join(posix.dirname(epicFolder), 'tickets.toml')];
    return [...new Set(watched)].filter((path) => changed.has(path));
  };

  /** Throws `plan_uncommitted` when the ticket's plan or a `tickets.toml` above it has uncommitted changes. */
  const requirePlanCommitted = async (repoPath: string, plan: string | null): Promise<void> => {
    if ((await uncommittedPlanFiles(repoPath, plan)).length > 0) throw new BuildRefusedError('plan_uncommitted', PLAN_UNCOMMITTED_MESSAGE);
  };

  /** Throws `vcs_unavailable` with a plain reason when git is missing or older than builds need (story 5.5). */
  const requireGit = async (): Promise<void> => {
    const git = await vcs.check();
    if (git.ok) return;
    throw new BuildRefusedError('vcs_unavailable', git.reason === 'missing' ? GIT_MISSING_MESSAGE : gitTooOldMessage(git.version));
  };

  const cleanupDeps = { dataDir, vcs, isBuildBranch };

  /** What the run's agent may write: its worktree, the run's own git paths; never hooks, config, `objects/info` or another ref. */
  const sandboxFor = async (kind: string, worktreePath: string, branch: string): Promise<{ sandbox: AgentSandbox; gitWritable: string[] }> => {
    // Only the run's own branch's ref and reflog folders (`ogden/<run8>/`), never the user's refs.
    const git = await vcs.worktreeGitPaths(worktreePath, branch);
    const gitWritable = [join(git.commonDir, 'objects'), git.branchRefDir, git.branchLogDir, git.gitDir];
    const deniedPaths = [
      join(git.commonDir, 'objects', 'info'),
      join(git.commonDir, 'hooks'),
      join(git.commonDir, 'config'),
      ...PROTECTED_PATHS.folders.map((folder) => join(worktreePath, folder)),
      ...PROTECTED_PATHS.files.map((file) => join(worktreePath, file)),
    ];
    const home = deps.homeDir;
    const deniedReads = [paths.realpath(dataDir) ?? dataDir, ...(home === undefined ? [] : CREDENTIAL_FOLDERS.map((folder) => join(home, folder)))];
    return { sandbox: { kind, writableRoots: [worktreePath, ...gitWritable], deniedPaths, deniedReads, allowedReads: [worktreePath] }, gitWritable };
  };

  const startLocked = async (workspaceId: WorkspaceId, repoPath: string, ref: string, agent: BuildAgent): Promise<{ run: Run; session: Session }> => {
    // Fail closed: never an unsandboxed unattended run (user decision 2026-10-04); the sandbox says why.
    const check = await sandbox.check({ agent });
    if (!check.available) throw new BuildRefusedError('sandbox_unavailable', `${SANDBOX_UNAVAILABLE_MESSAGE} ${check.reason}`.trim());
    await requireGit();
    if (entities.activeRunForTicket(workspaceId, ref) !== undefined) throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
    // A run paused at a checkpoint is still this ticket's build (story 5.4): resume or reject it first.
    const latest = entities.latestRunForTicket(workspaceId, ref);
    if (latest !== undefined && atCheckpoint(latest)) throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
    const { guard } = await guarded(workspaceId);
    const ticket = await tickets.find(repoPath, ref, guard);
    if ((ticket.status ?? '') !== READY_STATUS) throw new BuildRefusedError('not_ready', NOT_READY_MESSAGE);
    if (ticket.after.length > 0 && !prerequisitesMet(ticket, await tickets.tree(repoPath, guard))) throw new BuildRefusedError('prerequisite_unmet', PREREQUISITE_UNMET_MESSAGE);
    // The project must be its repository's top folder: a worktree is of the whole repository.
    const top = await vcs.topLevel(repoPath);
    if (top === undefined) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
    if ((paths.realpath(top) ?? top) !== (paths.realpath(repoPath) ?? repoPath)) throw new BuildRefusedError('vcs_unavailable', VCS_NOT_TOP_LEVEL_MESSAGE);
    const head = await vcs.head(repoPath);
    if (head === undefined) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
    await requirePlanCommitted(repoPath, ticket.plan);
    // The guards once more, right before anything is written: a piece turned off meanwhile writes nothing.
    await guarded(workspaceId);

    // Room for the worktree (story 5.5): refused before anything is written when the disk is nearly full.
    const free = (deps.freeBytes ?? freeBytesOf)(dataDir);
    if (free !== undefined && free < MIN_FREE_DISK_BYTES) throw new BuildRefusedError('disk_space_low', DISK_SPACE_LOW_MESSAGE);
    let parent: string;
    try {
      parent = ensureWorktreesRoot(dataDir);
    } catch {
      throw new BuildRefusedError('vcs_unavailable', WORKTREES_FOLDER_NOT_REAL_MESSAGE);
    }
    // A run id no run, folder or branch has yet (collision-free; 40 random bits, tried a few times, never reused).
    const taken = async (id: string): Promise<boolean> =>
      existsSync(join(parent, id)) || entities.listRunsWithWorktree().some((each) => each.branch?.startsWith(`${BUILD_BRANCH_PREFIX}${id}/`) === true) || (await vcs.branchRevision(repoPath, buildBranchName(id, ref, ticket.title))) !== undefined;
    let runShort = runShortId();
    for (let attempt = 0; await taken(runShort); attempt++) {
      if (attempt >= 5) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
      runShort = runShortId();
    }
    const branch = buildBranchName(runShort, ref, ticket.title);
    if (!isBuildBranch(branch)) throw new ValidationError('That ticket reference makes no usable branch name.', [{ path: ['ref'], message: 'unusable branch name' }]);
    const worktreePath = join(parent, runShort);
    await vcs.addWorktree(repoPath, { path: worktreePath, branch, base: head.revision });
    let run: Run | undefined;
    let session: Session | undefined;
    try {
      const real = paths.realpath(worktreePath) ?? worktreePath;
      // The worktree's scripts are the committed ones: they must be the ones the user trusted (BMad files committed).
      try {
        await trust.requireScriptsMatch(workspaceId, real);
      } catch (error) {
        if (error instanceof ScriptsChangedError) throw new BuildRefusedError('plan_uncommitted', BMAD_FILES_UNCOMMITTED_MESSAGE);
        throw error;
      }
      for (const folder of PRECREATED_FOLDERS) mkdirSync(join(real, folder), { recursive: true });
      const { sandbox: contained, gitWritable } = await sandboxFor(check.kind, real, branch);
      session = await chat.createChatSession(workspaceId, { kind: 'build', agentId: runner.agent });
      run = entities.createRun({ sessionId: session.id, ticketRef: ref, worktreePath: real, sandbox: check.kind, branch, baseRevision: head.revision, baseBranch: head.branch, agent });
      const scope = { worktree: real, gitWritable, protectedPaths: PROTECTED_PATHS };
      buildSessions.set(session.id, { cwd: real, sandbox: contained, decide: (request) => decideBuildPermission(request, scope, paths) });
      if (ticket.plan_checkpoint === true) {
        // The plan checkpoint (story 5.4): paused before the prompt is sent; `resume` sends it.
        const reason = blockedSentence('checkpoint_plan');
        run = entities.setRunOutcome(run.id, 'blocked', reason, { blockedCode: 'checkpoint_plan' });
        await writeResult(run, repoPath, ticket, reason, true);
        return { run, session };
      }
      chat.sendMessage(workspaceId, session.id, runner.invocation(ref), { build: true });
      // The ticket's previous run, undecided and not running, is superseded (story 5.5 review): no Retry or Reject reaches it now, so its worktree and branch go.
      if (latest !== undefined && latest.decision === null && latest.outcome !== 'running') await cleanUp(repoPath, latest);
      return { run, session };
    } catch (error) {
      if (session !== undefined) buildSessions.delete(session.id);
      // Nothing of a run that didn't start is left behind: no worktree, and no branch unless a run names it.
      await vcs.removeWorktree(repoPath, worktreePath, run === undefined ? { deleteBranch: branch } : {}).catch((cleanup: unknown) => report(run?.id ?? 'none', 'cleanup', cleanup));
      if (run !== undefined) {
        try {
          entities.setRunOutcome(run.id, 'failed', RUN_REASON_START_FAILED);
        } catch (outcome) {
          report(run.id, 'outcome', outcome);
        }
      }
      throw error;
    }
  };

  /**
   * Whether the ticket of `run` has `done_checkpoint`, read in the main
   * checkout (review): never in the worktree, whose `tickets.toml` the agent
   * can edit without committing. The project's scripts must still be the
   * trusted ones before `tickets.py` runs there.
   */
  const doneCheckpointOf = async (run: Run, repoPath: string): Promise<boolean> => {
    const scripts = await trust.requireScriptsUnchanged(run.workspaceId);
    return (await tickets.find(repoPath, run.ticketRef, { scripts })).done_checkpoint === true;
  };

  /** Works out a finished turn's outcome (see the header). */
  const decideOutcome = async (run: Run, ended: 'idle' | 'error', options: { passedDone?: boolean } = {}): Promise<void> => {
    if (run.worktreePath === null) return;
    let repoPath: string;
    try {
      repoPath = workspaceRepoPath(entities, run.workspaceId);
    } catch {
      return;
    }
    let outcome: 'verified' | 'failed' | 'blocked';
    let reason: string | null = null;
    let blockedCode: BlockedCode | null = null;
    let ticket: TicketDetail | undefined;
    try {
      // The agent may have edited the worktree's scripts: they must be the trusted ones before `tickets.py` runs there.
      const scripts = await trust.requireScriptsMatch(run.workspaceId, run.worktreePath);
      ticket = await tickets.find(run.worktreePath, run.ticketRef, { scripts });
      const status = ticket.status ?? '';
      if (status === 'built' && options.passedDone !== true && (await doneCheckpointOf(run, repoPath))) {
        // The done checkpoint (story 5.4): paused before the end checks; `resume` runs them.
        outcome = 'blocked';
        blockedCode = 'checkpoint_done';
        reason = blockedSentence('checkpoint_done');
      } else if (status === 'built') {
        const changes = run.branch === null || run.baseRevision === null ? undefined : await vcs.diff(repoPath, run.baseRevision, run.branch, { maxBytes: 1 });
        if (changes === undefined || changes.files.length === 0) {
          outcome = 'failed';
          reason = RUN_REASON_EMPTY_DIFF;
        } else if (forbiddenChanges(changes.files, ticket.plan).length > 0) {
          outcome = 'failed';
          reason = RUN_REASON_PROTECTED_DIFF;
        } else outcome = 'verified';
      } else if (status === 'blocked') {
        outcome = 'blocked';
        const said = ticket.blocked_reason === null || ticket.blocked_reason.trim() === '' ? RUN_REASON_NOT_BUILT(status) : ticket.blocked_reason;
        // The halt's code is the runner's to say (AD-12; story 5.3): core never reads the skill's words.
        blockedCode = runner.blockedCode(ticket.blocked_reason ?? '');
        reason = `${said} ${RUN_REASON_NO_NETWORK}`;
      } else {
        outcome = 'failed';
        reason = `${ended === 'error' ? RUN_REASON_AGENT_ERROR : RUN_REASON_NOT_BUILT(status)} ${RUN_REASON_NO_NETWORK}`;
      }
    } catch (error) {
      report(run.id, 'outcome', error);
      outcome = 'failed';
      reason = error instanceof ScriptsChangedError ? RUN_REASON_SCRIPTS_CHANGED : RUN_REASON_UNREADABLE;
    }
    // The run's agent is done: its process tree stops now, not at the next server stop.
    await chat.releaseAgent(run.workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
    // Only a run still running gets an outcome here: a Reject meanwhile stands.
    if (entities.getRunBySession(run.sessionId)?.outcome !== 'running') return;
    const decided = entities.setRunOutcome(run.id, outcome, reason === null ? null : mask(reason), { blockedCode });
    await writeResult(decided, repoPath, ticket, decided.reason, outcome === 'blocked');
  };

  const deciding = new Set<Promise<void>>();
  /** Runs `work` as an outcome being worked out, so `settled` waits for it. */
  const track = (runId: string, work: () => Promise<void>): Promise<void> => {
    const pending: Promise<void> = Promise.resolve()
      .then(work)
      .catch((error: unknown) => report(runId, 'outcome', error))
      .finally(() => deciding.delete(pending));
    deciding.add(pending);
    return pending;
  };
  const unsubscribe = events.subscribe(events.lastSeq(), (event) => {
    if (event.type !== 'session.state_changed') return;
    const { sessionId, state, previous, resumable } = event.payload;
    if ((state !== 'idle' && state !== 'error') || (previous !== 'working' && previous !== 'waiting')) return;
    // An agent stopped under it (a server stop, a dropped agent) did not finish its turn: the server start settles it.
    if (resumable === true) return;
    const run = entities.getRunBySession(sessionId);
    if (run === undefined || run.outcome !== 'running') return;
    void track(run.id, () => decideOutcome(run, state));
  });

  /** Resume (see the header), inside the repo's serialization. */
  const resumeLocked = async (workspaceId: WorkspaceId, repoPath: string, runId: RunId, note: string | undefined): Promise<Run> => {
    await guarded(workspaceId);
    const run = entities.getRun(runId);
    if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', runId);
    if (!atCheckpoint(run) || run.worktreePath === null || run.branch === null || !isBuildBranch(run.branch)) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    // Fail closed, as at the start: never an unsandboxed unattended run.
    const check = await sandbox.check({ agent: run.agent ?? runner.agent });
    if (!check.available) throw new BuildRefusedError('sandbox_unavailable', `${SANDBOX_UNAVAILABLE_MESSAGE} ${check.reason}`.trim());
    if (!(await vcs.worktreeExists(repoPath, run.worktreePath))) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    // The worktree's scripts must still be the trusted ones before anything runs there.
    await trust.requireScriptsMatch(workspaceId, run.worktreePath);
    if (buildSessions.get(run.sessionId) === undefined) {
      // The server restarted since the pause: the session's setup is rebuilt from the run, so the next prompt starts a fresh agent there.
      const { sandbox: contained, gitWritable } = await sandboxFor(check.kind, run.worktreePath, run.branch);
      const scope = { worktree: run.worktreePath, gitWritable, protectedPaths: PROTECTED_PATHS };
      buildSessions.set(run.sessionId, { cwd: run.worktreePath, sandbox: contained, decide: (request) => decideBuildPermission(request, scope, paths) });
    }
    const resumed = entities.setRunOutcome(run.id, 'running', null);
    if (run.blockedCode === 'checkpoint_plan') {
      try {
        chat.sendMessage(workspaceId, run.sessionId, runner.invocation(run.ticketRef, { note }), { build: true });
      } catch (error) {
        // Nothing was sent: the run stays paused at its checkpoint (review), never `running` with no agent.
        entities.setRunOutcome(run.id, 'blocked', run.reason, { blockedCode: 'checkpoint_plan' });
        throw error;
      }
      return resumed;
    }
    await track(run.id, () => decideOutcome(resumed, 'idle', { passedDone: true }));
    return entities.getRun(run.id) ?? resumed;
  };

  /** The workspace's latest run of `ref`, as the review page shows it. */
  const reviewOf = async (repoPath: string, run: Run): Promise<ReviewResponse> => {
    // The summary, verification, findings and diff stats are 5.8's and 5.9's (story 5.3 froze them).
    const base = { run, outcome: run.outcome, reason: run.reason, summary: null, verification: null, findings: [], diffStats: null };
    if (run.branch === null || run.baseRevision === null || !isBuildBranch(run.branch)) return { ...base, diff: '', truncated: false, files: [], merged: run.decision === 'approved', headRevision: null };
    const headRevision = (await vcs.branchRevision(repoPath, run.branch)) ?? null;
    // An approved run's branch is deleted with its worktree (story 5.5): it is merged.
    if (headRevision === null) return { ...base, diff: '', truncated: false, files: [], merged: run.decision === 'approved', headRevision };
    const changes = await vcs.diff(repoPath, run.baseRevision, run.branch, { maxBytes: MAX_REVIEW_DIFF_BYTES });
    const merged = changes.files.length > 0 && (await vcs.isMerged(repoPath, run.branch));
    return { ...base, diff: changes.diff, truncated: changes.truncated, files: changes.files, merged, headRevision };
  };

  const latestRun = (workspaceId: WorkspaceId, ref: string): Run => {
    const run = entities.latestRunForTicket(workspaceId, ref);
    if (run === undefined) throw new NotFoundError('run', ref);
    return run;
  };

  /** Stops the run's agent and forgets its session's setup. */
  const release = async (run: Run): Promise<void> => {
    await chat.releaseAgent(run.workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
    buildSessions.delete(run.sessionId);
  };

  /**
   * Removes a decided run's worktree and branch (story 5.5; an approved
   * run's branch only when merged). A failure is reported, never thrown:
   * the decision stands and the next server start's sweep tries again.
   */
  const cleanUp = async (repoPath: string, run: Run): Promise<void> => {
    await removeRunWorktree(cleanupDeps, repoPath, run).catch((error: unknown) => report(run.id, 'cleanup', error));
  };

  /** Approve's checkout checks: nothing staged, the plan untouched, no operation in progress, nothing changed outside `_bmad-output/`. */
  const requireCleanCheckout = async (repoPath: string, plan: string | null): Promise<void> => {
    if ((await vcs.operationInProgress(repoPath)) || (await vcs.staged(repoPath)).length > 0) throw new BuildRefusedError('checkout_dirty', CHECKOUT_BUSY_MESSAGE);
    const changed = await vcs.status(repoPath);
    if (plan !== null && changed.includes(plan)) throw new BuildRefusedError('checkout_dirty', CHECKOUT_BUSY_MESSAGE);
    if (changed.some((path) => !path.startsWith(BMAD_OUTPUT_PREFIX))) throw new BuildRefusedError('checkout_dirty', CHECKOUT_DIRTY_MESSAGE);
  };

  return {
    async start(workspaceId, request) {
      const { repoPath } = await guarded(workspaceId);
      const parsed = StartBuildRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Name one ticket to build.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      // Every ready ticket is 5.8's dispatcher (story 5.3 froze the request).
      if (parsed.data.ref === undefined) throw new NotImplementedError(ALL_READY_NOT_AVAILABLE_MESSAGE);
      const ref = checkedRef(parsed.data.ref);
      // Each agent builds through its own runner (epic 6 adds runners, not core); v1 has Claude Code's.
      const agent = parsed.data.agent ?? runner.agent;
      if (agent !== runner.agent) throw new ValidationError(UNKNOWN_BUILD_AGENT_MESSAGE, [{ path: ['agent'], message: UNKNOWN_BUILD_AGENT_MESSAGE }]);
      return serializedByRepo(repoPath, () => startLocked(workspaceId, repoPath, ref, agent));
    },

    async review(workspaceId, ref) {
      const { repoPath } = await guarded(workspaceId);
      return reviewOf(repoPath, latestRun(workspaceId, checkedRef(ref)));
    },

    async approve(workspaceId, ref, request) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRef(ref);
      const parsed = ApproveBuildRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError('Say which revision you reviewed.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      const reviewed = parsed.data.revision;
      // One operation per repo, shared with the board's marks (review loop 1).
      return serializedByRepo(repoPath, async () => {
        const { guard } = await guarded(workspaceId);
        const run = latestRun(workspaceId, checked);
        // Approved already (its branch is gone since story 5.5), or rejected.
        if (run.decision === 'approved') throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        if (run.outcome !== 'verified' || run.decision !== null || run.branch === null || !isBuildBranch(run.branch)) throw new BuildRefusedError('checks_failed', CHECKS_FAILED_MESSAGE);
        if (await vcs.isMerged(repoPath, run.branch)) throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        // Exactly what the user reviewed: the branch must still point at it.
        if ((await vcs.branchRevision(repoPath, run.branch)) !== reviewed) throw new BuildRefusedError('checks_failed', REVIEW_STALE_MESSAGE);
        await requireGit();
        const { plan } = await tickets.find(repoPath, checked, guard);
        await requireCleanCheckout(repoPath, plan);
        // The branch this build started from must still be checked out (story 5.5): never a detached HEAD or another branch.
        const current = await vcs.head(repoPath);
        if (current === undefined || (run.baseBranch !== null && current.branch !== run.baseBranch) || run.baseRevision === null || !(await vcs.isAncestor(repoPath, run.baseRevision))) {
          throw new BuildRefusedError('checkout_dirty', CHECKOUT_MOVED_MESSAGE);
        }
        await chat.releaseAgent(workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
        const merged = await vcs.merge(repoPath, reviewed);
        if (merged === 'conflict') {
          entities.setRunOutcome(run.id, 'blocked', MERGE_CONFLICT_MESSAGE, { blockedCode: 'merge_conflict' });
          throw new BuildRefusedError('merge_conflict', MERGE_CONFLICT_MESSAGE);
        }
        // Git refused for another reason (an untracked or ignored file in the way): nothing merged, the run stays verified.
        if (merged === 'refused') throw new BuildRefusedError('checkout_dirty', MERGE_REFUSED_MESSAGE);
        let marked = false;
        try {
          // The merged scripts must still be the ones the user trusted before `tickets.py` runs (AD-22 note, story 5.2).
          const scripts = await trust.requireScriptsUnchanged(workspaceId);
          await tickets.mark(repoPath, checked, 'done', { scripts }, { approve: true });
          marked = true;
          const after = (await tickets.find(repoPath, checked, { scripts })).plan ?? plan;
          if (after !== null) await vcs.add(repoPath, [after]);
          await vcs.commit(repoPath, `Merge ${run.branch}: ticket ${checked} done\n\nApproved in Ogden Agents.`);
        } catch (error) {
          // The plan as HEAD has it first (the mark wrote it), then the merge Ogden started is aborted.
          if (marked && plan !== null) await vcs.restore(repoPath, [plan]).catch((restore: unknown) => report(run.id, 'restore', restore));
          await vcs.abortMerge(repoPath).catch((abort: unknown) => report(run.id, 'abort', abort));
          throw error;
        }
        const mergeRevision = (await vcs.head(repoPath).catch(() => undefined))?.revision;
        const approved = entities.setRunDecision(run.id, 'approved', mergeRevision, reviewed);
        await release(run);
        await cleanUp(repoPath, approved);
        return reviewOf(repoPath, entities.getRunBySession(run.sessionId) ?? approved);
      });
    },

    async reject(workspaceId, ref) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRef(ref);
      return serializedByRepo(repoPath, async () => {
        await guarded(workspaceId);
        const run = latestRun(workspaceId, checked);
        if (run.outcome === 'running') throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
        // An approved run is merged: never rejected after (its branch is gone since story 5.5).
        if (run.decision === 'approved') throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        if (run.branch !== null && isBuildBranch(run.branch) && (await vcs.isMerged(repoPath, run.branch)) && run.outcome === 'verified') {
          throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        }
        // A run already rejected stays as it is: a repeat Reject writes nothing (review, story 5.3).
        if (run.decision === 'rejected') return reviewOf(repoPath, run);
        await release(run);
        entities.setRunOutcome(run.id, 'stopped', run.reason);
        const rejected = entities.setRunDecision(run.id, 'rejected');
        // A discard (story 5.5): the worktree and its branch go; a failure is swept at the next start.
        await cleanUp(repoPath, rejected);
        return reviewOf(repoPath, rejected);
      });
    },

    async commitPlanFiles(workspaceId, ref) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRef(ref);
      return serializedByRepo(repoPath, async () => {
        const { guard } = await guarded(workspaceId);
        await requireGit();
        const head = await vcs.head(repoPath);
        if (head === undefined) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
        if (await vcs.operationInProgress(repoPath)) throw new BuildRefusedError('checkout_dirty', CHECKOUT_BUSY_MESSAGE);
        const { plan } = await tickets.find(repoPath, checked, guard);
        const files = await uncommittedPlanFiles(repoPath, plan);
        if (files.length === 0) return { committed: [], revision: head.revision };
        const revision = await vcs.commitPaths(repoPath, files, `Plan files for ticket ${checked}\n\nCommitted in Ogden Agents before a build.`);
        return { committed: files, revision };
      });
    },

    async sweep() {
      const repoOf = (workspaceId: WorkspaceId): string | undefined => {
        try {
          return workspaceRepoPath(entities, workspaceId);
        } catch {
          return undefined;
        }
      };
      const sweepDeps = { ...cleanupDeps, entities, repoOf, onError: (step: string, error: unknown) => report('none', `sweep ${step}`, error) };
      try {
        await sweepWorktrees(sweepDeps);
      } catch (error) {
        report('none', 'sweep', error);
      }
      // Awaited, so no git of the sweep outlives it or runs beside a served build (review).
      await sweepRunBranches(sweepDeps).catch((error: unknown) => report('none', 'sweep branch', error));
    },

    async runOfSession(workspaceId, sessionId) {
      await guarded(workspaceId);
      const session = entities.getSession(sessionId);
      if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
      const run = entities.getRunBySession(sessionId);
      if (run === undefined) throw new NotFoundError('run', sessionId);
      return run;
    },

    async resume(workspaceId, runId) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRunId(runId);
      return serializedByRepo(repoPath, () => resumeLocked(workspaceId, repoPath, checked, undefined));
    },

    async retry(workspaceId, runId, request) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRunId(runId);
      const parsed = RetryRunRequest.safeParse(request ?? {});
      if (!parsed.success) throw new ValidationError('That is not a retry request.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      const run = entities.getRun(checked);
      if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', checked);
      // Nothing to retry for a run still going, ready for review or decided (review: 409 as the route says).
      if (run.outcome === 'running' || run.outcome === 'verified' || run.decision !== null) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
      // A checkpoint pause resumes (story 5.4); every other Retry is 5.8's.
      if (parsed.data.mode !== 'resume' || !atCheckpoint(run)) throw new NotImplementedError(RETRY_NOT_AVAILABLE_MESSAGE);
      return serializedByRepo(repoPath, () => resumeLocked(workspaceId, repoPath, checked, parsed.data.note));
    },

    recorded: () => recorder.flushed(),

    async settled() {
      while (deciding.size > 0) await Promise.all([...deciding]);
    },

    close() {
      unsubscribe();
      recorder.close();
    },
  };
}
