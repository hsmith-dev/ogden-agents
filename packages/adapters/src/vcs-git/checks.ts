/**
 * `vcs-git`'s options and the checks it makes before using a name, a path or an
 * object store (story 5.10 split `index.ts`): pure, no git is run here.
 */
import { existsSync, lstatSync, readdirSync, realpathSync, type Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { VcsError } from '@ogden-agents/core';

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
  /**
   * The folder of every run's folder (`<data>/r`; story 5.6). A run's own
   * object store is `<runsRoot>/<run8>/objects`, found from its `ogden/<run8>/…`
   * branch name: reads of that branch take it as an alternate, and a rebase
   * or patch in its worktree writes there, never to the repo's objects.
   */
  runsRoot?: string;
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
export const REVISION = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
/** A run's branch: `ogden/<run8>/…`. */
export const RUN_BRANCH = /^ogden\/([a-z2-7]{8})\//;
/** The most bytes of new objects approve imports from one run (a pack held in memory). */
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
/** A branch name as Ogden makes them, and as git accepts them. */
export const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function checkBranch(branch: string): string {
  if (!BRANCH.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock') || branch.includes('@{')) {
    throw new VcsError('That is not a branch name Ogden Agents can use.', { step: 'branch' });
  }
  return branch;
}

export function checkRevision(revision: string): string {
  if (!REVISION.test(revision)) throw new VcsError('That is not a commit Ogden Agents can use.', { step: 'revision' });
  return revision;
}

export function checkPath(path: string): string {
  if (!isAbsolute(path) || path.includes('\0')) throw new VcsError('That is not a folder Ogden Agents can use.', { step: 'path' });
  return path;
}

/** A repo-relative path for `git add -- <path>`: no `..`, never absolute. */
export function checkRelative(path: string): string {
  if (path === '' || isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).includes('..')) throw new VcsError('That is not a project file Ogden Agents can stage.', { step: 'add' });
  return path;
}

/** Config git must not take from anywhere for a rebase or a patch: no signing program, no ref rewriting elsewhere. */
export const SAFE_CONFIG = ['-c', 'commit.gpgsign=false', '-c', 'rebase.updateRefs=false', '-c', 'core.sshCommand=false'];

/** The real path of `dir`, or its resolved path when it doesn't exist. */
export function realOf(dir: string): string {
  try {
    return realpathSync.native(dir);
  } catch {
    return resolve(dir);
  }
}

/** Whether `path` is `root` or inside it. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Whether the store holds only plain files and folders and no alternates
 * list: the agent writes it, and git would follow `info/alternates` to any
 * folder, or hang on a FIFO. Anything else and the store is not used.
 */
export const storeIsPlain = (store: string): boolean => {
  try {
    // The agent's git is writing here while this reads: a temporary object file renamed, or a folder gone, between the
    // listing and the check is nothing to refuse (it is no longer there); only what is still there and not plain is.
    const gone = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
    const walk = (folder: string, depth: number): boolean => {
      if (depth > 4) return false;
      let entries: Dirent[];
      try {
        entries = readdirSync(folder, { withFileTypes: true });
      } catch (error) {
        if (gone(error)) return true;
        throw error;
      }
      for (const entry of entries) {
        const full = join(folder, entry.name);
        try {
          if (entry.isDirectory()) {
            if (!lstatSync(full).isDirectory() || !walk(full, depth + 1)) return false;
          } else if (!entry.isFile() || lstatSync(full).isSymbolicLink() || (depth === 1 && folder.endsWith('info'))) return false;
        } catch (error) {
          if (!gone(error)) throw error;
        }
      }
      return true;
    };
    return !existsSync(join(store, 'info', 'alternates')) && !existsSync(join(store, 'info', 'http-alternates')) && walk(store, 0);
  } catch {
    return false;
  }
};
