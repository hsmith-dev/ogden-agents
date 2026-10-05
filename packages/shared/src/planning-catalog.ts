import { z } from 'zod';
import type { BmadPiece } from './bmad.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * The catalog (story 4.1, entries 4.4 and 4.5): a project's installed BMad
 * Method modules, skills and agents, their Plan page groups, the
 * capabilities reduced mode reads (entry 4.11), and starting a planning
 * session on a skill.
 *
 * Part of epic 4's contract, split out of `planning.ts` (entry 4.12), which
 * re-exports it under the same names.
 */

// ---- The catalog ----

/**
 * A skill name as a request may name it, and as the catalog keeps it: lower
 * case letters, digits and dashes, starting with a letter or digit, at most
 * 64 characters. Anything else (`../x`, a slash, a space) names no skill.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A skill name ({@link SKILL_NAME_PATTERN}). */
export const SkillName = z.string().regex(SKILL_NAME_PATTERN, 'That is not the name of a skill.');
export type SkillName = z.infer<typeof SkillName>;

/**
 * The UI groups of the Plan page, in the order it shows them (EXPERIENCE.md
 * Plan home). A skill's group comes from Ogden Agents' label mapping (entry 4.5); a group
 * this list doesn't know, or none, shows last as {@link CATALOG_OTHER_GROUP_LABEL}.
 */
export const CATALOG_GROUPS = ['planning', 'building', 'checking', 'research', 'agents', 'setup'] as const;
export const CatalogGroup = z.enum(CATALOG_GROUPS);
export type CatalogGroup = z.infer<typeof CatalogGroup>;

/** Each group's heading on the Plan page. */
export const CATALOG_GROUP_LABELS: Readonly<Record<CatalogGroup, string>> = {
  planning: 'Planning',
  building: 'Building',
  checking: 'Checking work',
  research: 'Ideas and research',
  agents: 'Agents and groups',
  setup: 'Course and setup',
};

/** The heading of the last group: skills whose group is unknown or missing. */
export const CATALOG_OTHER_GROUP_LABEL = 'Other';

/**
 * Where a skill's `group` sorts on the Plan page: its index in
 * {@link CATALOG_GROUPS}, or after every known group when it is unknown or `null`.
 */
export function catalogGroupRank(group: string | null): number {
  const index = (CATALOG_GROUPS as readonly string[]).indexOf(group ?? '');
  return index === -1 ? CATALOG_GROUPS.length : index;
}

/** The heading a skill's `group` shows under: its label, or {@link CATALOG_OTHER_GROUP_LABEL}. */
export function catalogGroupLabel(group: string | null): string {
  const parsed = CatalogGroup.safeParse(group);
  return parsed.success ? CATALOG_GROUP_LABELS[parsed.data] : CATALOG_OTHER_GROUP_LABEL;
}

/** A module installed within this many days carries the "New" tag on the Plan page (CAP-18). */
export const NEW_TAG_DAYS = 7;

/** Whether a module installed at `installedAt` is new at `now` (installed less than {@link NEW_TAG_DAYS} days ago). */
export function isNewlyInstalled(installedAt: string | null, now: Date = new Date()): boolean {
  if (installedAt === null) return false;
  const at = Date.parse(installedAt);
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age < NEW_TAG_DAYS * 24 * 60 * 60 * 1000;
}

/** One installed BMad Method module (`bmod.toml`). `version` and `installedAt` are `null` when the metadata doesn't say. */
export const CatalogModule = z.object({
  /** The module's code (`bmm`, `bmod-method`). */
  code: z.string().min(1),
  /** Its plain name. */
  name: z.string().min(1),
  version: z.string().min(1).nullable(),
  installedAt: IsoUtcTimestamp.nullable(),
});
export type CatalogModule = z.infer<typeof CatalogModule>;

/** The next suggested step after a skill (or a written document): the skill it starts and its button's plain label. */
export const CatalogNext = z.object({ skill: SkillName, label: z.string().min(1) });
export type CatalogNext = z.infer<typeof CatalogNext>;

/**
 * One installed skill, from its `SKILL.md` frontmatter and Ogden Agents' label mapping (AD-12).
 * `description` is empty when the skill gives none; each other field is
 * `null` when no metadata says it (the Plan page then falls back to the
 * name and description, AD-12).
 */
export const CatalogSkill = z.object({
  name: SkillName,
  description: z.string(),
  /** The plain-language label (Ogden Agents' label mapping, entry 4.5). */
  label: z.string().min(1).nullable().default(null),
  /** The UI group ({@link CATALOG_GROUPS}, or an unknown one that shows as Other). */
  group: z.string().min(1).nullable().default(null),
  /** The code of the module it belongs to. */
  module: z.string().min(1).nullable().default(null),
  /** When its module was installed (the "New" tag). */
  installedAt: IsoUtcTimestamp.nullable().default(null),
  /** The next suggested step after it. */
  next: CatalogNext.nullable().default(null),
  /**
   * `epic` for a skill that takes an epic's folder and shows on the board's
   * epic header, not in Plan home (epic 7, the look-back); `null` for every other.
   */
  scope: z.literal('epic').nullable().default(null),
  /** Further next steps beside {@link next} (the look-back's lessons and action items); empty for most skills. */
  nexts: z.array(CatalogNext).max(8).default([]),
});
export type CatalogSkill = z.infer<typeof CatalogSkill>;

