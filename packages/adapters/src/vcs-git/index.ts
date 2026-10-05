/**
 * `vcs-git` (story 5.2's tracer; story 5.3 adds diff stats, worktree
 * lookup, rebase and patch apply; 5.5 completes it): core's `VcsPort` on
 * the user's own `git`.
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
 *
 * Story 5.5: `check` says whether git is there and at least
 * `MIN_GIT_VERSION`; a worktree is removed only inside `worktreesRoot` (a
 * real folder, never a link), by git's own `worktree remove` of that one
 * path (never a `prune`, which would touch the user's other worktrees), and
 * a branch is deleted only when it is one Ogden made (`ogden/…`).
 */
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isRealFolder, removeLinkOnly, RUN_SHORT_ID as RUN_ID, VcsError, type VcsCheck, type VcsDiff, type VcsHead, type VcsPort, type VcsWorktreeGitPaths } from '@ogden-agents/core';
import { BUILD_BRANCH_PREFIX, MIN_GIT_VERSION } from '@ogden-agents/shared';

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
  /**
   * The folder every run's worktree is made in (`<data>/w`; story 5.5): a
   * removal outside it, or with it a link, is refused. Without it (tests of
   * other methods), removal checks only that the path isn't the repo.
   */
  worktreesRoot?: string;
}

