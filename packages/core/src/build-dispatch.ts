/**
 * Dispatch (story 5.8; story 5.10 split `builds.ts`): the time limit, the
 * queue and its drain, Build all ready, Retry, Resume and Update and retry.
 */
import { join } from 'node:path';
import { APPLY_FIX_REFUSED_MESSAGE, ATTENDED_SANDBOX, blockedSentence, NO_SAVED_FIX_MESSAGE, RUN_NOT_ACTIVE_MESSAGE, RunId, CHECKOUT_MOVED_MESSAGE, RUN_REASON_START_FAILED, type BuildAgent, type Run, type WorkspaceId, REBASE_CONFLICT_MESSAGE, REBASE_REFUSED_MESSAGE, type TicketStatus } from '@ogden-agents/shared';
import { BuildRefusedError, NotFoundError } from './errors.js';
import { workspaceRepoPath } from './planning.js';
import { serializedByRepo } from './repo-serialization.js';
import { NO_BUILD_RUNNER_MESSAGE, NO_FREE_SLOT_MESSAGE, READY_STATUS, prerequisitesMet, atCheckpoint, forbiddenChanges, intentGapPatchOf } from './build-names.js';
import type { BuildCtx } from './build-context.js';
import type { createOutcome } from './build-outcome.js';
import type { createStarter } from './build-start.js';

