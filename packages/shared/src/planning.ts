import { z } from 'zod';
import type { BmadPiece } from './bmad.js';
import { IsoUtcTimestamp } from './time.js';

/**
 * Epic 4's contract (story 4.1's tracer, frozen by story 4.2): the catalog of
 * a project's installed BMad Method modules, skills and agents, starting a
 * planning session on one, the project's tickets as `tickets.py` reports
 * them, a ticket's detail and status change, BMad Method's setup in a
 * project, and the per-project script trust. Every shape and user-facing
 * text of the Plan and Board pages, the setup panel and the trust prompt
 * lives here, so entries 4.3 to 4.11 build against one file.
 *
 * Nothing here names a skill (AD-12): the catalog is read from the repo's
 * installed metadata, and the agent adapter turns a skill name into the
 * text that invokes it. No UI text here holds an em or en dash.
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

// ---- The board ----

/**
 * A ticket reference as `tickets.py` prints it and `find` resolves it:
 * `4.1`, an entry's id, or a backlog leaf's file name. Letters, digits,
 * dots, dashes and underscores, starting with a letter or digit, at most
 * 128 characters: never a slash, a space or an option (`-x`).
 */
export const TICKET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** A ticket reference as a route takes it (`:ref`), checked against {@link TICKET_REF_PATTERN}. */
export const TicketRefParam = z.string().regex(TICKET_REF_PATTERN, 'That is not a ticket reference.');
export type TicketRefParam = z.infer<typeof TicketRefParam>;

/** A ticket another one waits for or blocks, as the script writes it: a sibling's id (`2`) or `<epic id>.<id>` (`1.2`). */
export const TicketLink = z.union([z.number().int(), z.string().min(1)]);
export type TicketLink = z.infer<typeof TicketLink>;

/**
 * One ticket as `tickets.py status` reports it (AD-10: ticket state lives
 * only in the BMad files; Ogden Agents stores none of it). Field names are
 * the script's own. A 4.1 field the script leaves out is `null`; a field
 * story 4.2 added takes its default when absent.
 */
export const TicketRow = z.object({
  /** The reference `tickets.py find` resolves (`4.1`). */
  ref: z.string().min(1),
  /** The entry's id in its epic (an integer), or a backlog leaf's stem. */
  id: z.union([z.number().int(), z.string()]).nullable(),
  /** The epic folder the ticket is in. */
  epic: z.string().nullable(),
  title: z.string(),
  /** `story`, `bug`, `task`, … */
  type: z.string().nullable(),
  /** The plan's `status` ({@link TICKET_STATUSES}; empty when no build has started). */
  status: z.string().nullable(),
  /** `planned`, `backlog`, `in-progress`, `review`, `done` or `dropped`. */
  state: z.string(),
  blocked_reason: z.string().nullable(),
  /** The ticket's leaf file name, or `null` for an entry not pulled into one. */
  file: z.string().nullable().default(null),
  /** The tracker's id, empty in the repo store. */
  tracker_id: z.string().default(''),
  assignee: z.string().default(''),
  /** Whether a person must take part (human in the loop). */
  hitl: z.boolean().default(false),
  /** The spec capabilities it covers. */
  covers: z.array(z.string()).default([]),
  /** The tickets it waits for. */
  after: z.array(TicketLink).default([]),
  /** The tickets waiting for it. */
  blocks: z.array(TicketLink).default([]),
  /** When it was blocked (an ISO date), empty when it isn't. */
  blocked_at: z.string().default(''),
});
export type TicketRow = z.infer<typeof TicketRow>;

/** One epic of the active initiative as `tickets.py status` reports it (only when it reads a whole initiative). */
export const TicketEpic = z.object({
  slug: z.string().min(1),
  id: z.number().int().nullable(),
  status: z.string(),
  after: z.array(TicketLink),
  blocks: z.array(TicketLink),
});
export type TicketEpic = z.infer<typeof TicketEpic>;

/**
 * `GET /api/v1/workspaces/:wsId/tickets`: every ticket in build order, what
 * `tickets.py` couldn't read, the folder it read (the initiative's, or
 * `null` when it didn't say) and the initiative's epics (`[]` for one epic's folder).
 */
export const TicketsResponse = z.object({
  tickets: z.array(TicketRow),
  problems: z.array(z.string()),
  folder: z.string().min(1).nullable().default(null),
  epics: z.array(TicketEpic).default([]),
});
export type TicketsResponse = z.infer<typeof TicketsResponse>;

/** One ticket as `tickets.py find` reports it: its row and its entry's text, and whether its plan file exists. */
export const TicketDetail = TicketRow.extend({
  description: z.string(),
  verify: z.string(),
  references: z.array(z.string()),
  notes: z.array(z.string()),
  /** The entry's open question, empty when it has none. */
  unknown: z.string(),
  /** Whether the ticket's plan file exists (a planned entry has none until it is marked). */
  hasPlan: z.boolean(),
});
export type TicketDetail = z.infer<typeof TicketDetail>;

