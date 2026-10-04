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
 *   The worktree goes; the branch stays. One operation per repo at a time,
 *   shared with the board's marks.
 * - `reject`: removes the worktree (the branch stays) and stops the run; the
 *   ticket is untouched.
 *
 * Core names no skill, VCS, sandbox or agent (AD-1, AD-12).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import {
  ALREADY_MERGED_MESSAGE,
  ApproveBuildRequest,
  BMAD_FILES_UNCOMMITTED_MESSAGE,
  BUILD_BRANCH_PREFIX,
  CHECKOUT_BUSY_MESSAGE,
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
  VCS_NOT_TOP_LEVEL_MESSAGE,
  VCS_UNAVAILABLE_MESSAGE,
  type ReviewResponse,
  type Run,
  type Session,
  type SessionId,
  type TicketRow,
  type TicketsResponse,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { BmadSourceUseCases } from './bmad-source-port.js';
import { BUILD_PERMISSION_DENIED, decideBuildPermission, nodePathNormalizer, type PathNormalizer } from './build-permission-policy.js';
import type { BuildRunnerPort } from './build-runner-port.js';
import type { BuildSessions } from './build-sessions.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { BuildRefusedError, NotFoundError, ScriptsChangedError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { isProtectedSegment, PROTECTED_PATHS } from './permission-matching.js';
import { workspaceRepoPath } from './planning.js';
import { serializedByRepo } from './repo-serialization.js';
import type { AgentSandbox, SandboxPort } from './sandbox-port.js';
import type { TicketStorePort } from './ticket-store-port.js';
import type { VcsPort } from './vcs-port.js';

export { BUILD_PERMISSION_DENIED };

/** The folder of every run's worktree, inside Ogden Agents' data folder (AD-17): `<data>/w/<id>`. */
export const WORKTREES_DIR = 'w';

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
  /** The run of `sessionId` (a `build` session of the workspace), behind the full guards. `NotFoundError` otherwise. */
  runOfSession(workspaceId: WorkspaceId, sessionId: SessionId): Promise<Run>;
  /** Resolves once no outcome is being worked out (tests, shutdown). */
  settled(): Promise<void>;
  /** Stops following the event log. */
  close(): void;
}

