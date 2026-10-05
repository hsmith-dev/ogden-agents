/**
 * Where runs' worktrees live and when they go (story 5.5; AD-17).
 *
 * Every run's worktree is `<data>/w/<run8>`: short for Windows' path limits
 * (spike 5.1), outside the repo, one folder per run. Ogden removes only what
 * it can tell is its own: a direct child of `<data>/w` (itself a real folder,
 * never a link or junction) named like a run id. Nothing here follows a
 * link: a link found in `<data>/w` is removed itself, never its target.
 *
 * Disposition: a decided run (approved, or rejected: a discard) loses its
 * worktree and its branch; every other run keeps them (blocked and
 * interrupted runs are retried there, a failed one is reviewed or rejected;
 * E5-R8). A removal that fails (a file still open on Windows) is retried by
 * the sweep at the next server start.
 */
import { lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync, rmSync, statfsSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Run, WorkspaceId } from '@ogden-agents/shared';
import type { Entities } from './entities.js';
import type { VcsPort } from './vcs-port.js';

/** The folder of every run's worktree, inside Ogden Agents' data folder (AD-17): `<data>/w/<id>`. */
export const WORKTREES_DIR = 'w';

/** A run's short id, the name of its worktree folder (`[a-z2-7]{8}`). */
export const RUN_SHORT_ID = /^[a-z2-7]{8}$/;

/** `<dataDir>/w`. */
export function worktreesRootOf(dataDir: string): string {
  return join(dataDir, WORKTREES_DIR);
}