/** `GET /api/v1/workspaces/:wsId/tickets/:ref`: one ticket (404 when no ticket matches). */
export const TicketResponse = z.object({ ticket: TicketDetail });
export type TicketResponse = z.infer<typeof TicketResponse>;

/** A plan's statuses, as `tickets.py mark` accepts them. */
export const TICKET_STATUSES = ['draft', 'ready-for-dev', 'in-progress', 'in-review', 'built', 'done', 'blocked', 'dropped'] as const;
export const TicketStatus = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatus>;

/** The statuses the board may set: every one but `done`, which only epic 5's approve writes (AD-10). */
export const MARKABLE_TICKET_STATUSES: readonly TicketStatus[] = TICKET_STATUSES.filter((status) => status !== 'done');

/** The longest blocked reason the board sends, in characters. */
export const MAX_BLOCKED_REASON_LENGTH = 500;

/** `reopen` sent for a ticket the request doesn't say is Done (story 4.10). */
export const REOPEN_ONLY_FROM_DONE_MESSAGE = 'Only a Done ticket can be reopened.';

/** A blocked reason left empty: the schema's message and the board's field error (story 4.10). */
export const BOARD_BLOCKED_REASON_REQUIRED = 'Say why it is blocked.';
/** A blocked reason holding a control character (other than a line break or tab) or a broken character. */
export const BOARD_BLOCKED_REASON_INVALID = 'A reason can only hold plain text.';
/** Control characters but newline and tab, and lone UTF-16 surrogates (the `u` flag matches only unpaired ones). */
const NOT_PLAIN_TEXT = /[\u0000-\u0008\u000B-\u001F\u007F]|[\uD800-\uDFFF]/u;

/**
 * `PUT /api/v1/workspaces/:wsId/tickets/:ref/status`: set the ticket's
 * status through `tickets.py mark`. `done` parses but is refused with 409
 * `status_not_allowed`; `blockedReason` goes only with `blocked`;
 * `expectedStatus` (story 4.10) refuses a change the user hasn't seen.
 */
export const MarkTicketRequest = z
  .object({
    status: TicketStatus,
    blockedReason: z
      .string()
      .trim()
      .min(1, BOARD_BLOCKED_REASON_REQUIRED)
      .max(MAX_BLOCKED_REASON_LENGTH)
      .refine((reason) => !NOT_PLAIN_TEXT.test(reason), BOARD_BLOCKED_REASON_INVALID)
      .optional(),
    /**
     * The status the board showed (`''`: no plan yet; story 4.10). When
     * given and the plan's status no longer matches, nothing is written: 409
     * `ticket_changed`. Left out, the mark runs whatever the status is.
     */
    expectedStatus: z.union([TicketStatus, z.literal('')]).optional(),
    /**
     * The user confirmed reopening a Done ticket (story 4.10, user decision
     * 2026-10-02). Required (`true`) when `expectedStatus` is `done`, else
     * 409 `reopen_not_confirmed` and nothing is written; only with it.
     */
    reopen: z.literal(true).optional(),
  })
  .refine((request) => request.blockedReason === undefined || request.status === 'blocked', {
    message: 'A reason goes only with Blocked.',
    path: ['blockedReason'],
  })
  .refine((request) => request.reopen === undefined || request.expectedStatus === 'done', {
    message: REOPEN_ONLY_FROM_DONE_MESSAGE,
    path: ['reopen'],
  });
export type MarkTicketRequest = z.infer<typeof MarkTicketRequest>;

/** The ticket's status after a mark, as the plan file now has it. */
export const MarkTicketResponse = z.object({ ref: z.string().min(1), status: TicketStatus });
export type MarkTicketResponse = z.infer<typeof MarkTicketResponse>;

/** The Board's status columns, in order (EXPERIENCE.md Board). */
export const BOARD_COLUMNS = ['draft', 'ready', 'in_progress', 'in_review', 'built', 'done', 'blocked'] as const;
export const BoardColumn = z.enum(BOARD_COLUMNS);
export type BoardColumn = z.infer<typeof BoardColumn>;

/** Each column's heading. */
export const BOARD_COLUMN_LABELS: Readonly<Record<BoardColumn, string>> = {
  draft: 'Draft',
  ready: 'Ready',
  in_progress: 'In progress',
  in_review: 'In review',
  built: 'Built',
  done: 'Done',
  blocked: 'Blocked',
};

/** The column a plan status puts a ticket in; `dropped` is in none. */
const COLUMN_OF_STATUS: Readonly<Record<TicketStatus, BoardColumn | null>> = {
  draft: 'draft',
  'ready-for-dev': 'ready',
  'in-progress': 'in_progress',
  'in-review': 'in_review',
  built: 'built',
  done: 'done',
  blocked: 'blocked',
  dropped: null,
};

/** The column a ticket with no (or an unknown) plan status goes in, by its `state`. */
const COLUMN_OF_STATE: Readonly<Record<string, BoardColumn | null>> = {
  planned: 'draft',
  backlog: 'draft',
  'in-progress': 'in_progress',
  review: 'in_review',
  done: 'done',
  dropped: null,
};

