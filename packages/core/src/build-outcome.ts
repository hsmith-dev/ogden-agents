/**
 * What a build's turn ending decides (story 5.10 split `builds.ts`): the
 * verification, the per-run result read back, the outcome and the done
 * checkpoint.
 */
import { ATTENDED_SANDBOX, blockedSentence, RUN_REASON_AGENT_ERROR, RUN_REASON_EMPTY_DIFF, RUN_REASON_NO_NETWORK, RUN_REASON_NOT_BUILT, RUN_REASON_PROTECTED_DIFF, RUN_REASON_RESULT_MISMATCH, RUN_REASON_SCRIPTS_CHANGED, RUN_REASON_UNREADABLE, type BlockedCode, type Run, type TicketDetail, type VerificationResult } from '@ogden-agents/shared';
import { detectTestCommand, verifyRun } from './build-verify.js';
import { runFolderOf, runShortOf } from './build-run-folder.js';
import { ScriptsChangedError } from './errors.js';
import { workspaceRepoPath } from './planning.js';
import { forbiddenChanges } from './build-names.js';
import type { BuildCtx } from './build-context.js';

export function createOutcome(ctx: BuildCtx) {
  const {
    trust, entities, events, tickets, vcs, sandbox, runner, chat, buildSessions, dataDir, settings, commandEnv, mask, report,
    writeResult, generation, state, disarmDeadline, release, fn
  } = ctx;

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

  /**
   * The verification of a run whose plan says built (story 5.8, AD-17): the
   * three checks, the project's tests re-run in the run's own sandbox (never
   * unsandboxed; an attended run has none), `run.verification_completed`.
   * `checkedHead` is the branch head the checks looked at.
   */
  const verifyBuilt = async (run: Run, repoPath: string, ticket: TicketDetail, stillCurrent: () => boolean): Promise<{ verification: VerificationResult; checkedHead: string | null }> => {
    const checkedHead = run.branch === null ? null : ((await vcs.branchRevision(repoPath, run.branch)) ?? null);
    const changes = run.branch === null || run.baseRevision === null ? undefined : await vcs.diff(repoPath, run.baseRevision, run.branch, { maxBytes: 1 });
    const files = changes?.files ?? [];
    const attended = run.sandbox === ATTENDED_SANDBOX;
    const setup = buildSessions.get(run.sessionId);
    const contained = setup === undefined || setup.attended === true ? undefined : setup;
    const verification = await verifyRun(
      { sandbox, mask },
      {
        planStatus: ticket.status ?? '',
        files,
        forbiddenDetail: files.length > 0 && forbiddenChanges(files, ticket.plan).length > 0 ? RUN_REASON_PROTECTED_DIFF : undefined,
        emptyDetail: RUN_REASON_EMPTY_DIFF,
        attended,
        sandbox: contained?.sandbox,
        cwd: run.worktreePath ?? repoPath,
        env: { ...commandEnv(), ...contained?.env },
        testCommand: detectTestCommand(repoPath, settings.workspaceSettings(run.workspaceId).testCommand) ?? undefined,
      },
    );
    // A run stopped or started again meanwhile has no verification to announce.
    if (!stillCurrent()) return { verification, checkedHead };
    try {
      events.append({ type: 'run.verification_completed', workspaceId: run.workspaceId, streamId: run.sessionId, payload: { runId: run.id, verification } });
    } catch (error) {
      report(run.id, 'verification event', error);
    }
    return { verification, checkedHead };
  };

  /** Works out a finished turn's outcome (see the header). */
  const decideOutcome = async (run: Run, ended: 'idle' | 'error', options: { passedDone?: boolean } = {}): Promise<void> => {
    if (run.worktreePath === null) return;
    // The turn is over: the time limit no longer applies (the tests have their own).
    disarmDeadline(run.id);
    const started = generation.get(run.id) ?? 0;
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
    // The branch head the end checks looked at (story 5.7): the run's result must name the same one.
    let checkedHead: string | null = null;
    let released = false;
    /** The run's agent is done: its process tree stops now, before anything of the run's is read or re-run. */
    const releaseAgent = async () => {
      if (released) return;
      released = true;
      await chat.releaseAgent(run.workspaceId, run.sessionId).catch((error: unknown) => report(run.id, 'release', error));
    };
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
        await releaseAgent();
        const checked = await verifyBuilt(run, repoPath, ticket, () => entities.getRunBySession(run.sessionId)?.outcome === 'running' && (generation.get(run.id) ?? 0) === started);
        checkedHead = checked.checkedHead;
        outcome = checked.verification.outcome;
        // The first failing check says why, in plain words (the plan check cannot fail here: the plan is built).
        reason = checked.verification.checks.find((each) => each.result === 'fail')?.detail ?? null;
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
    await releaseAgent();
    // Only a run still running gets an outcome here: a Reject or a Stop meanwhile stands, and so does a Retry's new start.
    if (entities.getRunBySession(run.sessionId)?.outcome !== 'running' || (generation.get(run.id) ?? 0) !== started) return;
    // Story 5.7: a run is ready for review only when its per-run result lands and, read back through the runner, agrees with
    // the plan, the run and the branch head the checks saw (the agent is released: nothing moves the branch now).
    let wroteVerified = false;
    if (outcome === 'verified') {
      // A write that failed leaves an older result (a checkpoint's) on disk: never read back as this one's.
      wroteVerified = await writeResult(run, repoPath, ticket, null, false);
      if (!wroteVerified || !(await resultHolds(run, checkedHead))) {
        report(run.id, 'result', new Error(wroteVerified ? 'result did not match' : 'result not written'));
        outcome = 'failed';
        reason = RUN_REASON_RESULT_MISMATCH;
        wroteVerified = false;
      }
    }
    // Re-checked after the awaits above: a Stop, a Reject or a Retry meanwhile stands.
    if (entities.getRunBySession(run.sessionId)?.outcome !== 'running' || (generation.get(run.id) ?? 0) !== started) return;
    const decided = entities.setRunOutcome(run.id, outcome, reason === null ? null : mask(reason), { blockedCode });
    if (!wroteVerified) await writeResult(decided, repoPath, ticket, decided.reason, outcome === 'blocked');
    // A slot is free: the next queued run starts.
    fn.scheduleDrain();
  };

  /**
   * Whether the per-run result in the run's folder, read back through the
   * runner, says the plan is `built` at the branch head the end checks saw
   * and the run's base (story 5.7). A result that is missing, bad or
   * different fails closed.
   */
  const resultHolds = async (run: Run, checkedHead: string | null): Promise<boolean> => {
    const short = runShortOf(run);
    if (short === undefined || checkedHead === null) return false;
    const result = await runner.readResult(runFolderOf(dataDir, short), { runId: run.id, ticketRef: run.ticketRef }).catch(() => undefined);
    return result !== undefined && result.status === 'built' && result.commit === checkedHead && result.baseRevision === run.baseRevision;
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

  return { doneCheckpointOf, verifyBuilt, decideOutcome, resultHolds, deciding, track, unsubscribe };
}
