/**
 * Ogden Agents' own plain-language labels for BMad Method skills (story
 * 4.14, AD-12 as amended): one mapping file in this adapter, keyed by skill
 * name, instead of metadata in a BMad fork. Entry 4.5's rework fills it and
 * reads it with `readModuleLabels(raw)`; a skill it doesn't name shows its
 * `SKILL.md` description.
 *
 * The file: `entry`, the skill behind "Start from an idea" (or `null`), and
 * `skills`, each skill's `label`, optional one-sentence `description`,
 * `group` and `next = { skill, label }`.
 */
import raw from './skill-labels.json' with { type: 'json' };

/** One skill's labels in the mapping. */
export interface SkillLabelsEntry {
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly next?: { readonly skill: string; readonly label: string };
}

/** The mapping file's shape. */
export interface SkillLabelsFile {
  readonly entry: string | null;
  readonly skills: Readonly<Record<string, SkillLabelsEntry>>;
}

/** The mapping as shipped (unchecked here: 4.5's reader reports what doesn't fit; a test checks the shipped file's shape). */
export const SKILL_LABELS: SkillLabelsFile = raw as SkillLabelsFile;