/**
 * The board column a ticket shows in, from the files alone (AD-8): its plan
 * status, else its state. A planned entry (no plan) is in Draft; a ticket
 * with a blocked date is in Blocked; a `dropped` ticket is in no column
 * (`null`: hidden behind the dropped filter). Decision 2026-10-02, story 4.2.
 */
export function boardColumnOf(row: Pick<TicketRow, 'status' | 'state'> & Partial<Pick<TicketRow, 'blocked_at'>>): BoardColumn | null {
  const status = TicketStatus.safeParse(row.status);
  if (status.success && status.data === 'dropped') return null;
  if (row.state === 'dropped') return null;
  if (row.blocked_at !== undefined && row.blocked_at !== '') return 'blocked';
  if (status.success) return COLUMN_OF_STATUS[status.data];
  return Object.hasOwn(COLUMN_OF_STATE, row.state) ? COLUMN_OF_STATE[row.state]! : 'draft';
}

// ---- BMad Method's setup in a project ----

/**
 * Where a project's BMad Method stands (`setup.py --status`, entry 4.3):
 * - `not_set_up`: no `_bmad/`;
 * - `setup_owed`: a piece is on but setup hasn't finished (or was interrupted);
 * - `current`: set up with the pinned version (AD-13);
 * - `update_available`: set up with an older version than the pinned one;
 * - `unusable`: `_bmad/` is there but can't be read (`problems` says why).
 */
export const BMAD_SETUP_STATES = ['not_set_up', 'setup_owed', 'current', 'update_available', 'unusable'] as const;
export const BmadSetupState = z.enum(BMAD_SETUP_STATES);
export type BmadSetupState = z.infer<typeof BmadSetupState>;

/** A path relative to the repo, `/`-separated, never absolute and never leaving it. */
export const RepoRelativePath = z
  .string()
  .min(1)
  .refine(
    (path) => !path.startsWith('/') && !/^[A-Za-z]:/.test(path) && !path.includes('\\') && !path.split('/').includes('..'),
    'A path inside the project, with forward slashes.',
  );
export type RepoRelativePath = z.infer<typeof RepoRelativePath>;

export const BmadSetupStatus = z.object({
  state: BmadSetupState,
  /** The output folder the project's config names, relative to the repo (`_bmad-output`); `null` when not set up. */
  outputFolder: RepoRelativePath.nullable(),
  /** The pinned upstream version (`bmad-lock.json`, AD-13; the name is kept from when it was bundled). */
  bundledVersion: z.string().min(1),
  /** The version installed in the project, `null` when none is. */
  installedVersion: z.string().min(1).nullable(),
  /** What couldn't be read, in plain words. */
  problems: z.array(z.string()),
  /**
   * The capabilities the pieces that are on need and the project's BMad
   * Method lacks (entry 4.11, AD-14), each with its reduced-mode notice.
   * Absent for `not_set_up` and in payloads stored before 4.11.
   */
  missingCapabilities: z.array(BmadCapability).optional(),
});
export type BmadSetupStatus = z.infer<typeof BmadSetupStatus>;

/** `GET /api/v1/workspaces/:wsId/bmad/setup`: the project's setup status. */
export const BmadSetupStatusResponse = z.object({ setup: BmadSetupStatus });
export type BmadSetupStatusResponse = z.infer<typeof BmadSetupStatusResponse>;

/**
 * `POST /api/v1/workspaces/:wsId/bmad/setup` → 202: whether a setup started
 * (`false` when one is already running), and the status now. Progress
 * arrives as `bmad.setup_*` events on the workspace's stream.
 */
export const BmadSetupStartedResponse = z.object({ started: z.boolean(), setup: BmadSetupStatus });
export type BmadSetupStartedResponse = z.infer<typeof BmadSetupStartedResponse>;

/**
 * `POST /api/v1/workspaces/:wsId/bmad/setup`'s optional body (entry 4.11):
 * `upgrade: true` is Upgrade this project, which runs the setup in a project
 * that already has `_bmad/` (adding what is missing, repairing BMad
 * Method's scripts, keeping its settings and every existing skill). No body
 * (or `{}`) is Set up, unchanged.
 */
export const BmadSetupStartRequest = z.object({ upgrade: z.boolean().optional() }).strict();
export type BmadSetupStartRequest = z.infer<typeof BmadSetupStartRequest>;

/** The steps a setup reports, in order, each with its line in the progress list. */
export const BMAD_SETUP_STEPS = ['checking', 'copying_skills', 'writing_config', 'verifying'] as const;
export type BmadSetupStep = (typeof BMAD_SETUP_STEPS)[number];
export const BMAD_SETUP_STEP_LABELS: Readonly<Record<BmadSetupStep, string>> = {
  checking: 'Checking the project',
  copying_skills: 'Copying the BMad Method skills',
  writing_config: "Writing the project's BMad Method settings",
  verifying: 'Checking the setup',
};

/** One setup step as `bmad.setup_progress` carries it: a snake_case code and its plain label. */
export const BmadSetupProgress = z.object({ step: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().min(1) });
export type BmadSetupProgress = z.infer<typeof BmadSetupProgress>;

// ---- The per-project script trust (story 4.2, user decision 2026-10-02) ----

