/**
 * Plain-language labels (story 4.5; AD-12 as amended by story 4.14): reading
 * Ogden Agents' label mapping leniently and merging it into the catalog's
 * skills with the `SKILL.md` description as the fallback, on fixture data;
 * then the shipped `skill-labels.json` itself, in EXPERIENCE.md's voice and
 * covering every skill bmad-integration.md surfaces.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_GROUPS } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { applyLabels, readModuleLabels } from '../src/bmad-catalog/labels.js';
import { SKILL_LABELS } from '../src/bmad-catalog/skill-labels.js';

const installed = [
  { name: 'alpha', description: 'Alpha from SKILL.md.' },
  { name: 'beta', description: 'Beta from SKILL.md.' },
  { name: 'gamma', description: '' },
];

describe('readModuleLabels', () => {
  it('reads the entry and each labelled skill', () => {
    const { labels, problems } = readModuleLabels({
      entry: 'alpha',
      skills: {
        alpha: { label: 'Describe your idea', description: 'One sentence.', group: 'planning', next: { skill: 'beta', label: 'Turn this into a spec' } },
        beta: { label: ' Write the spec ' },
      },
    });
    expect(problems).toEqual([]);
    expect(labels.entry).toBe('alpha');
    expect(labels.skills.get('alpha')).toEqual({ label: 'Describe your idea', description: 'One sentence.', group: 'planning', next: { skill: 'beta', label: 'Turn this into a spec' } });
    expect(labels.skills.get('beta')).toEqual({ label: 'Write the spec', description: null, group: null, next: null });
  });

  it('leaves out a bad entry or field, keeps the rest, and reports each, unknown keys included', () => {
    const { labels, problems } = readModuleLabels({
      entry: '../x',
      extra: 1,
      skills: {
        'Bad Name': { label: 'x' },
        ['__proto__']: { label: 'x' },
        nolabel: { label: '  ', group: 'planning' },
        notatable: 'x',
        badfields: { label: 'Fine', description: 3, group: [], next: { skill: 'x/y', label: 'Go' } },
        typos: { label: 'Typos', descripton: 'x', next: { skill: 'good', label: 'Go', lable: 'x' } },
        good: { label: 'Good' },
      },
    });
    expect(labels.entry).toBeNull();
    expect([...labels.skills.keys()]).toEqual(['badfields', 'typos', 'good']);
    expect(labels.skills.get('badfields')).toEqual({ label: 'Fine', description: null, group: null, next: null });
    expect(labels.skills.get('typos')?.next).toEqual({ skill: 'good', label: 'Go' });
    expect(problems).toEqual([
      "skill-labels.json has an unknown key 'extra'",
      "'entry' is not a skill name",
      "'Bad Name' is not a skill name",
      "'__proto__' is not a skill name",
      'skills.nolabel has no label',
      'skills.notatable is not an object',
      'skills.badfields.description is not text',
      'skills.badfields.group is not text',
      'skills.badfields.next needs a skill name and a label',
      "skills.typos has an unknown key 'descripton'",
      "skills.typos.next has an unknown key 'lable'",
    ]);
  });

  it('answers no labels for a mapping that is not an object, or whose skills are not; a null entry is fine', () => {
    expect(readModuleLabels('x').problems).toEqual(['skill-labels.json is not an object']);
    const { labels, problems } = readModuleLabels({ skills: [] });
    expect(labels.skills.size).toBe(0);
    expect(problems).toEqual(["'skills' is not an object"]);
    expect(readModuleLabels({ entry: null, skills: {} }).problems).toEqual([]);
  });
});

describe('readModuleLabels modules (story 4.4)', () => {
  it('reads each module label by code, leaving out and reporting what does not fit', () => {
    const { labels, problems } = readModuleLabels({
      skills: {},
      modules: { method: { label: ' BMad Method ' }, 'Bad Code': { label: 'x' }, nolabel: {}, notatable: 'x', typo: { label: 'Typo', lable: 'x' } },
    });
    expect([...labels.modules]).toEqual([
      ['method', 'BMad Method'],
      ['typo', 'Typo'],
    ]);
    expect(problems).toEqual(["'Bad Code' is not a module code", 'modules.nolabel has no label', 'modules.notatable is not an object', "modules.typo has an unknown key 'lable'"]);
    expect(readModuleLabels({ skills: {}, modules: [] }).problems).toEqual(["'modules' is not an object"]);
    expect(readModuleLabels({ skills: {} }).labels.modules.size).toBe(0);
  });
});

describe('applyLabels', () => {
  const labels = readModuleLabels({
    entry: 'alpha',
    skills: {
      alpha: { label: 'Describe your idea', description: 'Alpha in one sentence.', group: 'planning', next: { skill: 'beta', label: 'Next' } },
      beta: { label: 'Beta label', group: 'someday', next: { skill: 'missing', label: 'Gone' } },
    },
  }).labels;

  it('labels a skill, keeps the SKILL.md description without a sentence, and leaves an unlabelled skill null', () => {
    const { skills, entryAction, labelled } = applyLabels(installed, labels);
    expect(skills).toEqual([
      { name: 'alpha', description: 'Alpha in one sentence.', label: 'Describe your idea', group: 'planning', module: null, installedAt: null, next: { skill: 'beta', label: 'Next' } },
      // An unknown group is kept as written (the Plan page shows it under Other); a next that isn't installed is null.
      { name: 'beta', description: 'Beta from SKILL.md.', label: 'Beta label', group: 'someday', module: null, installedAt: null, next: null },
      { name: 'gamma', description: '', label: null, group: null, module: null, installedAt: null, next: null },
    ]);
    expect(entryAction).toBe('alpha');
    expect(labelled).toBe(true);
  });

  it('falls back entirely when the mapping names none of the installed skills, and drops an entry not installed', () => {
    const { skills, entryAction, labelled } = applyLabels(installed, readModuleLabels({ entry: 'missing', skills: { other: { label: 'x' } } }).labels);
    expect(skills.map((s) => [s.name, s.description, s.label])).toEqual([
      ['alpha', 'Alpha from SKILL.md.', null],
      ['beta', 'Beta from SKILL.md.', null],
      ['gamma', '', null],
    ]);
    expect(entryAction).toBeNull();
    expect(labelled).toBe(false);
  });
});

/** The skills bmad-integration.md "Skills surfaced in the UI" names (a `bmad-agent-*` pattern stands for the agents). */
function surfacedSkills(): string[] {
  const file = join(import.meta.dirname, '..', '..', '..', '_bmad-output', 'initiative-ogden-agents', 'spec-ogden-agents', 'bmad-integration.md');
  const text = readFileSync(file, 'utf8');
  const section = text.slice(text.indexOf('## Skills surfaced in the UI'));
  return [...section.matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1]!);
}

