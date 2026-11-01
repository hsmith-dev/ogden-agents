/**
 * How `vcs-git` runs git (moved out of `index.ts` by story 8.4, shared by
 * the builds' `VcsPort` and the Workbench's `VcsWorkingTreePort`): through
 * `execFile` with an argument array (never a shell), the caller's
 * allowlisted environment plus `GIT_TERMINAL_PROMPT=0`,
 * `GIT_OPTIONAL_LOCKS=0` and a C locale, and on every call
 * `core.longpaths=true`, `core.hooksPath=<an empty folder of Ogden's own>`,
 * `core.fsmonitor=false` and `core.autocrlf=false` (see `index.ts`).
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { VcsError } from '@ogden-agents/core';
import { readRegularFile } from '../fs-safe.js';
import { checkBranch, checkPath, realOf, type GitResult } from './checks.js';

export interface GitRunnerOptions {
  /** The empty folder given to git as `core.hooksPath`: created if missing, refused if anything is in it. */
  hooksDir: string;
  /** The environment of every git child (an allowlist, never the server's own). */
  env: () => Readonly<Record<string, string>>;
  /** The `git` to run. Default `git` on `PATH`. */
  git?: string | undefined;
  /** How long one git call may take. Default 120 s. */
  timeoutMs?: number | undefined;
  /**
   * Whether every call says `core.autocrlf=false` (default yes: builds'
   * checkouts are byte for byte). The Workbench's working tree reads the
   * user's own checkout as its own config says (story 8.4 review).
   */
  overrideAutocrlf?: boolean | undefined;
  /** More `-c` flags for every call (story 8.4: the working tree's no-fetch, no-split-index config). */
  extraConfig?: readonly string[] | undefined;
  /** More environment for every call, under each call's own. */
  extraEnv?: Readonly<Record<string, string>> | undefined;
}

/** The most bytes of a worktree's small git file (`HEAD`, `commondir`, `.git`) read for its check. */
export const MAX_GIT_FILE_BYTES = 64 * 1024;

/** Ogden's own folders for a worktree, after its check: git's env, and the repo's shared git folder. */
export interface PinnedWorktree {
  env: { GIT_DIR: string; GIT_COMMON_DIR: string; GIT_WORK_TREE: string };
  common: string;
}

export interface GitRunner {
  readonly git: string;
  readonly timeout: number;
  /** The empty hooks folder, made sure of before every call. */
  hooksDir(): string;
  /** The flags every call starts with. */
  baseArgs(): string[];
  /** The environment of every call, with `extraEnv` over it. */
  env(extraEnv?: Readonly<Record<string, string>>): Record<string, string>;
  /** Runs git in `cwd`; resolves with its exit code (a spawn failure, a timeout or output over `maxBuffer` rejects). `input` goes to its stdin. */
  run(cwd: string, args: readonly string[], maxBuffer?: number, extraEnv?: Readonly<Record<string, string>>, input?: string): Promise<GitResult>;
  /** Runs git and requires success. `details` never hold git's output (it can name the user's files). */
  must(cwd: string, args: readonly string[], step: string, maxBuffer?: number, extraEnv?: Readonly<Record<string, string>>, input?: string): Promise<string>;
  /** The user's identity where git has one, else Ogden Agents' for the part missing. */
  identityFlags(repoPath: string): Promise<string[]>;
  /** Checks a worktree's own git files still name the repo and `branch`; Ogden's folders for it. */
  pinnedWorktree(repoPath: string, worktreePath: string, branch: string): Promise<PinnedWorktree>;
}

/** The `details.code` of a call whose output went over its `maxBuffer`. */
export const OUTPUT_TOO_LARGE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

