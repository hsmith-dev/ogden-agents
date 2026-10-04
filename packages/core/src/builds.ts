/**
 * Unattended builds (CAP-8, CAP-9, CAP-10, CAP-12; story 5.2, epic 5's
 * tracer bullet): one ticket built in its own worktree by a `build` session,
 * reviewed, and approved (a local merge with the ticket's `done` mark in the
 * merge commit) or rejected.
 *
 * Every use-case serves the `builds` piece and calls the guards in board's
 * order (AD-22): the piece, the project's script trust, the pinned BMad
 * Method, then the project's scripts unchanged. The repo is the workspace's
 * stored real path, never request input.
 *
 * - `start`: refuses without a sandbox (`sandbox_unavailable`, fail closed),
 *   with a run of the ticket still running (`run_active`), a ticket that
 *   isn't `ready-for-dev` (`not_ready`), one waiting on a ticket not done or
 *   in review (`prerequisite_unmet`), a checkout that isn't a branch with a
 *   commit (`vcs_unavailable`), or a plan or `tickets.toml` with uncommitted
 *   changes (`plan_uncommitted`); nothing is written then. Otherwise it adds a
 *   worktree under `<data>/w/<8-char id>` on `ogden/<ref>-<slug>` from the
 *   checked-out branch, a `build` session with its run, registers what the
 *   session's agent starts with (the worktree, the sandbox, the build
 *   permission policy) and sends the build runner's invocation.
 * - When the session's turn ends, core checks the worktree's
 *   `_bmad/scripts/` are the trusted ones, reads the plan's status there and
 *   sets the outcome: `verified` for `built` with a non-empty diff (5.8 adds
 *   the test re-run), `blocked` with the plan's reason, else `failed`.
 * - `approve`: only a `verified`, unmerged run; refused on a checkout with
 *   uncommitted changes outside `_bmad-output/` (`checkout_dirty`). Merges
 *   with `--no-ff --no-commit`; a conflict aborts it (the checkout
 *   unchanged) and blocks the run (`merge_conflict`). Then the project's
 *   scripts must still be the trusted ones (else the merge is aborted), the
 *   ticket is marked `done` (the only path to it, AD-10), its plan staged,
 *   and one merge commit made. Never a push or a force. The worktree goes;
 *   the branch stays.
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
  BUILD_BRANCH_PREFIX,
  CHECKOUT_DIRTY_MESSAGE,
  CHECKS_FAILED_MESSAGE,
  MAX_REVIEW_DIFF_BYTES,
  MERGE_CONFLICT_MESSAGE,
  NOT_READY_MESSAGE,
  PLAN_UNCOMMITTED_MESSAGE,
  PREREQUISITE_UNMET_MESSAGE,
  RUN_ACTIVE_MESSAGE,
  RUN_REASON_AGENT_ERROR,
  RUN_REASON_EMPTY_DIFF,
  RUN_REASON_NOT_BUILT,
  RUN_REASON_SCRIPTS_CHANGED,
  RUN_REASON_UNREADABLE,
  SANDBOX_UNAVAILABLE_MESSAGE,
  StartBuildRequest,
  TICKET_REF_PATTERN,
  VCS_UNAVAILABLE_MESSAGE,
  type ReviewResponse,
  type Run,
  type Session,
  type SessionId,
  type TicketLink,
  type TicketRow,
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
import { PROTECTED_PATHS } from './permission-matching.js';
import { workspaceRepoPath } from './planning.js';
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

export interface BuildsUseCases {
  /** Builds one ticket (see the header). Rejects as the header says; nothing is written then. */
  start(workspaceId: WorkspaceId, request: unknown): Promise<{ run: Run; session: Session }>;
  /** The ticket's latest run for the review page. `NotFoundError` without one. */
  review(workspaceId: WorkspaceId, ref: string): Promise<ReviewResponse>;
  /** Approve (see the header). */
  approve(workspaceId: WorkspaceId, ref: string): Promise<ReviewResponse>;
  /** Reject (see the header). */
  reject(workspaceId: WorkspaceId, ref: string): Promise<ReviewResponse>;
  /** The run of `sessionId` (a `build` session of the workspace). `NotFoundError` otherwise. */
  runOfSession(workspaceId: WorkspaceId, sessionId: SessionId): Run;
  /** Resolves once no outcome is being worked out (tests, shutdown). */
  settled(): Promise<void>;
  /** Stops following the event log. */
  close(): void;
}