export interface BuildsDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  trust: Pick<BmadScriptTrust, 'requireScriptsTrusted' | 'requireScriptsUnchanged' | 'requireScriptsMatch'>;
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  entities: Pick<Entities, 'getWorkspace' | 'getSession' | 'createRun' | 'getRun' | 'getRunBySession' | 'latestRunForTicket' | 'activeRunForTicket' | 'setRunOutcome'>;
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

  /** The guards in board's order (the piece, the trust, the pinned BMad Method, the scripts unchanged), then the repo. */
  const guarded = async (workspaceId: WorkspaceId): Promise<string> => {
    bmad.requireBmadFeature(workspaceId, 'builds');
    trust.requireScriptsTrusted(workspaceId);
    source.requireReady();
    const repoPath = workspaceRepoPath(entities, workspaceId);
    await trust.requireScriptsUnchanged(workspaceId);
    return repoPath;
  };

  /** Throws `plan_uncommitted` when the ticket's plan or a `tickets.toml` above it has uncommitted changes. */
  const requirePlanCommitted = async (repoPath: string, plan: string | null): Promise<void> => {
    if (plan === null) return;
    const changed = new Set(await vcs.status(repoPath));
    const epicFolder = posix.dirname(plan);
    const watched = [plan, posix.join(epicFolder, 'tickets.toml'), posix.join(posix.dirname(epicFolder), 'tickets.toml')];
    if (watched.some((path) => changed.has(path))) throw new BuildRefusedError('plan_uncommitted', PLAN_UNCOMMITTED_MESSAGE);
  };

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

  const startLocked = async (workspaceId: WorkspaceId, repoPath: string, ref: string): Promise<{ run: Run; session: Session }> => {
    // Fail closed: never an unsandboxed unattended run (user decision 2026-10-04); the sandbox says why.
    const check = await sandbox.check();
    if (!check.available) throw new BuildRefusedError('sandbox_unavailable', `${SANDBOX_UNAVAILABLE_MESSAGE} ${check.reason}`.trim());
    if (entities.activeRunForTicket(workspaceId, ref) !== undefined) throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
    const ticket = await tickets.find(repoPath, ref);
    if ((ticket.status ?? '') !== READY_STATUS) throw new BuildRefusedError('not_ready', NOT_READY_MESSAGE);
    if (ticket.after.length > 0 && !prerequisitesMet(ticket, await tickets.tree(repoPath))) throw new BuildRefusedError('prerequisite_unmet', PREREQUISITE_UNMET_MESSAGE);
    // The project must be its repository's top folder: a worktree is of the whole repository.
    const top = await vcs.topLevel(repoPath);
    if (top === undefined) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
    if ((paths.realpath(top) ?? top) !== (paths.realpath(repoPath) ?? repoPath)) throw new BuildRefusedError('vcs_unavailable', VCS_NOT_TOP_LEVEL_MESSAGE);
    const head = await vcs.head(repoPath);
    if (head === undefined) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
    await requirePlanCommitted(repoPath, ticket.plan);
    // The guards once more, right before anything is written: a piece turned off meanwhile writes nothing.
    await guarded(workspaceId);

    const runShort = runShortId();
    const branch = buildBranchName(runShort, ref, ticket.title);
    if (!isBuildBranch(branch)) throw new ValidationError('That ticket reference makes no usable branch name.', [{ path: ['ref'], message: 'unusable branch name' }]);
    const parent = join(dataDir, WORKTREES_DIR);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
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
      session = await chat.createChatSession(workspaceId, { kind: 'build', agentId: runner.agentId });
      run = entities.createRun({ sessionId: session.id, ticketRef: ref, worktreePath: real, sandbox: check.kind, branch, baseRevision: head.revision });
      const scope = { worktree: real, gitWritable, protectedPaths: PROTECTED_PATHS };
      buildSessions.set(session.id, { cwd: real, sandbox: contained, decide: (request) => decideBuildPermission(request, scope, paths) });
      chat.sendMessage(workspaceId, session.id, runner.invocation(ref), { build: true });
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

  /** Works out a finished turn's outcome (see the header). */
  const decideOutcome = async (run: Run, ended: 'idle' | 'error'): Promise<void> => {
    if (run.worktreePath === null) return;
    let repoPath: string;
    try {
      repoPath = workspaceRepoPath(entities, run.workspaceId);
    } catch {
      return;
    }
    let outcome: 'verified' | 'failed' | 'blocked';
    let reason: string | null = null;
    try {
      // The agent may have edited the worktree's scripts: they must be the trusted ones before `tickets.py` runs there.
      await trust.requireScriptsMatch(run.workspaceId, run.worktreePath);
      const ticket = await tickets.find(run.worktreePath, run.ticketRef);
      const status = ticket.status ?? '';
      if (status === 'built') {
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
    entities.setRunOutcome(run.id, outcome, reason === null ? null : mask(reason));
  };

  const deciding = new Set<Promise<void>>();
  const unsubscribe = events.subscribe(events.lastSeq(), (event) => {
    if (event.type !== 'session.state_changed') return;
    const { sessionId, state, previous, resumable } = event.payload;
    if ((state !== 'idle' && state !== 'error') || (previous !== 'working' && previous !== 'waiting')) return;
    // An agent stopped under it (a server stop, a dropped agent) did not finish its turn: the server start settles it.
    if (resumable === true) return;
    const run = entities.getRunBySession(sessionId);
    if (run === undefined || run.outcome !== 'running') return;
    const pending: Promise<void> = Promise.resolve()
      .then(() => decideOutcome(run, state))
      .catch((error: unknown) => report(run.id, 'outcome', error))
      .finally(() => deciding.delete(pending));
    deciding.add(pending);
  });

  /** The workspace's latest run of `ref`, as the review page shows it. */
  const reviewOf = async (repoPath: string, run: Run): Promise<ReviewResponse> => {
    const base = { run, outcome: run.outcome, reason: run.reason };
    if (run.branch === null || run.baseRevision === null || !isBuildBranch(run.branch)) return { ...base, diff: '', truncated: false, files: [], merged: false, headRevision: null };
    const headRevision = (await vcs.branchRevision(repoPath, run.branch)) ?? null;
    if (headRevision === null) return { ...base, diff: '', truncated: false, files: [], merged: false, headRevision };
    const changes = await vcs.diff(repoPath, run.baseRevision, run.branch, { maxBytes: MAX_REVIEW_DIFF_BYTES });
    const merged = changes.files.length > 0 && (await vcs.isMerged(repoPath, run.branch));
    return { ...base, diff: changes.diff, truncated: changes.truncated, files: changes.files, merged, headRevision };
  };

  const latestRun = (workspaceId: WorkspaceId, ref: string): Run => {
    const run = entities.latestRunForTicket(workspaceId, ref);
    if (run === undefined) throw new NotFoundError('run', ref);
    return run;
  };

  /** Stops the run's agent and removes its worktree (its branch stays). */
  const retire = async (repoPath: string, run: Run): Promise<void> => {
    await chat.releaseAgent(run.workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
    buildSessions.delete(run.sessionId);
    if (run.worktreePath !== null) await vcs.removeWorktree(repoPath, run.worktreePath);
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
      const repoPath = await guarded(workspaceId);
      const parsed = StartBuildRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Name one ticket to build.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      const ref = checkedRef(parsed.data.ref);
      return serializedByRepo(repoPath, () => startLocked(workspaceId, repoPath, ref));
    },

    async review(workspaceId, ref) {
      const repoPath = await guarded(workspaceId);
      return reviewOf(repoPath, latestRun(workspaceId, checkedRef(ref)));
    },

    async approve(workspaceId, ref, request) {
      const repoPath = await guarded(workspaceId);
      const checked = checkedRef(ref);
      const parsed = ApproveBuildRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError('Say which revision you reviewed.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      const reviewed = parsed.data.revision;
      // One operation per repo, shared with the board's marks (review loop 1).
      return serializedByRepo(repoPath, async () => {
        await guarded(workspaceId);
        const run = latestRun(workspaceId, checked);
        if (run.outcome !== 'verified' || run.branch === null || !isBuildBranch(run.branch)) throw new BuildRefusedError('checks_failed', CHECKS_FAILED_MESSAGE);
        if (await vcs.isMerged(repoPath, run.branch)) throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        // Exactly what the user reviewed: the branch must still point at it.
        if ((await vcs.branchRevision(repoPath, run.branch)) !== reviewed) throw new BuildRefusedError('checks_failed', REVIEW_STALE_MESSAGE);
        const { plan } = await tickets.find(repoPath, checked);
        await requireCleanCheckout(repoPath, plan);
        await chat.releaseAgent(workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
        const merged = await vcs.merge(repoPath, reviewed);
        if (merged === 'conflict') {
          entities.setRunOutcome(run.id, 'blocked', MERGE_CONFLICT_MESSAGE);
          throw new BuildRefusedError('merge_conflict', MERGE_CONFLICT_MESSAGE);
        }
        // Git refused for another reason (an untracked or ignored file in the way): nothing merged, the run stays verified.
        if (merged === 'refused') throw new BuildRefusedError('checkout_dirty', MERGE_REFUSED_MESSAGE);
        let marked = false;
        try {
          // The merged scripts must still be the ones the user trusted before `tickets.py` runs (AD-22 note, story 5.2).
          await trust.requireScriptsUnchanged(workspaceId);
          await tickets.mark(repoPath, checked, 'done', { approve: true });
          marked = true;
          const after = (await tickets.find(repoPath, checked)).plan ?? plan;
          if (after !== null) await vcs.add(repoPath, [after]);
          await vcs.commit(repoPath, `Merge ${run.branch}: ticket ${checked} done\n\nApproved in Ogden Agents.`);
        } catch (error) {
          // The plan as HEAD has it first (the mark wrote it), then the merge Ogden started is aborted.
          if (marked && plan !== null) await vcs.restore(repoPath, [plan]).catch((restore: unknown) => report(run.id, 'restore', restore));
          await vcs.abortMerge(repoPath).catch((abort: unknown) => report(run.id, 'abort', abort));
          throw error;
        }
        await retire(repoPath, run).catch((error: unknown) => report(run.id, 'retire', error));
        return reviewOf(repoPath, entities.getRunBySession(run.sessionId) ?? run);
      });
    },

    async reject(workspaceId, ref) {
      const repoPath = await guarded(workspaceId);
      const checked = checkedRef(ref);
      return serializedByRepo(repoPath, async () => {
        await guarded(workspaceId);
        const run = latestRun(workspaceId, checked);
        if (run.outcome === 'running') throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
        if (run.branch !== null && isBuildBranch(run.branch) && (await vcs.isMerged(repoPath, run.branch)) && run.outcome === 'verified') {
          throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        }
        await retire(repoPath, run);
        const stopped = entities.setRunOutcome(run.id, 'stopped', run.reason);
        return reviewOf(repoPath, stopped);
      });
    },

    async runOfSession(workspaceId, sessionId) {
      await guarded(workspaceId);
      const session = entities.getSession(sessionId);
      if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
      const run = entities.getRunBySession(sessionId);
      if (run === undefined) throw new NotFoundError('run', sessionId);
      return run;
    },

    async settled() {
      while (deciding.size > 0) await Promise.all([...deciding]);
    },

    close: unsubscribe,
  };
}
