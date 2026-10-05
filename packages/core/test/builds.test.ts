/**
 * Unattended builds' use-cases (story 5.2, epic 5's tracer), on a real core
 * with fake ports: an in-memory VCS, sandbox, build runner, ticket store and
 * chat. Each row of the plan's I/O matrix: piece off, not trusted, scripts
 * changed, unmet prerequisite, a run already active, no sandbox, not ready,
 * an uncommitted plan, no branch; the run's outcome from the plan status in
 * its worktree (verified, blocked, failed, an empty diff, worktree scripts
 * edited by the agent); Approve (dirty checkout, `_bmad-output` exception,
 * merge conflict, scripts changed by the merge, the happy path) and Reject.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_ACTIVITY_FILE,
  BUILD_RESULT_FILE,
  BuildRunResult,
  blockedSentence,
  CHECKOUT_DIRTY_MESSAGE,
  MERGE_CONFLICT_MESSAGE,
  RUN_REASON_EMPTY_DIFF,
  RUN_REASON_INTERRUPTED,
  RUN_REASON_NO_NETWORK,
  RUN_REASON_PROTECTED_DIFF,
  RUN_REASON_START_FAILED,
  REVIEW_STALE_MESSAGE,
  BMAD_FILES_UNCOMMITTED_MESSAGE,
  CHECKOUT_BUSY_MESSAGE,
  MERGE_REFUSED_MESSAGE,
  VCS_NOT_TOP_LEVEL_MESSAGE,
  RUN_REASON_SCRIPTS_CHANGED,
  type SessionId,
  type TicketDetail,
  type TicketStatus,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it, vi } from 'vitest';
import { BuildRefusedError, createBuilds, FeatureOffError, ScriptsChangedError, ScriptsNotTrustedError, type BuildRunnerPort, type BuildsUseCases, type Core, type TicketStorePort, type VcsCheck, type VcsHead, type VcsPort } from '../src/index.js';
import { codeOf, harness, PLAN, refusal, REVISION, testRunner, type Harness } from './builds-harness.js';

describe('starting a build (story 5.2)', () => {
  it('refuses with Unattended builds off (feature_off), untrusted (scripts_not_trusted) or changed scripts (scripts_changed), writing nothing', async () => {
    const off = await harness({ pieces: ['board'] as never });
    expect(await refusal(off.builds.start(off.wsId, { ref: '1.1' }))).toBeInstanceOf(FeatureOffError);
    expect(off.git.calls).toEqual([]);
    expect(off.core.entities.listSessions(off.wsId)).toEqual([]);
    expect(existsSync(join(off.dataDir, 'w'))).toBe(false);

    const untrusted = await harness({ trusted: false });
    expect(await refusal(untrusted.builds.start(untrusted.wsId, { ref: '1.1' }))).toBeInstanceOf(ScriptsNotTrustedError);
    expect(untrusted.tickets.calls).toEqual([]);

    const changed = await harness();
    changed.fingerprints.set(changed.repo, 'edited');
    expect(await refusal(changed.builds.start(changed.wsId, { ref: '1.1' }))).toBeInstanceOf(ScriptsChangedError);
    expect(changed.tickets.calls).toEqual([]);
    expect(changed.git.calls).toEqual([]);
  });

  it('refuses no sandbox, an unmet prerequisite, a ticket not ready, no branch and an uncommitted plan, writing nothing', async () => {
    const h = await harness();
    h.sandbox.available = false;
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('sandbox_unavailable');
    h.sandbox.available = true;
    // 1.2 waits for 1.1, which is only ready.
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.2' }))).toBe('prerequisite_unmet');
    h.tickets.set(h.repo, '1.1', 'draft');
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('not_ready');
    h.tickets.set(h.repo, '1.1', 'ready-for-dev');
    h.git.state.head = undefined;
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('vcs_unavailable');
    h.git.state.head = { branch: 'main', revision: REVISION };
    h.git.state.status = [PLAN, 'src/mine.ts'];
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('plan_uncommitted');
    h.git.state.status = ['_bmad-output/initiative-demo/epic-first/tickets.toml'];
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('plan_uncommitted');
    expect(h.git.calls).toEqual([]);
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
    // Other uncommitted changes don't block it, and a prerequisite in review is met.
    h.git.state.status = ['src/mine.ts', '_bmad-output/notes.md'];
    h.tickets.set(h.repo, '1.1', 'in-review');
    expect((await h.builds.start(h.wsId, { ref: '1.2' })).run.ticketRef).toBe('1.2');
    // A malformed request is a validation error.
    expect(((await refusal(h.builds.start(h.wsId, { ref: '../x' }))) as Error).name).toBe('ValidationError');
  });

  it('starts a build session in a worktree under the data folder with its sandbox and policy, and refuses a second while it runs', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(session.kind).toBe('build');
    expect(run).toMatchObject({ ticketRef: '1.1', outcome: 'running', sandbox: 'test', baseRevision: REVISION });
    const runShort = run.worktreePath!.split(/[\\/]/).at(-1)!;
    expect(run.branch).toBe(`ogden/${runShort}/1.1-build-the-thing`);
    expect(run.worktreePath!.startsWith(join(realpathSync.native(h.dataDir), 'w'))).toBe(true);
    expect(h.git.calls).toEqual([`worktree add ${run.branch} ${REVISION}`]);
    // Empty protected folders in the worktree, so the sandbox's binds exist.
    for (const folder of ['.claude', '.vscode', '.idea', '_bmad']) expect(existsSync(join(run.worktreePath!, folder)), folder).toBe(true);
    expect(h.sent).toEqual([{ sessionId: session.id, text: '/build 1.1' }]);
    const setup = h.core.buildSessions.get(session.id)!;
    expect(setup.cwd).toBe(run.worktreePath);
    // Only the run's own git paths: never the user's refs, logs or objects/info.
    expect(setup.sandbox.writableRoots).toEqual([run.worktreePath, join('/repo/.git', 'objects'), `/repo/.git/refs/heads/ogden/${runShort}`, `/repo/.git/logs/refs/heads/ogden/${runShort}`, '/repo/.git/worktrees/x']);
    expect(setup.sandbox.deniedPaths).toContain(join('/repo/.git', 'objects', 'info'));
    expect(setup.sandbox.deniedReads).toContain(realpathSync.native(h.dataDir));
    expect(setup.sandbox.allowedReads).toEqual([run.worktreePath]);
    expect(setup.decide({ toolCallId: 't', title: 'w', kind: 'edit', paths: ['/repo/.git/refs/heads/main'] }).outcome).toBe('deny');
    expect(setup.decide({ toolCallId: 't', title: 'w', kind: 'edit', paths: [`/repo/.git/refs/heads/ogden/${runShort}/x`] }).outcome).toBe('allow_once');
    expect(setup.sandbox.deniedPaths).toEqual(expect.arrayContaining([join('/repo/.git', 'hooks'), join('/repo/.git', 'config'), join(run.worktreePath!, '_bmad')]));
    expect(setup.decide({ toolCallId: 't', title: 'w', kind: 'edit', paths: [join(run.worktreePath!, 'src', 'a.ts')] }).outcome).toBe('allow_once');
    expect(setup.decide({ toolCallId: 't', title: 'w', kind: 'edit', paths: [join(h.repo, 'src', 'a.ts')] }).outcome).toBe('deny');
    expect(setup.decide({ toolCallId: 't', title: 'w', kind: 'execute', command: 'curl x' }).outcome).toBe('deny');
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('run_active');
    expect((await h.builds.runOfSession(h.wsId, session.id)).id).toBe(run.id);
  });
});

describe("a build's outcome when its turn ends (story 5.2)", () => {
  it('verified for built with a non-empty diff, read in the worktree', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'verified', reason: null });
    expect(h.tickets.calls).toContainEqual(['find', run.worktreePath, '1.1']);
  });

  it('blocked with the plan reason; failed for any other status, an agent error, or an empty diff', async () => {
    const blocked = await harness();
    const one = await blocked.builds.start(blocked.wsId, { ref: '1.1' });
    blocked.tickets.set(one.run.worktreePath!, '1.1', 'blocked', 'Needs the payment API.');
    await blocked.endTurn(one.session.id);
    expect(blocked.core.entities.getRun(one.run.id)).toMatchObject({ outcome: 'blocked', reason: `Needs the payment API. ${RUN_REASON_NO_NETWORK}` });

    const notBuilt = await harness();
    const two = await notBuilt.builds.start(notBuilt.wsId, { ref: '1.1' });
    notBuilt.tickets.set(two.run.worktreePath!, '1.1', 'in-progress');
    await notBuilt.endTurn(two.session.id, 'error');
    expect(notBuilt.core.entities.getRun(two.run.id)?.outcome).toBe('failed');

    const empty = await harness();
    const three = await empty.builds.start(empty.wsId, { ref: '1.1' });
    empty.tickets.set(three.run.worktreePath!, '1.1', 'built');
    empty.git.state.files = [];
    await empty.endTurn(three.session.id);
    expect(empty.core.entities.getRun(three.run.id)).toMatchObject({ outcome: 'failed', reason: RUN_REASON_EMPTY_DIFF });
  });

  it("failed without running tickets.py when the agent edited the worktree's scripts", async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    h.fingerprints.set(run.worktreePath!, 'edited by the agent');
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'failed', reason: RUN_REASON_SCRIPTS_CHANGED });
    expect(h.tickets.calls.filter((call) => call[1] === run.worktreePath)).toEqual([]);
  });

  it('an agent stopped under the run (a server stop) sets no outcome', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.core.entities.setSessionState(session.id, 'working');
    h.core.entities.setSessionState(session.id, 'idle', { reason: 'restarted', resumable: true });
    await h.builds.settled();
    expect(h.core.entities.getRun(run.id)?.outcome).toBe('running');
  });
});

describe('Approve and Reject (story 5.2)', () => {
  async function verified() {
    const h = await harness();
    const started = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(started.run.worktreePath!, '1.1', 'built');
    await h.endTurn(started.session.id);
    h.git.calls.length = 0;
    return { ...h, ...started };
  }

  it('refuses a run that is not verified (checks_failed)', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('checks_failed');
    h.tickets.set(run.worktreePath!, '1.1', 'in-progress');
    await h.endTurn(session.id);
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('checks_failed');
  });

  it('refuses a checkout dirty outside _bmad-output (checkout_dirty), not inside it, then merges with done in the merge commit', async () => {
    const h = await verified();
    h.git.state.status = ['src/mine.ts'];
    const dirty = (await refusal(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))) as BuildRefusedError;
    expect([dirty.code, dirty.message]).toEqual(['checkout_dirty', CHECKOUT_DIRTY_MESSAGE]);
    expect(h.git.calls).toEqual([]);
    h.git.state.status = ['_bmad-output/notes.md'];
    const review = await h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) });
    // The merged branch goes with the worktree, merged only (story 5.5).
    expect(h.git.calls).toEqual(['merge bbbb', `add ${PLAN}`, 'commit', `worktree remove and merged ${h.run.branch}`]);
    expect(h.tickets.calls).toContainEqual(['mark', h.repo, '1.1', 'done', true]);
    expect(h.tickets.status(h.repo, '1.1')).toBe('done');
    expect(h.released).toContain(h.session.id);
    expect(h.core.buildSessions.get(h.session.id)).toBeUndefined();
    expect(review).toMatchObject({ outcome: 'verified', merged: true });
    // Merged once: a second Approve and a Reject are refused.
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('checks_failed');
    expect(await codeOf(h.builds.reject(h.wsId, '1.1'))).toBe('checks_failed');
  });

  it('a merge conflict blocks the run (merge_conflict) and marks nothing', async () => {
    const h = await verified();
    h.git.state.merge = 'conflict';
    const conflict = (await refusal(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))) as BuildRefusedError;
    expect([conflict.code, conflict.message]).toEqual(['merge_conflict', MERGE_CONFLICT_MESSAGE]);
    expect(h.core.entities.getRun(h.run.id)).toMatchObject({ outcome: 'blocked', reason: MERGE_CONFLICT_MESSAGE });
    expect(h.tickets.calls.filter((call) => call[0] === 'mark')).toEqual([]);
    expect(h.git.calls).toEqual(['merge bbbb']);
  });

  it('scripts changed by the merge abort it before done is marked', async () => {
    const h = await verified();
    h.git.state.onMerge = () => h.fingerprints.set(h.repo, 'changed by the merge');
    expect(await refusal(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBeInstanceOf(ScriptsChangedError);
    expect(h.git.calls).toEqual(['merge bbbb', 'abort']);
    expect(h.tickets.calls.filter((call) => call[0] === 'mark')).toEqual([]);
  });

  it('Reject removes the worktree and its branch (a discard, story 5.5), stops the run and leaves the ticket untouched', async () => {
    const h = await verified();
    const review = await h.builds.reject(h.wsId, '1.1');
    expect(review.outcome).toBe('stopped');
    expect(h.git.calls).toEqual([`worktree remove and ${h.run.branch}`]);
    expect(h.git.state.branches.has(h.run.branch!)).toBe(false);
    expect(h.tickets.calls.filter((call) => call[0] === 'mark')).toEqual([]);
    expect(h.tickets.status(h.repo, '1.1')).toBe('ready-for-dev');
  });
});

describe('review loop 1 hardening (story 5.2)', () => {
  async function verifiedRun() {
    const h = await harness();
    const started = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(started.run.worktreePath!, '1.1', 'built');
    await h.endTurn(started.session.id);
    h.git.calls.length = 0;
    return { ...h, ...started };
  }
  const approve = (h: Harness, revision = 'b'.repeat(40)) => h.builds.approve(h.wsId, '1.1', { revision });

  it('refuses a project that is not its repository top folder, passes the sandbox reason, and meets an epic prerequisite when the epic is done', async () => {
    const h = await harness();
    h.git.state.top = '/somewhere/else';
    const nested = (await refusal(h.builds.start(h.wsId, { ref: '1.1' }))) as BuildRefusedError;
    expect([nested.code, nested.message]).toEqual(['vcs_unavailable', VCS_NOT_TOP_LEVEL_MESSAGE]);
    h.git.state.top = undefined;
    h.sandbox.available = false;
    expect(((await refusal(h.builds.start(h.wsId, { ref: '1.1' }))) as Error).message).toMatch(/none$/);
    const { prerequisitesMet } = await import('../src/builds.js');
    const epics = [{ slug: 'epic-zero', id: 0, status: 'done', after: [], blocks: [] }];
    expect(prerequisitesMet({ ref: '1.1', after: ['epic-zero'] }, { tickets: [], epics })).toBe(true);
    expect(prerequisitesMet({ ref: '1.1', after: ['epic-zero'] }, { tickets: [], epics: [{ ...epics[0]!, status: 'in-progress' }] })).toBe(false);
  });

  it("removes a new worktree whose _bmad/scripts aren't the trusted ones (BMad files not committed), writing no run", async () => {
    const h = await harness();
    h.worktreeFingerprint.value = 'not committed';
    const refused = (await refusal(h.builds.start(h.wsId, { ref: '1.1' }))) as BuildRefusedError;
    expect([refused.code, refused.message]).toEqual(['plan_uncommitted', BMAD_FILES_UNCOMMITTED_MESSAGE]);
    expect(h.git.calls.at(-1)).toMatch(/^worktree remove and ogden\/[a-z2-7]{8}\/1\.1-build-the-thing$/);
    expect(h.core.entities.latestRunForTicket(h.wsId, '1.1')).toBeUndefined();
  });

  it('a failure after the run exists removes the worktree and ends the run failed; a rebuild then gets its own branch', async () => {
    const h = await harness();
    const sendMessage = vi.fn(() => {
      throw new Error('the agent could not be told');
    });
    const failing = createBuilds({
      bmad: h.core.bmad,
      trust: h.core.bmadScriptTrust,
      source: { requireReady() {} },
      entities: h.core.entities,
      events: h.core.events,
      tickets: h.tickets.store,
      vcs: h.git.vcs,
      sandbox: { check: async () => ({ available: true, kind: 'test' }) },
      runner: testRunner,
      chat: { createChatSession: async (wsId, options) => h.core.entities.createSession({ workspaceId: wsId, kind: options?.kind ?? 'chat' }), sendMessage, releaseAgent: async () => {} },
      buildSessions: h.core.buildSessions,
      dataDir: h.dataDir,
    });
    expect(((await refusal(failing.start(h.wsId, { ref: '1.1' }))) as Error).message).toBe('the agent could not be told');
    const failed = h.core.entities.latestRunForTicket(h.wsId, '1.1')!;
    expect(failed).toMatchObject({ outcome: 'failed', reason: RUN_REASON_START_FAILED });
    expect(h.git.calls.at(-1)).toBe('worktree remove');
    failing.close();
    // Not stuck: the ticket builds again, on a branch of its own.
    const again = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(again.run.branch).not.toBe(failed.branch);
  });

  it('a rebuild after Reject gets a new branch; the rejected one is gone (story 5.5)', async () => {
    const h = await verifiedRun();
    await h.builds.reject(h.wsId, '1.1');
    const again = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(again.run.branch).not.toBe(h.run.branch);
    expect(h.git.state.branches.has(h.run.branch!)).toBe(false);
  });

  it('fails a run whose diff touches a protected path, a tickets.toml, or another ticket plan; masks the stored reason; releases the agent', async () => {
    for (const file of ['.claude/settings.json', '_bmad/scripts/config_utils.py', 'sub/.git/hooks/x', '_bmad-output/initiative-demo/epic-first/tickets.toml', '_bmad-output/initiative-demo/epic-first/story-other-plan.md']) {
      const h = await harness();
      const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
      h.tickets.set(run.worktreePath!, '1.1', 'built');
      h.git.state.files = ['src/thing.ts', PLAN, file];
      await h.endTurn(session.id);
      expect(h.core.entities.getRun(run.id), file).toMatchObject({ outcome: 'failed', reason: RUN_REASON_PROTECTED_DIFF });
      expect(h.released).toContain(session.id);
    }
    const masked = await harness();
    const { run, session } = await masked.builds.start(masked.wsId, { ref: '1.1' });
    masked.tickets.set(run.worktreePath!, '1.1', 'blocked', 'Key sk-ant-api03-abcdefghijklmnop leaked');
    await masked.endTurn(session.id);
    expect(masked.core.entities.getRun(run.id)?.reason).not.toContain('sk-ant-api03');
  });

  it('Approve merges only the reviewed revision, and only while the branch still points at it', async () => {
    const h = await verifiedRun();
    expect((await h.builds.review(h.wsId, '1.1')).headRevision).toBe('b'.repeat(40));
    h.git.state.revisions.set(h.run.branch!, 'c'.repeat(40));
    const stale = (await refusal(approve(h))) as BuildRefusedError;
    expect([stale.code, stale.message]).toEqual(['checks_failed', REVIEW_STALE_MESSAGE]);
    expect(((await refusal(h.builds.approve(h.wsId, '1.1', {}))) as Error).name).toBe('ValidationError');
    expect(h.git.calls).toEqual([]);
    await approve(h, 'c'.repeat(40));
    expect(h.git.calls[0]).toBe('merge cccc');
  });

  it('refuses (checkout_dirty, run unchanged) a staged change, a changed plan file or an operation in progress; a refused merge leaves it verified', async () => {
    const h = await verifiedRun();
    h.git.state.staged = ['_bmad-output/notes.md'];
    expect(((await refusal(approve(h))) as BuildRefusedError).message).toBe(CHECKOUT_BUSY_MESSAGE);
    h.git.state.staged = [];
    h.git.state.status = [PLAN];
    expect(((await refusal(approve(h))) as BuildRefusedError).message).toBe(CHECKOUT_BUSY_MESSAGE);
    h.git.state.status = [];
    h.git.state.inProgress = true;
    expect(((await refusal(approve(h))) as BuildRefusedError).message).toBe(CHECKOUT_BUSY_MESSAGE);
    h.git.state.inProgress = false;
    expect(h.git.calls).toEqual([]);
    h.git.state.merge = 'refused';
    const refused = (await refusal(approve(h))) as BuildRefusedError;
    expect([refused.code, refused.message]).toEqual(['checkout_dirty', MERGE_REFUSED_MESSAGE]);
    expect(h.core.entities.getRun(h.run.id)?.outcome).toBe('verified');
  });

  it('a failure after the mark restores the plan from HEAD, then aborts the merge', async () => {
    const h = await verifiedRun();
    h.git.vcs.commit = async () => {
      throw new Error('commit failed');
    };
    expect(((await refusal(approve(h))) as Error).message).toBe('commit failed');
    expect(h.git.calls).toEqual(['merge bbbb', `add ${PLAN}`, `restore ${PLAN}`, 'abort']);
  });

  it('runOfSession takes the full guards', async () => {
    const h = await harness();
    const { session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.fingerprints.set(h.repo, 'changed');
    expect(await refusal(h.builds.runOfSession(h.wsId, session.id))).toBeInstanceOf(ScriptsChangedError);
  });

  it('at a server start, a run still running is blocked as interrupted, its worktree kept', async () => {
    const h = await harness();
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(h.core.entities.settleInterruptedRuns(RUN_REASON_INTERRUPTED).map((each) => each.id)).toEqual([run.id]);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', reason: RUN_REASON_INTERRUPTED });
    expect(h.git.calls.some((call) => call.startsWith('worktree remove'))).toBe(false);
  });
});

describe('the run folder and checkpoint pauses (story 5.4)', () => {
  /** The run's folder: `<data>/r/<run8>`, the run's 8-character id. */
  const folderOf = (h: Harness, runId: string) => join(h.dataDir, 'r', h.core.entities.getRun(runId as never)!.branch!.split('/')[1]!);
  const resultIn = (h: Harness, runId: string) => BuildRunResult.parse(JSON.parse(readFileSync(join(folderOf(h, runId), BUILD_RESULT_FILE), 'utf8')));

  it("writes the per-run result when the run ends: the plan's status, the branch head, the base; null for an unreadable plan", async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(resultIn(h, run.id)).toMatchObject({ version: 1, runId: run.id, ticketRef: '1.1', status: 'built', commit: 'b'.repeat(40), baseRevision: REVISION, blockedCondition: null, blockedReason: null, intentGapPatch: null });
    await h.builds.recorded();
    const activity = readFileSync(join(folderOf(h, run.id), BUILD_ACTIVITY_FILE), 'utf8');
    expect(activity).toContain('"type":"run.outcome_changed"');
    expect(statSync(join(folderOf(h, run.id), BUILD_RESULT_FILE)).isFile()).toBe(true);
    expect(folderOf(h, run.id)).toBe(join(h.dataDir, 'r', run.worktreePath!.split(/[\\/]/).at(-1)!));

    const unreadable = await harness();
    const two = await unreadable.builds.start(unreadable.wsId, { ref: '1.1' });
    unreadable.fingerprints.set(two.run.worktreePath!, 'edited by the agent');
    await unreadable.endTurn(two.session.id);
    expect(resultIn(unreadable, two.run.id).status).toBeNull();
  });

  it("a blocked run's result names the skill's condition (masked) and the run's reason", async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'blocked', 'unclear intent: key sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    await h.endTurn(session.id);
    const result = resultIn(h, run.id);
    expect(result.status).toBe('blocked');
    expect(result.blockedCondition).toMatch(/^unclear intent/);
    expect(result.blockedCondition).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(result.blockedReason).toContain('unclear intent');
  });

  it('plan_checkpoint: paused before the prompt is sent; a second Build is refused; resume sends it', async () => {
    const h = await harness();
    h.tickets.checkpoint('1.1', { plan: true });
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(run).toMatchObject({ outcome: 'blocked', blockedCode: 'checkpoint_plan', reason: blockedSentence('checkpoint_plan') });
    expect(h.sent).toEqual([]);
    expect(resultIn(h, run.id)).toMatchObject({ status: 'ready-for-dev', blockedReason: blockedSentence('checkpoint_plan') });
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('run_active');

    const resumed = await h.builds.resume(h.wsId, run.id);
    expect(resumed).toMatchObject({ outcome: 'running', blockedCode: null });
    expect(h.sent).toEqual([{ sessionId: session.id, text: '/build 1.1' }]);
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)?.outcome).toBe('verified');
    // Not at a checkpoint any more: resume and Retry refuse a run ready for review.
    expect(await codeOf(h.builds.resume(h.wsId, run.id))).toBe('run_not_active');
    expect(await codeOf(h.builds.retry(h.wsId, run.id, {}))).toBe('run_not_active');
  });

  it("resume after a restart rebuilds the session's setup; it fails closed without a sandbox or worktree, and takes the guards", async () => {
    const h = await harness();
    h.tickets.checkpoint('1.1', { plan: true });
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    // As after a restart: the in-memory setup is gone.
    h.core.buildSessions.delete(session.id);
    h.sandbox.available = false;
    expect(await codeOf(h.builds.resume(h.wsId, run.id))).toBe('sandbox_unavailable');
    h.sandbox.available = true;
    const worktrees = [...h.git.state.worktrees];
    h.git.state.worktrees.clear();
    expect(await codeOf(h.builds.resume(h.wsId, run.id))).toBe('run_not_active');
    for (const each of worktrees) h.git.state.worktrees.add(each);
    h.fingerprints.set(run.worktreePath!, 'edited');
    expect(await refusal(h.builds.resume(h.wsId, run.id))).toBeInstanceOf(ScriptsChangedError);
    h.fingerprints.delete(run.worktreePath!);
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: ['board'] });
    expect(await refusal(h.builds.resume(h.wsId, run.id))).toBeInstanceOf(FeatureOffError);
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: ['board', 'builds'] });
    expect(h.core.entities.getRun(run.id)?.blockedCode).toBe('checkpoint_plan');
    expect(h.sent).toEqual([]);

    await h.builds.retry(h.wsId, run.id, { mode: 'resume', note: 'Keep it short.' });
    const setup = h.core.buildSessions.get(session.id)!;
    expect(setup.cwd).toBe(run.worktreePath);
    expect(setup.decide({ toolCallId: 't', title: 'w', kind: 'edit', paths: [join(h.repo, 'src', 'a.ts')] }).outcome).toBe('deny');
    expect(h.sent).toHaveLength(1);
    expect(((await refusal(h.builds.resume(h.wsId, 'nope'))) as Error).name).toBe('ValidationError');
  });

  it('done_checkpoint: paused when the plan is built, before the end checks; resume runs them', async () => {
    const h = await harness();
    h.tickets.checkpoint('1.1', { done: true });
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    h.git.state.files = [];
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'checkpoint_done' });
    expect(h.released).toContain(session.id);
    expect(resultIn(h, run.id).status).toBe('built');
    // The end checks run on resume: here an empty diff fails it.
    expect(await h.builds.resume(h.wsId, run.id)).toMatchObject({ outcome: 'failed', reason: RUN_REASON_EMPTY_DIFF });
    expect(h.sent).toHaveLength(1);
  });

  it("done_checkpoint is read in the main checkout, never the worktree's tickets.toml the agent can edit", async () => {
    const h = await harness();
    h.tickets.checkpoint('1.1', { done: true });
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.checkpoint('1.1', { done: false }, run.worktreePath!);
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)?.blockedCode).toBe('checkpoint_done');
  });

  it('resume and Retry refuse a running run (run_not_active); Retry of another blocked run is 5.8s (501); a refused prompt keeps the pause', async () => {
    const h = await harness();
    const running = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(await codeOf(h.builds.resume(h.wsId, running.run.id))).toBe('run_not_active');
    expect(await codeOf(h.builds.retry(h.wsId, running.run.id, {}))).toBe('run_not_active');
    h.tickets.set(running.run.worktreePath!, '1.1', 'blocked', 'unclear intent');
    await h.endTurn(running.session.id);
    expect(await codeOf(h.builds.resume(h.wsId, running.run.id))).toBe('run_not_active');
    expect(((await refusal(h.builds.retry(h.wsId, running.run.id, {}))) as Error).name).toBe('NotImplementedError');

    const paused = await harness();
    paused.tickets.checkpoint('1.1', { plan: true });
    const { run } = await paused.builds.start(paused.wsId, { ref: '1.1' });
    paused.sendFails.value = true;
    expect(((await refusal(paused.builds.resume(paused.wsId, run.id))) as Error).message).toBe('the chat refused it');
    expect(paused.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'checkpoint_plan' });
  });
});
