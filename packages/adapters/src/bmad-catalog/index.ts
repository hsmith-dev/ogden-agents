/**
 * `bmad-catalog` (story 10.3): the real `BmadCatalogPort`. `detect` answers
 * whether a project's repo already has BMad Method's `_bmad/` and
 * `_bmad-output/` folders (E10-R5, AD-22); `skills` (story 4.1) is the
 * catalog's installed skills, scanned in `skills.ts`, so this file keeps
 * `detect`'s lstat-only guarantee below. Setup's status and setup itself
 * (entry 4.3) live in `setup.ts`, built from the options.
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
import { CatalogSkill, type Catalog } from '@ogden-agents/shared';
import { createBmadSetup, type BmadSetupOptions } from './setup.js';
import { scanSkills } from './skills.js';

export type { BmadSetupOptions } from './setup.js';

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

/**
 * The catalog of a repo until entry 4.4 reads its modules and agents and
 * entry 4.5 applies Ogden Agents' label mapping (`skill-labels.json`, story
 * 4.14) (story 4.2): the installed skills (`scanSkills`, read-only, only
 * inside the repo) with every metadata field `null`, no modules or agents,
 * no entry action, and no capability detected yet.
 */
async function catalogOf(repoPath: string): Promise<Catalog> {
  const skills = await scanSkills(repoPath);
  return {
    modules: [],
    skills: skills.map((skill) => CatalogSkill.parse(skill)),
    agents: [],
    entryAction: null,
    capabilities: { plain_labels: false, ticket_tree: false },
  };
}

/**
 * The `bmad-catalog` adapter: read-only detection of a repo's BMad Method
 * folders, its installed skills and its catalog, and, with `options` (the
 * script runner, the work folder and the server's pinned BMad Method source), BMad Method's
 * setup status and setup (entry 4.3). Without them those two reject.
 */
export function createBmadCatalog(options?: BmadSetupOptions): BmadCatalogPort {
  const setup = options === undefined ? undefined : createBmadSetup(options);
  const unconfigured = () => Promise.reject(new Error('BMad Method setup needs the script runner (entry 4.3)'));
  return {
    catalog: catalogOf,
    setupStatus: setup === undefined ? unconfigured : setup.setupStatus,
    setup: setup === undefined ? unconfigured : setup.setup,
    async detect(repoPath): Promise<BmadRepoDetection> {
      // An empty or relative path would resolve against the server's own folder: answer nothing.
      if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return { hasBmad: false, hasOutput: false };
      // The root itself must be a real folder: a root swapped for a link is never followed into.
      if (!(await isRealFolderAt(repoPath))) return { hasBmad: false, hasOutput: false };
      const [hasBmad, hasOutput] = await Promise.all([isRealFolder(repoPath, BMAD_DIR), isRealFolder(repoPath, BMAD_OUTPUT_DIR)]);
      return { hasBmad, hasOutput };
    },
    skills: scanSkills,
  };
}