/** The real path of `path`, or its resolved path when it can't be resolved. */
function realOf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Whether `path` itself (not what it points at) is a real folder. */
export function isRealFolder(path: string): boolean {
  try {
    const entry = lstatSync(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Makes `<dataDir>/w` (owner only) and returns it. Throws when it is there
 * but isn't a real folder (a link or junction would put worktrees, and
 * their removal, somewhere else).
 */
export function ensureWorktreesRoot(dataDir: string): string {
  const root = worktreesRootOf(dataDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!isRealFolder(root)) throw new Error("Ogden Agents' worktrees folder isn't a real folder.");
  return root;
}

/** Whether `path` is one of Ogden's own worktree folders: `<dataDir>/w/<run8>`, with `<dataDir>/w` a real folder. */
export function isOwnWorktreePath(dataDir: string, path: string): boolean {
  const root = worktreesRootOf(dataDir);
  if (!isRealFolder(root)) return false;
  return RUN_SHORT_ID.test(basename(path)) && realOf(dirname(path)) === realOf(root);
}

/** Whether a run's worktree and branch should go now: only once the user decided (approved or rejected). */
export function worktreeDisposition(run: Pick<Run, 'decision'>): 'remove' | 'keep' {
  return run.decision === null ? 'keep' : 'remove';
}

/** Removes the link (or Windows junction) `path` itself, never what it points at. */
function unlinkEntry(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EISDIR') throw error;
    rmdirSync(path);
  }
}

/**
 * The free bytes on the disk holding `dir`, or `undefined` when the OS
 * can't say (the guard then lets the build go: git reports a full disk).
 */
export function freeBytesOf(dir: string): number | undefined {
  try {
    const stats = statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return undefined;
  }
}

export interface RunCleanupDeps {
  dataDir: string;
  vcs: Pick<VcsPort, 'removeWorktree'>;
  /** Whether `branch` is one Ogden made (`ogden/<run8>/…`). */
  isBuildBranch: (branch: string) => boolean;
}

/**
 * Removes run `run`'s worktree and its branch (an approved run's only when
 * merged) from `repoPath`. Does nothing for a path that isn't Ogden's own.
 * Throws when git or the file system refused (the sweep tries again).
 */
export async function removeRunWorktree(deps: RunCleanupDeps, repoPath: string, run: Pick<Run, 'worktreePath' | 'branch' | 'decision'>): Promise<void> {
  if (run.worktreePath === null || !isOwnWorktreePath(deps.dataDir, run.worktreePath)) return;
  const branch = run.branch !== null && deps.isBuildBranch(run.branch) ? run.branch : undefined;
  await deps.vcs.removeWorktree(repoPath, run.worktreePath, { deleteBranch: branch, mergedOnly: run.decision === 'approved' });
}

export interface SweepDeps extends RunCleanupDeps {
  entities: Pick<Entities, 'listRunsWithWorktree' | 'getWorkspace'>;
  /** The repo of a workspace, or `undefined` when it is gone. */
  repoOf: (workspaceId: WorkspaceId) => string | undefined;
  onError?: (step: string, error: unknown) => void;
}

/**
 * The startup sweep (story 5.5): in `<data>/w` only, removes a link or file
 * (itself), a folder no run names (with `rm`: no git runs and no repo is
 * touched), and a decided run's leftovers (through git, with its branch).
 * A run that
 * isn't decided keeps its worktree. Never touches anything outside
 * `<data>/w` but each decided run's own branch and worktree metadata. Errors
 * are reported and the sweep goes on. Run before builds are served.
 */
export async function sweepWorktrees(deps: SweepDeps): Promise<{ removed: number }> {
  const report = (step: string, error: unknown) => {
    try {
      deps.onError?.(step, error);
    } catch {
      // Logging never stops the sweep.
    }
  };
  const root = worktreesRootOf(deps.dataDir);
  let entry: ReturnType<typeof lstatSync>;
  try {
    entry = lstatSync(root);
  } catch {
    return { removed: 0 };
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    // Not Ogden's own folder: the link itself goes, never what it points at; nothing in it is swept.
    try {
      unlinkEntry(root);
    } catch (error) {
      report('root', error);
    }
    return { removed: 0 };
  }
  const runs = deps.entities.listRunsWithWorktree();
  const realRoot = realOf(root);
  const byName = new Map<string, Run>();
  for (const run of runs) {
    if (run.worktreePath !== null && realOf(dirname(run.worktreePath)) === realRoot) byName.set(basename(run.worktreePath), run);
  }
  let removed = 0;
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    try {
      if (item.isSymbolicLink() || !item.isDirectory()) {
        unlinkEntry(path);
        removed++;
        continue;
      }
      const run = byName.get(item.name);
      if (run === undefined || !RUN_SHORT_ID.test(item.name)) {
        // No run names it: a leftover of a start that never recorded its run. Removed inside `<data>/w` only; links in it are unlinked, not followed.
        rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        removed++;
        continue;
      }
      if (worktreeDisposition(run) === 'keep') continue;
      const repoPath = deps.repoOf(run.workspaceId);
      if (repoPath === undefined) {
        rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } else {
        await removeRunWorktree(deps, repoPath, { ...run, worktreePath: path });
      }
      removed++;
    } catch (error) {
      report('worktree', error);
    }
  }
  return { removed };
}

/** How far back {@link sweepRunBranches} looks: runs decided longer ago were cleaned up, or never will be. */
export const BRANCH_SWEEP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes the branch (and any worktree metadata) a run decided in the last
 * {@link BRANCH_SWEEP_WINDOW_MS} still has in its repo, when its folder is
 * gone: a removal that failed part-way (story 5.5). Only each run's own
 * `ogden/` branch; errors are reported. Safe to run in the background.
 */
export async function sweepRunBranches(deps: SweepDeps, now: number = Date.now()): Promise<void> {
  const realRoot = realOf(worktreesRootOf(deps.dataDir));
  for (const run of deps.entities.listRunsWithWorktree()) {
    if (worktreeDisposition(run) === 'keep' || run.worktreePath === null || run.branch === null || !deps.isBuildBranch(run.branch)) continue;
    if (now - Date.parse(run.updatedAt) > BRANCH_SWEEP_WINDOW_MS) continue;
    if (!RUN_SHORT_ID.test(basename(run.worktreePath)) || realOf(dirname(run.worktreePath)) !== realRoot || isRealFolder(run.worktreePath)) continue;
    const repoPath = deps.repoOf(run.workspaceId);
    if (repoPath === undefined) continue;
    try {
      await removeRunWorktree(deps, repoPath, run);
    } catch (error) {
      try {
        deps.onError?.('branch', error);
      } catch {
        // Logging never stops the sweep.
      }
    }
  }
}