/** One installed agent persona (`roster.toml`). */
export const CatalogAgent = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  module: z.string().min(1).nullable(),
});
export type CatalogAgent = z.infer<typeof CatalogAgent>;

/**
 * The fork capabilities a project's installed metadata may lack (AD-14):
 * features are gated on these, never on version strings. A missing one puts
 * its surface in reduced mode with {@link BMAD_CAPABILITY_REDUCED_TEXT}.
 *
 * - `plain_labels`: plain-language labels, groups and the entry action (the fork label patch, entry 4.5);
 * - `ticket_tree`: the v7 ticket tree `tickets.py` reads (the Board).
 */
export const BMAD_CAPABILITIES = ['plain_labels', 'ticket_tree'] as const;
export const BmadCapability = z.enum(BMAD_CAPABILITIES);
export type BmadCapability = z.infer<typeof BmadCapability>;

/** The reduced-mode notice's sentence for each missing capability (EXPERIENCE.md Reduced-mode notice). */
export const BMAD_CAPABILITY_REDUCED_TEXT: Readonly<Record<BmadCapability, string>> = {
  plain_labels: "This project's BMad Method has actions Ogden Agents doesn't know, so starting from an idea isn't available and its actions show without plain names or groups.",
  ticket_tree: "This project's BMad Method doesn't keep tickets the way Ogden Agents reads them, so the board isn't available.",
};

/** Which capabilities the project's installed metadata has: every one is listed, `true` or `false`. */
export const BmadCapabilities = z.object({ plain_labels: z.boolean(), ticket_tree: z.boolean() });
export type BmadCapabilities = z.infer<typeof BmadCapabilities>;

/**
 * The capabilities each piece needs (entry 4.11, AD-14): Planning the plain
 * labels and the entry action, Board the ticket tree. Builds and
 * retrospectives need none until epics 5 and 7 say otherwise. A capability
 * is read (and its notice shown) only for a piece that is on.
 */
export const BMAD_PIECE_CAPABILITIES: Readonly<Record<BmadPiece, readonly BmadCapability[]>> = {
  planning: ['plain_labels'],
  board: ['ticket_tree'],
  builds: [],
  retrospectives: [],
};

/** The capabilities `pieces` need, each once, in {@link BMAD_CAPABILITIES} order. */
export function bmadCapabilitiesFor(pieces: Iterable<BmadPiece>): BmadCapability[] {
  const wanted = new Set<BmadCapability>();
  for (const piece of pieces) for (const capability of BMAD_PIECE_CAPABILITIES[piece]) wanted.add(capability);
  return BMAD_CAPABILITIES.filter((capability) => wanted.has(capability));
}

/**
 * A project's catalog (AD-12): its installed modules, skills (sorted by
 * name, each once) and agents, the skill behind "Start from an idea"
 * (`null` without fork metadata), and its capabilities (AD-14).
 */
export const Catalog = z.object({
  modules: z.array(CatalogModule),
  skills: z.array(CatalogSkill),
  agents: z.array(CatalogAgent),
  entryAction: SkillName.nullable(),
  capabilities: BmadCapabilities,
});
export type Catalog = z.infer<typeof Catalog>;

/** `GET /api/v1/workspaces/:wsId/catalog`: the project's catalog. */
export const CatalogResponse = Catalog;
export type CatalogResponse = z.infer<typeof CatalogResponse>;

/** The longest idea "Start from an idea" sends, in characters. */
export const MAX_IDEA_LENGTH = 2000;

/** An idea for a planning session: trimmed, 1 to {@link MAX_IDEA_LENGTH} characters. */
export const PlanningIdea = z
  .string()
  .trim()
  .min(1, 'Write your idea first.')
  .max(MAX_IDEA_LENGTH, `An idea can be at most ${MAX_IDEA_LENGTH} characters.`);

/**
 * `POST /api/v1/workspaces/:wsId/planning-sessions`: start a planning
 * session on `skill`, which must be in the project's catalog (else 404),
 * with the user's `idea` when given ("Start from an idea"). Answered 201
 * with `SessionResponse` (a session of kind `planning`) whose first message
 * is the agent's invocation of the skill with the idea.
 */
export const StartPlanningRequest = z.object({ skill: SkillName, idea: PlanningIdea.optional() });
export type StartPlanningRequest = z.infer<typeof StartPlanningRequest>;
