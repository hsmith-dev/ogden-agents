/**
 * The chat-worktree half of `vcs-memory` (CAP-35; epic 27 entry 2): an
 * in-memory `VcsChatWorktreePort` for tests and the hand-off and retention
 * lanes (27.4 and 27.6 build it on git). It runs no git and touches no
 * file. Each folder is a set of changed file names; tests set them
 * (`changes(path)`), mark branches gone (`missingBranches`) and paths taken
 * (`takenPaths`), and read the calls. A put-away saves the folder's changes
 * under a new tree id and forgets the folder; Restore brings them back.
 * `moveChanges` answers `conflict` when `to` has a change to any of the same
 * files, else moves them all.
 */
import type { VcsChatWorktreePort, VcsMoveChanges, VcsPutAway, VcsRestoreResult } from '@ogden-agents/core';

export interface MemoryVcsChatWorktree extends VcsChatWorktreePort {
  /** Every call as `method repo …`, in order. */
  readonly calls: string[];
  /** The changed file names in the folder at `path`, created (none) if new. */
  changes(path: string): Set<string>;
  /** Branches Restore finds gone (`branch_missing`). */
  readonly missingBranches: Set<string>;
  /** Paths Restore finds taken (`path_taken`). */
  readonly takenPaths: Set<string>;
  /** Snapshot trees put away, by tree id: the file names they hold. */
  readonly snapshots: ReadonlyMap<string, ReadonlySet<string>>;
}

let trees = 0;
const nextTree = (): string => (++trees).toString(16).padStart(40, 'c');

export function createMemoryVcsChatWorktree(): MemoryVcsChatWorktree {
  const calls: string[] = [];
  const folders = new Map<string, Set<string>>();
  const snapshots = new Map<string, Set<string>>();
  const missingBranches = new Set<string>();
  const takenPaths = new Set<string>();
  const changes = (path: string): Set<string> => {
    let found = folders.get(path);
    if (found === undefined) {
      found = new Set();
      folders.set(path, found);
    }
    return found;
  };
  return {
    calls,
    changes,
    missingBranches,
    takenPaths,
    snapshots,
    async putAway(repoPath, worktreePath, branch): Promise<VcsPutAway> {
      calls.push(`putAway ${repoPath} ${worktreePath} ${branch}`);
      const files = new Set(changes(worktreePath));
      folders.delete(worktreePath);
      if (files.size === 0) return { snapshotTree: null, files: 0 };
      const snapshotTree = nextTree();
      snapshots.set(snapshotTree, files);
      return { snapshotTree, files: files.size };
    },
    async restore(repoPath, { path, branch, snapshotTree }): Promise<VcsRestoreResult> {
      calls.push(`restore ${repoPath} ${path} ${branch} ${snapshotTree ?? '-'}`);
      if (missingBranches.has(branch)) return 'branch_missing';
      if (takenPaths.has(path) || folders.has(path)) return 'path_taken';
      const folder = changes(path);
      for (const file of snapshotTree === null ? [] : (snapshots.get(snapshotTree) ?? [])) folder.add(file);
      return 'restored';
    },
    async moveChanges(repoPath, { from, to }): Promise<VcsMoveChanges> {
      calls.push(`moveChanges ${repoPath} ${from} ${to}`);
      const moving = changes(from);
      const target = changes(to);
      const clashes = [...moving].filter((file) => target.has(file)).length;
      if (clashes > 0) return { result: 'conflict', files: clashes };
      const files = moving.size;
      for (const file of moving) target.add(file);
      moving.clear();
      return { result: 'moved', files };
    },
  };
}
