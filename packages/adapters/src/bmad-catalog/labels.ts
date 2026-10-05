/**
 * Plain-language labels (story 4.5, E4-R4; AD-12 as amended by story 4.14):
 * reading Ogden Agents' own label mapping (`skill-labels.json`, keyed by
 * skill name, typed in `skill-labels.ts`) and putting it on the catalog's
 * skills. Entry 4.4 calls `applyLabels` from `catalogOf`; this file names no
 * skill (the names are data in the JSON file).
 *
 * The mapping: `entry` (the skill behind "Start from an idea", or `null`),
 * `skills`, per skill a `label`, an optional one-sentence `description`,
 * a `group` and an optional `next = { skill, label }`, and an optional
 * `modules`, per module code its plain `label` (entry 4.4; a module it
 * doesn't name shows its code). Reading is lenient
 * per entry: a bad entry or field is left out and reported in `problems`,
 * and the rest still counts (AD-14: nothing fails silently); an unknown key
 * (a misspelt field, say) is reported too. A skill the mapping doesn't name
 * keeps its `SKILL.md` description and `null` label, group and next, which
 * the Plan page shows as the name and description, and so does a mapped
 * skill whose folder isn't the verified pinned copy's (entry 4.12).
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
  /** `epic` for a skill that takes an epic's folder (epic 7), else `null`. */
  readonly scope: 'epic' | null;
  /** Further next steps beside {@link next}, each once (epic 7). */
  readonly nexts: readonly CatalogNext[];
}

/** The label mapping, read. */
export interface LabelMap {
  readonly entry: SkillName | null;
  readonly skills: ReadonlyMap<SkillName, SkillLabels>;
  /** Each named module's plain label, by module code (entry 4.4). */
  readonly modules: ReadonlyMap<string, string>;
}

/** A module code (`[bmod] code` in `bmod.toml`): written as a skill name is. */
export const MODULE_CODE_PATTERN = SKILL_NAME_PATTERN;

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSkillName = (value: unknown): value is SkillName => typeof value === 'string' && SKILL_NAME_PATTERN.test(value);

/** A non-empty trimmed string, or `undefined`. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

const FILE_KEYS = new Set(['entry', 'skills', 'modules']);
const MODULE_KEYS = new Set(['label']);
const SKILL_KEYS = new Set(['label', 'description', 'group', 'next', 'scope', 'nexts']);
/** The most further next steps a skill may name. */
const MAX_NEXTS = 8;
const NEXT_KEYS = new Set(['skill', 'label']);

/**
 * The label mapping from its parsed JSON (`raw`). Never throws: what doesn't
 * fit is left out and reported in `problems`.
 */
export function readModuleLabels(raw: unknown): { labels: LabelMap; problems: string[] } {
  const problems: string[] = [];
  const skills = new Map<SkillName, SkillLabels>();
  const modules = new Map<string, string>();
  if (!isTable(raw)) {
    problems.push(`${LABELS_FILE} is not an object`);
    return { labels: { entry: null, skills, modules }, problems };
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
    let scope: 'epic' | null = null;
    if (value.scope !== undefined) {
      if (value.scope === 'epic') scope = 'epic';
      else problems.push(`skills.${name}.scope is not 'epic'`);
    }
    const nexts: CatalogNext[] = [];
    if (value.nexts !== undefined) {
      if (!Array.isArray(value.nexts)) problems.push(`skills.${name}.nexts is not a list`);
      else {
        for (const [index, each] of value.nexts.slice(0, MAX_NEXTS).entries()) {
          if (isTable(each)) unknownKeys(each, NEXT_KEYS, `skills.${name}.nexts[${index}]`);
          const nextLabel = isTable(each) ? text(each.label) : undefined;
          if (isTable(each) && isSkillName(each.skill) && nextLabel !== undefined) nexts.push({ skill: each.skill, label: nextLabel });
          else problems.push(`skills.${name}.nexts[${index}] needs a skill name and a label`);
        }
        if (value.nexts.length > MAX_NEXTS) problems.push(`skills.${name}.nexts has more than ${MAX_NEXTS} steps`);
      }
    }
    skills.set(name, { label, description, group, next, scope, nexts });
  }

  if (raw.modules !== undefined && !isTable(raw.modules)) problems.push("'modules' is not an object");
  for (const [code, value] of Object.entries(isTable(raw.modules) ? raw.modules : {})) {
    if (!MODULE_CODE_PATTERN.test(code)) {
      problems.push(`'${code}' is not a module code`);
      continue;
    }
    if (!isTable(value)) {
      problems.push(`modules.${code} is not an object`);
      continue;
    }
    unknownKeys(value, MODULE_KEYS, `modules.${code}`);
    const label = text(value.label);
    if (label === undefined) problems.push(`modules.${code} has no label`);
    else modules.set(code, label);
  }
  return { labels: { entry, skills, modules }, problems };
}

/**
 * The installed skills with the mapping's labels: `label`, `group` and
 * `next` from the skill's entry, and its `description` replaced by the
 * one-sentence one when given. Only a skill in `verified` (entry 4.12: its
 * folder is the verified pinned copy's, `verified.ts`) is labelled; any
 * other keeps its `SKILL.md` description and no label, group or next. A
 * `next` whose skill isn't installed and verified is `null`, and so is the
 * entry action when its skill isn't. `labelled` says whether any installed
 * skill got a label.
 */
export function applyLabels(
  skills: readonly InstalledSkill[],
  labels: LabelMap,
  verified: ReadonlySet<string>,
): { skills: CatalogSkill[]; entryAction: SkillName | null; labelled: boolean } {
  const installed = new Set(skills.map((skill) => skill.name).filter((name) => verified.has(name)));
  let labelled = false;
  const result = skills.map((skill) => {
    const found = installed.has(skill.name) ? labels.skills.get(skill.name) : undefined;
    if (found === undefined) return CatalogSkill.parse(skill);
    labelled = true;
    return CatalogSkill.parse({
      ...skill,
      description: found.description ?? skill.description,
      label: found.label,
      group: found.group,
      next: found.next !== null && installed.has(found.next.skill) ? found.next : null,
      scope: found.scope,
      nexts: found.nexts.filter((step) => installed.has(step.skill)),
    });
  });
  const entryAction = labels.entry !== null && installed.has(labels.entry) ? labels.entry : null;
  return { skills: result, entryAction, labelled };
}
