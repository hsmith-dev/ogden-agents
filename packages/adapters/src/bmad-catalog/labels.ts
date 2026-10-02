/**
 * Plain-language labels (story 4.5, E4-R4; AD-12 as amended by story 4.14):
 * reading Ogden Agents' own label mapping (`skill-labels.json`, keyed by
 * skill name, typed in `skill-labels.ts`) and putting it on the catalog's
 * skills. Entry 4.4 calls `applyLabels` from `catalogOf`; this file names no
 * skill (the names are data in the JSON file).
 *
 * The mapping: `entry` (the skill behind "Start from an idea", or `null`)
 * and `skills`, per skill a `label`, an optional one-sentence `description`,
 * a `group` and an optional `next = { skill, label }`. Reading is lenient
 * per entry: a bad entry or field is left out and reported in `problems`,
 * and the rest still counts (AD-14: nothing fails silently); an unknown key
 * (a misspelt field, say) is reported too. A skill the mapping doesn't name
 * keeps its `SKILL.md` description and `null` label, group and next, which
 * the Plan page shows as the name and description.
 */
import type { InstalledSkill } from '@ogden-agents/core';
import { CatalogSkill, SKILL_NAME_PATTERN, type CatalogNext, type SkillName } from '@ogden-agents/shared';

/** The mapping file's name, beside this file. */
export const LABELS_FILE = 'skill-labels.json';

/** One skill's labels, read. */
export interface SkillLabels {
  readonly label: string;
  /** The one-sentence description, or `null` to keep the `SKILL.md` one. */
  readonly description: string | null;
  /** The UI group as written (an unknown one shows as Other). */
  readonly group: string | null;
  readonly next: CatalogNext | null;
}

/** The label mapping, read. */
export interface LabelMap {
  readonly entry: SkillName | null;
  readonly skills: ReadonlyMap<SkillName, SkillLabels>;
}

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSkillName = (value: unknown): value is SkillName => typeof value === 'string' && SKILL_NAME_PATTERN.test(value);

/** A non-empty trimmed string, or `undefined`. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const FILE_KEYS = new Set(['entry', 'skills']);
const SKILL_KEYS = new Set(['label', 'description', 'group', 'next']);
const NEXT_KEYS = new Set(['skill', 'label']);

/**
 * The label mapping from its parsed JSON (`raw`). Never throws: what doesn't
 * fit is left out and reported in `problems`.
 */
export function readModuleLabels(raw: unknown): { labels: LabelMap; problems: string[] } {
  const problems: string[] = [];
  const skills = new Map<SkillName, SkillLabels>();
  if (!isTable(raw)) {
    problems.push(`${LABELS_FILE} is not an object`);
    return { labels: { entry: null, skills }, problems };
  }
  const unknownKeys = (table: Record<string, unknown>, known: ReadonlySet<string>, where: string) => {
    for (const key of Object.keys(table)) if (!known.has(key)) problems.push(`${where} has an unknown key '${key}'`);
  };
  unknownKeys(raw, FILE_KEYS, LABELS_FILE);

  let entry: SkillName | null = null;
  if (raw.entry !== undefined && raw.entry !== null) {
    if (isSkillName(raw.entry)) entry = raw.entry;
    else problems.push("'entry' is not a skill name");
  }

  if (raw.skills !== undefined && !isTable(raw.skills)) problems.push("'skills' is not an object");
  const tables = isTable(raw.skills) ? raw.skills : {};
  for (const [name, value] of Object.entries(tables)) {
    if (!isSkillName(name)) {
      problems.push(`'${name}' is not a skill name`);
      continue;
    }
    if (!isTable(value)) {
      problems.push(`skills.${name} is not an object`);
      continue;
    }
    unknownKeys(value, SKILL_KEYS, `skills.${name}`);
    const label = text(value.label);
    if (label === undefined) {
      problems.push(`skills.${name} has no label`);
      continue;
    }
    const description = text(value.description) ?? null;
    if (value.description !== undefined && description === null) problems.push(`skills.${name}.description is not text`);
    const group = text(value.group) ?? null;
    if (value.group !== undefined && group === null) problems.push(`skills.${name}.group is not text`);
    let next: CatalogNext | null = null;
    if (value.next !== undefined) {
      if (isTable(value.next)) unknownKeys(value.next, NEXT_KEYS, `skills.${name}.next`);
      const nextLabel = isTable(value.next) ? text(value.next.label) : undefined;
      if (isTable(value.next) && isSkillName(value.next.skill) && nextLabel !== undefined) next = { skill: value.next.skill, label: nextLabel };
      else problems.push(`skills.${name}.next needs a skill name and a label`);
    }
    skills.set(name, { label, description, group, next });
  }
  return { labels: { entry, skills }, problems };
}

/**
 * The installed skills with the mapping's labels: `label`, `group` and
 * `next` from the skill's entry, and its `description` replaced by the
 * one-sentence one when given. A `next` whose skill isn't installed is
 * `null`, and so is the entry action when its skill isn't installed.
 * `labelled` says whether any installed skill got a label.
 */
export function applyLabels(
  skills: readonly InstalledSkill[],
  labels: LabelMap,
): { skills: CatalogSkill[]; entryAction: SkillName | null; labelled: boolean } {
  const installed = new Set(skills.map((skill) => skill.name));
  let labelled = false;
  const result = skills.map((skill) => {
    const found = labels.skills.get(skill.name);
    if (found === undefined) return CatalogSkill.parse(skill);
    labelled = true;
    return CatalogSkill.parse({
      ...skill,
      description: found.description ?? skill.description,
      label: found.label,
      group: found.group,
      next: found.next !== null && installed.has(found.next.skill) ? found.next : null,
    });
  });
  const entryAction = labels.entry !== null && installed.has(labels.entry) ? labels.entry : null;
  return { skills: result, entryAction, labelled };
}
