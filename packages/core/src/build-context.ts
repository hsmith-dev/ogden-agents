/**
 * The state and helpers every part of the builds use-cases shares (story 5.10
 * split `builds.ts`): the guards, the sandbox and its session setup, the
 * limits, the time-limit timers, the queue's notes and the run's cleanup.
 */
import { dirname, join, posix } from 'node:path';
import { RunId, CHECKOUT_BUSY_MESSAGE, GIT_MISSING_MESSAGE, gitTooOldMessage, CHECKOUT_DIRTY_MESSAGE, PLAN_UNCOMMITTED_MESSAGE, redactApiKeys, SANDBOX_UNAVAILABLE_MESSAGE, type BuildAgent, type BuildRunResult, type Run, type TicketDetail, type VerificationResult, type WorkspaceId } from '@ogden-agents/shared';
import { decideBuildPermission, nodePathNormalizer } from './build-permission-policy.js';
import { createRunActivityRecorder, runFolderOf, runShortOf, writeRunResult } from './build-run-folder.js';
import { createObjectStore, ObjectStoreError, objectStoreEnv } from './build-object-store.js';
import { removeRunWorktree } from './build-worktrees.js';
import type { BuildSessionSetup } from './build-sessions.js';
import { BuildRefusedError, NotFoundError } from './errors.js';
import type { BuildRunnerPort } from './build-runner-port.js';
import { PROTECTED_PATHS } from './permission-matching.js';
import { workspaceRepoPath } from './planning.js';
import { serializedByRepo } from './repo-serialization.js';
import type { AgentSandbox } from './sandbox-port.js';
import type { TicketRunGuard } from './ticket-store-port.js';
import { AGENTS_FILE, BMAD_OUTPUT_PREFIX, credentialReadFences, isBuildBranch, intentGapPatchOf, RESULT_STATUSES, MAX_RESULT_TEXT } from './build-names.js';
import type { BuildsDeps } from './builds-types.js';

export interface BuildFns {
  /** Arms the run's time limit (dispatch module). */
  armDeadline(run: Run): void;
  /** Starts the queue's next runs once the current dispatch decision settled (dispatch module). */
  scheduleDrain(): void;
}

