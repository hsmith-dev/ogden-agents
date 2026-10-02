/**
 * The lock (story 4.14, AD-13): the upstream BMad Method and bmad-loop
 * commits this release pins, each with the content hash of the files Ogden
 * Agents uses (`include`). It ships inside the server bundle; the package
 * ships no BMad files. `scripts/bmad-lock.mjs --check` re-downloads each pin
 * in CI and fails when a hash or the commit's place in upstream's history
 * no longer holds. Moving a pin is a maintainer's edit of `bmad-lock.json`
 * (CONTRIBUTING.md).
 */
import { BmadLock } from '@ogden-agents/shared';
import raw from './bmad-lock.json' with { type: 'json' };

/** The pinned sources, checked against the shared schema when the module loads. */
export const BMAD_LOCK: BmadLock = BmadLock.parse(raw);

/** A source's name in the lock, and its folder in `<data>/bmad/`. */
export type BmadSourceName = keyof BmadLock['sources'];

export { tarballUrl } from './archive.js';