export interface BuildsDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  trust: Pick<BmadScriptTrust, 'requireScriptsTrusted' | 'requireScriptsUnchanged' | 'requireScriptsMatch'>;
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  entities: Pick<Entities, 'getWorkspace' | 'getSession' | 'createRun' | 'getRunBySession' | 'latestRunForTicket' | 'activeRunForTicket' | 'setRunOutcome'>;
  events: Pick<EventLog, 'subscribe' | 'lastSeq'>;
  tickets: TicketStorePort;
  vcs: VcsPort;
  sandbox: SandboxPort;
  runner: BuildRunnerPort;
  chat: Pick<Chat, 'createChatSession' | 'sendMessage' | 'releaseAgent'>;
  buildSessions: BuildSessions;
  /** Ogden Agents' data folder: worktrees go in `<dataDir>/w/`. */
  dataDir: string;
  /** How paths resolve, for the permission policy (tests inject one). Default: this computer's. */
  paths?: PathNormalizer;
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

/** A git-safe branch name for ticket `ref` titled `title`: `ogden/<ref>-<slug>`. */
export function buildBranchName(ref: string, title: string): string {
  const safeRef = ref.replace(/\.{2,}/g, '.').replace(/^[.-]+|[.-]+$/g, '') || 'ticket';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const name = `${BUILD_BRANCH_PREFIX}${safeRef}${slug === '' ? '' : `-${slug}`}`;
  return name.endsWith('.lock') ? `${name}-1` : name;
}

/** Whether `name` is a branch name Ogden made (checked before every use). */
export function isBuildBranch(name: string): boolean {
  return /^ogden\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..') && !name.endsWith('.lock') && !name.endsWith('.');
}

/** The refs `after` names, as full refs (`2` in epic `1` is `1.2`). */
export function prerequisiteRefs(ref: string, after: readonly TicketLink[]): string[] {
  const dot = ref.lastIndexOf('.');
  const epic = dot === -1 ? undefined : ref.slice(0, dot);
  return after.map((link) => {
    const text = String(link);
    return text.includes('.') || epic === undefined ? text : `${epic}.${text}`;
  });
}

/** An 8-character lowercase id for a worktree folder. */
const worktreeId = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return [...randomBytes(8)].map((byte) => alphabet[byte % 32]).join('');
};

