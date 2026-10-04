/**
 * The catalog of a repo (story 4.4, E4-R3, E4-R4; AD-12, AD-14), built from
 * its installed metadata on every read: nothing is cached and nothing
 * watched, so a module copied in while the server runs shows on the next
 * read without a restart.
 *
 * - Modules: each skill folder (`SKILL_FOLDERS`) holding a `bmod.toml` with
 *   a `[bmod]` table is a module record, not a skill. Its `code` (a
 *   {@link MODULE_CODE_PATTERN}), `version` and `skills` make the module;
 *   the first record that names a usable code claims it, even when it is
 *   then left out. A record without a usable code, or whose `skills` is
 *   there but not a list of strings, is left out (and its folder is still
 *   not a skill). At most {@link MAX_SKILL_FOLDER_ENTRIES} entries per
 *   skills folder and {@link MAX_ROSTER_MEMBERS} roster members are read. The name is the mapping's module label, else
 *   the code; `installedAt` is `null` here (core records when it first
 *   appeared, story 4.4).
 * - Skills: `scanSkills` (story 4.1) without the record folders, with the
 *   module whose `skills` lists them, and the label mapping's labels,
 *   groups, `next` and entry action (`applyLabels`, story 4.5), only for
 *   the skills whose folder is the verified pinned copy's (entry 4.12,
 *   `verified.ts`; none without a verified copy).
 * - Agents: the `[[members]]` of a record's `roster.toml` whose `skill` is
 *   installed: named by the skill, labelled with its mapped label, else the
 *   member's `title`, else the skill's name; described as the skill is.
 * - Capabilities (AD-14, never a version): `plain_labels` when an installed
 *   verified skill has a label in the mapping; `ticket_tree` when the repo's
 *   `_bmad/scripts/config_utils.py` is a regular file reached through real
 *   folders whose first 64 KB define `load_central_config(` (what the
 *   verified `tickets.py` loads).
 *
 * `missingCapabilities` (entry 4.11) reads only what the wanted capabilities
 * need: the config script for `ticket_tree`, the skills (and module records)
 * for `plain_labels`, so a project with Planning off is never scanned.
 *
 * Read-only and inside the repo, as `scanSkills`: the root must be a real
 * folder, every file read is a regular file whose real path is inside the
 * repo's, read up to {@link MAX_SKILL_FILE_BYTES}; any error leaves that
 * item out and nothing throws for the repo's state. This file names no
 * skill or module (they are data).
 */
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BMAD_CAPABILITIES, CatalogAgent, CatalogModule, CatalogSkill, SKILL_NAME_PATTERN, type BmadCapability, type Catalog } from '@ogden-agents/shared';
import { applyLabels, MODULE_CODE_PATTERN, readModuleLabels, type LabelMap } from './labels.js';
import { SKILL_LABELS } from './skill-labels.js';
import { MAX_SKILL_FOLDER_ENTRIES, readHead, readInsideRepo, realRepoRoot, scanSkillFoldersAt, SKILL_FOLDERS } from './skills.js';
import { readToml, type TomlTable } from './toml.js';
import { UNVERIFIED, type SkillVerifier } from './verified.js';

/** A module record's file, in its skill folder. */
export const MODULE_RECORD_FILE = 'bmod.toml';
/** A module's roster, beside its record. */
export const MODULE_ROSTER_FILE = 'roster.toml';
/** The BMad config script the ticket tree's `tickets.py` loads, relative to the repo. */
export const TICKET_TREE_CONFIG_SCRIPT: readonly string[] = ['_bmad', 'scripts', 'config_utils.py'];

/** The shipped label mapping, read once (its problems are a test's concern: the shipped file has none). */
const SHIPPED_LABELS: LabelMap = readModuleLabels(SKILL_LABELS).labels;

/** How a catalog is labelled: the mapping (the shipped one by default) and the label trust (none verified by default). */
export interface LabelOptions {
  readonly labels?: LabelMap;
  readonly verifier?: SkillVerifier;
}

/** The names the mapping labels or makes the entry action: the only ones the trust checks. */
const mappedNames = (labels: LabelMap): Set<string> => new Set([...labels.skills.keys(), ...(labels.entry === null ? [] : [labels.entry])]);

/** The repo's skills (not module records), labelled with `labels` where verified. */
async function labelledSkills(repoReal: string, recordFolders: ReadonlySet<string>, { labels = SHIPPED_LABELS, verifier = UNVERIFIED }: LabelOptions) {
  const found = (await scanSkillFoldersAt(repoReal)).filter((entry) => !recordFolders.has(entry.skill.name));
  const verified = await verifier.verified(repoReal, found, mappedNames(labels));
  return applyLabels(
    found.map((entry) => entry.skill),
    labels,
    verified,
  );
}

/** At most this many `[[members]]` of a roster are read. */
export const MAX_ROSTER_MEMBERS = 200;

/** A catalog with nothing in it. */
const EMPTY_CATALOG: Catalog = { modules: [], skills: [], agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: false } };

/** A module record, read. */
interface ModuleRecord {
  readonly code: string;
  readonly version: string | null;
  readonly skills: readonly string[];
  /** Where the record is, relative to the repo: its skill folder. */
  readonly folder: readonly string[];
}

