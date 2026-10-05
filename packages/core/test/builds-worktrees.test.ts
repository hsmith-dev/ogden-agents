/**
 * Story 5.5 in core: the git version and disk-space guards at Build, the
 * worktrees folder that must be Ogden's own, approve refusing a detached or
 * switched checkout, cleanup on a decision (and a failed cleanup that never
 * fails the decision), Commit plan files, the startup sweep that touches only
 * `<data>/w`, and the run-aware ticket store (AD-10).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT_BUSY_MESSAGE, CHECKOUT_MOVED_MESSAGE, DISK_SPACE_LOW_MESSAGE, GIT_MISSING_MESSAGE, gitTooOldMessage, MIN_FREE_DISK_BYTES } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  BuildRefusedError,
  createRunAwareTickets,
  FeatureOffError,
  isOwnWorktreePath,
  ScriptsChangedError,
  sweepRunBranches,
  worktreeDisposition,
  type VcsPort,
} from '../src/index.js';
import { codeOf, harness, PLAN, refusal, type Harness } from './builds-harness.js';
import { tempDir } from './helpers.js';

const link = (target: string, path: string) => symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');

async function verified(options: Parameters<typeof harness>[0] = {}) {
  const h = await harness(options);
  const started = await h.builds.start(h.wsId, { ref: '1.1' });
  h.tickets.set(started.run.worktreePath!, '1.1', 'built');
  await h.endTurn(started.session.id);
  h.git.calls.length = 0;
  return { ...h, ...started };
}

describe('Build: git and disk guards (story 5.5)', () => {
  it('refuses git that is missing or too old (vcs_unavailable, plain words) and a nearly full disk (disk_space_low), writing nothing', async () => {
    const h = await harness();
    h.git.state.git = { ok: false, reason: 'too_old', version: '2.30.1' };
    const old = (await refusal(h.builds.start(h.wsId, { ref: '1.1' }))) as BuildRefusedError;
    expect([old.code, old.message]).toEqual(['vcs_unavailable', gitTooOldMessage('2.30.1')]);
    expect(old.message).toContain('2.39.2');
    h.git.state.git = { ok: false, reason: 'missing' };
    const missing = (await refusal(h.builds.start(h.wsId, { ref: '1.1' }))) as BuildRefusedError;
    expect([missing.code, missing.message]).toEqual(['vcs_unavailable', GIT_MISSING_MESSAGE]);
    expect(h.git.calls).toEqual([]);

    const full = await harness({ freeBytes: () => MIN_FREE_DISK_BYTES - 1 });
    const disk = (await refusal(full.builds.start(full.wsId, { ref: '1.1' }))) as BuildRefusedError;
    expect([disk.code, disk.message]).toEqual(['disk_space_low', DISK_SPACE_LOW_MESSAGE]);
    expect(full.git.calls.filter((call) => call.startsWith('worktree'))).toEqual([]);
    expect(readdirSync(join(full.dataDir, 'w'))).toEqual([]);
    expect(full.core.entities.listSessions(full.wsId)).toEqual([]);
    // Enough room (or a disk that can't say) builds.
    const roomy = await harness({ freeBytes: () => MIN_FREE_DISK_BYTES });
    expect((await roomy.builds.start(roomy.wsId, { ref: '1.1' })).run.outcome).toBe('running');
    const unknown = await harness({ freeBytes: () => undefined });
    expect((await unknown.builds.start(unknown.wsId, { ref: '1.1' })).run.outcome).toBe('running');
  });

  it("refuses to build when the worktrees folder is a link, so nothing is made where it points", async () => {
    const h = await harness();
    const elsewhere = tempDir('ogden-agents-elsewhere-');
    link(elsewhere, join(h.dataDir, 'w'));
    await expect(h.builds.start(h.wsId, { ref: '1.1' })).rejects.toThrow(/real folder/);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(h.git.calls.filter((call) => call.startsWith('worktree'))).toEqual([]);
  });

  it('makes each worktree a short <data>/w/<run8> folder of its own', async () => {
    const h = await harness();
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(isOwnWorktreePath(h.dataDir, run.worktreePath!)).toBe(true);
    expect(run.worktreePath!.endsWith(join('w', run.branch!.split('/')[1]!))).toBe(true);
  });
});

describe('Approve and Reject: the checkout and cleanup (story 5.5)', () => {
  it('refuses approve on a detached HEAD or a branch without the build base (checkout_dirty), merging nothing, the run still verified', async () => {
    const h = await verified();
    h.git.state.head = undefined;
    const detached = (await refusal(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))) as BuildRefusedError;
    expect([detached.code, detached.message]).toEqual(['checkout_dirty', CHECKOUT_MOVED_MESSAGE]);
    h.git.state.head = { branch: 'other', revision: 'c'.repeat(40) };
    h.git.state.ancestor = false;
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('checkout_dirty');
    h.git.state.ancestor = true;
    h.git.state.git = { ok: false, reason: 'too_old', version: '2.20.0' };
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('vcs_unavailable');
    expect(h.git.calls.filter((call) => call.startsWith('merge'))).toEqual([]);
    expect(h.core.entities.getRun(h.run.id)).toMatchObject({ outcome: 'verified', decision: null });
  });

  it('an approved run is never rejected or approved again; a cleanup that fails never fails the decision', async () => {
    const h = await verified();
    h.git.state.removeFails = true;
    const review = await h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) });
    expect(review.merged).toBe(true);
    expect(h.core.entities.getRun(h.run.id)?.decision).toBe('approved');
    expect(await codeOf(h.builds.reject(h.wsId, '1.1'))).toBe('checks_failed');
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('checks_failed');

    const r = await verified();
    r.git.state.removeFails = true;
    expect((await r.builds.reject(r.wsId, '1.1')).run.decision).toBe('rejected');
    // The worktree is still there for the next start's sweep.
    expect(existsSync(r.run.worktreePath!)).toBe(true);
  });

  it('keeps the worktree of a run that is blocked, failed or interrupted (Retry, Reject)', () => {
    expect(worktreeDisposition({ decision: null })).toBe('keep');
    expect(worktreeDisposition({ decision: 'approved' })).toBe('remove');
    expect(worktreeDisposition({ decision: 'rejected' })).toBe('remove');
  });
});

describe('Commit plan files (story 5.5)', () => {
  it("commits exactly the ticket's changed plan files, nothing else", async () => {
    const h = await harness();
    // The plan exists only once the ticket has a status (the fake store's rule).
    const toml = '_bmad-output/initiative-demo/epic-first/tickets.toml';
    h.git.state.status = [PLAN, toml, 'src/mine.ts', '_bmad-output/notes.md'];
    const result = await h.builds.commitPlanFiles(h.wsId, '1.1');
    expect(result.committed).toEqual([PLAN, toml]);
    expect(h.git.state.committed).toEqual([[PLAN, toml]]);
    // Nothing left to commit: nothing committed, the head answered.
    const again = await h.builds.commitPlanFiles(h.wsId, '1.1');
    expect(again).toEqual({ committed: [], revision: 'a'.repeat(40) });
    expect(h.git.state.committed).toHaveLength(1);
    // Build then goes ahead.
    expect((await h.builds.start(h.wsId, { ref: '1.1' })).run.outcome).toBe('running');
  });

  it('refuses during a merge or rebase (checkout_dirty), without a branch (vcs_unavailable), and with builds off (feature_off)', async () => {
    const h = await harness();
    h.git.state.status = [PLAN];
    h.git.state.inProgress = true;
    const busy = (await refusal(h.builds.commitPlanFiles(h.wsId, '1.1'))) as BuildRefusedError;
    expect([busy.code, busy.message]).toEqual(['checkout_dirty', CHECKOUT_BUSY_MESSAGE]);
    h.git.state.inProgress = false;
    h.git.state.head = undefined;
    expect(await codeOf(h.builds.commitPlanFiles(h.wsId, '1.1'))).toBe('vcs_unavailable');
    expect(h.git.state.committed).toEqual([]);
    const off = await harness({ pieces: ['board'] });
    expect(await refusal(off.builds.commitPlanFiles(off.wsId, '1.1'))).toBeInstanceOf(FeatureOffError);
  });
});

describe('the startup sweep (story 5.5)', () => {
  /** Two runs: one blocked (kept), one decided whose removal failed (swept). */
  async function withRuns(): Promise<Harness & { kept: string; decided: string; decidedBranch: string }> {
    const h = await harness();
    const one = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(one.run.worktreePath!, '1.1', 'blocked', 'Needs you');
    await h.endTurn(one.session.id);
    h.tickets.set(h.repo, '1.2', 'ready-for-dev');
    h.tickets.set(h.repo, '1.1', 'done');
    const two = await h.builds.start(h.wsId, { ref: '1.2' }).catch(() => undefined);
    // 1.2 waits on 1.1, which the main checkout now says is done.
    expect(two).toBeDefined();
    h.tickets.set(two!.run.worktreePath!, '1.2', 'built');
    await h.endTurn(two!.session.id);
    h.git.state.removeFails = true;
    await h.builds.reject(h.wsId, '1.2');
    h.git.state.removeFails = false;
    return { ...h, kept: one.run.worktreePath!, decided: two!.run.worktreePath!, decidedBranch: two!.run.branch! };
  }

  it('removes orphans, links, files and decided leftovers in <data>/w only; keeps undecided runs and every link target', async () => {
    const h = await withRuns();
    const root = join(h.dataDir, 'w');
    const outside = tempDir('ogden-agents-outside-');
    writeFileSync(join(outside, 'keep.txt'), 'keep\n');
    mkdirSync(join(root, 'zzzzzzzz', 'src'), { recursive: true });
    writeFileSync(join(root, 'zzzzzzzz', 'src', 'x.txt'), 'orphan\n');
    link(outside, join(root, 'yyyyyyyy'));
    // A link inside an orphan: unlinked, never followed.
    link(outside, join(root, 'zzzzzzzz', 'escape'));
    writeFileSync(join(root, 'stray.txt'), 'x');
    expect(existsSync(h.decided)).toBe(true);
    await h.builds.sweep();
    expect(readdirSync(root).sort()).toEqual([h.kept.split(/[\\/]/).pop()]);
    expect(existsSync(h.kept)).toBe(true);
    expect(readdirSync(outside)).toEqual(['keep.txt']);
    expect(h.git.calls).toContain(`worktree remove and ${h.decidedBranch}`);
  });

  it('unlinks a worktrees folder that is a link, and sweeps nothing where it points', async () => {
    const h = await harness();
    const elsewhere = tempDir('ogden-agents-elsewhere-');
    mkdirSync(join(elsewhere, 'abcdefgh'));
    link(elsewhere, join(h.dataDir, 'w'));
    await h.builds.sweep();
    expect(existsSync(join(h.dataDir, 'w'))).toBe(false);
    expect(readdirSync(elsewhere)).toEqual(['abcdefgh']);
  });

  it('deletes a recently decided run branch left behind when its folder is gone, and leaves older ones alone', async () => {
    const h = await withRuns();
    rmSync(h.decided, { recursive: true, force: true });
    const calls: string[] = [];
    const vcs: Pick<VcsPort, 'removeWorktree'> = {
      async removeWorktree(_repo, path, options = {}) {
        calls.push(`${path} ${options.deleteBranch ?? ''}`);
      },
    };
    const deps = { dataDir: h.dataDir, vcs, isBuildBranch: () => true, entities: h.core.entities, repoOf: () => h.repo };
    await sweepRunBranches(deps);
    expect(calls).toEqual([`${h.decided} ${h.decidedBranch}`]);
    calls.length = 0;
    await sweepRunBranches(deps, Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(calls).toEqual([]);
  });
});