export function createBuildContext(deps: BuildsDeps) {
  const { bmad, trust, source, entities, events, tickets, vcs, sandbox, runner, chat, buildSessions, dataDir, settings } = deps;
  const commandEnv = deps.commandEnv ?? (() => ({}));
  /** The runner that builds with `agent` (epic 17: one per agent, found by id); `undefined` for an agent that cannot build. */
  const runnerFor = (agent: BuildAgent): BuildRunnerPort | undefined => [runner, ...(deps.runners ?? [])].find((each) => each.agent === agent);
  /** The runner of a run's agent (an old run has none stored: the default build agent's); `undefined` when its agent can no longer build (never another agent's runner). */
  const runnerOf = (run: Pick<Run, 'agent'>): BuildRunnerPort | undefined => runnerFor(run.agent ?? runner.agent);
  const aware = deps.runAwareTickets ?? tickets;
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
  const writeResult = async (run: Run, repoPath: string, ticket: TicketDetail | undefined, reason: string | null, blocked: boolean): Promise<boolean> => {
    const short = runShortOf(run);
    if (short === undefined) return false;
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
      return true;
    } catch (error) {
      report(run.id, 'result', error);
      return false;
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

  /**
   * What the run's agent may write: its worktree, the run's own git paths and
   * its own object store (story 5.6); never the repo's objects, hooks, config,
   * `objects/info` or another ref. Its git writes objects to the store and
   * reads the repo's as an alternate (`env`).
   */
  const sandboxFor = async (kind: string, worktreePath: string, branch: string, runShort: string): Promise<{ sandbox: AgentSandbox; gitWritable: string[]; env: Record<string, string> }> => {
    // Only the run's own branch's ref and reflog folders (`ogden/<run8>/`), never the user's refs.
    const git = await vcs.worktreeGitPaths(worktreePath, branch);
    let store: string;
    let env: Record<string, string>;
    try {
      store = createObjectStore(dataDir, runShort);
      env = objectStoreEnv(store, join(git.commonDir, 'objects'));
    } catch (error) {
      if (error instanceof ObjectStoreError) throw new BuildRefusedError('vcs_unavailable', error.message);
      throw error;
    }
    const gitWritable = [store, git.branchRefDir, git.branchLogDir, git.gitDir];
    const deniedPaths = [
      join(git.commonDir, 'objects'),
      join(git.commonDir, 'hooks'),
      join(git.commonDir, 'config'),
      ...PROTECTED_PATHS.folders.map((folder) => join(worktreePath, folder)),
      ...PROTECTED_PATHS.files.map((file) => join(worktreePath, file)),
    ];
    const home = deps.homeDir;
    const deniedReads = [paths.realpath(dataDir) ?? dataDir, ...(home === undefined ? [] : credentialReadFences(home, (path) => paths.realpath(path)))];
    return { sandbox: { kind, writableRoots: [worktreePath, ...gitWritable], deniedPaths, deniedReads, allowedReads: [worktreePath, store] }, gitWritable, env };
  };

  /** The sandbox that holds an unattended run, or the refusal (fail closed: never an unsandboxed unattended run, user decision 2026-10-04). */
  const requireSandbox = async (agent: BuildAgent): Promise<string> => {
    const check = await sandbox.check({ agent });
    if (!check.available) throw new BuildRefusedError('sandbox_unavailable', `${SANDBOX_UNAVAILABLE_MESSAGE} ${check.reason}`.trim());
    return check.kind;
  };

  /** The session setup of a sandboxed run: its sandbox, its object store's environment and core's permission policy. */
  const unattendedSetup = async (kind: string, worktreePath: string, branch: string, runShort: string): Promise<BuildSessionSetup> => {
    const { sandbox: contained, gitWritable, env } = await sandboxFor(kind, worktreePath, branch, runShort);
    const scope = { worktree: worktreePath, gitWritable, protectedPaths: PROTECTED_PATHS };
    return { cwd: worktreePath, sandbox: contained, env, decide: (request) => decideBuildPermission(request, scope, paths) };
  };

  /** The limits at this moment: a project's, the install's (read at each dispatch, so a change applies to the next). */
  const hasCapacity = (workspaceId: WorkspaceId): boolean => {
    const running = entities.listRunningRuns();
    const install = settings.runLimits().maxConcurrentRunsPerInstall;
    const project = settings.workspaceSettings(workspaceId).maxConcurrentRuns;
    return running.length < install && running.filter((each) => each.workspaceId === workspaceId).length < project;
  };

  /** The run's deadline from now (the install's maximum run time). */
  const deadlineFromNow = (): string => new Date(Date.now() + settings.runLimits().maxRunMinutes * 60_000).toISOString();

  /** Dispatch decisions (limits, queue) are taken one at a time across every repo: this key is never a path. */
  const DISPATCH_KEY = '\0dispatch';
  const inDispatch = <T>(work: () => Promise<T>): Promise<T> => serializedByRepo(DISPATCH_KEY, work);
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => {
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  });
  const timers = new Map<RunId, { cancel(): void }>();
  /** A note for a queued run's first message (Retry, Reject and retry); kept in memory only. */
  const pendingNotes = new Map<RunId, { note: string | undefined; resume: boolean }>();
  /** Bumped when a run is stopped or started again: an end-of-turn decision made for an earlier start is dropped. */
  const generation = new Map<RunId, number>();
  const bump = (runId: RunId): number => {
    const next = (generation.get(runId) ?? 0) + 1;
    generation.set(runId, next);
    return next;
  };
  /** A run's test re-run in progress, so Stop, discarding the run and the server quitting can end it (story 5.8 review). */
  const reruns = new Map<RunId, AbortController>();
  const rerunSignal = (runId: RunId): { signal: AbortSignal; done(): void } => {
    reruns.get(runId)?.abort();
    const controller = new AbortController();
    reruns.set(runId, controller);
    return { signal: controller.signal, done: () => void (reruns.get(runId) === controller && reruns.delete(runId)) };
  };
  const abortRerun = (runId: RunId): void => {
    reruns.get(runId)?.abort();
    reruns.delete(runId);
  };
  const abortAllReruns = (): void => {
    for (const controller of reruns.values()) controller.abort();
    reruns.clear();
  };
  /** Workspaces with Build all ready going: the tickets already tried, so a failed one is not tried again. */
  /** The workspaces with Build all ready going: the tickets tried so far, and the agent the request named (epic 17). */
  const draining = new Map<WorkspaceId, Set<string> & { agent: BuildAgent }>();
  const state = { closed: false };

  /** The run's agent and its session's setup go (Stop). */
  const stopAgent = async (run: Run): Promise<void> => {
    await chat.releaseAgent(run.workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
  };

  const disarmDeadline = (runId: RunId): void => {
    timers.get(runId)?.cancel();
    timers.delete(runId);
  };

  /** The run's latest verification (story 5.8), `undefined` before one ran. */
  const verificationOf = (run: Run): VerificationResult | undefined => {
    const event = entities.listSessionEvents(run.sessionId, ['run.verification_completed']).at(-1);
    return event?.type === 'run.verification_completed' ? event.payload.verification : undefined;
  };

  const latestRun = (workspaceId: WorkspaceId, ref: string): Run => {
    const run = entities.latestRunForTicket(workspaceId, ref);
    if (run === undefined) throw new NotFoundError('run', ref);
    return run;
  };

  /** Stops the run's agent and forgets its session's setup. */
  const release = async (run: Run): Promise<void> => {
    abortRerun(run.id);
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

  /** Approve's checkout checks: nothing staged, the plan untouched, no operation in progress, nothing changed outside `_bmad-output/` (and the root `AGENTS.md`, whose lessons Save the lessons commits later: epic 7, E7-R5). */
  const requireCleanCheckout = async (repoPath: string, plan: string | null): Promise<void> => {
    if ((await vcs.operationInProgress(repoPath)) || (await vcs.staged(repoPath)).length > 0) throw new BuildRefusedError('checkout_dirty', CHECKOUT_BUSY_MESSAGE);
    const changed = await vcs.status(repoPath);
    if (plan !== null && changed.includes(plan)) throw new BuildRefusedError('checkout_dirty', CHECKOUT_BUSY_MESSAGE);
    if (changed.some((path) => !path.startsWith(BMAD_OUTPUT_PREFIX) && path !== AGENTS_FILE)) throw new BuildRefusedError('checkout_dirty', CHECKOUT_DIRTY_MESSAGE);
  };

  /** Cross-module calls bound late: dispatch fills them in. */
  const fn: BuildFns = { armDeadline: () => undefined, scheduleDrain: () => undefined };

  return {
    deps, bmad, trust, source, entities, events, tickets, vcs, sandbox, runner, runnerFor, runnerOf, chat, buildSessions, dataDir, settings, commandEnv,
    aware, paths, mask, report, recorder, writeResult, guarded, uncommittedPlanFiles, requirePlanCommitted, requireGit, cleanupDeps,
    sandboxFor, requireSandbox, unattendedSetup, hasCapacity, deadlineFromNow, inDispatch, setTimer, timers, pendingNotes, generation,
    bump, draining, state, rerunSignal, abortRerun, abortAllReruns, stopAgent, disarmDeadline, verificationOf, latestRun, release, cleanUp, requireCleanCheckout, fn
  };
}

export type BuildCtx = ReturnType<typeof createBuildContext>;