export function createGitRunner(options: GitRunnerOptions): GitRunner {
  const git = options.git ?? 'git';
  const timeout = options.timeoutMs ?? 120_000;

  const hooksDir = (): string => {
    mkdirSync(options.hooksDir, { recursive: true, mode: 0o700 });
    if (readdirSync(options.hooksDir).length > 0) throw new VcsError("Ogden Agents' empty hooks folder isn't empty, so git didn't run.", { step: 'hooks' });
    return options.hooksDir;
  };

  const baseArgs = (): string[] => [
    '-c',
    'core.longpaths=true',
    '-c',
    `core.hooksPath=${hooksDir()}`,
    '-c',
    'core.fsmonitor=false',
    ...(options.overrideAutocrlf === false ? [] : ['-c', 'core.autocrlf=false']),
    ...(options.extraConfig ?? []),
  ];

  const env = (extraEnv: Readonly<Record<string, string>> = {}): Record<string, string> => ({
    ...options.env(),
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    LANG: 'C',
    ...options.extraEnv,
    ...extraEnv,
  });

  const run = (cwd: string, args: readonly string[], maxBuffer = 16 * 1024 * 1024, extraEnv: Readonly<Record<string, string>> = {}, input?: string): Promise<GitResult> =>
    new Promise((resolvePromise, reject) => {
      let fullArgs: string[];
      try {
        fullArgs = [...baseArgs(), ...args];
      } catch (error) {
        reject(error);
        return;
      }
      const child = execFile(git, fullArgs, { cwd, env: env(extraEnv), maxBuffer, timeout, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error !== null && typeof (error as { code?: unknown }).code !== 'number') {
          reject(new VcsError("Ogden Agents couldn't run git.", { step: args[0] ?? 'git', code: String((error as NodeJS.ErrnoException).code ?? 'unknown') }));
          return;
        }
        resolvePromise({ code: error === null ? 0 : ((error as { code: number }).code ?? 1), stdout, stderr });
      });
      child.on('error', () => undefined);
      child.stdin?.on('error', () => undefined);
      if (input === undefined) child.stdin?.end();
      else child.stdin?.end(input);
    });

  const must = async (cwd: string, args: readonly string[], step: string, maxBuffer?: number, extraEnv?: Readonly<Record<string, string>>, input?: string): Promise<string> => {
    const result = await run(cwd, args, maxBuffer, extraEnv, input);
    if (result.code !== 0) throw new VcsError(`git couldn't ${step}.`, { step, exitCode: result.code });
    return result.stdout;
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
   * Git's own folders for a worktree, checked against the repo before git
   * runs there (security review, story 5.3): the agent can write the
   * worktree's admin folder (`<common>/worktrees/<id>`), so its `HEAD` must
   * still name `branch` and its `commondir` the repo's, and git is then run
   * with `GIT_DIR`, `GIT_COMMON_DIR` and `GIT_WORK_TREE` set by Ogden, never
   * read from files the agent wrote.
   */
  const pinnedWorktree = async (repoPath: string, worktreePath: string, branch: string): Promise<PinnedWorktree> => {
    checkPath(repoPath);
    checkPath(worktreePath);
    checkBranch(branch);
    const common = realOf(resolve(repoPath, (await must(repoPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'read the repository')).trim()));
    const gitDir = join(common, 'worktrees', basename(worktreePath));
    try {
      // Each a regular file of its own, never a link to another file or a FIFO that would hold the event loop.
      const small = (path: string): string => {
        const read = readRegularFile(path, MAX_GIT_FILE_BYTES);
        if (read === undefined) throw new Error('missing');
        return read.bytes.toString('utf8');
      };
      const head = small(join(gitDir, 'HEAD'));
      const commondir = small(join(gitDir, 'commondir')).trim();
      const link = small(join(worktreePath, '.git')).trim();
      if (head.trim() !== `ref: refs/heads/${branch}`) throw new Error('head');
      if (realOf(resolve(gitDir, commondir)) !== common) throw new Error('commondir');
      if (!link.startsWith('gitdir: ') || realOf(resolve(worktreePath, link.slice('gitdir: '.length))) !== realOf(gitDir)) throw new Error('gitdir');
    } catch {
      throw new VcsError("The run's worktree isn't as Ogden Agents made it, so git didn't run there.", { step: 'worktree' });
    }
    return { env: { GIT_DIR: gitDir, GIT_COMMON_DIR: common, GIT_WORK_TREE: worktreePath }, common };
  };

  return { git, timeout, hooksDir, baseArgs, env, run, must, identityFlags, pinnedWorktree };
}