export function createDispatcher(ctx: BuildCtx, start: ReturnType<typeof createStarter>, outcome: ReturnType<typeof createOutcome>) {
  const {
    bmad, entities, tickets, vcs, sandbox, runner, runnerOf, chat, settings, aware, paths, report, writeResult, guarded, requireGit,
    hasCapacity, deadlineFromNow, inDispatch, setTimer, timers, pendingNotes, bump, draining, state, stopAgent, disarmDeadline, fn
  } = ctx;
  const { validateStart, begin, startLocked, prepareContinue } = start;
  const { decideOutcome, track } = outcome;

  /** Stops the run when its deadline passes: blocked `time_limit` (E5-R7), its worktree kept, Retry resumes it. */
  const timeUp = async (runId: RunId): Promise<void> => {
    timers.delete(runId);
    const seen = entities.getRun(runId);
    if (seen === undefined || seen.outcome !== 'running' || seen.queuePosition !== null || state.closed) return;
    let repoPath: string;
    try {
      repoPath = workspaceRepoPath(entities, seen.workspaceId);
    } catch {
      return;
    }
    await serializedByRepo(repoPath, async () => {
      const run = entities.getRun(runId);
      if (run === undefined || run.outcome !== 'running' || run.queuePosition !== null) return;
      await stopAgent(run);
      if (entities.getRun(runId)?.outcome !== 'running') return;
      const reason = blockedSentence('time_limit', { minutes: settings.runLimits().maxRunMinutes });
      const decided = entities.setRunOutcome(run.id, 'blocked', reason, { blockedCode: 'time_limit' });
      await writeResult(decided, repoPath, undefined, reason, true);
    }).catch((error: unknown) => report(runId, 'time limit', error));
    scheduleDrain();
  };

  const armDeadline = (run: Run): void => {
    disarmDeadline(run.id);
    if (run.deadline === null) return;
    timers.set(run.id, setTimer(() => void timeUp(run.id), Math.max(0, Date.parse(run.deadline) - Date.now())));
  };

  /**
   * Starts `run` again in its worktree, in a slot or in the queue: `running`
   * with a fresh deadline and its prompt sent (the resume prompt when
   * `resume`; a plan checkpoint's first prompt otherwise). A prompt that
   * can't be sent puts the run back as it was.
   */
  const startAgain = async (workspaceId: WorkspaceId, run: Run, options: { note?: string | undefined; resume: boolean }): Promise<Run> => {
    if (!hasCapacity(workspaceId)) {
      pendingNotes.set(run.id, { note: options.note, resume: options.resume });
      entities.setRunOutcome(run.id, 'running', null);
      return entities.queueRun(run.id);
    }
    return dispatchAgain(workspaceId, run, options);
  };

  const dispatchAgain = (workspaceId: WorkspaceId, run: Run, options: { note?: string | undefined; resume: boolean }): Run => {
    const before = run;
    bump(run.id);
    const started = entities.dispatchRun(run.id, {
      worktreePath: run.worktreePath!,
      sandbox: run.sandbox ?? ATTENDED_SANDBOX,
      branch: run.branch!,
      baseRevision: run.baseRevision ?? '',
      baseBranch: run.baseBranch,
      deadline: deadlineFromNow(),
    });
    armDeadline(started);
    try {
      const own = runnerOf(run);
      if (own === undefined) throw new BuildRefusedError('sandbox_unavailable', NO_BUILD_RUNNER_MESSAGE);
      chat.sendMessage(workspaceId, run.sessionId, own.invocation(run.ticketRef, { note: options.note, resume: options.resume }), { build: true });
    } catch (error) {
      // Nothing was sent: the run is as it was (a pause, a block), never `running` with no agent.
      disarmDeadline(run.id);
      entities.setRunOutcome(run.id, before.outcome, before.reason, { blockedCode: before.blockedCode });
      throw error;
    }
    return started;
  };

  /**
   * The end checks of a run with no agent to start (Update and retry, Check again, Resume at the done
   * checkpoint) take a run-limit slot like any run: with none free the request is refused before anything
   * changes, so the limits hold (story 5.8 review). The tests' re-run has its own time limit.
   */
  const requireSlot = (workspaceId: WorkspaceId): void => {
    if (!hasCapacity(workspaceId)) throw new BuildRefusedError('run_active', NO_FREE_SLOT_MESSAGE);
  };

  /** Resume (see the header), inside the repo's serialization. */
  const resumeLocked = async (workspaceId: WorkspaceId, repoPath: string, runId: RunId, note: string | undefined): Promise<Run> => {
    await guarded(workspaceId);
    const run = entities.getRun(runId);
    if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', runId);
    if (!atCheckpoint(run)) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    await prepareContinue(workspaceId, repoPath, run);
    if (run.blockedCode === 'checkpoint_plan') return startAgain(workspaceId, run, { note, resume: false });
    requireSlot(workspaceId);
    const resumed = entities.setRunOutcome(run.id, 'running', null);
    // The end checks (the tests' re-run can take minutes) run on their own: the repo's lock is not held for them, so Stop works.
    void track(run.id, () => decideOutcome(resumed, 'idle', { passedDone: true }));
    return resumed;
  };

  /**
   * Update and retry (story 5.9, AD-17): a run blocked `merge_conflict` is
   * rebased in its worktree onto the commit the checkout is on now, its base
   * moves with it, and the end checks run again (the plan is built; the tests
   * are re-run in its sandbox). A rebase that conflicts again or can't run
   * changes nothing and says so; no automatic conflict resolution.
   */
  const rebaseLocked = async (workspaceId: WorkspaceId, repoPath: string, runId: RunId): Promise<Run> => {
    await guarded(workspaceId);
    const run = entities.getRun(runId);
    if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', runId);
    if (run.outcome !== 'blocked' || run.blockedCode !== 'merge_conflict' || run.decision !== null || entities.latestRunForTicket(workspaceId, run.ticketRef)?.id !== run.id) {
      throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    }
    await requireGit();
    requireSlot(workspaceId);
    await prepareContinue(workspaceId, repoPath, run);
    const head = await vcs.head(repoPath);
    if (head === undefined || (run.baseBranch !== null && head.branch !== run.baseBranch)) throw new BuildRefusedError('checkout_dirty', CHECKOUT_MOVED_MESSAGE);
    const done = await vcs.rebase({ repoPath, worktreePath: run.worktreePath!, branch: run.branch!, onto: head.revision });
    if (done === 'conflict') throw new BuildRefusedError('merge_conflict', REBASE_CONFLICT_MESSAGE);
    if (done === 'refused') throw new BuildRefusedError('merge_conflict', REBASE_REFUSED_MESSAGE);
    entities.setRunBase(run.id, head.revision);
    bump(run.id);
    const resumed = entities.setRunOutcome(run.id, 'running', null);
    // The checks run on their own, so the repo's lock is free for Stop.
    void track(run.id, () => decideOutcome(entities.getRun(run.id) ?? resumed, 'idle', { passedDone: true }));
    return resumed;
  };

  /**
   * Check again (story 11.2): the end checks run once more on a failed or
   * ready-for-review run's worktree (the plan's status, the tests re-run in
   * the run's sandbox, the diff), with the project's test command as it is
   * now. The agent does not run. Never for a decided run or one that is not
   * the ticket's latest.
   */
  const checkAgainLocked = async (workspaceId: WorkspaceId, repoPath: string, runId: RunId): Promise<Run> => {
    await guarded(workspaceId);
    const run = entities.getRun(runId);
    if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', runId);
    if (
      (run.outcome !== 'failed' && run.outcome !== 'verified') || run.decision !== null || run.worktreePath === null ||
      entities.latestRunForTicket(workspaceId, run.ticketRef)?.id !== run.id
    ) {
      throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    }
    await requireGit();
    requireSlot(workspaceId);
    await prepareContinue(workspaceId, repoPath, run);
    bump(run.id);
    const checking = entities.setRunOutcome(run.id, 'running', null);
    // The checks run on their own, so the repo's lock is free for Stop.
    void track(run.id, () => decideOutcome(entities.getRun(run.id) ?? checking, 'idle', { passedDone: true }));
    return checking;
  };

  /** The plan statuses a blocked plan may be marked with to resume (its `blocked_at`, else ready for dev). */
  const RESUME_STATUSES: ReadonlySet<string> = new Set(['ready-for-dev', 'in-progress', 'in-review']);

  /**
   * Retry (story 5.8, E5-R7): a blocked, failed or stopped run starts again
   * in its worktree. A blocked plan is marked with its resume status first
   * (through the ticket store, which writes in the run's worktree and clears
   * the blocked fields); any other plan resumes from its own status.
   */
  const retryLocked = async (workspaceId: WorkspaceId, repoPath: string, run: Run, note: string | undefined): Promise<Run> => {
    const { guard } = await guarded(workspaceId);
    await prepareContinue(workspaceId, repoPath, run);
    const ticket = await aware.find(repoPath, run.ticketRef, guard);
    if ((ticket.status ?? '') === 'blocked') {
      const target = RESUME_STATUSES.has(ticket.blocked_at) ? ticket.blocked_at : READY_STATUS;
      await aware.mark(repoPath, run.ticketRef, target as TicketStatus, guard);
    }
    return startAgain(workspaceId, run, { note, resume: true });
  };

  /**
   * Apply the saved fix and retry (story 11.1, bmad-integration): a run
   * blocked `intent_gap` whose plan has the saved patch beside it gets the
   * patch applied in its worktree (all or nothing, through `VcsPort`, with
   * the protected paths the sandbox never let the agent write refused), its
   * plan marked `in-review`, and the agent started again to carry on. A patch
   * that is missing, not a plain file in the run's own `_bmad-output`, or that
   * doesn't apply, changes nothing and says so.
   */
  const applyFixLocked = async (workspaceId: WorkspaceId, repoPath: string, runId: RunId, note: string | undefined): Promise<Run> => {
    const { guard } = await guarded(workspaceId);
    const run = entities.getRun(runId);
    if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', runId);
    if (
      run.outcome !== 'blocked' || run.blockedCode !== 'intent_gap' || run.decision !== null || run.worktreePath === null || run.branch === null ||
      entities.latestRunForTicket(workspaceId, run.ticketRef)?.id !== run.id
    ) {
      throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    }
    await requireGit();
    await prepareContinue(workspaceId, repoPath, run);
    const ticket = await aware.find(repoPath, run.ticketRef, guard);
    const patch = intentGapPatchOf(run.worktreePath, ticket.plan);
    if (patch === null) throw new BuildRefusedError('run_not_active', NO_SAVED_FIX_MESSAGE);
    const applied = await vcs.applyPatch({
      repoPath,
      worktreePath: run.worktreePath,
      branch: run.branch,
      patchPath: join(run.worktreePath, ...patch.split('/')),
      refuse: (file) => forbiddenChanges([file], ticket.plan).length > 0,
    });
    if (applied === 'refused') throw new BuildRefusedError('merge_conflict', APPLY_FIX_REFUSED_MESSAGE);
    await aware.mark(repoPath, run.ticketRef, 'in-review', guard);
    return startAgain(workspaceId, run, { note, resume: true });
  };

  /** Starts one queued run now (its slot is free): its worktree and agent, or a retried one's agent again. A run that can't start ends failed; the queue goes on. */
  const launchQueued = async (queued: Run): Promise<void> => {
    try {
      bmad.requireBmadFeature(queued.workspaceId, 'builds');
    } catch {
      // The piece is off: nothing is dispatched until it is on again (E5-R8); the run stays queued.
      return;
    }
    let repoPath: string;
    try {
      repoPath = workspaceRepoPath(entities, queued.workspaceId);
    } catch {
      return;
    }
    const pending = pendingNotes.get(queued.id);
    try {
      await serializedByRepo(repoPath, async () => {
        const run = entities.getRun(queued.id);
        // Stopped, rejected or already started meanwhile.
        if (run === undefined || run.outcome !== 'running' || run.queuePosition === null) return;
        await guarded(run.workspaceId);
        // Re-checked under the repo's lock: a Retry or a start may have taken the slot meanwhile.
        if (!hasCapacity(run.workspaceId)) return;
        if (run.worktreePath !== null) {
          await prepareContinue(run.workspaceId, repoPath, run);
          dispatchAgain(run.workspaceId, run, { note: pending?.note, resume: pending?.resume ?? true });
          pendingNotes.delete(queued.id);
          return;
        }
        const agent = run.agent ?? runner.agent;
        const plan = await validateStart(run.workspaceId, repoPath, run.ticketRef, agent, run.sandbox === ATTENDED_SANDBOX ? 'attended' : 'unattended', run.machineId, run.id);
        await begin(run.workspaceId, repoPath, run.ticketRef, agent, plan, run, pending?.note);
        pendingNotes.delete(queued.id);
      });
    } catch (error) {
      pendingNotes.delete(queued.id);
      report(queued.id, 'dispatch', error);
      try {
        const run = entities.getRun(queued.id);
        if (run !== undefined && run.outcome === 'running') {
          entities.leaveQueue(run.id);
          // The plain reason when a rule refused it; a failure of git or the disk is only reported (codes), never the user's paths.
          entities.setRunOutcome(run.id, 'failed', error instanceof BuildRefusedError ? error.message : RUN_REASON_START_FAILED);
        }
      } catch (outcome) {
        report(queued.id, 'outcome', outcome);
      }
    }
  };

  /** Starts every ready ticket of a workspace with Build all ready going, once each; the runs started. */
  const extendAll = async (workspaceId: WorkspaceId, repoPath: string, tried: Set<string> & { agent: BuildAgent }): Promise<Run[]> => {
    const { guard } = await guarded(workspaceId);
    // The main checkout's statuses only: a ticket built in a worktree (the agent's own word) is not a prerequisite until it is merged.
    const tree = await tickets.tree(repoPath, guard);
    const started: Run[] = [];
    for (const row of tree.tickets) {
      if (tried.has(row.ref) || (row.status ?? '') !== READY_STATUS || !prerequisitesMet(row, tree)) continue;
      if (entities.activeRunForTicket(workspaceId, row.ref) !== undefined) continue;
      const latest = entities.latestRunForTicket(workspaceId, row.ref);
      if (latest !== undefined && atCheckpoint(latest)) continue;
      tried.add(row.ref);
      try {
        started.push((await startLocked(workspaceId, repoPath, row.ref, tried.agent, 'unattended')).run);
      } catch (error) {
        // A ticket that can't start does not stop the others (a refusal is its own; the rest are reported).
        if (!(error instanceof BuildRefusedError)) report('none', 'build all', error);
      }
    }
    return started;
  };

  /** Keeps Build all ready going and starts what the free slots allow: queued runs oldest first, within both limits. */
  const drainQueue = async (): Promise<void> => {
    if (state.closed) return;
    for (const [workspaceId, tried] of [...draining]) {
      try {
        bmad.requireBmadFeature(workspaceId, 'builds');
        const repoPath = workspaceRepoPath(entities, workspaceId);
        await serializedByRepo(repoPath, () => extendAll(workspaceId, repoPath, tried));
        const busy = entities.listRunningRuns().some((each) => each.workspaceId === workspaceId) || entities.queueOf(workspaceId).length > 0;
        if (!busy) draining.delete(workspaceId);
      } catch {
        // The piece went off or the project went away: it is not drained any more.
        draining.delete(workspaceId);
      }
    }
    for (const queued of entities.listQueuedRuns()) {
      if (state.closed) return;
      if (hasCapacity(queued.workspaceId)) await launchQueued(queued);
    }
  };

  /** Starts the queue's next runs once the current dispatch decision settled; never throws. */
  const scheduleDrain = (): void => {
    if (state.closed) return;
    void inDispatch(drainQueue).catch((error: unknown) => report('none', 'drain', error));
  };

  // Bound late: the starter and the outcome call these through the shared context.
  fn.armDeadline = armDeadline;
  fn.scheduleDrain = scheduleDrain;

  return { timeUp, armDeadline, startAgain, dispatchAgain, resumeLocked, rebaseLocked, applyFixLocked, checkAgainLocked, RESUME_STATUSES, retryLocked, launchQueued, extendAll, drainQueue, scheduleDrain };
}