/** `scripts_not_trusted` (409): a route that runs the project's BMad Method scripts before the user allowed it. */
export const SCRIPTS_NOT_TRUSTED_MESSAGE =
  "Ogden Agents needs your OK before it runs this project's BMad Method scripts. Allow it on the Board page, then try again.";
/** The trust prompt's and the confirm dialog's title. */
export const SCRIPT_TRUST_TITLE = "Run this project's BMad Method scripts?";
/** The trust prompt's sentence: what runs, and what it never gets. */
export const SCRIPT_TRUST_TEXT =
  "Board reads your tickets by running the BMad Method scripts in this project's folder, on your computer. They run without your API keys or tokens. Allow this only for a project you trust.";
/** The button that allows it, once for this project. */
export const SCRIPT_TRUST_ALLOW = 'Allow';
/** The dialog's button that changes nothing. */
export const SCRIPT_TRUST_CANCEL = 'Cancel';
/** The fallback when allowing couldn't be saved. */
export const SCRIPT_TRUST_FAILED = "Ogden Agents couldn't save your answer. Try again.";

// ---- The pinned upstream BMad Method (story 4.14, AD-13) ----

/**
 * Whether this install has its pinned BMad Method downloaded and verified in
 * its data folder:
 * - `missing`: not downloaded (or downloaded for another pin, before an upgrade);
 * - `downloading`: a download the user asked for is running;
 * - `ready`: the exact pinned commit is there, verified.
 */
export const BMAD_SOURCE_STATES = ['missing', 'downloading', 'ready'] as const;
export const BmadSourceState = z.enum(BMAD_SOURCE_STATES);
export type BmadSourceState = z.infer<typeof BmadSourceState>;

/** The pinned BMad Method's state, its version as upstream names it, and the full commit it is pinned to. */
export const BmadSourceStatus = z.object({
  state: BmadSourceState,
  version: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
});
export type BmadSourceStatus = z.infer<typeof BmadSourceStatus>;

/** `GET` and `POST /api/v1/bmad/source`: the status itself (after a download, `ready`). */
export const BmadSourceResponse = BmadSourceStatus;
export type BmadSourceResponse = BmadSourceStatus;

