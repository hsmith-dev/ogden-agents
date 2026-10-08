/**
 * Starting a build (story 5.10 split `builds.ts`): what a start refuses for,
 * a run that waits for a slot, the worktree and session a run gets, and
 * what lets a run with a worktree start again.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ATTENDED_SANDBOX, blockedSentence, RUN_NOT_ACTIVE_MESSAGE, RunId, BMAD_FILES_UNCOMMITTED_MESSAGE, BUILD_BRANCH_PREFIX, WORKTREES_FOLDER_NOT_REAL_MESSAGE, DISK_SPACE_LOW_MESSAGE, MIN_FREE_DISK_BYTES, NOT_READY_MESSAGE, PREREQUISITE_UNMET_MESSAGE, RUN_ACTIVE_MESSAGE, RUN_REASON_START_FAILED, VCS_NOT_TOP_LEVEL_MESSAGE, VCS_UNAVAILABLE_MESSAGE, type BuildAgent, type BuildMode, type RemoteMachineId, type Run, type Session, type TicketDetail, type WorkspaceId } from '@ogden-agents/shared';
import { runShortOf } from './build-run-folder.js';
import { removeObjectStore } from './build-object-store.js';
import { ensureWorktreesRoot, freeBytesOf } from './build-worktrees.js';
import { BuildRefusedError, NotFoundError, ScriptsChangedError, ValidationError } from './errors.js';
import type { RemoteHostConnection } from './remote-host-port.js';
import type { VcsHead } from './vcs-port.js';
import {
  NO_BUILD_RUNNER_MESSAGE,
  READY_STATUS,
  PRECREATED_FOLDERS,
  REMOTE_MACHINE_UNAVAILABLE_MESSAGE,
  REMOTE_UNAVAILABLE_MESSAGE,
  UNATTENDED_REMOTE_MESSAGE,
  buildBranchName,
  isBuildBranch,
  prerequisitesMet,
  runShortId,
  atCheckpoint,
} from './build-names.js';
import type { BuildCtx } from './build-context.js';

export function createStarter(ctx: BuildCtx) {
  const {
    deps, trust, entities, tickets, vcs, sandbox, runner, runnerFor, chat, buildSessions, dataDir, paths, report, writeResult, guarded,
    requirePlanCommitted, requireGit, requireSandbox, unattendedSetup, hasCapacity, deadlineFromNow, pendingNotes, disarmDeadline,
    cleanUp, fn, remote
  } = ctx;

  /** What a start checked about the ticket and the checkout, for the run it makes or the queued run it dispatches. */
  interface StartPlan {
    ticket: TicketDetail;
    head: VcsHead;
    sandboxKind: string;
    attended: boolean;
    latest: Run | undefined;
    /** The remote machine this run goes to (CAP-24, epic 19 story 19.6), attended only; `null` for a local run. */
    machineId: RemoteMachineId | null;
  }

  /**
   * Everything a start refuses for before it writes anything (see the
   * header); the guards run last, right before the first write.
   *
   * `machineId` (CAP-24, epic 19 story 19.6) is refused outright, before
   * anything else runs, for every way this story does not support a remote
   * build yet (the scope decision): an unattended mode, no remote capability
   * wired at all (fail closed, never a silent local run), or a machine this
   * install can't actually reach or use right now -- checked here by opening
   * and at once closing a real connection, the only way {@link BuildCtx.remote}'s
   * narrow `connect`-only shape can say a machine is usable.
   */
  const validateStart = async (workspaceId: WorkspaceId, repoPath: string, ref: string, agent: BuildAgent, mode: BuildMode, machineId: RemoteMachineId | null, self?: RunId): Promise<StartPlan> => {
    if (machineId !== null) {
      if (mode !== 'attended') throw new BuildRefusedError('sandbox_unavailable', UNATTENDED_REMOTE_MESSAGE);
      if (remote === undefined) throw new BuildRefusedError('sandbox_unavailable', REMOTE_UNAVAILABLE_MESSAGE);
      try {
        const probe = await remote.connect(machineId);
        await probe.close();
      } catch {
        throw new BuildRefusedError('sandbox_unavailable', REMOTE_MACHINE_UNAVAILABLE_MESSAGE);
      }
    }
    // Fail closed: an unattended run needs a sandbox that says it is there; only the user's own `attended` mode runs without one (story 5.6).
    // An agent that can no longer build (its runner is not wired) is refused, never built with another's runner (epic 17).
    if (runnerFor(agent) === undefined) throw new BuildRefusedError('sandbox_unavailable', NO_BUILD_RUNNER_MESSAGE);
    const attended = mode === 'attended';
    const sandboxKind = attended ? ATTENDED_SANDBOX : await requireSandbox(agent);
    await requireGit();
    const active = entities.activeRunForTicket(workspaceId, ref);
    // The queued run being dispatched is itself the ticket's active run.
    if (active !== undefined && active.id !== self) throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
    // A run paused at a checkpoint is still this ticket's build (story 5.4): resume or reject it first.
    const latest = self === undefined ? entities.latestRunForTicket(workspaceId, ref) : undefined;
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
    // A queued run must already have its agent's build skill committed; dispatch rechecks the actual worktree.
    const noSkill = runnerFor(agent) !== runner ? await deps.committedSkillReach?.(agent, repoPath, head.revision) : undefined;
    if (noSkill !== undefined) throw new BuildRefusedError('plan_uncommitted', noSkill);
    // The guards once more, right before anything is written: a piece turned off meanwhile writes nothing.
    await guarded(workspaceId);
    return { ticket, head, sandboxKind, attended, latest, machineId };
  };

  /**
   * A run waiting for a slot (story 5.8): its build session and run exist,
   * the run is last in its workspace's queue, and nothing is written in the
   * repo or the data folder yet (its worktree comes at dispatch).
   */
  const enqueue = async (workspaceId: WorkspaceId, ref: string, agent: BuildAgent, plan: StartPlan, note?: string): Promise<{ run: Run; session: Session }> => {
    const session = await chat.createChatSession(workspaceId, { kind: 'build', agentId: agent });
    const run = entities.createRun({ sessionId: session.id, ticketRef: ref, sandbox: plan.sandboxKind, agent, machineId: plan.machineId, queuePosition: 1 });
    if (note !== undefined) pendingNotes.set(run.id, { note, resume: false });
    return { run, session };
  };

  /**
   * Gives the run its worktree and starts it (a new run, or a queued one
   * leaving the queue): the worktree and branch from the checked-out branch,
   * its object store, its session's setup, then the prompt (or the plan
   * checkpoint's pause). Any failure after the worktree exists removes it
   * and ends the run `failed`.
   */
  const begin = async (workspaceId: WorkspaceId, repoPath: string, ref: string, agent: BuildAgent, plan: StartPlan, queued: Run | undefined, note?: string): Promise<{ run: Run; session: Session }> => {
    const { ticket, head, sandboxKind, attended, latest, machineId } = plan;
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
    let run: Run | undefined = queued;
    let session: Session | undefined;
    // A remote attended run's own long-lived connection (CAP-24, epic 19 story 19.6): closed here on any failure after
    // it opens, independently of the remote directory's own best-effort removal below (each closes its own thing).
    let remoteConnection: RemoteHostConnection | undefined;
    let pushedRemote = false;
    try {
      const real = paths.realpath(worktreePath) ?? worktreePath;
      // The worktree's scripts are the committed ones: they must be the ones the user trusted (BMad files committed).
      try {
        await trust.requireScriptsMatch(workspaceId, real);
      } catch (error) {
        if (error instanceof ScriptsChangedError) throw new BuildRefusedError('plan_uncommitted', BMAD_FILES_UNCOMMITTED_MESSAGE);
        throw error;
      }
      // Another agent's skill folder must hold the build skill in this worktree (only committed files are there): never built without it.
      // The default agent's own skill folder is not checked here (epic 5's live checks cover it); every other agent's is.
      const noSkill = runnerFor(agent) !== runner ? deps.skillReach?.(agent, real) : undefined;
      if (noSkill !== undefined) throw new BuildRefusedError('plan_uncommitted', noSkill);
      for (const folder of PRECREATED_FOLDERS) mkdirSync(join(real, folder), { recursive: true });
      const deadline = deadlineFromNow();
      if (queued === undefined) {
        session = await chat.createChatSession(workspaceId, { kind: 'build', agentId: agent });
        run = entities.createRun({ sessionId: session.id, ticketRef: ref, worktreePath: real, sandbox: sandboxKind, branch, baseRevision: head.revision, baseBranch: head.branch, agent, machineId, deadline });
      } else {
        session = entities.getSession(queued.sessionId);
        if (session === undefined) throw new NotFoundError('session', queued.sessionId);
        run = entities.dispatchRun(queued.id, { worktreePath: real, sandbox: sandboxKind, branch, baseRevision: head.revision, baseBranch: head.branch, deadline });
      }
      // An attended run has no sandbox, so no object store: the user answers every card. A sandboxed run's git writes its own store.
      // A remote attended run (CAP-24, epic 19 story 19.6) pushes the worktree right after it is created, and its agent
      // runs over one long-lived connection handed to the chat layer, in the remote's own directory, never the local one.
      // `cwd` here is the real navigation target the remote shell's own `cd` needs (relative to the machine's login
      // directory, `remote-worktree-sync.ts`'s own `push`); the ACP agent is told a different, always-safe `cwd`
      // (`REMOTE_LAUNCH_CWD`) once it's actually there -- `acp-base/acp-agent.ts`'s own concern, story 19.7's fix.
      const setup =
        machineId !== null
          ? await (async () => {
              const { remotePath } = await remote!.sync.push({ repoPath, branch, runId: run!.id, machineId });
              pushedRemote = true;
              remoteConnection = await remote!.connect(machineId);
              return { attended: true as const, cwd: remotePath, remote: remoteConnection };
            })()
          : attended
            ? ({ attended: true, cwd: real } as const)
            : await unattendedSetup(workspaceId, sandboxKind, real, branch, runShort);
      buildSessions.set(session.id, setup);
      if (ticket.plan_checkpoint === true) {
        // The plan checkpoint (story 5.4): paused before the prompt is sent; `resume` sends it.
        const reason = blockedSentence('checkpoint_plan');
        run = entities.setRunOutcome(run.id, 'blocked', reason, { blockedCode: 'checkpoint_plan' });
        await writeResult(run, repoPath, ticket, reason, true);
        return { run, session };
      }
      fn.armDeadline(run);
      const own = runnerFor(agent);
      if (own === undefined) throw new BuildRefusedError('sandbox_unavailable', NO_BUILD_RUNNER_MESSAGE);
      chat.sendMessage(workspaceId, session.id, own.invocation(ref, { note }), { build: true });
      // The ticket's previous run, undecided and not running, is superseded (story 5.5 review): no Retry or Reject reaches it now, so its worktree and branch go.
      if (latest !== undefined && latest.id !== run.id && latest.decision === null && latest.outcome !== 'running') await cleanUp(repoPath, latest);
      return { run, session };
    } catch (error) {
      if (run !== undefined) disarmDeadline(run.id);
      if (session !== undefined) buildSessions.delete(session.id);
      // The remote run's own connection and directory (CAP-24, epic 19 story 19.6): each closed/removed independently, best-effort.
      if (remoteConnection !== undefined) await remoteConnection.close().catch((cleanup: unknown) => report(run?.id ?? 'none', 'cleanup', cleanup));
      if (pushedRemote && machineId !== null) await remote!.sync.remove({ runId: run!.id, machineId }).catch((cleanup: unknown) => report(run?.id ?? 'none', 'cleanup', cleanup));
      // Nothing of a run that didn't start is left behind: no worktree, no object store, and no branch unless a run names it.
      try {
        removeObjectStore(dataDir, runShort);
      } catch (cleanup) {
        report(run?.id ?? 'none', 'cleanup', cleanup);
      }
      await vcs.removeWorktree(repoPath, worktreePath, run === undefined || run.branch !== branch ? { deleteBranch: branch } : {}).catch((cleanup: unknown) => report(run?.id ?? 'none', 'cleanup', cleanup));
      if (run !== undefined) {
        try {
          // A queued run that could not leave the queue leaves it failed.
          if (queued !== undefined) entities.leaveQueue(run.id);
          entities.setRunOutcome(run.id, 'failed', RUN_REASON_START_FAILED);
        } catch (outcome) {
          report(run.id, 'outcome', outcome);
        }
        fn.scheduleDrain();
      }
      throw error;
    }
  };

  /**
   * One start (see the header): to a slot now, or to the queue. `machineId`
   * (CAP-24, epic 19 story 19.6) is reached only by a direct call -- no REST
   * field exists for it yet (19.7's job); `start()` (`builds.ts`) never
   * passes one. Default `null`: a local run, exactly as before.
   */
  const startLocked = async (workspaceId: WorkspaceId, repoPath: string, ref: string, agent: BuildAgent, mode: BuildMode, note?: string, machineId: RemoteMachineId | null = null): Promise<{ run: Run; session: Session }> => {
    const plan = await validateStart(workspaceId, repoPath, ref, agent, mode, machineId);
    if (!hasCapacity(workspaceId)) return enqueue(workspaceId, ref, agent, plan, note);
    return begin(workspaceId, repoPath, ref, agent, plan, undefined, note);
  };

  /**
   * Checks a run with a worktree can start there again (Retry, a checkpoint's
   * Resume, a queued one leaving the queue): the sandbox (fail closed), the
   * worktree, its scripts, and its session's setup rebuilt after a restart.
   *
   * A remote run (CAP-24, epic 19 story 19.6) gets a fresh remote directory
   * and a fresh connection every time, never a hot-patch of whatever the
   * last attempt left behind: `sync.push` itself always rebuilds the run's
   * remote directory from scratch (`remote-worktree-sync.ts`'s own `rm -rf`
   * first), and `connect` opens a connection of its own, so a Retry after a
   * `connection_lost` drop proceeds exactly as a first attempt.
   */
  const prepareContinue = async (workspaceId: WorkspaceId, repoPath: string, run: Run): Promise<void> => {
    if (run.worktreePath === null || run.branch === null || !isBuildBranch(run.branch)) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    // Fail closed, as at the start: never an unsandboxed unattended run (a build the user watches is the one without).
    const attended = run.sandbox === ATTENDED_SANDBOX;
    const sandboxKind = attended ? ATTENDED_SANDBOX : await requireSandbox(run.agent ?? runner.agent);
    if (!(await vcs.worktreeExists(repoPath, run.worktreePath))) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
    // The worktree's scripts must still be the trusted ones before anything runs there.
    await trust.requireScriptsMatch(workspaceId, run.worktreePath);
    // The other agent's build skill must still be there (a retry or a queued run with a worktree starts from it too).
    const noSkill = runnerFor(run.agent ?? runner.agent) !== runner ? deps.skillReach?.(run.agent ?? runner.agent, run.worktreePath) : undefined;
    if (noSkill !== undefined) throw new BuildRefusedError('plan_uncommitted', noSkill);
    if (run.machineId !== null) {
      if (remote === undefined) throw new BuildRefusedError('sandbox_unavailable', REMOTE_UNAVAILABLE_MESSAGE);
      const existing = buildSessions.get(run.sessionId);
      // The dead connection from before the drop (if any) is closed independently of the fresh one below.
      if (existing?.attended === true && existing.remote !== undefined) await existing.remote.close().catch(() => undefined);
      const { remotePath } = await remote.sync.push({ repoPath, branch: run.branch, runId: run.id, machineId: run.machineId });
      const connection = await remote.connect(run.machineId);
      buildSessions.set(run.sessionId, { attended: true, cwd: remotePath, remote: connection });
      return;
    }
    if (buildSessions.get(run.sessionId) === undefined) {
      // The server restarted since the pause (or the run was stopped): the setup is rebuilt from the run, so the next prompt starts a fresh agent there.
      const short = runShortOf(run);
      if (short === undefined) throw new BuildRefusedError('run_not_active', RUN_NOT_ACTIVE_MESSAGE);
      buildSessions.set(run.sessionId, attended ? { attended: true, cwd: run.worktreePath } : await unattendedSetup(workspaceId, sandboxKind, run.worktreePath, run.branch, short));
    }
  };

  return { validateStart, enqueue, begin, startLocked, prepareContinue };
}
