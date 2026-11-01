/**
 * The chat-worktree half of `vcs-memory` (CAP-35; epic 27 entry 2, 27.6):
 * an in-memory `VcsChatWorktreePort` for tests and the hand-off and
 * retention lanes. It runs no git and touches no file. Each folder is a set
 * of changed file names; tests set them (`changes(path)`), mark branches
 * gone (`missingBranches`), moved (`heads`), paths taken (`takenPaths`) and
 * copies unsafe to put away (`unsafe`), and read the calls. Saving for a
 * put-away keeps the folder's changes under a new tree id (the folder is
 * removed by `VcsPort.removeWorktree`, or `forget`); Restore brings them
 * back, in place when the folder is still there. `moveChanges` answers
 * `conflict` when `to` has a change to any of the same files, else moves
 * them all.
 */
import { VcsError, type VcsChatWorktreePort, type VcsMoveChanges, type VcsPutAway, type VcsRestoreResult } from '@ogden-agents/core';

/** The commit every branch is at unless a test moves it (`heads`). */
export const MEMORY_BRANCH_HEAD = 'b'.repeat(40);

export interface MemoryVcsChatWorktree extends VcsChatWorktreePort {
  /** Every call as `method repo …`, in order. */
  readonly calls: string[];
  /** The changed file names in the folder at `path`, created (none) if new. */
  changes(path: string): Set<string>;
  /** Forgets the folder at `path` (its removal). */
  forget(path: string): void;
  /** Whether a folder is at `path`. */
  has(path: string): boolean;
  /** Branches Restore finds gone (`branch_missing`). */
  readonly missingBranches: Set<string>;
  /** Each branch's commit when it isn't {@link MEMORY_BRANCH_HEAD} (`branch_moved`). */
  readonly heads: Map<string, string>;
  /** Paths Restore finds taken (`path_taken`). */
  readonly takenPaths: Set<string>;
  /** Folders a put-away refuses (a detached HEAD, a merge, a gitlink). */
  readonly unsafe: Set<string>;
  /** Snapshot trees saved, by tree id: the file names they hold. */
  readonly snapshots: ReadonlyMap<string, ReadonlySet<string>>;
}

let trees = 0;
const nextTree = (): string => (++trees).toString(16).padStart(40, 'c');

export function createMemoryVcsChatWorktree(): MemoryVcsChatWorktree {
  const calls: string[] = [];
  const folders = new Map<string, Set<string>>();
  const snapshots = new Map<string, Set<string>>();
  const missingBranches = new Set<string>();
  const heads = new Map<string, string>();
  const takenPaths = new Set<string>();
  const unsafe = new Set<string>();
  const byContent = new Map<string, string>();
  const changes = (path: string): Set<string> => {
    let found = folders.get(path);
    if (found === undefined) {
      found = new Set();
      folders.set(path, found);
    }
    return found;
  };
  const headOf = (branch: string): string => heads.get(branch) ?? MEMORY_BRANCH_HEAD;
  return {
    calls,
    changes,
    forget: (path) => void folders.delete(path),
    has: (path) => folders.has(path),
    missingBranches,
    heads,
    takenPaths,
    unsafe,
    snapshots,
    async saveForPutAway(repoPath, worktreePath, branch): Promise<VcsPutAway> {
      calls.push(`saveForPutAway ${repoPath} ${worktreePath} ${branch}`);
      if (unsafe.has(worktreePath)) throw new VcsError("This chat's copy can't be put away as it is.", { step: 'put_away' });
      const files = new Set(changes(worktreePath));
      if (files.size === 0) return { snapshotTree: null, head: headOf(branch), files: 0 };
      // The same changes save as the same tree, as git's would.
      const key = [...files].sort().join('\0');
      let snapshotTree = byContent.get(key);
      if (snapshotTree === undefined) byContent.set(key, (snapshotTree = nextTree()));
      snapshots.set(snapshotTree, files);
      return { snapshotTree, head: headOf(branch), files: files.size };
    },
    async restore(repoPath, { path, branch, head, snapshotTree }): Promise<VcsRestoreResult> {
      calls.push(`restore ${repoPath} ${path} ${branch} ${snapshotTree ?? '-'}`);
      if (missingBranches.has(branch)) return 'branch_missing';
      if (snapshotTree !== null && headOf(branch) !== head) return 'branch_moved';
      if (takenPaths.has(path)) return 'path_taken';
      // A folder still there (half put away) gets the snapshot in place.
      const folder = changes(path);
      folder.clear();
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