describe('the run-aware ticket store (story 5.5, AD-10)', () => {
  it("reads and marks an active run's ticket in its worktree, the rest (and decided runs) in the main checkout", async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    const store = createRunAwareTickets({ store: h.tickets.store, entities: h.core.entities, trust: h.core.bmadScriptTrust, dataDir: h.dataDir });
    h.tickets.set(run.worktreePath!, '1.1', 'in-progress');
    expect((await store.find(h.repo, '1.1')).status).toBe('in-progress');
    const tree = await store.tree(h.repo);
    expect(tree.tickets.find((row) => row.ref === '1.1')?.status).toBe('in-progress');
    expect(tree.tickets.find((row) => row.ref === '1.2')?.status).toBe('ready-for-dev');
    // The main checkout itself is unchanged.
    expect(h.tickets.status(h.repo, '1.1')).toBe('ready-for-dev');
    await store.mark(h.repo, '1.1', 'blocked', { blockedReason: 'Retry me' });
    expect(h.tickets.status(run.worktreePath!, '1.1')).toBe('blocked');
    expect(h.tickets.status(h.repo, '1.1')).toBe('ready-for-dev');
    await store.mark(h.repo, '1.2', 'draft');
    expect(h.tickets.status(h.repo, '1.2')).toBe('draft');

    // The agent edited the worktree's scripts: reads come from the main checkout and a mark is refused.
    h.worktreeFingerprint.value = 'edited';
    expect((await store.find(h.repo, '1.1')).status).toBe('ready-for-dev');
    await expect(store.mark(h.repo, '1.1', 'in-progress')).rejects.toBeInstanceOf(ScriptsChangedError);
    h.worktreeFingerprint.value = 'trusted';

    // Once decided (rejected), the main checkout answers again.
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    await h.builds.reject(h.wsId, '1.1');
    expect((await store.find(h.repo, '1.1')).status).toBe('ready-for-dev');
    // The watch is the main checkout's.
    const watched: string[] = [];
    const inner = h.tickets.store.watch;
    h.tickets.store.watch = async (path, ...rest) => {
      watched.push(path);
      return inner(path, ...rest);
    };
    await store.watch(h.repo, '_bmad-output', () => {});
    expect(watched).toEqual([h.repo]);
  });
});