const byKey = <T>(key: (item: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** A non-empty trimmed string value of `table`, or `undefined`. */
function textOf(table: TomlTable | undefined, key: string): string | undefined {
  const value = table?.get(key);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The module records under the repo's skill folders, first per code, and
 * the names of every record folder (left out of the skills).
 */
async function readModuleRecords(repoReal: string): Promise<{ records: ModuleRecord[]; recordFolders: Set<string> }> {
  const records = new Map<string, ModuleRecord>();
  /** Every usable code a record named, used or not: the first record of a code claims it. */
  const claimed = new Set<string>();
  const recordFolders = new Set<string>();
  for (const folder of SKILL_FOLDERS) {
    let names: string[];
    try {
      names = (await readdir(join(repoReal, ...folder))).sort().slice(0, MAX_SKILL_FOLDER_ENTRIES);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SKILL_NAME_PATTERN.test(name)) continue;
      const text = await readInsideRepo(repoReal, [...folder, name, MODULE_RECORD_FILE]);
      if (text === undefined) continue;
      const bmod = readToml(text).tables.get('bmod');
      if (bmod === undefined) continue;
      recordFolders.add(name);
      const code = textOf(bmod, 'code');
      if (code === undefined || !MODULE_CODE_PATTERN.test(code) || claimed.has(code)) continue;
      claimed.add(code);
      // Absent is none; there but not a list of strings (a number, a mixed array) leaves the module out.
      const skills = bmod.get('skills') ?? [];
      if (!Array.isArray(skills)) continue;
      records.set(code, { code, version: textOf(bmod, 'version') ?? null, skills: skills.filter((skill) => SKILL_NAME_PATTERN.test(skill)), folder: [...folder, name] });
    }
  }
  return { records: [...records.values()], recordFolders };
}

/** The `[[members]]` of a record's roster, or none. */
async function readRoster(repoReal: string, record: ModuleRecord): Promise<readonly TomlTable[]> {
  const text = await readInsideRepo(repoReal, [...record.folder, MODULE_ROSTER_FILE]);
  return text === undefined ? [] : (readToml(text).arrays.get('members') ?? []).slice(0, MAX_ROSTER_MEMBERS);
}

/** Whether the repo has the ticket tree's BMad config script (see the file's comment). */
async function hasTicketTree(repoReal: string): Promise<boolean> {
  let path = repoReal;
  try {
    for (const [index, part] of TICKET_TREE_CONFIG_SCRIPT.entries()) {
      path = join(path, part);
      const entry = await lstat(path);
      // Real folders on the way and a regular file at the end: a link anywhere is never followed.
      if (index === TICKET_TREE_CONFIG_SCRIPT.length - 1 ? !entry.isFile() : !entry.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  const text = await readHead(path);
  return text !== undefined && /^[ \t]*def[ \t]+load_central_config[ \t]*\(/m.test(text);
}

/**
 * The catalog of the repo at `repoPath` (see the file's comment), labelled
 * with `options.labels` (the shipped mapping by default) where
 * `options.verifier` verifies the skill (none by default). An empty catalog
 * for a path that isn't an absolute path to a real folder.
 */
export async function buildCatalog(repoPath: string, options: LabelOptions = {}): Promise<Catalog> {
  const labels = options.labels ?? SHIPPED_LABELS;
  const repoReal = await realRepoRoot(repoPath);
  if (repoReal === undefined) return EMPTY_CATALOG;
  const [{ records, recordFolders }, ticketTree] = await Promise.all([readModuleRecords(repoReal), hasTicketTree(repoReal)]);

  const moduleOf = new Map<string, string>();
  for (const record of records) for (const skill of record.skills) if (!moduleOf.has(skill)) moduleOf.set(skill, record.code);

  const labelled = await labelledSkills(repoReal, recordFolders, options);
  const skills = labelled.skills.map((skill) => CatalogSkill.parse({ ...skill, module: moduleOf.get(skill.name) ?? null }));
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));

  const agents = new Map<string, CatalogAgent>();
  for (const record of records) {
    for (const member of await readRoster(repoReal, record)) {
      const name = textOf(member, 'skill');
      const skill = name === undefined ? undefined : skillByName.get(name);
      if (skill === undefined || agents.has(skill.name)) continue;
      agents.set(skill.name, CatalogAgent.parse({ name: skill.name, label: skill.label ?? textOf(member, 'title') ?? skill.name, description: skill.description, module: record.code }));
    }
  }

  return {
    modules: records.map((record) => CatalogModule.parse({ code: record.code, name: labels.modules.get(record.code) ?? record.code, version: record.version, installedAt: null })).sort(byKey((module) => module.code)),
    skills,
    agents: [...agents.values()].sort(byKey((agent) => agent.name)),
    entryAction: labelled.entryAction,
    capabilities: { plain_labels: labelled.labelled, ticket_tree: ticketTree },
  };
}

/** Whether an installed verified skill (not a module record) has a label: the `plain_labels` capability. */
async function hasPlainLabels(repoReal: string, options: LabelOptions): Promise<boolean> {
  const { recordFolders } = await readModuleRecords(repoReal);
  return (await labelledSkills(repoReal, recordFolders, options)).labelled;
}

/**
 * Which of `wanted` the repo at `repoPath` lacks (entry 4.11, AD-14; see the
 * file's comment), in {@link BMAD_CAPABILITIES} order, each once. Only what
 * `wanted` names is read. A path that isn't an absolute path to a real
 * folder lacks every one; nothing throws for the repo's state.
 */
export async function missingCapabilities(repoPath: string, wanted: readonly BmadCapability[], options: LabelOptions = {}): Promise<BmadCapability[]> {
  const asked = BMAD_CAPABILITIES.filter((capability) => wanted.includes(capability));
  if (asked.length === 0) return [];
  const repoReal = await realRepoRoot(repoPath);
  if (repoReal === undefined) return asked;
  const has = await Promise.all(asked.map((capability) => (capability === 'ticket_tree' ? hasTicketTree(repoReal) : hasPlainLabels(repoReal, options))));
  return asked.filter((_capability, index) => !has[index]);
}
