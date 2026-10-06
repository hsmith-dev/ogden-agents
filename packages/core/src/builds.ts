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
import { existsSync } from 'node:fs';
import { type BuildAgent, type BuildAgentChoice, ATTENDED_SANDBOX, ALREADY_MERGED_MESSAGE, ApproveBuildRequest, RetryRunRequest, RETRY_NOT_AVAILABLE_MESSAGE, RUN_NOT_ACTIVE_MESSAGE, CHECKOUT_BUSY_MESSAGE, CHECKOUT_MOVED_MESSAGE, CHECKS_FAILED_MESSAGE, MERGE_CONFLICT_MESSAGE, MERGE_REFUSED_MESSAGE, REVIEW_STALE_MESSAGE, RUN_ACTIVE_MESSAGE, OBJECTS_NOT_IMPORTED_MESSAGE, StartBuildRequest, UNKNOWN_BUILD_AGENT_MESSAGE, VCS_UNAVAILABLE_MESSAGE, type WorkspaceId, ALL_READY_ASK_MESSAGE, RUN_REASON_STOPPED, RejectBuildRequest } from '@ogden-agents/shared';
import { runShortOf } from './build-run-folder.js';
import { objectStoreOf } from './build-object-store.js';
import { sweepObjectStores, sweepRunBranches, sweepWorktrees } from './build-worktrees.js';
import { BuildRefusedError, NotFoundError, NotImplementedError, ValidationError } from './errors.js';
import { workspaceRepoPath } from './planning.js';
import { serializedByRepo } from './repo-serialization.js';
import { createBuildContext } from './build-context.js';
import { createDispatcher } from './build-dispatch.js';
import { createOutcome } from './build-outcome.js';
import { createReviewer } from './build-review.js';
import { createStarter } from './build-start.js';
import { checkedRef, isBuildBranch, checkedRunId, atCheckpoint } from './build-names.js';
import type { BuildsDeps, BuildsUseCases } from './builds-types.js';

export { BUILD_PERMISSION_DENIED } from './build-permission-policy.js';
export { BMAD_OUTPUT_PREFIX, buildBranchName, isBuildBranch, prerequisitesMet, forbiddenChanges, atCheckpoint, intentGapPatchOf } from './build-names.js';
export type { BuildsDeps, BuildsUseCases } from './builds-types.js';

