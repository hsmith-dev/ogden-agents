/**
 * Which epics' retrospective files changed (epic 7, story 7.4): a rerun of
 * `tickets.py status` shows no change when only an epic's
 * `*-retrospective.md` is written, so the watch also keeps a small signature
 * per epic (each such file's name, size and modified time) and reports the
 * epics whose signature changed. Only names and `lstat`s are read, never file
 * contents; an epic folder that is a link, one whose real path leaves the
 * output folder (a linked parent), or any name that is not one plain folder
 * name, is skipped (so nothing outside the output folder is touched). Only
 * regular files count, as the reader reads only those.
 */
import { lstat, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { boundedNames } from '../bounded-names.js';
import { EPIC_SLUG_PATTERN, RETROSPECTIVE_FILE_SUFFIX, type TicketsResponse } from '@ogden-agents/shared';

/** The most epics looked at in one read. */
const MAX_EPICS = 200;
/** The most directory entries looked at in one epic folder. */
const MAX_ENTRIES = 2000;
/** The most retrospective files looked at (`lstat`) in one epic folder. */
const MAX_FILES = 20;

/** Each epic's signature (`''` when it has no retrospective file), by its name. */
export async function retrospectiveSignatures(root: string, tree: Pick<TicketsResponse, 'folder' | 'epics'>): Promise<Map<string, string>> {
  const signatures = new Map<string, string>();
  if (tree.folder === null || !EPIC_SLUG_PATTERN.test(tree.folder)) return signatures;
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return signatures;
  }
  for (const epic of tree.epics.slice(0, MAX_EPICS)) {
    if (!EPIC_SLUG_PATTERN.test(epic.slug)) continue;
    const folder = join(root, tree.folder, epic.slug);
    const parts: string[] = [];
    try {
      // A real folder whose real path stays inside the output folder (a linked parent leads out of it).
      if ((await lstat(folder)).isDirectory() && (await realpath(folder)).startsWith(`${rootReal}${sep}`)) {
        const names = (await boundedNames(folder, RETROSPECTIVE_FILE_SUFFIX, MAX_ENTRIES)).slice(0, MAX_FILES);
        for (const name of names) {
          const entry = await lstat(join(folder, name));
          if (entry.isFile()) parts.push(`${name}:${entry.size}:${Math.round(entry.mtimeMs)}`);
        }
      }
    } catch {
      // A folder that went meanwhile has no retrospective now.
    }
    signatures.set(epic.slug, parts.join('|'));
  }
  return signatures;
}

/** The epics whose signature differs between `before` and `after` (a new epic with a file counts), in `after`'s order. */
export function changedRetrospectives(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([slug, signature]) => (before.get(slug) ?? '') !== signature).map(([slug]) => slug);
}
