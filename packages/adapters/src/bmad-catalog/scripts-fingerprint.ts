/**
 * The fingerprint of a project's own BMad Method scripts (story 4.13, user
 * decision 2026-10-04): the verified `tickets.py` imports and runs the
 * project's `_bmad/scripts/config_utils.py`, so the per-project trust is
 * bound to the contents of `_bmad/scripts/` as the user allowed them. The
 * whole folder is hashed (a module `config_utils.py` imports from beside it
 * counts too), by the pinned source's rule (`bmad-source/folder-hash.ts`:
 * regular files only, paths and LF-normalized contents, sorted, bounded,
 * never following a link).
 *
 * `__pycache__` folders are left out: the server runs Python with its
 * bytecode cache in Ogden Agents' own folder (`PYTHONPYCACHEPREFIX`), so
 * Python never reads a repo's `__pycache__`, and a user's own runs of the
 * scripts (which write one) don't count as a change.
 *
 * `'none'` when the repo has no `_bmad/scripts/` (nothing of the project's
 * runs); `undefined` when it can't be hashed: `_bmad` or `scripts` is a link
 * or not a folder, or anything below is a link or a special file, or past
 * the bounds. Core counts `undefined` as changed, so nothing runs. Never
 * rejects.
 */
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { BMAD_SCRIPTS_NONE } from '@ogden-agents/core';
import { hashFolder } from '../bmad-source/folder-hash.js';

const PYCACHE: ReadonlySet<string> = new Set(['__pycache__']);

/** What a missing entry answers, and anything else at that name. */
async function kindAt(path: string): Promise<'missing' | 'folder' | 'other'> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() ? 'folder' : 'other';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'other';
  }
}

export async function scriptsFingerprint(repoPath: string): Promise<string | undefined> {
  if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return undefined;
  for (const path of [join(repoPath, '_bmad'), join(repoPath, '_bmad', 'scripts')]) {
    const kind = await kindAt(path);
    if (kind === 'missing') return BMAD_SCRIPTS_NONE;
    if (kind === 'other') return undefined;
  }
  return hashFolder(join(repoPath, '_bmad', 'scripts'), { skipFolders: PYCACHE });
}
