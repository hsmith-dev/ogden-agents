/**
 * The label trust (entry 4.12; 4.6 security review S1): Ogden Agents' label
 * mapping is keyed by skill name, so a repo's own skill that only uses a
 * mapped name must never get Ogden's label, group, next step or the entry
 * action. A mapped skill counts as verified only when every installed copy
 * of it (each skills folder's entry of that name, `.agents/skills` and
 * `.claude/skills`) has the content of the verified pinned copy's folder of
 * the same name (`hashFolder`: regular files only, LF-normalized, sorted
 * paths; a link or any other entry inside, or one file added or changed, is
 * not verified), and no other folder's `SKILL.md` claims the name. Each repo
 * folder is hashed within the pinned folder's own counts (its entries, and
 * twice its bytes for CRLF), one folder at a time.
 *
 * Fail closed: without a source, or while the pinned copy isn't downloaded
 * (`file` answers nothing), no skill is verified. Disk only, never the
 * network; the pinned side is hashed once per folder (it is immutable per
 * commit), the repo's on every read. Nothing throws for the repo's state.
 */
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BmadSourcePort } from '@ogden-agents/core';
import { hashFolderWithCounts, type FolderHash } from '../bmad-source/index.js';
import { inside, type FoundSkill } from './skills.js';

/** What the trust reads of the pinned source: a file's path in the verified copy, only once it is ready. */
export type VerifiedSource = Pick<BmadSourcePort, 'file'>;

/** The skills of a repo whose folder is the verified pinned copy's. */
export interface SkillVerifier {
  /** The names among `candidates` whose installed folder (in `found`) equals the pinned copy's. */
  verified(repoReal: string, found: readonly FoundSkill[], candidates: ReadonlySet<string>): Promise<Set<string>>;
}

/** A verifier that verifies nothing: no pinned source. */
export const UNVERIFIED: SkillVerifier = { verified: async () => new Set() };

/** The label trust over `source` (see the file's comment); {@link UNVERIFIED} without one. */
export function createSkillVerifier(source: VerifiedSource | undefined): SkillVerifier {
  if (source === undefined) return UNVERIFIED;
  /** The pinned folder's hash and counts, by its path: only ones that were read (a missing copy is asked again next time). */
  const pinned = new Map<string, FolderHash>();

  const pinnedHash = async (name: string): Promise<FolderHash | undefined> => {
    let skillFile: string | undefined;
    try {
      skillFile = source.file(`${name}/SKILL.md`);
    } catch {
      return undefined;
    }
    if (skillFile === undefined) return undefined;
    const folder = dirname(skillFile);
    const cached = pinned.get(folder);
    if (cached !== undefined) return cached;
    const hash = await hashFolderWithCounts(folder);
    if (hash !== undefined) pinned.set(folder, hash);
    return hash;
  };

  /** The installed folder's hash, when its real path stays inside the repo; `undefined` otherwise. */
  const installedHash = async (repoReal: string, folder: readonly string[], expected: FolderHash): Promise<string | undefined> => {
    const path = join(repoReal, ...folder);
    try {
      // The skills folder may be reached through a link inside the repo (as `scanSkills` reads it); the skill folder itself never is.
      const parent = await realpath(dirname(path));
      if (!inside(parent, repoReal)) return undefined;
      return await hashFolderWithCounts(join(parent, folder.at(-1)!), { maxEntries: expected.entries, maxBytes: 2 * expected.bytes }).then((hash) => hash?.hash);
    } catch {
      return undefined;
    }
  };

  return {
    async verified(repoReal, found, candidates) {
      const names = new Set<string>();
      // One folder at a time: the repo side's reads stay within one pinned folder's bounds at once.
      for (const entry of found) {
        if (!candidates.has(entry.skill.name) || entry.contested) continue;
        const expected = await pinnedHash(entry.skill.name);
        if (expected === undefined) continue;
        let every = true;
        for (const folder of entry.folders) {
          if ((await installedHash(repoReal, folder, expected)) !== expected.hash) {
            every = false;
            break;
          }
        }
        if (every) names.add(entry.skill.name);
      }
      return names;
    },
  };
}