describe('the shipped label mapping (skill-labels.json)', () => {
  const { labels, problems } = readModuleLabels(SKILL_LABELS);

  it('reads with no problems and labels every skill bmad-integration.md surfaces', () => {
    expect(problems).toEqual([]);
    const surfaced = surfacedSkills();
    expect(surfaced.length).toBeGreaterThan(15);
    for (const name of surfaced) expect(labels.skills.has(name), name).toBe(true);
  });

  it('is plain: short labels, one-sentence descriptions, known groups, no dashes or skill names', () => {
    for (const [name, skill] of labels.skills) {
      expect(CATALOG_GROUPS as readonly string[], name).toContain(skill.group);
      expect(skill.label.length, name).toBeLessThanOrEqual(40);
      expect(skill.label, name).not.toMatch(/[.!?]$/);
      expect(skill.description, name).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(skill.description!.length, name).toBeLessThanOrEqual(120);
      for (const text of [skill.label, skill.description!, skill.next?.label ?? '']) {
        expect(text, name).not.toMatch(/[–—]/);
        expect(text, name).not.toMatch(/\bbmad-|_bmad/);
      }
      if (skill.next) expect(labels.skills.has(skill.next.skill), `${name} next`).toBe(true);
    }
  });

  it('names the upstream modules plainly (story 4.4)', () => {
    expect([...labels.modules]).toEqual([
      ['core-tools', 'Core tools'],
      ['method', 'BMad Method'],
    ]);
    for (const [code, label] of labels.modules) {
      expect(label.length, code).toBeLessThanOrEqual(40);
      expect(label, code).not.toMatch(/[–—.!?]|\bbmad-|_bmad/);
    }
  });

  it("starts from an idea with the brief, and uses EXPERIENCE.md's own words where it gives them", () => {
    expect(labels.entry).toBe('bmad-product-brief');
    expect(labels.skills.get('bmad-product-brief')?.label).toBe('Describe your idea');
    expect(labels.skills.get('bmad-build-auto')?.label).toBe('Build next story');
    expect(labels.skills.get('bmad-spec')?.next).toEqual({ skill: 'bmad-ticket', label: 'Turn this spec into tickets' });
  });
});