/** `major.minor.patch` of `git --version`'s answer (`git version 2.39.2.windows.1`), or `undefined`. */
export function parseGitVersion(text: string): [number, number, number] | undefined {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Whether version `found` is at least `wanted` (both `major.minor.patch`). */
export function gitVersionAtLeast(found: readonly [number, number, number], wanted: string): boolean {
  const want = wanted.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const have = found[index] ?? 0;
    const need = want[index] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
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

/** Config git must not take from anywhere for a rebase or a patch: no signing program, no ref rewriting elsewhere. */
const SAFE_CONFIG = ['-c', 'commit.gpgsign=false', '-c', 'rebase.updateRefs=false', '-c', 'core.sshCommand=false'];

/** The real path of `dir`, or its resolved path when it doesn't exist. */
function realOf(dir: string): string {
  try {
    return realpathSync.native(dir);
  } catch {
    return resolve(dir);
  }
}

/** Whether `path` is `root` or inside it. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
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
  const run = (cwd: string, args: readonly string[], maxBuffer = 16 * 1024 * 1024, extraEnv: Readonly<Record<string, string>> = {}): Promise<GitResult> =>
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
          env: { ...options.env(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C', ...extraEnv },
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
  const must = async (cwd: string, args: readonly string[], step: string, maxBuffer?: number, extraEnv?: Readonly<Record<string, string>>): Promise<string> => {
    const result = await run(cwd, args, maxBuffer, extraEnv);
    if (result.code !== 0) throw new VcsError(`git couldn't ${step}.`, { step, exitCode: result.code });
    return result.stdout;
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

  /**
   * The identity a merge, its commit or a rebase is made with: the user's own
   * where git has one (repo or global config), else Ogden Agents' for the part
   * missing, so a computer with no git identity still merges and commits.
   */
  const identityFlags = async (repoPath: string): Promise<string[]> => {
    const email = await run(repoPath, ['config', '--get', 'user.email']);
    const name = await run(repoPath, ['config', '--get', 'user.name']);
    return [
      ...(name.code === 0 && name.stdout.trim() !== '' ? [] : ['-c', 'user.name=Ogden Agents']),
      ...(email.code === 0 && email.stdout.trim() !== '' ? [] : ['-c', 'user.email=ogden-agents@localhost']),
    ];
  };

  /**
   * Git's own folders for a run's worktree, checked against the repo before
   * git runs there (security review, story 5.3): the agent can write the
   * worktree's admin folder (`<common>/worktrees/<id>`), so its `HEAD` must
   * still name `branch` and its `commondir` the repo's, and git is then run
   * with `GIT_DIR`, `GIT_COMMON_DIR` and `GIT_WORK_TREE` set by Ogden, never
   * read from files the agent wrote.
   */
  const pinnedWorktree = async (repoPath: string, worktreePath: string, branch: string): Promise<Record<string, string>> => {
    checkPath(repoPath);
    checkPath(worktreePath);
    checkBranch(branch);
    const common = realOf(resolve(repoPath, (await must(repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'read the repository')).trim()));
    const gitDir = join(common, 'worktrees', basename(worktreePath));
    try {
      const head = readFileSync(join(gitDir, 'HEAD'), 'utf8');
      const commondir = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
      const link = readFileSync(join(worktreePath, '.git'), 'utf8').trim();
      if (head.trim() !== `ref: refs/heads/${branch}`) throw new Error('head');
      if (realOf(resolve(gitDir, commondir)) !== common) throw new Error('commondir');
      if (!link.startsWith('gitdir: ') || realOf(resolve(worktreePath, link.slice('gitdir: '.length))) !== realOf(gitDir)) throw new Error('gitdir');
    } catch {
      throw new VcsError("The run's worktree isn't as Ogden Agents made it, so git didn't run there.", { step: 'worktree' });
    }
    return { GIT_DIR: gitDir, GIT_COMMON_DIR: common, GIT_WORK_TREE: worktreePath };
  };

  /** Whether git's own file `name` (`MERGE_HEAD`, `rebase-merge`, …) exists in the checkout's git folder. */
  const gitPathExists = async (repoPath: string, name: string, extraEnv?: Readonly<Record<string, string>>): Promise<boolean> => {
    const out = await run(repoPath, ['rev-parse', '--path-format=absolute', '--git-path', name], undefined, extraEnv);
    return out.code === 0 && existsSync(out.stdout.trim());
  };

  let checked: Promise<VcsCheck> | undefined;

  /**
   * Throws unless `path` may be removed as a run's worktree (story 5.5): a
   * direct child of `worktreesRoot`, which is a real folder (not a link or a
   * junction), and never the repo itself.
   */
  const requireOwnWorktree = (repoPath: string, path: string): void => {
    const refuse = (): never => {
      throw new VcsError("That folder isn't one of Ogden Agents' worktrees, so it wasn't removed.", { step: 'remove the worktree' });
    };
    // Never the repo, a folder holding it, or a folder inside it (AD-17: worktrees are never in the repo).
    if (isInside(realOf(path), realOf(repoPath)) || isInside(realOf(repoPath), realOf(path))) refuse();
    const root = options.worktreesRoot;
    if (root === undefined) return;
    if (!isRealFolder(root)) refuse();
    if (realOf(dirname(path)) !== realOf(root) || !RUN_ID.test(basename(path))) refuse();
  };

  return {
    check() {
      // Only a usable git is remembered (review): a missing or old one is asked again next time.
      checked ??= new Promise<VcsCheck>((resolveCheck) => {
        execFile(git, ['--version'], { env: { ...options.env(), LC_ALL: 'C', LANG: 'C' }, timeout: 30_000, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
          if (error !== null) {
            resolveCheck({ ok: false, reason: 'missing' });
            return;
          }
          const found = parseGitVersion(stdout);
          if (found === undefined) {
            resolveCheck({ ok: false, reason: 'missing' });
            return;
          }
          const version = found.join('.');
          resolveCheck(gitVersionAtLeast(found, MIN_GIT_VERSION) ? { ok: true, version } : { ok: false, reason: 'too_old', version });
        });
      });
      const answer = checked;
      void answer.then((result) => {
        if (!result.ok && checked === answer) checked = undefined;
      });
      return answer;
    },

    head,

    async isAncestor(repoPath, revision) {
      const result = await run(checkPath(repoPath), ['merge-base', '--is-ancestor', checkRevision(revision), 'HEAD']);
      return result.code === 0;
    },

    async commitPaths(repoPath, paths, message) {
      checkPath(repoPath);
      if (paths.length === 0) throw new VcsError('There is nothing to commit.', { step: 'commit the plan files' });
      const files = paths.map(checkRelative);
      // Literal paths (review): never pathspec magic or a glob matching the user's other files.
      await must(repoPath, ['--literal-pathspecs', 'add', '--', ...files], 'stage the plan files');
      try {
        // `--only`: exactly these paths, whatever else is staged stays staged and out of this commit.
        await must(repoPath, ['--literal-pathspecs', ...(await identityFlags(repoPath)), 'commit', '--no-verify', '--only', '-m', message, '--', ...files], 'commit the plan files');
      } catch (error) {
        // Nothing committed: the index goes back to how it was for these paths (review).
        await run(repoPath, ['--literal-pathspecs', 'reset', '-q', '--', ...files]).catch(() => undefined);
        throw error;
      }
      const revision = (await must(repoPath, ['rev-parse', '--verify', 'HEAD^{commit}'], 'read the commit')).trim();
      if (!REVISION.test(revision)) throw new VcsError("git couldn't read the commit.", { step: 'commit the plan files' });
      return revision;
    },

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
      await must(checkPath(repoPath), ['--literal-pathspecs', 'checkout', 'HEAD', '--', ...paths.map(checkRelative)], 'restore the plan');
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
      const id = basename(path);
      const branch = removeOptions.deleteBranch;
      // Only this run's own branch: `ogden/<its id>/…` (review: never another run's, never the user's).
      if (branch !== undefined && !checkBranch(branch).startsWith(`${BUILD_BRANCH_PREFIX}${id}/`)) throw new VcsError('That is not this run\'s branch, so it was kept.', { step: 'branch' });
      requireOwnWorktree(repoPath, path);
      // The folder first, by Ogden itself, never through git's path matching (review: git resolves a path that became
      // a link and could match another of the user's worktrees). A link or file is unlinked; a folder is removed
      // without following any link in it.
      let entry: ReturnType<typeof lstatSync> | undefined;
      try {
        entry = lstatSync(path);
      } catch {
        entry = undefined;
      }
      try {
        if (entry !== undefined && (!entry.isDirectory() || entry.isSymbolicLink())) removeLinkOnly(path);
        else if (entry !== undefined) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        throw new VcsError("Ogden Agents couldn't remove the run's worktree (a program may still have files open there).", { step: 'remove the worktree' });
      }
      // Then git's record of it, found by its id in the repo's own git folder (never a prune, which would touch the user's other worktrees).
      const common = realOf(resolve(repoPath, (await must(repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'read the repository')).trim()));
      const admin = join(common, 'worktrees', id);
      try {
        const record = lstatSync(admin);
        if (record.isDirectory() && !record.isSymbolicLink()) rmSync(admin, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        else removeLinkOnly(admin);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new VcsError("Ogden Agents couldn't remove git's record of the run's worktree.", { step: 'remove the worktree' });
      }
      // git's own folder of records goes when it is empty, as git leaves it (never when another worktree is recorded there).
      try {
        rmdirSync(join(common, 'worktrees'));
      } catch {
        // Not empty, or not there.
      }
      if (branch === undefined) return;
      if ((await run(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).code !== 0) return;
      const deleted = await run(repoPath, ['branch', removeOptions.mergedOnly === true ? '-d' : '-D', '--', branch]);
      if (deleted.code !== 0) throw new VcsError("git couldn't delete the run's branch.", { step: 'delete the branch', exitCode: deleted.code });
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
      const result = await run(repoPath, [...(await identityFlags(repoPath)), 'merge', '--no-ff', '--no-commit', '--no-verify', '--no-overwrite-ignore', commit]);
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
      await must(checkPath(repoPath), ['--literal-pathspecs', 'add', '--', ...paths.map(checkRelative)], 'stage the plan');
    },

    async commit(repoPath, message) {
      checkPath(repoPath);
      // The user's own identity; a repo without one still gets its merge commit.
      await must(repoPath, [...(await identityFlags(repoPath)), 'commit', '--no-verify', '--no-edit', '-m', message], 'commit the merge');
    },

    async diffStats(repoPath, base, branch) {
      checkPath(repoPath);
      const out = await must(repoPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', checkRevision(base), `refs/heads/${checkBranch(branch)}`, '--'], 'read the changes');
      let files = 0;
      let insertions = 0;
      let deletions = 0;
      // `<added>\t<deleted>\t<path>` per file, NUL-terminated; a binary file counts `-` for both.
      for (const entry of out.split('\0')) {
        const match = /^(\d+|-)\t(\d+|-)\t/.exec(entry);
        if (match === null) continue;
        files++;
        if (match[1] !== '-') insertions += Number(match[1]);
        if (match[2] !== '-') deletions += Number(match[2]);
      }
      return { files, insertions, deletions };
    },

    async worktreeExists(repoPath, path) {
      checkPath(repoPath);
      checkPath(path);
      if (!existsSync(path)) return false;
      // Without `-z` (git 2.36+ only): a worktree path in Ogden's data folder has no line break.
      const out = await run(repoPath, ['worktree', 'list', '--porcelain']);
      if (out.code !== 0) throw new VcsError("git couldn't list the worktrees.", { step: 'worktree list', exitCode: out.code });
      const wanted = realOf(path);
      // The first entry is the main checkout: never one of the runs' worktrees (review: a removal must never reach the repo).
      const listed = out.stdout.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).slice(1);
      return listed.some((line) => realOf(line.slice('worktree '.length)) === wanted) && wanted !== realOf(repoPath);
    },

    async rebase({ repoPath, worktreePath, branch, onto }) {
      const commit = checkRevision(onto);
      const pinned = await pinnedWorktree(repoPath, worktreePath, branch);
      const args = [...SAFE_CONFIG, ...(await identityFlags(repoPath)), 'rebase', '--no-autostash', '--no-update-refs', '--no-verify', commit];
      let result: GitResult;
      try {
        result = await run(worktreePath, args, undefined, pinned);
      } catch (error) {
        // A timeout or a spawn failure: whatever git left, the worktree goes back to how it was.
        await run(worktreePath, ['rebase', '--abort'], undefined, pinned).catch(() => undefined);
        throw error;
      }
      if (result.code === 0) return 'rebased';
      // Stopped part-way (conflicts) is aborted; never started (uncommitted changes, …) is refused.
      if ((await gitPathExists(worktreePath, 'rebase-merge', pinned)) || (await gitPathExists(worktreePath, 'rebase-apply', pinned))) {
        await must(worktreePath, ['rebase', '--abort'], 'abort the rebase', undefined, pinned);
        return 'conflict';
      }
      return 'refused';
    },

    async applyPatch({ repoPath, worktreePath, branch, patchPath, refuse }) {
      const pinned = await pinnedWorktree(repoPath, worktreePath, branch);
      // The saved fix is a regular file inside the worktree, never a link to somewhere else.
      checkPath(patchPath);
      try {
        if (!lstatSync(patchPath).isFile() || !isInside(realOf(worktreePath), realOf(patchPath))) return 'refused';
      } catch {
        return 'refused';
      }
      const listed = await run(worktreePath, [...SAFE_CONFIG, 'apply', '--numstat', '--summary', '-z', patchPath], undefined, pinned);
      if (listed.code !== 0) return 'refused';
      // No symbolic link, and no path the caller refuses (the protected paths: the sandbox denies the agent those).
      if (/\b120000\b/.test(listed.stdout)) return 'refused';
      const paths = listed.stdout.split('\0').flatMap((entry) => {
        const match = /^(?:\d+|-)\t(?:\d+|-)\t(.*)$/s.exec(entry.trim());
        return match === null || match[1] === '' ? [] : [match[1]!];
      });
      if (refuse !== undefined && paths.some((path) => refuse(path))) return 'refused';
      // All or nothing, and never a path outside the worktree (git refuses those without --unsafe-paths).
      const check = await run(worktreePath, [...SAFE_CONFIG, 'apply', '--check', '--whitespace=nowarn', patchPath], undefined, pinned);
      if (check.code !== 0) return 'refused';
      const applied = await run(worktreePath, [...SAFE_CONFIG, 'apply', '--whitespace=nowarn', patchPath], undefined, pinned);
      return applied.code === 0 ? 'applied' : 'refused';
    },
  };
}
