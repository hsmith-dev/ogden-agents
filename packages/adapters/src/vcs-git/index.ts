/**
 * `vcs-git` (story 5.2's tracer, minimal; 5.5 completes it): core's
 * `VcsPort` on the user's own `git`.
 *
 * Every call runs `git` through `execFile` with an argument array (never a
 * shell), with:
 * - `-c core.longpaths=true` (Windows' long worktree paths, spike 5.1);
 * - `-c core.hooksPath=<an empty folder of Ogden Agents' own>`, so no hook
 *   the repo has, or an agent wrote into the run's branch (`.husky/`, a
 *   `core.hooksPath` the repo sets), ever runs: approve runs git unsandboxed
 *   in the main checkout;
 * - `-c core.fsmonitor=false`, so no configured monitor program starts;
 * - `--no-ext-diff --no-textconv` on every diff, so no configured diff
 *   program runs on the agent's files.
 * Branch names and revisions are checked before use; paths given to git
 * follow `--` or are absolute. No call pushes, fetches or forces a merge.
 * The environment is the caller's allowlist (AD-16), plus
 * `GIT_TERMINAL_PROMPT=0` and a C locale for parseable output.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { VcsError, type VcsDiff, type VcsHead, type VcsPort, type VcsWorktreeGitPaths } from '@ogden-agents/core';

export interface GitVcsOptions {
  /**
   * An empty folder of Ogden Agents' own (`<data>/tools/git-hooks-none`),
   * given to git as `core.hooksPath`: created if missing, and refused if
   * anything is in it.
   */
  hooksDir: string;
  /** The environment of every git child (an allowlist, never the server's own). */
  env: () => Readonly<Record<string, string>>;
  /** The `git` to run. Default `git` on `PATH`. */
  git?: string;
  /** How long one git call may take. Default 120 s. */
  timeoutMs?: number;
}

