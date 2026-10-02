import { z } from 'zod';

/**
 * Epic 4's tracer contract (story 4.1): the catalog of a project's installed
 * BMad Method skills, starting a planning session on one, and the project's
 * tickets as `tickets.py status` reports them. Every shape and user-facing
 * text of the Plan and Board pages lives here; story 4.2 freezes them.
 *
 * Nothing here names a skill (AD-12): the catalog is read from the repo's
 * installed `SKILL.md` frontmatter, and the agent adapter turns a skill name
 * into the text that invokes it.
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

/** One installed skill, from its `SKILL.md` frontmatter. `description` is empty when the skill gives none. */
export const CatalogSkill = z.object({ name: SkillName, description: z.string() });
export type CatalogSkill = z.infer<typeof CatalogSkill>;

/** `GET /api/v1/workspaces/:wsId/catalog`: the project's installed skills, by name. */
export const CatalogResponse = z.object({ skills: z.array(CatalogSkill) });
export type CatalogResponse = z.infer<typeof CatalogResponse>;

/**
 * `POST /api/v1/workspaces/:wsId/planning-sessions`: start a planning
 * session on `skill`, which must be in the project's catalog (else 404).
 * Answered 201 with `SessionResponse` (a session of kind `planning`).
 */
export const StartPlanningRequest = z.object({ skill: SkillName });
export type StartPlanningRequest = z.infer<typeof StartPlanningRequest>;

// ---- The board ----

/**
 * One ticket as `tickets.py status` reports it (AD-10: ticket state lives
 * only in the BMad files; Ogden Agents stores none of it). Field names are
 * the script's own; a field it leaves out is `null`.
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
  /** The plan's `status` (empty when no build has started). */
  status: z.string().nullable(),
  /** `planned`, `backlog`, `in-progress`, `review`, `done` or `dropped`. */
  state: z.string(),
  blocked_reason: z.string().nullable(),
});
export type TicketRow = z.infer<typeof TicketRow>;

/** `GET /api/v1/workspaces/:wsId/tickets`: every ticket in build order, and what `tickets.py` couldn't read. */
export const TicketsResponse = z.object({ tickets: z.array(TicketRow), problems: z.array(z.string()) });
export type TicketsResponse = z.infer<typeof TicketsResponse>;

// ---- User-facing texts ----

/** `tickets_unavailable` (503): the tickets couldn't be read (no active initiative, a bad tree, a timeout). */
export const TICKETS_UNAVAILABLE_MESSAGE =
  "Ogden Agents couldn't read this project's tickets. Check that BMad Method is set up with an active initiative, then try again.";
/** `tickets_unavailable` (503) when there is no usable uv to run BMad Method's scripts with. */
export const TICKETS_UV_MISSING_MESSAGE = 'Reading tickets needs uv. Install it in Settings → Tools, then try again.';

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
