/**
 * The version control port (AD-1, AD-17; story 5.2's tracer, the minimal
 * shape 5.3 freezes): a run's own worktree on its own branch, created in
 * Ogden Agents' data folder (never in the repo), what changed in a checkout,
 * a branch's diff, and approve's local merge. Core names no VCS here; the
 * `vcs-git` adapter does. No operation ever pushes, forces or runs a repo's
 * hooks.
 *
 * `repoPath` is always the workspace's stored real path, and every branch,
 * revision and path passed is core's own (validated before use), never
 * request input.
 */
import { CoreError } from './errors.js';

/** The main checkout's current branch and its commit. */
export interface VcsHead {
  branch: string;
  revision: string;
}

/** Where a worktree's git data lives, for the sandbox's writable roots (story 5.2 decision). */
export interface VcsWorktreeGitPaths {
  /** The repo's shared git folder (the main checkout's `.git`). */
  commonDir: string;
  /** The worktree's own git folder (`<commonDir>/worktrees/<id>`). */
  gitDir: string;
  /**
   * The folders holding the run's branch's loose ref and its reflog
   * (`<commonDir>/refs/heads/<folder of branch>`, `<commonDir>/logs/refs/heads/…`),
   * made if missing so a sandbox can bind them (story 5.2 review loop 1).
   */
  branchRefDir: string;
  branchLogDir: string;
}

/** A branch's changes against where it started. */
export interface VcsDiff {
  /** The unified diff text, cut at `maxBytes`. */
  diff: string;
  truncated: boolean;
  /** The changed files, repo-relative, `/`-separated. */
  files: string[];
}

export interface VcsPort {
  /**
   * The checked-out branch and its commit, or `undefined` when `repoPath`
   * isn't a repository, `HEAD` is detached, or the branch has no commit.
   */
  head(repoPath: string): Promise<VcsHead | undefined>;
  /** The repository's top-level folder (real path) containing `repoPath`, or `undefined` when it is in none. */
  topLevel(repoPath: string): Promise<string | undefined>;
  /** The commit `branch` points at, or `undefined` when there is no such branch. */
  branchRevision(repoPath: string, branch: string): Promise<string | undefined>;
  /** Whether a merge, rebase, cherry-pick or revert is in progress in the checkout. */
  operationInProgress(repoPath: string): Promise<boolean>;
  /** The paths with staged changes (the index differs from `HEAD`), repo-relative, `/`-separated. */
  staged(repoPath: string): Promise<string[]>;
  /** Puts `paths` (repo-relative) back as `HEAD` has them, in the index and the working tree. */
  restore(repoPath: string, paths: readonly string[]): Promise<void>;
  /** Creates `path` (which must not exist) as a worktree on a new `branch` started at `base`. */
  addWorktree(repoPath: string, input: { path: string; branch: string; base: string }): Promise<void>;
  /** The worktree's git folders, for its branch `branch` (one of the form `<prefix>/<folder>/<name>`). */
  worktreeGitPaths(worktreePath: string, branch: string): Promise<VcsWorktreeGitPaths>;
  /** Removes the worktree at `path` (forced: its own changes go with it); with `deleteBranch`, its branch too. Missing is fine. */
  removeWorktree(repoPath: string, path: string, options?: { deleteBranch?: string | undefined }): Promise<void>;
  /** The paths with uncommitted changes (staged, unstaged or untracked), repo-relative, `/`-separated. */
  status(repoPath: string): Promise<string[]>;
  /** `branch`'s changes since `base`. */
  diff(repoPath: string, base: string, branch: string, options?: { maxBytes?: number }): Promise<VcsDiff>;
  /** Whether `branch` is already merged into the checked-out branch. */
  isMerged(repoPath: string, branch: string): Promise<boolean>;
  /**
   * Merges commit `revision` into the checked-out branch without committing
   * (`--no-ff --no-commit --no-overwrite-ignore`). `conflict` only for a real
   * conflict (unmerged paths); `refused` when git refused or failed otherwise
   * (say, it would overwrite an untracked or ignored file). Either way the
   * merge was aborted and the checkout is as it was. Never called, and never
   * aborts, while another merge is in progress.
   */
  merge(repoPath: string, revision: string): Promise<'merged' | 'conflict' | 'refused'>;
  /** Aborts the merge in progress (one Ogden started), leaving the checkout as before it. */
  abortMerge(repoPath: string): Promise<void>;
  /** Stages `paths` (repo-relative). */
  add(repoPath: string, paths: readonly string[]): Promise<void>;
  /** Commits what is staged (the merge in progress) with `message`. */
  commit(repoPath: string, message: string): Promise<void>;
}

/** A git operation failed; `message` is plain words, `details` are for the log and hold no secret. */
export class VcsError extends CoreError {
  override readonly name = 'VcsError';
  constructor(
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super('vcs_failed', message);
  }
}