/** A full commit id. */
const REVISION = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
/** A branch name as Ogden makes them, and as git accepts them. */
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function checkBranch(branch: string): string {
  if (!BRANCH.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock') || branch.includes('@{')) {
    throw new VcsError('That is not a branch name Ogden Agents can use.', { step: 'branch' });
  }
  return branch;
}

function checkRevision(revision: string): string {
  if (!REVISION.test(revision)) throw new VcsError('That is not a commit Ogden Agents can use.', { step: 'revision' });
  return revision;
}

function checkPath(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new VcsError('That is not a folder Ogden Agents can use.', { step: 'path' });
  return path;
}

/** A repo-relative path for `git add -- <path>`: no `..`, never absolute. */
function checkRelative(path: string): string {
  if (path === '' || isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).includes('..')) throw new VcsError('That is not a project file Ogden Agents can stage.', { step: 'add' });
  return path;
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function createGitVcs(options: GitVcsOptions): VcsPort {
  const git = options.git ?? 'git';
  const timeout = options.timeoutMs ?? 120_000;

  /** The empty hooks folder, made sure of before every call. */
  const hooksDir = (): string => {
    mkdirSync(options.hooksDir, { recursive: true, mode: 0o700 });
    if (readdirSync(options.hooksDir).length > 0) throw new VcsError("Ogden Agents' empty hooks folder isn't empty, so git didn't run.", { step: 'hooks' });
    return options.hooksDir;
  };

  /** Runs git in `cwd`; resolves with its exit code (a spawn failure rejects). */
  const run = (cwd: string, args: readonly string[], maxBuffer = 16 * 1024 * 1024): Promise<GitResult> =>
    new Promise((resolvePromise, reject) => {
      let hooks: string;
      try {
        hooks = hooksDir();
      } catch (error) {
        reject(error);
        return;
      }
      const fullArgs = ['-c', 'core.longpaths=true', '-c', `core.hooksPath=${hooks}`, '-c', 'core.fsmonitor=false', ...args];
      execFile(
        git,
        fullArgs,
        {
          cwd,
          env: { ...options.env(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C' },
          maxBuffer,
          timeout,
          windowsHide: true,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error !== null && typeof (error as { code?: unknown }).code !== 'number') {
            reject(new VcsError("Ogden Agents couldn't run git.", { step: args[0] ?? 'git', code: String((error as NodeJS.ErrnoException).code ?? 'unknown') }));
            return;
          }
          resolvePromise({ code: error === null ? 0 : ((error as { code: number }).code ?? 1), stdout, stderr });
        },
      );
    });

  /** Runs git and requires success. `details` never hold git's output (it can name the user's files). */
  const must = async (cwd: string, args: readonly string[], step: string, maxBuffer?: number): Promise<string> => {
    const result = await run(cwd, args, maxBuffer);
    if (result.code !== 0) throw new VcsError(`git couldn't ${step}.`, { step, exitCode: result.code });
    return result.stdout;
  };

  /**
   * The identity a merge or its commit is made with: the user's own where git
   * has one (repo or global config), else Ogden Agents' for the part missing,
   * so a computer with no git identity still merges and commits.
   */
  const identity = async (repoPath: string): Promise<string[]> => {
    const email = await run(repoPath, ['config', '--get', 'user.email']);
    const name = await run(repoPath, ['config', '--get', 'user.name']);
    return [
      ...(name.code === 0 && name.stdout.trim() !== '' ? [] : ['-c', 'user.name=Ogden Agents']),
      ...(email.code === 0 && email.stdout.trim() !== '' ? [] : ['-c', 'user.email=ogden-agents@localhost']),
    ];
  };

  const head = async (repoPath: string): Promise<VcsHead | undefined> => {
    const ref = await run(checkPath(repoPath), ['symbolic-ref', '--quiet', 'HEAD']);
    if (ref.code !== 0) return undefined;
    const name = ref.stdout.trim();
    if (!name.startsWith('refs/heads/')) return undefined;
    const revision = await run(repoPath, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    if (revision.code !== 0) return undefined;
    const id = revision.stdout.trim();
    if (!REVISION.test(id)) return undefined;
    return { branch: name.slice('refs/heads/'.length), revision: id };
  };

  const status = async (repoPath: string): Promise<string[]> => {
    const out = await must(checkPath(repoPath), ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], 'read the changes');
    const entries = out.split('\0');
    const paths: string[] = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      paths.push(entry.slice(3));
      // A rename or copy is followed by its original path.
      if (code.includes('R') || code.includes('C')) {
        const original = entries[index + 1];
        if (original !== undefined && original !== '') paths.push(original);
        index++;
      }
    }
    return paths;
  };

  /** Whether git's own file `name` (`MERGE_HEAD`, `rebase-merge`, …) exists in the checkout's git folder. */
  const gitPathExists = async (repoPath: string, name: string): Promise<boolean> => {
    const out = await run(repoPath, ['rev-parse', '--path-format=absolute', '--git-path', name]);
    return out.code === 0 && existsSync(out.stdout.trim());
  };

  return {
    head,

    async topLevel(repoPath) {
      const out = await run(checkPath(repoPath), ['rev-parse', '--show-toplevel']);
      if (out.code !== 0) return undefined;
      const top = out.stdout.trim();
      try {
        return realpathSync.native(top);
      } catch {
        return undefined;
      }
    },

    async branchRevision(repoPath, branch) {
      const out = await run(checkPath(repoPath), ['rev-parse', '--verify', '--quiet', `refs/heads/${checkBranch(branch)}^{commit}`]);
      const id = out.stdout.trim();
      return out.code === 0 && REVISION.test(id) ? id : undefined;
    },

    async operationInProgress(repoPath) {
      checkPath(repoPath);
      for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
        if (await gitPathExists(repoPath, name)) return true;
      }
      return false;
    },

    async staged(repoPath) {
      const out = await must(checkPath(repoPath), ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z'], 'read the staged changes');
      return out.split('\0').filter((name) => name !== '');
    },

    async restore(repoPath, paths) {
      if (paths.length === 0) return;
      await must(checkPath(repoPath), ['checkout', 'HEAD', '--', ...paths.map(checkRelative)], 'restore the plan');
    },

    async addWorktree(repoPath, { path, branch, base }) {
      checkPath(repoPath);
      checkPath(path);
      if (existsSync(path)) throw new VcsError('The run folder already exists.', { step: 'worktree' });
      await must(repoPath, ['worktree', 'add', '-b', checkBranch(branch), path, checkRevision(base)], 'add the worktree');
    },

    async worktreeGitPaths(worktreePath, branch): Promise<VcsWorktreeGitPaths> {
      const folder = checkBranch(branch).split('/').slice(0, -1);
      if (folder.length === 0) throw new VcsError('That is not a branch Ogden Agents can use.', { step: 'branch' });
      const out = await must(checkPath(worktreePath), ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], 'read the worktree');
      const [gitDir, commonDir] = out.split(/\r?\n/).map((line) => line.trim());
      if (gitDir === undefined || commonDir === undefined || gitDir === '' || commonDir === '') throw new VcsError("git couldn't read the worktree.", { step: 'worktree' });
      const common = resolve(worktreePath, commonDir);
      const branchRefDir = join(common, 'refs', 'heads', ...folder);
      const branchLogDir = join(common, 'logs', 'refs', 'heads', ...folder);
      for (const dir of [branchRefDir, branchLogDir]) mkdirSync(dir, { recursive: true });
      return { gitDir: resolve(worktreePath, gitDir), commonDir: common, branchRefDir, branchLogDir };
    },

    async removeWorktree(repoPath, path, removeOptions = {}) {
      checkPath(repoPath);
      checkPath(path);
      if (existsSync(path)) {
        const removed = await run(repoPath, ['worktree', 'remove', '--force', '--force', path]);
        if (removed.code !== 0 && existsSync(path)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      await run(repoPath, ['worktree', 'prune']);
      if (removeOptions.deleteBranch !== undefined) await run(repoPath, ['branch', '-D', '--', checkBranch(removeOptions.deleteBranch)]);
    },

    status,

    async diff(repoPath, base, branch, diffOptions = {}): Promise<VcsDiff> {
      checkPath(repoPath);
      const from = checkRevision(base);
      const to = `refs/heads/${checkBranch(branch)}`;
      const names = await must(repoPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', from, to, '--'], 'read the changes');
      const files = names.split('\0').filter((name) => name !== '');
      const maxBytes = diffOptions.maxBytes ?? 512 * 1024;
      if (files.length === 0) return { diff: '', truncated: false, files };
      const result = await run(repoPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', from, to, '--'], 256 * 1024 * 1024);
      if (result.code !== 0) throw new VcsError("git couldn't read the changes.", { step: 'diff', exitCode: result.code });
      const bytes = Buffer.from(result.stdout, 'utf8');
      if (bytes.length <= maxBytes) return { diff: result.stdout, truncated: false, files };
      return { diff: bytes.subarray(0, maxBytes).toString('utf8'), truncated: true, files };
    },

    async isMerged(repoPath, branch) {
      const result = await run(checkPath(repoPath), ['merge-base', '--is-ancestor', `refs/heads/${checkBranch(branch)}`, 'HEAD']);
      return result.code === 0;
    },

    async merge(repoPath, revision) {
      checkPath(repoPath);
      const commit = checkRevision(revision);
      // Never touch a merge (or rebase, …) the user has in progress: nothing to abort that Ogden didn't start.
      for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
        if (await gitPathExists(repoPath, name)) return 'refused';
      }
      // A file the merge would add that is already on disk, untracked or ignored, is never overwritten: git's own
      // `--no-overwrite-ignore` doesn't stop a three-way merge from writing over an ignored file (git 2.54).
      const base = await run(repoPath, ['merge-base', 'HEAD', commit]);
      if (base.code === 0) {
        const added = await run(repoPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', '--diff-filter=A', base.stdout.trim(), commit, '--']);
        const tracked = await run(repoPath, ['ls-files', '-z']);
        const inHead = new Set(tracked.stdout.split('\0'));
        if (added.code !== 0 || tracked.code !== 0) return 'refused';
        if (added.stdout.split('\0').some((name) => name !== '' && !inHead.has(name) && existsSync(join(repoPath, ...name.split('/'))))) return 'refused';
      }
      // git wants an identity for a merge even with `--no-commit` (a computer with none refuses it).
      const result = await run(repoPath, [...(await identity(repoPath)), 'merge', '--no-ff', '--no-commit', '--no-verify', '--no-overwrite-ignore', commit]);
      if (result.code === 0) return 'merged';
      // Only unmerged paths are a conflict; anything else git refused or failed at.
      const unmerged = await run(repoPath, ['diff', '--name-only', '--diff-filter=U', '-z']);
      const conflict = unmerged.code === 0 && unmerged.stdout.split('\0').some((name) => name !== '');
      // This merge is Ogden's own (none was in progress before it): the checkout goes back to how it was.
      if (await gitPathExists(repoPath, 'MERGE_HEAD')) await must(repoPath, ['merge', '--abort'], 'abort the merge');
      return conflict ? 'conflict' : 'refused';
    },

    async abortMerge(repoPath) {
      const inProgress = await run(checkPath(repoPath), ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
      if (inProgress.code === 0) await must(repoPath, ['merge', '--abort'], 'abort the merge');
    },

    async add(repoPath, paths) {
      if (paths.length === 0) return;
      await must(checkPath(repoPath), ['add', '--', ...paths.map(checkRelative)], 'stage the plan');
    },

    async commit(repoPath, message) {
      checkPath(repoPath);
      await must(repoPath, [...(await identity(repoPath)), 'commit', '--no-verify', '--no-edit', '-m', message], 'commit the merge');
    },
  };
}
