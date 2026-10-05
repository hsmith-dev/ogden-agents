/**
 * `vcs-memory` (story 5.3): an in-memory `VcsPort` for tests and the epics'
 * lanes (the server wires the real `vcs-git`). It runs no git and touches no
 * file: each repo is a record of its checked-out branch, branches and their
 * commits, uncommitted and staged paths, and each branch's changed files;
 * a worktree is a path recorded against its repo and branch. Tests set the
 * state directly (`repo(path)`) and read the calls (`calls`). A merge
 * conflicts when the branch's files are in `conflicts`; a rebase conflicts
 * when `rebaseConflicts` names the worktree; a patch applies unless it is
 * in `badPatches`.
 */
import { VcsError, type VcsCheck, type VcsDiff, type VcsHead, type VcsPort, type VcsWorktreeGitPaths } from '@ogden-agents/core';
import type { DiffStats } from '@ogden-agents/shared';

export interface MemoryRepo {
  /** The checked-out branch, or `undefined` for a detached `HEAD` or no commit. */
  branch: string | undefined;
  /** Each branch's commit. */
  branches: Map<string, string>;
  /** Uncommitted paths (staged, unstaged or untracked). */
  status: string[];
  staged: string[];
  inProgress: boolean;
  /** Each branch's changed files against where it started. */
  changes: Map<string, string[]>;
  /** Paths whose change conflicts on a merge. */
  conflicts: Set<string>;
  /** Branches merged into the checked-out branch. */
  merged: Set<string>;
  /** The merge in progress that Ogden started (a revision), if any. */
  merging: string | undefined;
}

export interface MemoryVcs extends VcsPort {
  /** Every call as `method arg…`, in order. */
  readonly calls: string[];
  /** The repo at `path`, created (on `main`, one commit, clean) if new. */
  repo(path: string): MemoryRepo;
  /** Worktree path → its repo and branch. */
  readonly worktrees: Map<string, { repoPath: string; branch: string }>;
  readonly rebaseConflicts: Set<string>;
  readonly badPatches: Set<string>;
  /** What `check` answers (story 5.5); git 2.45.0 by default. */
  gitCheck: VcsCheck;
}

let commits = 0;
const nextRevision = (): string => (++commits).toString(16).padStart(40, '0');

