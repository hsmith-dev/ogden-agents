/**
 * A stand-in for the verified pinned BMad Method copy (entry 4.12, the label
 * trust): `file` answers a path below `skillsDir` (the copy's `skills/`) when
 * it is a regular file there, as the real source's `file` does once the copy
 * is ready. A test points it at a folder it wrote (or at
 * `tests/fixtures/bmad-upstream/skills`), so the catalog labels exactly the
 * skills whose folders equal that folder's.
 *
 * Plain Node only, so Vitest and Playwright specs can both use it.
 */
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PinnedCopy {
  file(relPath: string): string | undefined;
}

/** The pinned copy whose `skills/` is `skillsDir`. */
export function pinnedCopyAt(skillsDir: string): PinnedCopy {
  return {
    file(relPath) {
      const path = join(skillsDir, ...relPath.split('/'));
      try {
        return lstatSync(path).isFile() ? path : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/** Writes `files` (`/`-separated path below `skillsDir` → content) and answers the pinned copy there. */
export function writePinnedCopy(skillsDir: string, files: Readonly<Record<string, string>>): PinnedCopy {
  for (const [path, content] of Object.entries(files)) {
    const file = join(skillsDir, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return pinnedCopyAt(skillsDir);
}