export function createBuilds(deps: BuildsDeps): BuildsUseCases {
  const ctx = createBuildContext(deps);
  const start = createStarter(ctx);
  const outcome = createOutcome(ctx);
  const dispatch = createDispatcher(ctx, start, outcome);
  const reviewer = createReviewer(ctx);
  const {
    bmad, trust, entities, tickets, vcs, sandbox, runner, runnerFor, defaultAgentFor, chat, dataDir, report, recorder, writeResult, guarded, uncommittedPlanFiles,
    requireGit, cleanupDeps, requireSandbox, inDispatch, timers, pendingNotes, bump, draining, state, disarmDeadline, verificationOf,
    latestRun, release, cleanUp, requireCleanCheckout
  } = ctx;
  const { startLocked } = start;
  const { deciding, unsubscribe } = outcome;
  const { resumeLocked, rebaseLocked, applyFixLocked, checkAgainLocked, retryLocked, extendAll, drainQueue, scheduleDrain } = dispatch;
  const { reviewOf } = reviewer;

  return {
    async start(workspaceId, request) {
      const { repoPath } = await guarded(workspaceId);
      const parsed = StartBuildRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Name one ticket to build.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      // Every ready ticket is `startAll` (story 5.8), which answers with the runs and the queue.
      if (parsed.data.ref === undefined) throw new ValidationError(ALL_READY_ASK_MESSAGE, [{ path: ['all'], message: ALL_READY_ASK_MESSAGE }]);
      const ref = checkedRef(parsed.data.ref);
      // Each agent builds through its own runner (epic 17): one with none is refused.
      const agent = parsed.data.agent ?? defaultAgentFor(workspaceId);
      if (runnerFor(agent) === undefined) throw new ValidationError(UNKNOWN_BUILD_AGENT_MESSAGE, [{ path: ['agent'], message: UNKNOWN_BUILD_AGENT_MESSAGE }]);
      return inDispatch(() => serializedByRepo(repoPath, () => startLocked(workspaceId, repoPath, ref, agent, parsed.data.mode)));
    },

    async startAll(workspaceId, request) {
      const { repoPath } = await guarded(workspaceId);
      const parsed = StartBuildRequest.safeParse(request);
      if (!parsed.success || parsed.data.all !== true) throw new ValidationError(ALL_READY_ASK_MESSAGE, [{ path: ['all'], message: ALL_READY_ASK_MESSAGE }]);
      const agent = parsed.data.agent ?? defaultAgentFor(workspaceId);
      if (runnerFor(agent) === undefined) throw new ValidationError(UNKNOWN_BUILD_AGENT_MESSAGE, [{ path: ['agent'], message: UNKNOWN_BUILD_AGENT_MESSAGE }]);
      // Every ready ticket goes unattended: a build with the user watching is one ticket at a time.
      if (parsed.data.mode === 'attended') throw new ValidationError(ALL_READY_ASK_MESSAGE, [{ path: ['mode'], message: ALL_READY_ASK_MESSAGE }]);
      return inDispatch(() =>
        serializedByRepo(repoPath, async () => {
          await requireSandbox(agent);
          // Each request tries every ready ticket afresh (one refused before may be ready now).
          const tried = Object.assign(new Set<string>(), { agent });
          draining.set(workspaceId, tried);
          const runs = await extendAll(workspaceId, repoPath, tried);
          return { runs, queue: entities.queueOf(workspaceId) };
        }),
      );
    },

    async stop(workspaceId, runId) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRunId(runId);
      const stopped = await serializedByRepo(repoPath, async () => {
        await guarded(workspaceId);
        const run = entities.getRun(checked);
        if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', checked);
        if (run.outcome !== 'running') throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
        disarmDeadline(run.id);
        bump(run.id);
        // A test re-run in progress stops with the run (its whole process tree).
        ctx.abortRerun(run.id);
        pendingNotes.delete(run.id);
        if (run.queuePosition !== null) {
          entities.leaveQueue(run.id);
          return entities.setRunOutcome(run.id, 'stopped', RUN_REASON_STOPPED);
        }
        // The agent's whole process tree goes (`killProcessTree`); its worktree stays for Retry or Reject.
        await release(run);
        // A turn that ended meanwhile may have decided it first.
        if (entities.getRun(run.id)?.outcome !== 'running') return entities.getRun(run.id) ?? run;
        const decided = entities.setRunOutcome(run.id, 'stopped', RUN_REASON_STOPPED);
        await writeResult(decided, repoPath, undefined, RUN_REASON_STOPPED, false);
        return decided;
      });
      scheduleDrain();
      return stopped;
    },

    async runs(workspaceId) {
      await guarded(workspaceId);
      return { runs: entities.listRuns(workspaceId), queue: entities.queueOf(workspaceId) };
    },

    async run(workspaceId, runId) {
      await guarded(workspaceId);
      const checked = checkedRunId(runId);
      const run = entities.getRun(checked);
      if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', checked);
      return { run, verification: verificationOf(run) ?? null };
    },

    async dispatchQueued() {
      await inDispatch(drainQueue);
    },

    async sandboxStatus(workspaceId, agent) {
      bmad.requireBmadFeature(workspaceId, 'builds');
      // For the agent asked about (the picker's choice), else the project's default build agent (epic 17).
      const asked = agent ?? defaultAgentFor(workspaceId);
      if (runnerFor(asked) === undefined) throw new ValidationError(UNKNOWN_BUILD_AGENT_MESSAGE, [{ path: ['agent'], message: UNKNOWN_BUILD_AGENT_MESSAGE }]);
      return sandbox.status({ agent: asked });
    },

    async buildAgents(workspaceId) {
      bmad.requireBmadFeature(workspaceId, 'builds');
      const listed = await chat.chatAgents(workspaceId);
      const agents: BuildAgentChoice[] = [];
      for (const each of listed.agents) {
        if (runnerFor(each.agentId) === undefined) continue;
        if (each.unavailable !== undefined) {
          agents.push({ agentId: each.agentId, displayName: each.displayName, way: 'unavailable', reason: each.unavailable.reason });
          continue;
        }
        // The sandbox answer is per agent (epic 17): a missing sandbox, or an agent not verified in its own, leaves it attended only.
        const check = await sandbox.check({ agent: each.agentId });
        agents.push(check.available ? { agentId: each.agentId, displayName: each.displayName, way: 'unattended', reason: null } : { agentId: each.agentId, displayName: each.displayName, way: 'attended_only', reason: check.reason });
      }
      return { agents, defaultAgentId: defaultAgentFor(workspaceId) };
    },

    async review(workspaceId, ref) {
      const { repoPath, guard } = await guarded(workspaceId);
      const checked = checkedRef(ref);
      const run = latestRun(workspaceId, checked);
      // The plan's path (the same in the main checkout and the worktree), for the findings in it.
      // Not while the agent runs: its plan is being written, and nothing is reviewed yet.
      const plan = run.worktreePath === null || run.outcome === 'running' ? null : await tickets.find(repoPath, checked, guard).then((ticket) => ticket.plan, () => null);
      return reviewOf(repoPath, run, plan);
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
        // A sandboxed run's objects live only in its store: without it nothing can be merged (review: never a confusing git error).
        const short = runShortOf(run);
        if (run.sandbox !== ATTENDED_SANDBOX && short !== undefined && !existsSync(objectStoreOf(dataDir, short))) throw new BuildRefusedError('checks_failed', OBJECTS_NOT_IMPORTED_MESSAGE);
        // The run's own objects come into the repo through git's own strict unpacking, never as files the agent wrote (story 5.6).
        if (run.baseRevision !== null && (await vcs.importObjects(repoPath, run.branch, run.baseRevision)) === 'refused') {
          throw new BuildRefusedError('checks_failed', OBJECTS_NOT_IMPORTED_MESSAGE);
        }
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

    async reject(workspaceId, ref, request) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRef(ref);
      const parsed = RejectBuildRequest.safeParse(request ?? {});
      if (!parsed.success) throw new ValidationError('That is not a reject request.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      let attended = false;
      // Reject and retry builds with the agent the rejected run used (an old run has none stored: the default's).
      let retryAgent: BuildAgent = runner.agent;
      const rejected = await serializedByRepo(repoPath, async () => {
        await guarded(workspaceId);
        const run = latestRun(workspaceId, checked);
        if (run.outcome === 'running') throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
        // An approved run is merged: never rejected after (its branch is gone since story 5.5).
        if (run.decision === 'approved') throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        if (run.branch !== null && isBuildBranch(run.branch) && (await vcs.isMerged(repoPath, run.branch)) && run.outcome === 'verified') {
          throw new BuildRefusedError('checks_failed', ALREADY_MERGED_MESSAGE);
        }
        // A run already rejected stays as it is: a repeat Reject writes nothing (review, story 5.3); with retry it builds the ticket again (a start that was refused the first time).
        if (run.decision === 'rejected') {
          attended = run.sandbox === ATTENDED_SANDBOX;
          retryAgent = run.agent ?? runner.agent;
          return { review: await reviewOf(repoPath, run), fresh: parsed.data.retry };
        }
        attended = run.sandbox === ATTENDED_SANDBOX;
        retryAgent = run.agent ?? runner.agent;
        await release(run);
        entities.setRunOutcome(run.id, 'stopped', run.reason);
        const decided = entities.setRunDecision(run.id, 'rejected');
        // A discard (story 5.5): the worktree and its branch go; a failure is swept at the next start.
        await cleanUp(repoPath, decided);
        return { review: await reviewOf(repoPath, decided), fresh: true };
      });
      scheduleDrain();
      if (!parsed.data.retry || !rejected.fresh) return rejected.review;
      // Reject and retry (story 5.9): the same ticket, built again from a new worktree, the note in its first message.
      return inDispatch(() =>
        serializedByRepo(repoPath, async () => {
          const started = await startLocked(workspaceId, repoPath, checked, retryAgent, attended ? 'attended' : 'unattended', parsed.data.note);
          return reviewOf(repoPath, started.run);
        }),
      );
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
      await sweepObjectStores(sweepDeps).catch((error: unknown) => report('none', 'sweep objects', error));
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
      return inDispatch(() => serializedByRepo(repoPath, () => resumeLocked(workspaceId, repoPath, checked, undefined)));
    },

    async checkAgain(workspaceId, runId) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRunId(runId);
      return inDispatch(() => serializedByRepo(repoPath, () => checkAgainLocked(workspaceId, repoPath, checked)));
    },

    async retry(workspaceId, runId, request) {
      const { repoPath } = await guarded(workspaceId);
      const checked = checkedRunId(runId);
      const parsed = RetryRunRequest.safeParse(request ?? {});
      if (!parsed.success) throw new ValidationError('That is not a retry request.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      const run = entities.getRun(checked);
      if (run === undefined || run.workspaceId !== workspaceId) throw new NotFoundError('run', checked);
      // Nothing to retry for a run still going (or queued), ready for review or decided (review: 409 as the route says).
      if (run.outcome === 'running' || run.outcome === 'verified' || run.decision !== null) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
      // Update and retry (story 5.9): rebase the run's branch onto the checked-out branch, then check it again.
      if (parsed.data.mode === 'rebase') return inDispatch(() => serializedByRepo(repoPath, () => rebaseLocked(workspaceId, repoPath, checked)));
      // Apply the saved fix and retry (story 11.1): an intent gap's patch is applied in the worktree, then the build goes on.
      if (parsed.data.mode === 'apply_fix') return inDispatch(() => serializedByRepo(repoPath, () => applyFixLocked(workspaceId, repoPath, checked, parsed.data.note)));
      // A checkpoint pause resumes (story 5.4).
      if (atCheckpoint(run)) return inDispatch(() => serializedByRepo(repoPath, () => resumeLocked(workspaceId, repoPath, checked, parsed.data.note)));
      // A conflicting merge needs its rebase first (5.9), not another run of the agent.
      if (run.blockedCode === 'merge_conflict') throw new NotImplementedError(RETRY_NOT_AVAILABLE_MESSAGE);
      return inDispatch(() =>
        serializedByRepo(repoPath, async () => {
          const current = entities.getRun(checked);
          if (current === undefined || current.outcome === 'running' || current.outcome === 'verified' || current.decision !== null) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
          // Only the ticket's latest run: an older one was superseded by a new build.
          if (entities.latestRunForTicket(workspaceId, current.ticketRef)?.id !== current.id) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
          return retryLocked(workspaceId, repoPath, current, parsed.data.note);
        }),
      );
    },

    recorded: () => recorder.flushed(),

    async settled() {
      while (deciding.size > 0) await Promise.all([...deciding]);
      // Any dispatch the outcomes scheduled (story 5.8) has run when this one does.
      await inDispatch(async () => undefined);
    },

    close() {
      state.closed = true;
      for (const timer of timers.values()) timer.cancel();
      timers.clear();
      ctx.abortAllReruns();
      unsubscribe();
      recorder.close();
    },
  };
}