export function createMemoryVcs(): MemoryVcs {
  const calls: string[] = [];
  const repos = new Map<string, MemoryRepo>();
  const worktrees = new Map<string, { repoPath: string; branch: string }>();
  const rebaseConflicts = new Set<string>();
  const badPatches = new Set<string>();

  const repo = (path: string): MemoryRepo => {
    let found = repos.get(path);
    if (found === undefined) {
      found = { branch: 'main', branches: new Map([['main', nextRevision()]]), status: [], staged: [], inProgress: false, changes: new Map(), conflicts: new Set(), merged: new Set(), merging: undefined };
      repos.set(path, found);
    }
    return found;
  };
  const worktree = (path: string): { repoPath: string; branch: string } => {
    const found = worktrees.get(path);
    if (found === undefined) throw new VcsError('That is not a worktree.', { step: 'worktree' });
    return found;
  };
  /** The branch (other than the checked-out one) at `revision`. */
  const branchOfRevision = (state: MemoryRepo, revision: string): string | undefined => [...state.branches].find(([name, commit]) => name !== state.branch && commit === revision)?.[0];

  const vcs: MemoryVcs = {
    calls,
    repo,
    worktrees,
    rebaseConflicts,
    badPatches,
    gitCheck: { ok: true, version: '2.45.0' },

    async check() {
      calls.push('check');
      return vcs.gitCheck;
    },
    async isAncestor(repoPath, revision) {
      calls.push(`isAncestor ${repoPath} ${revision}`);
      const state = repo(repoPath);
      // The stub's history: a revision is an ancestor of the checked-out branch when no other branch names it.
      return state.branch !== undefined && (state.branches.get(state.branch) === revision || ![...state.branches].some(([name, commit]) => name !== state.branch && commit === revision));
    },
    async commitPaths(repoPath, paths, message) {
      calls.push(`commitPaths ${repoPath} ${paths.join(',')} ${message.split('\n')[0] ?? ''}`);
      const state = repo(repoPath);
      if (state.branch === undefined || paths.length === 0) throw new VcsError("git couldn't commit the plan files.", { step: 'commit the plan files' });
      const revision = nextRevision();
      state.branches.set(state.branch, revision);
      state.status = state.status.filter((path) => !paths.includes(path));
      state.staged = state.staged.filter((path) => !paths.includes(path));
      return revision;
    },

    async head(repoPath): Promise<VcsHead | undefined> {
      calls.push(`head ${repoPath}`);
      const state = repo(repoPath);
      const revision = state.branch === undefined ? undefined : state.branches.get(state.branch);
      return state.branch === undefined || revision === undefined ? undefined : { branch: state.branch, revision };
    },
    async topLevel(repoPath) {
      calls.push(`topLevel ${repoPath}`);
      return repoPath;
    },
    async branchRevision(repoPath, branch) {
      calls.push(`branchRevision ${repoPath} ${branch}`);
      return repo(repoPath).branches.get(branch);
    },
    async operationInProgress(repoPath) {
      calls.push(`operationInProgress ${repoPath}`);
      const state = repo(repoPath);
      return state.inProgress || state.merging !== undefined;
    },
    async staged(repoPath) {
      calls.push(`staged ${repoPath}`);
      return [...repo(repoPath).staged];
    },
    async restore(repoPath, paths) {
      calls.push(`restore ${repoPath} ${paths.join(',')}`);
      const state = repo(repoPath);
      state.status = state.status.filter((path) => !paths.includes(path));
      state.staged = state.staged.filter((path) => !paths.includes(path));
    },
    async addWorktree(repoPath, { path, branch, base }) {
      calls.push(`addWorktree ${repoPath} ${path} ${branch} ${base}`);
      const state = repo(repoPath);
      if (worktrees.has(path)) throw new VcsError('The run folder already exists.', { step: 'worktree' });
      if (state.branches.has(branch)) throw new VcsError("git couldn't add the worktree.", { step: 'add the worktree' });
      state.branches.set(branch, base);
      state.changes.set(branch, []);
      worktrees.set(path, { repoPath, branch });
    },
    async worktreeGitPaths(worktreePath, branch): Promise<VcsWorktreeGitPaths> {
      calls.push(`worktreeGitPaths ${worktreePath} ${branch}`);
      const { repoPath } = worktree(worktreePath);
      const commonDir = `${repoPath}/.git`;
      const folder = branch.split('/').slice(0, -1).join('/');
      return { commonDir, gitDir: `${commonDir}/worktrees/${worktreePath.split('/').pop() ?? 'w'}`, branchRefDir: `${commonDir}/refs/heads/${folder}`, branchLogDir: `${commonDir}/logs/refs/heads/${folder}` };
    },
    async removeWorktree(repoPath, path, options = {}) {
      calls.push(`removeWorktree ${repoPath} ${path}${options.deleteBranch === undefined ? '' : ` ${options.mergedOnly === true ? '-d' : '-D'} ${options.deleteBranch}`}`);
      worktrees.delete(path);
      if (options.deleteBranch !== undefined) repo(repoPath).branches.delete(options.deleteBranch);
    },
    async status(repoPath) {
      calls.push(`status ${repoPath}`);
      return [...repo(repoPath).status];
    },
    async diff(repoPath, base, branch, options = {}): Promise<VcsDiff> {
      calls.push(`diff ${repoPath} ${base} ${branch}`);
      const files = [...(repo(repoPath).changes.get(branch) ?? [])];
      const text = files.map((file) => `diff --git a/${file} b/${file}\n`).join('');
      const max = options.maxBytes ?? 512 * 1024;
      return { diff: text.slice(0, max), truncated: text.length > max, files };
    },
    async diffStats(repoPath, base, branch): Promise<DiffStats> {
      calls.push(`diffStats ${repoPath} ${base} ${branch}`);
      const files = repo(repoPath).changes.get(branch) ?? [];
      return { files: files.length, insertions: files.length, deletions: 0 };
    },
    async importObjects(repoPath, branch, base) {
      calls.push(`importObjects ${repoPath} ${branch} ${base}`);
      return 'nothing';
    },

    async isMerged(repoPath, branch) {
      calls.push(`isMerged ${repoPath} ${branch}`);
      return repo(repoPath).merged.has(branch);
    },
    async merge(repoPath, revision) {
      calls.push(`merge ${repoPath} ${revision}`);
      const state = repo(repoPath);
      if (state.inProgress || state.merging !== undefined) return 'refused';
      const branch = branchOfRevision(state, revision);
      if (branch === undefined) return 'refused';
      if ((state.changes.get(branch) ?? []).some((file) => state.conflicts.has(file))) return 'conflict';
      state.merging = revision;
      return 'merged';
    },
    async abortMerge(repoPath) {
      calls.push(`abortMerge ${repoPath}`);
      repo(repoPath).merging = undefined;
    },
    async add(repoPath, paths) {
      calls.push(`add ${repoPath} ${paths.join(',')}`);
      const state = repo(repoPath);
      state.staged = [...new Set([...state.staged, ...paths])];
    },
    async commit(repoPath, message) {
      calls.push(`commit ${repoPath} ${message.split('\n')[0] ?? ''}`);
      const state = repo(repoPath);
      if (state.branch === undefined) throw new VcsError("git couldn't commit the merge.", { step: 'commit the merge' });
      if (state.merging !== undefined) {
        const branch = branchOfRevision(state, state.merging);
        if (branch !== undefined) state.merged.add(branch);
      }
      state.branches.set(state.branch, nextRevision());
      state.status = state.status.filter((path) => !state.staged.includes(path));
      state.staged = [];
      state.merging = undefined;
    },
    async worktreeExists(repoPath, path) {
      calls.push(`worktreeExists ${repoPath} ${path}`);
      return worktrees.get(path)?.repoPath === repoPath;
    },
    async rebase({ repoPath: given, worktreePath, branch: expected, onto }) {
      calls.push(`rebase ${worktreePath} ${onto}`);
      const { repoPath, branch } = worktree(worktreePath);
      if (repoPath !== given || branch !== expected) throw new VcsError("The run's worktree isn't as Ogden Agents made it, so git didn't run there.", { step: 'worktree' });
      if (rebaseConflicts.has(worktreePath)) return 'conflict';
      repo(repoPath).branches.set(branch, nextRevision());
      return 'rebased';
    },
    async applyPatch({ repoPath: given, worktreePath, branch: expected, patchPath }) {
      calls.push(`applyPatch ${worktreePath} ${patchPath}`);
      const { repoPath, branch } = worktree(worktreePath);
      if (repoPath !== given || branch !== expected) throw new VcsError("The run's worktree isn't as Ogden Agents made it, so git didn't run there.", { step: 'worktree' });
      return badPatches.has(patchPath) ? 'refused' : 'applied';
    },
  };
  return vcs;
}