/** One upstream source in the lock (`bmad-lock.json`): repo, the ref its commit is reachable from, and the content hash of `include`. */
export const BmadLockSource = z.object({
  /** GitHub `owner/name`. */
  repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  /** The upstream branch or tag the commit must be in the history of (CI checks it). */
  ref: z.string().min(1),
  /** The full commit SHA. */
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  /** The version as upstream names it at that commit. */
  version: z.string().min(1),
  /** The folder of the tree that is used, ending in `/`, or `''` for the whole tree. */
  include: z
    .string()
    .regex(/^(?:[A-Za-z0-9_.-]+\/)*$/)
    .refine((include) => include.split('/').every((segment) => segment !== '.' && segment !== '..'), 'A folder inside the tree, without . or .. segments.'),
  /** Pinned build requirements for `uv` (bmad-loop). */
  buildConstraints: z.array(z.string().min(1)).optional(),
  /** `sha256:<hex>` over the selected files' paths and LF-normalized contents. */
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type BmadLockSource = z.infer<typeof BmadLockSource>;

/** The lock: every pinned upstream source, by name. */
export const BmadLock = z.object({ sources: z.object({ 'bmad-method': BmadLockSource, 'bmad-loop': BmadLockSource }) });
export type BmadLock = z.infer<typeof BmadLock>;

/** `bmad_not_downloaded` (409): a surface that runs BMad Method's scripts was used before the pinned BMad Method was downloaded. */
export const BMAD_NOT_DOWNLOADED_MESSAGE = 'Ogden Agents needs to download BMad Method first. Download it, then try again.';
/** `bmad_download_failed` (503): the download didn't arrive (offline, an HTTP error, too slow or too large). */
export const BMAD_DOWNLOAD_OFFLINE_MESSAGE = "Ogden Agents couldn't download BMad Method. Check your internet connection, then try again.";
/** `bmad_download_failed` (502): what arrived isn't the pinned BMad Method, so nothing was saved. */
export const BMAD_DOWNLOAD_INTEGRITY_MESSAGE =
  "The BMad Method download didn't match the version this Ogden Agents release expects, so nothing was saved. Try again later.";
/** The Board's notice when BMad Method isn't downloaded yet. */
export const BMAD_NOT_DOWNLOADED_TEXT = 'Board runs BMad Method, which Ogden Agents downloads once from GitHub and checks before it uses it.';
/** The button that downloads it. */
export const BMAD_DOWNLOAD_LABEL = 'Download BMad Method';
/** Said while it downloads. */
export const BMAD_DOWNLOADING_TEXT = 'Downloading BMad Method';

// ---- User-facing texts ----

/** `tickets_unavailable` (503): the tickets couldn't be read (no active initiative, a bad tree, a timeout). */
export const TICKETS_UNAVAILABLE_MESSAGE =
  "Ogden Agents couldn't read this project's tickets. Check that BMad Method is set up with an active initiative, then try again.";
/** `tickets_unavailable` (503) when there is no usable uv to run BMad Method's scripts with. */
export const TICKETS_UV_MISSING_MESSAGE = 'Reading tickets needs uv. Install it in Settings → Tools, then try again.';
/** `tickets_unavailable` (503) when the project keeps its tickets in a tracker, so `tickets.py mark` refuses. */
export const TICKETS_STORE_REFUSED_MESSAGE = "This project's tickets live in a tracker, so Ogden Agents can't change their status here.";
/** `status_not_allowed` (409): `done` (or another status the board may not set) was asked for. */
export const STATUS_NOT_ALLOWED_MESSAGE = 'Only approving the work marks a ticket done.';
/** `bmad_not_set_up` (409): a piece that needs BMad Method installed was used in a project without it. */
export const BMAD_NOT_SET_UP_MESSAGE = "BMad Method isn't set up in this project yet. Set it up, then try again.";
/** `reduced_mode` (409): the project's BMad Method lacks the capability this needs (AD-14). */
export const REDUCED_MODE_MESSAGE = "This project's BMad Method can't do this yet. Upgrade this project, then try again.";

/** The Plan page's title. */
export const PLAN_PAGE_TITLE = 'Plan';
/** The accessible name of the Plan page's list of skills. */
export const PLAN_SKILLS_LABEL = 'Skills';
/** Each skill row's button. */
export const PLAN_START_LABEL = 'Start';
/** Said while the skills load. */
export const PLAN_LOADING_TEXT = 'Loading the skills';
/** The Plan page with no installed skills. */
export const PLAN_EMPTY_TITLE = 'No BMad Method skills are installed in this project.';
/** The fallback when the skills couldn't be loaded. */
export const PLAN_LOAD_FAILED = "Ogden Agents couldn't load this project's skills";
/** The fallback when a planning session couldn't be started. */
export const PLAN_START_FAILED = "Ogden Agents couldn't start that skill";
/** The Plan page's one primary action. */
export const PLAN_IDEA_ACTION = 'Start from an idea';
/** The accessible name of the idea's one-line prompt. */
export const PLAN_IDEA_LABEL = 'Your idea';
/** The idea prompt's placeholder. */
export const PLAN_IDEA_PLACEHOLDER = 'What do you want to build?';
/** The tag on a module installed in the last {@link NEW_TAG_DAYS} days. */
export const PLAN_NEW_TAG = 'New';
/** Said under "Start from an idea" while the project's catalog names no entry action (story 4.6). Unused since entry 4.11, whose reduced-mode notice says {@link PLAN_ENTRY_REDUCED_TEXT}; kept for compatibility. */
export const PLAN_IDEA_UNAVAILABLE_TEXT = "Starting from an idea isn't available in this project yet. Pick an action below instead.";
/** The idea's button. */
export const PLAN_IDEA_START_LABEL = 'Start';
/** The link from the Plan page with Planning off to the project's settings. */
export const PLAN_OPEN_SETTINGS_LABEL = 'Open project settings';
/** The accessible name of the Plan page's grouped actions. */
export const PLAN_ACTIONS_LABEL = 'Actions';
/** Said while the Plan page checks the project's settings (whether Planning is on). */
export const PLAN_PROJECT_LOADING_TEXT = 'Loading the project';

/** One group of the Plan page: its key (a {@link CatalogGroup}, or `other`), heading and skills in catalog order. */
export interface CatalogSkillGroup {
  key: CatalogGroup | 'other';
  label: string;
  skills: CatalogSkill[];
}

/**
 * The catalog's skills in the Plan page's groups (story 4.6): in
 * {@link catalogGroupRank} order, each group once, a group with no skill
 * left out, and an unknown or missing group together last as
 * {@link CATALOG_OTHER_GROUP_LABEL}. Stable: skills keep their order within a group.
 */
export function groupCatalogSkills(skills: readonly CatalogSkill[]): CatalogSkillGroup[] {
  const groups = new Map<number, CatalogSkillGroup>();
  for (const skill of skills) {
    const rank = catalogGroupRank(skill.group);
    let group = groups.get(rank);
    if (group === undefined) {
      const known = CATALOG_GROUPS[rank];
      group = { key: known ?? 'other', label: catalogGroupLabel(known ?? null), skills: [] };
      groups.set(rank, group);
    }
    group.skills.push(skill);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}

/** The Board page's title. */
export const BOARD_PAGE_TITLE = 'Board';
/** The accessible name of the Board page's list of tickets. */
export const BOARD_TICKETS_LABEL = 'Tickets';
/** Said while the tickets load. */
export const BOARD_LOADING_TEXT = 'Loading the tickets';
/** The Board page with no tickets. */
export const BOARD_EMPTY_TITLE = 'No tickets yet.';
/** The fallback when the tickets couldn't be loaded. */
export const BOARD_LOAD_FAILED = "Ogden Agents couldn't load this project's tickets";
/** The heading over what `tickets.py` couldn't read. */
export const BOARD_PROBLEMS_TITLE = 'Some ticket files could not be read';
/** The filter that shows dropped tickets (in no column otherwise). */
export const BOARD_SHOW_DROPPED_LABEL = 'Show dropped tickets';
/** A card's line when a prerequisite is unmet ("Waits for 1.2"). */
export function boardWaitsForText(refs: readonly TicketLink[]): string {
  return `Waits for ${refs.map(String).join(', ')}`;
}
/** A card menu's item that sets a status ("Move to Ready"). */
export function boardMoveToText(column: BoardColumn): string {
  return `Move to ${BOARD_COLUMN_LABELS[column]}`;
}
/** The fallback when a ticket couldn't be loaded. */
export const TICKET_LOAD_FAILED = "Ogden Agents couldn't load this ticket";
/** The fallback when a status change couldn't be saved. */
export const TICKET_MARK_FAILED = "Ogden Agents couldn't change this ticket's status";

// ---- The board and its ticket detail (story 4.9) ----

/** The accessible name of the board's list of epics. */
export const BOARD_EPICS_LABEL = 'Epics';
/** The heading over an epic's dropped tickets (shown only with the dropped filter on), and a dropped card's status line. */
export const BOARD_DROPPED_LABEL = 'Dropped';
/** The heading of tickets that sit in no epic. */
export const BOARD_NO_EPIC_TITLE = 'Not in an epic';
/** The one-line notice when `tickets.py` couldn't read some files ("Some ticket files could not be read (2)"). */
export function boardProblemsLine(count: number): string {
  return `${BOARD_PROBLEMS_TITLE} (${count})`;
}
/** The button that shows the problems' details. */
export const BOARD_SHOW_DETAILS_LABEL = 'Show details';
/** The button that hides them again. */
export const BOARD_HIDE_DETAILS_LABEL = 'Hide details';
/** The detail sheet when no ticket has that ref (404). */
export function TICKET_NOT_FOUND(ref: string): string {
  return `No ticket ${ref} in this project.`;
}
/** Said while a ticket's detail loads. */
export const TICKET_LOADING_TEXT = 'Loading the ticket';
/** The detail sheet's section headings. */
export const TICKET_STATUS_HEADING = 'Status';
export const TICKET_SUMMARY_HEADING = 'Plan summary';
export const TICKET_VERIFY_HEADING = 'How it is checked';
export const TICKET_PREREQUISITES_HEADING = 'Prerequisites';
export const TICKET_NOTES_HEADING = 'Notes';
export const TICKET_REFERENCES_HEADING = 'References';
export const TICKET_UNKNOWN_HEADING = 'Open question';
/** The plan summary of a ticket with no description yet. */
export const TICKET_NO_PLAN_TEXT = 'No plan summary yet.';
/** The prerequisites section of a ticket that waits for nothing. */
export const TICKET_NO_PREREQUISITES_TEXT = 'No prerequisites.';
/** A prerequisite that is done or in review. */
export const TICKET_PREREQUISITE_MET_TEXT = 'Met';
/** A prerequisite that isn't yet. */
export const TICKET_PREREQUISITE_WAITING_TEXT = 'Waiting';
/** A blocked card's status line: the word, then the reason when it has one ("Blocked: Needs the API key"). */
export function boardBlockedText(reason: string): string {
  const trimmed = reason.trim();
  return trimmed === '' ? BOARD_COLUMN_LABELS.blocked : `${BOARD_COLUMN_LABELS.blocked}: ${trimmed}`;
}
/** A card's accessible name: its ref, title and status line ("1.3 Build the third thing, Waits for 1.2"). */
export function boardCardLabel(ref: string, title: string, statusLine: string): string {
  return `${ref} ${title}, ${statusLine}`;
}

// ---- Changing a ticket's status from the board (story 4.10) ----

/** `ticket_changed` (409): the ticket's status changed since the board showed it, so nothing was written. */
export const TICKET_CHANGED_MESSAGE = 'This ticket changed since the board showed it, so its status was not changed. Check the board, then try again.';
/** The status menu's visible trigger text and the detail sheet's button. */
export const BOARD_CHANGE_STATUS_LABEL = 'Change status';
/** The status menu trigger's accessible name on a card ("Change status of 1.2 Build the thing"). */
export function boardChangeStatusLabel(ref: string, title: string): string {
  return `${BOARD_CHANGE_STATUS_LABEL} of ${ref} ${title}`;
}
/** The status menu's item that drops a ticket. */
export const BOARD_DROP_LABEL = 'Drop this ticket';
/** The status menu's item for `status` ("Move to Ready", "Drop this ticket"). */
export function boardStatusActionText(status: TicketStatus): string {
  const column = COLUMN_OF_STATUS[status];
  return column === null ? BOARD_DROP_LABEL : boardMoveToText(column);
}
/** Where `status` puts a ticket, in words ("Ready", "Dropped"). */
export function boardStatusPlaceText(status: TicketStatus): string {
  const column = COLUMN_OF_STATUS[status];
  return column === null ? BOARD_DROPPED_LABEL : BOARD_COLUMN_LABELS[column];
}
/** Announced once a status change landed ("1.2 moved to Ready"). */
export function boardMovedText(ref: string, label: string): string {
  return `${ref} moved to ${label}`;
}
/** Said while a status change is saved. */
export const TICKET_SAVING_TEXT = 'Saving the status';
/** The blocked reason dialog's title. */
export const BOARD_BLOCKED_DIALOG_TITLE = 'Why is this ticket blocked?';
/** The blocked reason form's title, naming the ticket ("Why is 1.2 blocked?"). */
export function boardBlockedDialogTitle(ref: string): string {
  return `Why is ${ref} blocked?`;
}
/** A status change that failed, naming the ticket, then the server's plain message. */
export function boardMarkFailedText(ref: string, message: string): string {
  return `Couldn't change ${ref}'s status. ${message}`;
}
/** Announced when a dropped ticket left the board because dropped tickets are hidden. */
export function boardDroppedHiddenText(ref: string): string {
  return `${boardMovedText(ref, BOARD_DROPPED_LABEL)}. Turn on ${BOARD_SHOW_DROPPED_LABEL} to see it.`;
}
/** The blocked reason field's label. */
export const BOARD_BLOCKED_REASON_LABEL = 'Reason';
/** The blocked reason dialog's confirm button. */
export const BOARD_BLOCKED_SAVE_LABEL = 'Save';
/** The blocked reason dialog's cancel button. */
export const BOARD_BLOCKED_CANCEL_LABEL = 'Cancel';

// ---- Reopening a Done ticket from the board (story 4.10, user decision 2026-10-02) ----

/** `reopen_not_confirmed` (409): a change to a Done ticket that wasn't confirmed as a reopen. */
export const REOPEN_NOT_CONFIRMED_MESSAGE = 'This ticket is done. Confirm that you want to reopen it, then try again.';
/** The reopen confirmation's title. */
export const BOARD_REOPEN_DIALOG_TITLE = 'Reopen this ticket?';
/** The reopen confirmation's one sentence: what happens ("1.2 is done. It moves to Ready and needs approving again."). */
export function boardReopenDescription(ref: string, status: TicketStatus): string {
  const column = COLUMN_OF_STATUS[status];
  const place = column === null ? `${ref} is done. It is dropped` : `${ref} is done. It moves to ${BOARD_COLUMN_LABELS[column]}`;
  return `${place} and needs approving again to be done.`;
}
/** The reopen confirmation's confirm button. */
export const BOARD_REOPEN_CONFIRM_LABEL = 'Reopen';
/** The reopen confirmation's cancel button. */
export const BOARD_REOPEN_CANCEL_LABEL = 'Cancel';

/** The setup panel's button (Plan and Board, a piece on without `_bmad/`). */
export const BMAD_SET_UP_LABEL = 'Set up';
/** The reduced-mode notice's button (entry 4.11): upgrades the project's BMad Method from the verified pinned copy, after a confirmation. */
export const BMAD_UPGRADE_LABEL = 'Upgrade this project';
/** The reduced-mode notice on Plan when the project's BMad Method has plain labels but not the skill that starts from an idea (entry 4.11). */
export const PLAN_ENTRY_REDUCED_TEXT = "This project's BMad Method doesn't include the action that starts from an idea, so pick an action below instead.";
/** Upgrade this project's confirmation title (entry 4.11). */
export const BMAD_UPGRADE_CONFIRM_TITLE = 'Upgrade this project?';
/** Upgrade this project's confirmation sentence: what it downloads, writes and keeps. */
export const BMAD_UPGRADE_CONFIRM_TEXT =
  "Ogden Agents downloads BMad Method if needed, adds the actions this project is missing and updates BMad Method's own scripts, keeping the values you set and your changes.";
/** The confirmation's button that upgrades. */
export const BMAD_UPGRADE_CONFIRM = 'Upgrade';
/** The confirmation's button that changes nothing. */
export const BMAD_UPGRADE_CANCEL = 'Cancel';
/** Said when an upgrade finished. */
export const BMAD_UPGRADE_DONE_TEXT = "Upgraded. This project's BMad Method now has what Ogden Agents uses.";
/**
 * Why an upgrade was refused, nothing written (entry 4.11): part of the
 * project's BMad Method (its folder, skills folder, settings or output
 * folder) is a link, a file, too large, or points outside the project.
 */
export const BMAD_UPGRADE_REFUSED_TEXT =
  "Ogden Agents can't upgrade this project because part of its BMad Method folder is a link or points outside the project. Fix the _bmad folder, then try again.";
/** The settings' status line when a setup was started but not finished in a project with `_bmad/` (entry 4.11): Upgrade finishes it. */
export const BMAD_SETUP_OWED_UPGRADE_TEXT = "BMad Method's setup in this project isn't finished. Upgrade this project to finish it.";
/** The setup panel's sentence when BMad Method isn't set up. */
export const BMAD_NOT_SET_UP_TEXT = "BMad Method isn't set up in this project yet. Setting it up adds its files to this project's folder.";
/** Said when a setup finished and the project reports current. */
export const BMAD_SETUP_DONE_TEXT = 'Ready to plan.';
/** The fallback when a setup couldn't run. */
export const BMAD_SETUP_FAILED = "Ogden Agents couldn't set up BMad Method in this project";
/** The setup status line when a newer pinned version exists. */
export function bmadUpdateAvailableText(installed: string, bundled: string): string {
  return `This project has BMad Method ${installed}. Version ${bundled} is available.`;
}
/** `bmad_already_set_up` (409, story 4.3): setup was asked for in a project that already has BMad Method. */
export const BMAD_ALREADY_SET_UP_MESSAGE = 'BMad Method is already set up in this project.';
/** Why a setup failed (story 4.3), as `bmad.setup_failed`'s `reason`: plain words, never a path or the script's output. */
export const BMAD_SETUP_FAILURE_REASONS = {
  uv_missing: 'Setting up BMad Method needs uv. Install it in Settings → Tools, then try again.',
  not_writable: "Ogden Agents couldn't write to this project's folder. Check that you can change files there, then try again.",
  timeout: 'Setting up BMad Method took too long. Try again.',
  failed: "Ogden Agents couldn't set up BMad Method in this project. Try again.",
  /** Upgrade this project refused before writing anything (entry 4.11). */
  upgrade_refused: BMAD_UPGRADE_REFUSED_TEXT,
} as const;
export type BmadSetupFailureReason = keyof typeof BMAD_SETUP_FAILURE_REASONS;
/** The settings' status line when the project's BMad Method is current. */
export function bmadSetupCurrentText(installed: string): string {
  return `BMad Method ${installed} is set up in this project.`;
}
/** The settings' status line when a setup was started but not finished. */
export const BMAD_SETUP_OWED_TEXT = "BMad Method's setup in this project isn't finished. Set it up again.";
/** The settings' status line when `_bmad/` is there but can't be read. */
export const BMAD_SETUP_UNUSABLE_TEXT = "Ogden Agents can't read this project's BMad Method setup.";
/** A problem line: the project's `_bmad` entry is a link or a file, not a folder. */
export const BMAD_SETUP_NOT_A_FOLDER_TEXT = "This project's BMad Method folder is a link or a file, not a folder.";
/** A problem line: the version of the project's installed BMad Method can't be read. */
export const BMAD_SETUP_VERSION_UNKNOWN_TEXT = "Ogden Agents can't read which BMad Method version this project has.";
/** A problem line: the project's settings don't name a usable output folder. */
export const BMAD_SETUP_OUTPUT_FOLDER_PROBLEM = "This project's BMad Method settings name an output folder outside the project.";
/** The accessible name of the setup panel's progress list. */
export const BMAD_SETUP_PROGRESS_LABEL = 'Setting up BMad Method';
/** The setup panel's button after a failure. */
export const BMAD_SET_UP_AGAIN_LABEL = 'Set up again';
/** Said while the settings' setup status loads. */
export const BMAD_SETUP_CHECKING_TEXT = 'Checking BMad Method in this project';
/** The document card's button that opens a written document. */
export const DOCUMENT_OPEN_LABEL = 'Open';

// ---- Document cards and the next suggested step (story 4.7) ----

/** The most of a document `GET …/documents` answers, in bytes: a longer one is cut there (`truncated: true`). */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

/** A document as `GET …/documents` answers it: its path, its text (at most {@link MAX_DOCUMENT_BYTES}) and whether it was cut. */
export const PlanningDocument = z.object({ path: RepoRelativePath, content: z.string(), truncated: z.boolean() });
export type PlanningDocument = z.infer<typeof PlanningDocument>;

/** `GET /api/v1/workspaces/:wsId/documents?path=`: one document a planning session wrote. */
export const DocumentResponse = z.object({ document: PlanningDocument });
export type DocumentResponse = z.infer<typeof DocumentResponse>;

/** `invalid_request` (400): the path isn't a Markdown file inside the project's output folder. */
export const DOCUMENT_INVALID_PATH_MESSAGE = "That isn't a Markdown document in this project's output folder.";
/** The document sheet when the file is gone (404). */
export const DOCUMENT_NOT_FOUND_TEXT = "This document isn't there any more. It may have been moved or deleted.";
/** The fallback when a document couldn't be loaded. */
export const DOCUMENT_LOAD_FAILED = "Ogden Agents couldn't open this document";
/** Said while a document loads. */
export const DOCUMENT_LOADING_TEXT = 'Loading the document';
/** Said above a document cut at {@link MAX_DOCUMENT_BYTES}. */
export const DOCUMENT_TRUNCATED_TEXT = 'This document is long, so only its first part is shown.';
/** The fallback when the next suggested step couldn't be started. */
export const DOCUMENT_NEXT_FAILED = "Ogden Agents couldn't start the next step";
/** The document card's caption over its file name. */
export const DOCUMENT_CARD_CAPTION = 'Document written';

/** A document card's accessible name ("Document spec-x.md"). */
export function documentCardLabel(name: string): string {
  return `Document ${name}`;
}

/** A document's file name: the last segment of its repo-relative path. */
export function documentFileName(path: string): string {
  return path.split('/').filter((segment) => segment !== '').at(-1) ?? path;
}
