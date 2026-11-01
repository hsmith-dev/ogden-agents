/**
 * A project's `.git` file (a "gitdir: <path>" pointer) is followed only for
 * the two standard layouts (user decision 2026-11-01; AD-37; story 8.4
 * review #12), so the Changes panel, snapshots and a commit never read or
 * write a repository the pointer was made to name:
 *
 * - a linked worktree: it points at `<repo>/.git/worktrees/<name>`, whose
 *   `gitdir` file points back at this `.git` file and whose `commondir`
 *   names `<repo>/.git`;
 * - a submodule: it points inside `<super>/.git/modules/` (`<name...>`,
 *   nested ones too), and that folder's `core.worktree`, when set, is this
 *   project.
 *
 * Every path is compared by its real path. A path the pointer files name,
 * or a link on the way, that names another computer (`//host/share`,
 * `\\host\share`) is refused by its spelling and never looked up: on
 * Windows that lookup is a network request. Anything else is refused with
 * {@link GIT_POINTER_UNUSUAL_MESSAGE}. A `.git` folder is left as it was.
 */
import { lstatSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { isRealFolder, isRemotePathShape, localRealpathSync, RemotePathError, VcsError } from '@ogden-agents/core';
import { GIT_POINTER_UNUSUAL_MESSAGE } from '@ogden-agents/shared';
import { readRegularFile } from '../fs-safe.js';
import { isInside, realOf } from './checks.js';
import { MAX_GIT_FILE_BYTES } from './runner.js';

/** What git will use for a folder, as checked: its git folder and the repository's shared one. */
export interface GitPointer {
  /** The folder holding the `.git` entry. */
  top: string;
  /** The real git folder: `<top>/.git`, or where its pointer leads. */
  gitDir: string;
  /** The real shared git folder, for a pointer (a linked worktree's `<repo>/.git`, a submodule's own); `undefined` for a `.git` folder. */
  common?: string | undefined;
}

/** Reads `core.worktree` from a git folder's own `config` file, `undefined` when unset. */
export type ReadCoreWorktree = (gitDir: string) => Promise<string | undefined>;

const refuse = (reason: string): never => {
  throw new VcsError(GIT_POINTER_UNUSUAL_MESSAGE, { step: 'gitdir', reason });
};

/**
 * The real path of `path` (as `realOf`, `resolve(path)` when it is
 * missing), refused when it, or a link on the way, names another computer.
 */
function realLocal(path: string): string {
  if (isRemotePathShape(path)) return refuse('remote');
  try {
    return localRealpathSync(path);
  } catch (error) {
    return error instanceof RemotePathError ? refuse('remote') : resolve(path);
  }
}

/** A path read from a git file, resolved from `from` as git reads it; refused by its spelling when it names another computer. */
const named = (from: string, text: string): string => (isRemotePathShape(text) ? refuse('remote') : realLocal(resolve(from, text)));

/** A small git file's text, as a regular file of its own (never a link, a FIFO or a device), or `undefined` when missing. */
function small(path: string): string | undefined {
  try {
    return readRegularFile(path, MAX_GIT_FILE_BYTES)?.bytes.toString('utf8');
  } catch {
    return refuse('not_regular');
  }
}

/** The nearest `.git` entry from `folder` up, as git's discovery finds it; `undefined` when there is none. */
function nearestGit(folder: string): { top: string; kind: 'folder' | 'file' } | undefined {
  let dir = realOf(folder);
  for (;;) {
    const entry = join(dir, '.git');
    let stat;
    try {
      stat = lstatSync(entry);
    } catch {
      stat = undefined;
    }
    if (stat !== undefined) {
      if (stat.isDirectory()) return { top: dir, kind: 'folder' };
      if (stat.isFile()) return { top: dir, kind: 'file' };
      if (stat.isSymbolicLink()) {
        // A link to a folder is git's folder as before; a link to anything else (or to nothing) is not a pointer Ogden reads.
        let linked = false;
        try {
          linked = statSync(localRealpathSync(entry)).isDirectory();
        } catch {
          linked = false;
        }
        return linked ? { top: dir, kind: 'folder' } : refuse('link');
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The checked git folders for `folder`'s nearest `.git`, or `undefined`
 * when it has none (git then finds no repository either). A `.git` file
 * whose pointer isn't a standard linked worktree or submodule throws
 * {@link VcsError} with {@link GIT_POINTER_UNUSUAL_MESSAGE}.
 */
export async function checkGitPointer(folder: string, readCoreWorktree: ReadCoreWorktree): Promise<GitPointer | undefined> {
  const found = nearestGit(folder);
  if (found === undefined) return undefined;
  const { top } = found;
  const dotGit = join(top, '.git');
  if (found.kind === 'folder') return { top, gitDir: realOf(dotGit) };

  const text = small(dotGit) ?? refuse('missing');
  const line = text.split(/\r?\n/)[0] ?? '';
  if (!line.startsWith('gitdir: ')) return refuse('not_gitdir');
  const pointer = line.slice('gitdir: '.length).trim();
  if (pointer === '' || pointer.includes('\0')) return refuse('empty');
  // Relative to the `.git` file's folder, as git reads it.
  const target = named(top, pointer);
  if (!isRealFolder(target)) return refuse('not_folder');

  // A linked worktree: `<repo>/.git/worktrees/<name>`, or of a bare repository `<name>.git/worktrees/<name>`
  // (a bare repo has its own HEAD, objects and refs; the back-link and commondir checks below still prove the pairing).
  const admin = dirname(target);
  const repoGit = dirname(admin);
  const bareRepo = (dir: string) => /.\.git$/i.test(basename(dir)) && small(join(dir, 'HEAD')) !== undefined && isRealFolder(join(dir, 'objects')) && isRealFolder(join(dir, 'refs'));
  if (basename(admin) === 'worktrees' && (basename(repoGit) === '.git' || bareRepo(repoGit)) && isRealFolder(repoGit)) {
    const back = small(join(target, 'gitdir'));
    if (back === undefined || named(target, back.trim()) !== dotGit) return refuse('worktree_back_link');
    const commondir = small(join(target, 'commondir'));
    if (commondir === undefined || named(target, commondir.trim()) !== repoGit) return refuse('worktree_commondir');
    return { top, gitDir: target, common: repoGit };
  }

  // A submodule: inside `<super>/.git/modules/`.
  const marker = `${sep}.git${sep}modules${sep}`;
  const at = target.indexOf(marker);
  if (at > 0) {
    const superGit = target.slice(0, at + `${sep}.git`.length);
    const modules = join(superGit, 'modules');
    if (isRealFolder(superGit) && isRealFolder(modules) && target !== modules && isInside(modules, target)) {
      const worktree = await readCoreWorktree(target);
      if (worktree !== undefined && named(target, worktree) !== top) return refuse('submodule_worktree');
      return { top, gitDir: target, common: target };
    }
  }
  return refuse('unusual');
}
