/**
 * `bmad-catalog` (story 10.3): the real `BmadCatalogPort`. So far it answers
 * only `detect`: whether a project's repo already has BMad Method's
 * `_bmad/` and `_bmad-output/` folders (E10-R5, AD-22). Epic 4 adds the
 * catalog itself here.
 *
 * Read-only guarantee: `detect` first `lstat`s `repoPath` itself, which must
 * be a real folder (a repo root that has become a symlink or junction answers
 * both false, never followed into), then makes one `lstat` call per name, on
 * `<repoPath>/_bmad` and `<repoPath>/_bmad-output` (two constant names
 * joined to the workspace's stored real path, never request input). It
 * opens, lists, reads, writes, renames and deletes nothing, and never
 * follows a link: `lstat` describes the entry itself, so a symlink (or a
 * Windows junction) to a folder, a plain file, or anything else answers
 * `false`, and only a real folder answers `true`. Any file-system error (a
 * missing or deleted repo, no permission, a bad path) answers `false`.
 * A test checks this file imports no other `fs` function.
 */
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { BmadCatalogPort, BmadRepoDetection } from '@ogden-agents/core';

/** The folder BMad Method's installer creates at a repo's root. */
const BMAD_DIR = '_bmad';
/** The folder BMad Method writes its plans and tickets to. */
const BMAD_OUTPUT_DIR = '_bmad-output';

/** Whether `path` is a real folder (not a link to one); `false` on any error. */
async function isRealFolderAt(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `repoPath/name` is a real folder (not a link to one); `false` on any error. */
const isRealFolder = (repoPath: string, name: string): Promise<boolean> => isRealFolderAt(join(repoPath, name));

/** The `bmad-catalog` adapter: read-only detection of a repo's BMad Method folders. */
export function createBmadCatalog(): BmadCatalogPort {
  return {
    async detect(repoPath): Promise<BmadRepoDetection> {
      // An empty or relative path would resolve against the server's own folder: answer nothing.
      if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return { hasBmad: false, hasOutput: false };
      // The root itself must be a real folder: a root swapped for a link is never followed into.
      if (!(await isRealFolderAt(repoPath))) return { hasBmad: false, hasOutput: false };
      const [hasBmad, hasOutput] = await Promise.all([isRealFolder(repoPath, BMAD_DIR), isRealFolder(repoPath, BMAD_OUTPUT_DIR)]);
      return { hasBmad, hasOutput };
    },
  };
}