export function createBuilds(deps: BuildsDeps): BuildsUseCases {
  const { bmad, trust, source, entities, events, tickets, vcs, sandbox, runner, chat, buildSessions, dataDir } = deps;
  const paths = deps.paths ?? nodePathNormalizer();
  const report = (runId: string, step: string, error: unknown) => {
    try {
      deps.onError?.(runId, step, error);
    } catch {
      // Logging must never break a run.
    }
  };

  /** One operation of a repo at a time (start, approve, reject), as board's marks. */
  const chains = new Map<string, Promise<unknown>>();
  const serialized = <T>(repoPath: string, run: () => Promise<T>): Promise<T> => {
    const before = chains.get(repoPath) ?? Promise.resolve();
    const result = before.then(run, run);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    chains.set(repoPath, tail);
    void tail.then(() => {
      if (chains.get(repoPath) === tail) chains.delete(repoPath);
    });
    return result;
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

  /** Throws `prerequisite_unmet` when a ticket `row` waits for is not done or in review. */
  const requirePrerequisites = async (repoPath: string, row: TicketRow): Promise<void> => {
    const wanted = prerequisiteRefs(row.ref, row.after);
    if (wanted.length === 0) return;
    const { tickets: all } = await tickets.tree(repoPath);
    for (const ref of wanted) {
      const found = all.find((each) => each.ref === ref);
      if (found === undefined || !PREREQUISITE_MET_STATES.has(found.state)) throw new BuildRefusedError('prerequisite_unmet', PREREQUISITE_UNMET_MESSAGE);
    }
  };

  /** Throws `plan_uncommitted` when the ticket's plan or a `tickets.toml` above it has uncommitted changes. */
  const requirePlanCommitted = async (repoPath: string, plan: string | null): Promise<void> => {
    if (plan === null) return;
    const changed = new Set(await vcs.status(repoPath));
    const epicFolder = posix.dirname(plan);
    const watched = [plan, posix.join(epicFolder, 'tickets.toml'), posix.join(posix.dirname(epicFolder), 'tickets.toml')];
    if (watched.some((path) => changed.has(path))) throw new BuildRefusedError('plan_uncommitted', PLAN_UNCOMMITTED_MESSAGE);
  };

  /** What the run's agent may write: its worktree, and the git folders a commit there needs; never hooks or config. */
  const sandboxFor = async (kind: string, worktreePath: string): Promise<{ sandbox: AgentSandbox; gitWritable: string[] }> => {
    const git = await vcs.worktreeGitPaths(worktreePath);
    const gitWritable = [join(git.commonDir, 'objects'), join(git.commonDir, 'refs'), join(git.commonDir, 'logs'), git.gitDir];
    const deniedPaths = [
      join(git.commonDir, 'hooks'),
      join(git.commonDir, 'config'),
      ...PROTECTED_PATHS.folders.map((folder) => join(worktreePath, folder)),
      ...PROTECTED_PATHS.files.map((file) => join(worktreePath, file)),
    ];
    return { sandbox: { kind, writableRoots: [worktreePath, ...gitWritable], deniedPaths }, gitWritable };
  };

  const startLocked = async (workspaceId: WorkspaceId, repoPath: string, ref: string): Promise<{ run: Run; session: Session }> => {
    // Fail closed: never an unsandboxed unattended run (user decision 2026-10-04).
    const check = await sandbox.check();
    if (!check.available) throw new BuildRefusedError('sandbox_unavailable', SANDBOX_UNAVAILABLE_MESSAGE);
    if (entities.activeRunForTicket(workspaceId, ref) !== undefined) throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
    const ticket = await tickets.find(repoPath, ref);
    if ((ticket.status ?? '') !== READY_STATUS) throw new BuildRefusedError('not_ready', NOT_READY_MESSAGE);
    await requirePrerequisites(repoPath, ticket);
    const head = await vcs.head(repoPath);
    if (head === undefined) throw new BuildRefusedError('vcs_unavailable', VCS_UNAVAILABLE_MESSAGE);
    await requirePlanCommitted(repoPath, ticket.plan);
    // The guards once more, right before anything is written: a piece turned off meanwhile writes nothing.
    await guarded(workspaceId);

    const branch = buildBranchName(ref, ticket.title);
    if (!isBuildBranch(branch)) throw new ValidationError('That ticket reference makes no usable branch name.', [{ path: ['ref'], message: 'unusable branch name' }]);
    const parent = join(dataDir, WORKTREES_DIR);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const worktreePath = join(parent, worktreeId());
    await vcs.addWorktree(repoPath, { path: worktreePath, branch, base: head.revision });
    let session: Session | undefined;
    try {
      const real = paths.realpath(worktreePath) ?? worktreePath;
      const { sandbox: contained, gitWritable } = await sandboxFor(check.kind, real);
      session = await chat.createChatSession(workspaceId, { kind: 'build', agentId: runner.agentId });
      const run = entities.createRun({
        sessionId: session.id,
        ticketRef: ref,
        worktreePath: real,
        sandbox: check.kind,
        branch,
        baseRevision: head.revision,
      });
      const scope = { worktree: real, gitWritable, protectedPaths: PROTECTED_PATHS };
      buildSessions.set(session.id, { cwd: real, sandbox: contained, decide: (request) => decideBuildPermission(request, scope, paths) });
      chat.sendMessage(workspaceId, session.id, runner.invocation(ref));
      return { run, session };
    } catch (error) {
      if (session !== undefined) buildSessions.delete(session.id);
      // Nothing of a run that never started is left behind: no worktree and no branch.
      if (session === undefined) await vcs.removeWorktree(repoPath, worktreePath, { deleteBranch: branch }).catch((cleanup: unknown) => report('none', 'cleanup', cleanup));
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
        } else outcome = 'verified';
      } else if (status === 'blocked') {
        outcome = 'blocked';
        reason = ticket.blocked_reason === null || ticket.blocked_reason.trim() === '' ? RUN_REASON_NOT_BUILT(status) : ticket.blocked_reason;
      } else {
        outcome = 'failed';
        reason = ended === 'error' ? RUN_REASON_AGENT_ERROR : RUN_REASON_NOT_BUILT(status);
      }
    } catch (error) {
      report(run.id, 'outcome', error);
      outcome = 'failed';
      reason = error instanceof ScriptsChangedError ? RUN_REASON_SCRIPTS_CHANGED : RUN_REASON_UNREADABLE;
    }
    // Only a run still running gets an outcome here: a Reject meanwhile stands.
    if (entities.getRunBySession(run.sessionId)?.outcome !== 'running') return;
    entities.setRunOutcome(run.id, outcome, reason);
  };

  const deciding = new Set<Promise<void>>();
  const unsubscribe = events.subscribe(events.lastSeq(), (event) => {
    if (event.type !== 'session.state_changed') return;
    const { sessionId, state, previous, resumable } = event.payload;
    if ((state !== 'idle' && state !== 'error') || (previous !== 'working' && previous !== 'waiting')) return;
    // An agent stopped under it (a server stop, a dropped agent) did not finish its turn: no outcome from that (5.x's restart recovery).
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
    if (run.branch === null || run.baseRevision === null || !isBuildBranch(run.branch)) return { ...base, diff: '', truncated: false, files: [], merged: false };
    const changes = await vcs.diff(repoPath, run.baseRevision, run.branch, { maxBytes: MAX_REVIEW_DIFF_BYTES });
    const merged = changes.files.length > 0 && (await vcs.isMerged(repoPath, run.branch));
    return { ...base, diff: changes.diff, truncated: changes.truncated, files: changes.files, merged };
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

  return {
    async start(workspaceId, request) {
      const repoPath = await guarded(workspaceId);
      const parsed = StartBuildRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Name one ticket to build.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      const ref = checkedRef(parsed.data.ref);
      return serialized(repoPath, () => startLocked(workspaceId, repoPath, ref));
    },

    async review(workspaceId, ref) {
      const repoPath = await guarded(workspaceId);
      return reviewOf(repoPath, latestRun(workspaceId, checkedRef(ref)));
    },

    async approve(workspaceId, ref) {
      const repoPath = await guarded(workspaceId);
      const checked = checkedRef(ref);
      return serialized(repoPath, async () => {
        await guarded(workspaceId);
        const run = latestRun(workspaceId, checked);
        if (run.outcome !== 'verified' || run.branch === null || !isBuildBranch(run.branch)) throw new BuildRefusedError('checks_failed', CHECKS_FAILED_MESSAGE);
        if (await vcs.isMerged(repoPath, run.branch)) throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        const dirty = (await vcs.status(repoPath)).filter((path) => !path.startsWith(BMAD_OUTPUT_PREFIX));
        if (dirty.length > 0) throw new BuildRefusedError('checkout_dirty', CHECKOUT_DIRTY_MESSAGE);
        await chat.releaseAgent(workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
        if ((await vcs.merge(repoPath, run.branch)) === 'conflict') {
          entities.setRunOutcome(run.id, 'blocked', MERGE_CONFLICT_MESSAGE);
          throw new BuildRefusedError('merge_conflict', MERGE_CONFLICT_MESSAGE);
        }
        try {
          // The merged scripts must still be the ones the user trusted before `tickets.py` runs (AD-22 note, story 5.2).
          await trust.requireScriptsUnchanged(workspaceId);
          await tickets.mark(repoPath, checked, 'done', { approve: true });
          const { plan } = await tickets.find(repoPath, checked);
          if (plan !== null) await vcs.add(repoPath, [plan]);
          await vcs.commit(repoPath, `Merge ${run.branch}: ticket ${checked} done\n\nApproved in Ogden Agents.`);
        } catch (error) {
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
      return serialized(repoPath, async () => {
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

    runOfSession(workspaceId, sessionId) {
      bmad.requireBmadFeature(workspaceId, 'builds');
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
