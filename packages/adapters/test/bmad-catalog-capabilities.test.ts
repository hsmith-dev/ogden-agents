/**
 * Reduced mode's capability read in the `bmad-catalog` adapter (entry 4.11,
 * AD-14): `missingCapabilities` judges from the repo's files, never a version
 * string. On the two plain fixtures (`tests/fixtures/bmad-plain`): the older
 * layout lacks both capabilities, and so does the older `bmod` layout (its
 * genuine but older skills are not the verified pinned copy's, so they get
 * no labels: entry 4.12); a repo laid out from the pinned upstream fixture,
 * read against that fixture as the verified copy, lacks none. Only
 * what is wanted is read (a Planning-off project's skills are never
 * scanned), the answer follows the shared order, a missing repo lacks
 * everything, and a read writes nothing.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlainRepo } from '../../../tests/fixtures/bmad-plain/plain-repos.js';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { pinnedCopyAt } from '../../../tests/fixtures/pinned-copy.js';

/** The skill scan, counted: Planning off must never reach it. */
const scans = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/bmad-catalog/skills.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/bmad-catalog/skills.js')>();
  return {
    ...original,
    scanSkillFoldersAt: async (repoReal: string) => {
      scans.count++;
      return original.scanSkillFoldersAt(repoReal);
    },
  };
});

const { createBmadCatalog } = await import('../src/index.js');
const { missingCapabilities } = await import('../src/bmad-catalog/catalog.js');
const { createSkillVerifier } = await import('../src/bmad-catalog/verified.js');

const UPSTREAM_SKILLS = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'bmad-upstream', 'skills');
/** The pinned upstream fixture as the verified copy (entry 4.12). */
const VERIFIED = { verifier: createSkillVerifier(pinnedCopyAt(UPSTREAM_SKILLS)) };

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const made of repos.splice(0)) made.remove();
  scans.count = 0;
});

const keep = (made: FakeBmadRepo) => {
  repos.push(made);
  return made;
};

/** A repo set up from the pinned upstream fixture: its skills in `.claude/skills`, `bmad`'s scripts as `_bmad/scripts`. */
function pinnedRepo(): FakeBmadRepo {
  const made = keep(createFakeBmadRepo({ bmad: false, files: { '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n' }, prefix: 'ogden-agents-pinned-' }));
  mkdirSync(join(made.path, '.claude'), { recursive: true });
  cpSync(UPSTREAM_SKILLS, join(made.path, '.claude', 'skills'), { recursive: true });
  cpSync(join(UPSTREAM_SKILLS, 'bmad', 'scripts'), join(made.path, '_bmad', 'scripts'), { recursive: true });
  return made;
}

describe('missingCapabilities (entry 4.11)', () => {
  it('the older layout and the older bmod layout lack both, the pinned baseline lacks none', async () => {
    const catalog = createBmadCatalog({ source: pinnedCopyAt(UPSTREAM_SKILLS) });
    const both = ['plain_labels', 'ticket_tree'] as const;
    expect(await catalog.missingCapabilities(keep(createPlainRepo('older')).path, both)).toEqual(['plain_labels', 'ticket_tree']);
    // Genuine but older upstream skills are not the verified copy's: no labels (entry 4.12).
    expect(await catalog.missingCapabilities(keep(createPlainRepo('bmod')).path, both)).toEqual(['plain_labels', 'ticket_tree']);
    expect(await catalog.missingCapabilities(pinnedRepo().path, both)).toEqual([]);
    // Without a verified copy nothing is labelled (fail closed).
    expect(await createBmadCatalog().missingCapabilities(pinnedRepo().path, both)).toEqual(['plain_labels']);
  });

  it('answers only what is wanted, in the shared order, each once', async () => {
    const older = keep(createPlainRepo('older')).path;
    expect(await missingCapabilities(older, ['ticket_tree'])).toEqual(['ticket_tree']);
    expect(await missingCapabilities(older, ['plain_labels'])).toEqual(['plain_labels']);
    expect(await missingCapabilities(older, ['ticket_tree', 'plain_labels', 'ticket_tree'])).toEqual(['plain_labels', 'ticket_tree']);
    expect(await missingCapabilities(older, [])).toEqual([]);
  });

  it('with Planning off (only the ticket tree wanted) the skills are never scanned', async () => {
    const pinned = pinnedRepo().path;
    expect(await missingCapabilities(pinned, ['ticket_tree'], VERIFIED)).toEqual([]);
    expect(scans.count).toBe(0);
    expect(await missingCapabilities(pinned, ['plain_labels'], VERIFIED)).toEqual([]);
    expect(scans.count).toBe(1);
  });

  it('a missing, relative or empty repo path lacks every wanted capability; nothing throws', async () => {
    for (const path of ['/no/such/repo', 'relative/repo', '']) {
      expect(await missingCapabilities(path, ['plain_labels', 'ticket_tree'])).toEqual(['plain_labels', 'ticket_tree']);
    }
  });

  it('reads only: the repos are unchanged', async () => {
    for (const made of [keep(createPlainRepo('older')), keep(createPlainRepo('bmod')), pinnedRepo()]) {
      const before = made.hash();
      await missingCapabilities(made.path, ['plain_labels', 'ticket_tree']);
      expect(made.hash()).toBe(before);
    }
  });
});
