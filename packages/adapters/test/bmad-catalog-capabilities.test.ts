/**
 * Reduced mode's capability read in the `bmad-catalog` adapter (entry 4.11,
 * AD-14): `missingCapabilities` judges from the repo's files, never a version
 * string. On the two plain fixtures (`tests/fixtures/bmad-plain`): the older
 * layout lacks both capabilities, the older `bmod` layout lacks the ticket
 * tree; a repo laid out from the pinned upstream fixture lacks none. Only
 * what is wanted is read (a Planning-off project's skills are never
 * scanned), the answer follows the shared order, a missing repo lacks
 * everything, and a read writes nothing.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlainRepo } from '../../../tests/fixtures/bmad-plain/plain-repos.js';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';

/** The skill scan, counted: Planning off must never reach it. */
const scans = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/bmad-catalog/skills.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/bmad-catalog/skills.js')>();
  return {
    ...original,
    scanSkillsAt: async (repoReal: string) => {
      scans.count++;
      return original.scanSkillsAt(repoReal);
    },
  };
});

const { createBmadCatalog } = await import('../src/index.js');
const { missingCapabilities } = await import('../src/bmad-catalog/catalog.js');

const UPSTREAM_SKILLS = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'bmad-upstream', 'skills');

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
  it('the older layout lacks both, the older bmod layout lacks the ticket tree, the pinned baseline lacks none', async () => {
    const catalog = createBmadCatalog();
    const both = ['plain_labels', 'ticket_tree'] as const;
    expect(await catalog.missingCapabilities(keep(createPlainRepo('older')).path, both)).toEqual(['plain_labels', 'ticket_tree']);
    expect(await catalog.missingCapabilities(keep(createPlainRepo('bmod')).path, both)).toEqual(['ticket_tree']);
    expect(await catalog.missingCapabilities(pinnedRepo().path, both)).toEqual([]);
  });

  it('answers only what is wanted, in the shared order, each once', async () => {
    const older = keep(createPlainRepo('older')).path;
    expect(await missingCapabilities(older, ['ticket_tree'])).toEqual(['ticket_tree']);
    expect(await missingCapabilities(older, ['plain_labels'])).toEqual(['plain_labels']);
    expect(await missingCapabilities(older, ['ticket_tree', 'plain_labels', 'ticket_tree'])).toEqual(['plain_labels', 'ticket_tree']);
    expect(await missingCapabilities(older, [])).toEqual([]);
  });

  it('with Planning off (only the ticket tree wanted) the skills are never scanned', async () => {
    const bmod = keep(createPlainRepo('bmod')).path;
    expect(await missingCapabilities(bmod, ['ticket_tree'])).toEqual(['ticket_tree']);
    expect(scans.count).toBe(0);
    expect(await missingCapabilities(bmod, ['plain_labels'])).toEqual([]);
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
