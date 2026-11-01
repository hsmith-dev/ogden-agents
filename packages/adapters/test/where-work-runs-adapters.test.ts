/**
 * Epic 27 entry 2's in-memory stubs (CAP-35): the chat-worktree half of
 * `vcs-memory` (put away with a snapshot, Restore on a new branch when the
 * branch is missing or moved, or the path taken, the hand-off's move and its conflict) and
 * `port-probe-memory` (never the real network). Each records its calls.
 */
import { describe, expect, it } from 'vitest';
import { VcsError } from '@ogden-agents/core';
import { createMemoryPortProbe, createMemoryVcsChatWorktree, MEMORY_BRANCH_HEAD } from '../src/index.js';

const REPO = '/repo';
const TREE = '/data/worktrees/chat-1';
const BRANCH = 'ogden/chat/ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const RESTORED = `${BRANCH}-restored`;

describe('vcs-memory chat worktrees', () => {
  it("saves a worktree's changes for a put-away, and restores them on its branch", async () => {
    const vcs = createMemoryVcsChatWorktree();
    vcs.changes(TREE).add('a.ts').add('b.ts');
    const away = await vcs.saveForPutAway(REPO, TREE, BRANCH);
    expect(away.files).toBe(2);
    expect(away.snapshotTree).toMatch(/^[0-9a-f]{40}$/);
    expect(away.head).toBe(MEMORY_BRANCH_HEAD);
    vcs.forget(TREE);
    expect(await vcs.restore(REPO, { path: TREE, branch: BRANCH, head: away.head, snapshotTree: away.snapshotTree, newBranch: RESTORED })).toEqual({ branch: BRANCH, on: 'saved' });
    expect([...vcs.changes(TREE)].sort()).toEqual(['a.ts', 'b.ts']);
    // A clean worktree saves no snapshot.
    expect(await vcs.saveForPutAway(REPO, '/data/worktrees/clean', BRANCH)).toEqual({ snapshotTree: null, head: MEMORY_BRANCH_HEAD, files: 0 });
    expect(vcs.calls).toEqual([`saveForPutAway ${REPO} ${TREE} ${BRANCH}`, `restore ${REPO} ${TREE} ${BRANCH} ${away.snapshotTree}`, `saveForPutAway ${REPO} /data/worktrees/clean ${BRANCH}`]);
  });

  it('restores on the new branch when the branch is gone or moved, answers path_taken keeping the snapshot; refuses an unsafe copy', async () => {
    const vcs = createMemoryVcsChatWorktree();
    vcs.changes(TREE).add('a.ts');
    const { snapshotTree, head } = await vcs.saveForPutAway(REPO, TREE, BRANCH);
    vcs.missingBranches.add(BRANCH);
    expect(await vcs.restore(REPO, { path: TREE, branch: BRANCH, head, snapshotTree, newBranch: RESTORED })).toEqual({ branch: RESTORED, on: 'gone' });
    vcs.missingBranches.clear();
    vcs.heads.set(BRANCH, 'd'.repeat(40));
    expect(await vcs.restore(REPO, { path: TREE, branch: BRANCH, head, snapshotTree, newBranch: RESTORED })).toEqual({ branch: RESTORED, on: 'moved' });
    vcs.heads.clear();
    vcs.takenPaths.add(TREE);
    expect(await vcs.restore(REPO, { path: TREE, branch: BRANCH, head, snapshotTree, newBranch: RESTORED })).toBe('path_taken');
    expect(vcs.snapshots.get(snapshotTree!)).toEqual(new Set(['a.ts']));
    vcs.unsafe.add(TREE);
    await expect(vcs.saveForPutAway(REPO, TREE, BRANCH)).rejects.toThrow(VcsError);
  });

  it('moves changes between folders, or answers conflict and moves nothing', async () => {
    const vcs = createMemoryVcsChatWorktree();
    vcs.changes(TREE).add('a.ts').add('b.ts');
    const tree = { path: TREE, worktree: { repoPath: REPO, branch: BRANCH } };
    expect(await vcs.moveChanges(REPO, { from: tree, to: { path: REPO } })).toMatchObject({ result: 'moved', files: 2 });
    expect(vcs.changes(TREE).size).toBe(0);
    vcs.changes(TREE).add('a.ts');
    expect(await vcs.moveChanges(REPO, { from: tree, to: { path: REPO } })).toMatchObject({ result: 'conflict', files: 1, snapshots: { from: expect.any(String), to: expect.any(String) } });
    expect([...vcs.changes(TREE)]).toEqual(['a.ts']);
    vcs.failingMoves.set(TREE, {});
    await expect(vcs.moveChanges(REPO, { from: tree, to: { path: REPO } })).rejects.toThrow();
    expect([...vcs.changes(TREE)]).toEqual(['a.ts']);
  });
});

describe('port-probe-memory', () => {
  it('answers free unless marked taken, and records each probe', async () => {
    const probe = createMemoryPortProbe();
    probe.taken.add(41_001);
    expect(await probe.isFree(41_000)).toBe(true);
    expect(await probe.isFree(41_001)).toBe(false);
    expect(probe.probed).toEqual([41_000, 41_001]);
  });
});
