/**
 * `bmad-catalog` (story 10.3): the real `BmadCatalogPort`. `detect` answers
 * whether a project's repo already has BMad Method's `_bmad/` and
 * `_bmad-output/` folders (E10-R5, AD-22); `skills` (story 4.1) is the
 * catalog's installed skills, scanned in `skills.ts`, and `catalog` (story
 * 4.4) is built in `catalog.ts`, so this file keeps
 * `detect`'s lstat-only guarantee below. Setup's status and setup itself
 * (entry 4.3) live in `setup.ts`, built from the options, and
 * `readDocument` (story 4.7) in `document.ts`, `missingCapabilities`
 * (entry 4.11) in `catalog.ts`.
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
import type { Catalog } from '@ogden-agents/shared';
import { buildCatalog, missingCapabilities } from './catalog.js';
import { readDocument } from './document.js';
import { scriptsFingerprint } from './scripts-fingerprint.js';
import { createBmadSetup, type BmadSetupOptions } from './setup.js';
import { scanSkills } from './skills.js';
import { createSkillVerifier, type VerifiedSource } from './verified.js';

export type { BmadSetupOptions } from './setup.js';
export type { VerifiedSource } from './verified.js';

/** The catalog without setup: only the pinned source its labels are verified against (entry 4.12). */
export interface BmadCatalogReadOptions {
  readonly source: VerifiedSource;
}

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
 * The `bmad-catalog` adapter: read-only detection of a repo's BMad Method
 * folders, its installed skills and its catalog, and, with `options` (the
 * script runner, the work folder and the server's pinned BMad Method source), BMad Method's
 * setup status and setup (entry 4.3). Without them those two reject.
 *
 * The catalog (story 4.4): the repo's installed modules, skills and agents,
 * the label mapping's labels and entry action, and its capabilities, rebuilt
 * from the repo's metadata on every read (`catalog.ts`, read-only, only
 * inside the repo). Labels go only to skills whose folder is the verified
 * pinned copy's (entry 4.12, `verified.ts`): without `options` (no source)
 * none is labelled. `options` with only a `source` labels without setup.
 */
export function createBmadCatalog(options?: BmadSetupOptions | BmadCatalogReadOptions): BmadCatalogPort {
  const setup = options === undefined || !('runner' in options) ? undefined : createBmadSetup(options);
  const verifier = createSkillVerifier(options?.source);
  const catalogOf = (repoPath: string): Promise<Catalog> => buildCatalog(repoPath, { verifier });
  const unconfigured = () => Promise.reject(new Error('BMad Method setup needs the script runner (entry 4.3)'));
  return {
    catalog: catalogOf,
    setupStatus: setup === undefined ? unconfigured : setup.setupStatus,
    setup: setup === undefined ? unconfigured : setup.setup,
    // Reduced mode (entry 4.11): read-only, only what is asked for (`catalog.ts`).
    missingCapabilities: (repoPath, wanted) => missingCapabilities(repoPath, wanted, { verifier }),
    async detect(repoPath): Promise<BmadRepoDetection> {
      // An empty or relative path would resolve against the server's own folder: answer nothing.
      if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return { hasBmad: false, hasOutput: false };
      // The root itself must be a real folder: a root swapped for a link is never followed into.
      if (!(await isRealFolderAt(repoPath))) return { hasBmad: false, hasOutput: false };
      const [hasBmad, hasOutput] = await Promise.all([isRealFolder(repoPath, BMAD_DIR), isRealFolder(repoPath, BMAD_OUTPUT_DIR)]);
      return { hasBmad, hasOutput };
    },
    skills: scanSkills,
    // A document a planning session wrote (story 4.7): confined to the real repo and output folder (`document.ts`).
    readDocument: (repoPath, outputFolder, path) => readDocument(repoPath, outputFolder, path),
    // The project's own scripts, for the trust bound to their contents (story 4.13).
    scriptsFingerprint,
  };
}

