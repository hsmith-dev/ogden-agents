import { z } from 'zod';
import { RepoRelativePath } from './planning-setup.js';

/**
 * Epic 7's contract (story 7.1, the tracer; story 7.2 freezes the rest):
 * looking back on an epic from the board. A look-back is an ordinary
 * planning session (AD-8) whose first message invokes the project's
 * retrospective skill on the epic's folder (AD-12: nothing here names a
 * skill; the agent adapter formats the invocation). It serves the
 * `retrospectives` piece (AD-22) and, because it runs the project's BMad
 * Method scripts, needs the project's script trust.
 *
 * No user-facing text here holds an em or en dash.
 */

/**
 * An epic as a route names it (`:epic`): the epic's folder name under the
 * initiative, which is the `slug` the board gets from `tickets.py`. Letters,
 * digits, dots, dashes and underscores, starting with a letter or digit, at
 * most 128 characters: never a slash, a space or an option (`-x`).
 */
export const EPIC_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** An epic's slug as a route takes it, checked against {@link EPIC_SLUG_PATTERN}. */
export const EpicSlugParam = z.string().regex(EPIC_SLUG_PATTERN, 'That is not the name of an epic.');
export type EpicSlugParam = z.infer<typeof EpicSlugParam>;

/** The button on an epic's header that starts a look-back (EXPERIENCE.md Board). */
export const LOOK_BACK_LABEL = 'Look back on this epic';

/** The fallback when a look-back couldn't start. */
export const LOOK_BACK_FAILED = "Ogden Agents couldn't start the look back";

/** `not_found` (404) from the look-back route: the board has no such epic. */
export const LOOK_BACK_EPIC_NOT_FOUND_MESSAGE = "That epic isn't on this project's board.";

/** `not_found` (404) from the step route: that skill is not one of the retrospective's next steps. */
export const LOOK_BACK_STEP_NOT_OFFERED_MESSAGE = "That step isn't offered for this retrospective.";


// ---- Story 7.2: the rest of epic 7's contract ----

/** The file a look-back leaves in an epic's folder ends like this (`<epic folder name>-retrospective.md`, tree-rules.md). */
export const RETROSPECTIVE_FILE_SUFFIX = '-retrospective.md';

/**
 * A retrospective's verdict, as the skill writes it in the file's frontmatter
 * (`verdict`). Only this field and the date are read, never the prose (AD-10).
 */
export const RETROSPECTIVE_VERDICTS = ['accepted', 'accepted-with-open-items', 'rejected'] as const;
export const RetrospectiveVerdict = z.enum(RETROSPECTIVE_VERDICTS);
export type RetrospectiveVerdict = z.infer<typeof RetrospectiveVerdict>;

/** The verdict chip's words on an epic header (`rejected` is the skill's wording for no human decision). */
export const RETROSPECTIVE_VERDICT_LABELS: Readonly<Record<RetrospectiveVerdict, string>> = {
  accepted: 'Accepted',
  'accepted-with-open-items': 'Accepted with open items',
  rejected: 'Not accepted',
};

/** The one line shown when a retrospective file exists but its verdict can't be read. */
export const RETROSPECTIVE_UNREADABLE_TEXT = "This epic's retrospective has no verdict Ogden Agents can read.";

/**
 * An epic's retrospective as the board's tree reports it, read from the file
 * beside the epic by the `tickets-v7` adapter (story 7.4): `path` repo-relative
 * and `/`-separated; `verdict` and `date` from the frontmatter, `null` when
 * missing or unreadable, with `problem` then holding {@link RETROSPECTIVE_UNREADABLE_TEXT}.
 */
export const EpicRetrospective = z.object({
  path: RepoRelativePath.max(512),
  verdict: RetrospectiveVerdict.nullable(),
  /** The frontmatter's `date` as written (a date or a date and time), at most 40 characters. */
  date: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[0-9TZtz:+\-. ]+$/, 'A date holds digits and date punctuation only.')
    .nullable(),
  problem: z.string().max(200).nullable().default(null),
});
export type EpicRetrospective = z.infer<typeof EpicRetrospective>;

/**
 * What a look-back is told of one build run of the epic's tickets (E7-R2,
 * user decision 2026-10-02): outcome, verification result, blocked reason and
 * duration from Ogden's own run records. Never a transcript, a diff or a
 * path: the shape has no field that could hold one.
 */
export const EpicBuildSummary = z.object({
  ticketRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  /** The run's outcome (`verified`, `failed`, `blocked`, `stopped`; a run still going is left out). */
  outcome: z.enum(['verified', 'failed', 'blocked', 'stopped']),
  /** `passed`, `failed`, or `not_checked` when no verification ran. */
  verification: z.enum(['passed', 'failed', 'not_checked']),
  /** Why a blocked run was blocked, in the plain sentence the run view shows; else `null`. */
  blockedReason: z.string().max(500).nullable(),
  /** From the run's start to its last update, in whole seconds. */
  durationSeconds: z.number().int().nonnegative(),
  /** What the user decided on review: `approved`, `rejected`, or `null` while undecided. */
  decision: z.enum(['approved', 'rejected']).nullable(),
});
export type EpicBuildSummary = z.infer<typeof EpicBuildSummary>;

/** The most build summaries a look-back's first message carries (the newest runs). */
export const MAX_EPIC_BUILD_SUMMARIES = 40;

/**
 * `GET …/look-back-offers` (story 7.2; the finished-epic offer, E7-R3): the
 * epics whose offer the user answered with Not now. The offer itself is
 * derived from the ticket index (every ticket `done` or `dropped`) and needs
 * no event.
 */
export const LookBackOffersResponse = z.object({ dismissed: z.array(z.string().regex(EPIC_SLUG_PATTERN)).max(1000) });
export type LookBackOffersResponse = z.infer<typeof LookBackOffersResponse>;

/** The offer on a finished epic's header (EXPERIENCE.md State Patterns, "Epic finished"). */
export const LOOK_BACK_OFFER_TEXT = 'Every ticket in this epic is done. Look back on it?';
export const LOOK_BACK_OFFER_ACCEPT_LABEL = 'Look back';
export const LOOK_BACK_OFFER_DISMISS_LABEL = 'Not now';
/** The one line under the button of an epic with unfinished tickets (user decision 2026-10-02). */
export const LOOK_BACK_UNFINISHED_NOTE = 'Some tickets are not done yet, so the look back will record this epic as not accepted.';

/**
 * `POST …/epics/:epic/retrospective/sessions` (story 7.2; served by 7.5):
 * starts a planning session on one of the retrospective's next steps (the
 * catalog's `nexts` of the look-back action), with the epic's retrospective
 * file as its argument. `skill` must be one of those next steps, else 404.
 */
export const StartRetrospectiveStepRequest = z.object({ skill: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'That is not the name of a skill.') });
export type StartRetrospectiveStepRequest = z.infer<typeof StartRetrospectiveStepRequest>;

/**
 * `POST …/epics/:epic/retrospective/save` (story 7.2; served by 7.5):
 * **Save the lessons for later builds** commits exactly `AGENTS.md` and the
 * epic's retrospective file to the branch the main checkout has checked out,
 * locally, never pushed. `paths` are the ones committed (repo-relative);
 * `revision` the new commit.
 */
export const SaveLessonsResponse = z.object({
  paths: z.array(RepoRelativePath.max(512)).min(1).max(2),
  revision: z.string().regex(/^[0-9a-f]{40,64}$/),
});
export type SaveLessonsResponse = z.infer<typeof SaveLessonsResponse>;

/** `nothing_to_save` (409): neither `AGENTS.md` nor the retrospective file has a change to commit. */
export const NOTHING_TO_SAVE_MESSAGE = 'There is nothing new to save: the lessons are already saved.';
/** `checkout_busy` (409): a merge, rebase, cherry-pick or revert is in progress in the project's checkout. */
export const LESSONS_CHECKOUT_BUSY_MESSAGE = 'Finish or abort the merge or rebase in this project first, then save the lessons.';
/** `agents_file_missing` (409): the project has no `AGENTS.md` (or git ignores it) to carry the lessons. */
export const LESSONS_NO_AGENTS_FILE_MESSAGE = "This project has no AGENTS.md that git tracks, so the lessons can't be saved for later builds. Add the lessons to AGENTS.md first.";
export const SAVE_LESSONS_LABEL = 'Save the lessons for later builds';
export const SAVE_LESSONS_NOTE = 'Later builds will follow these lessons.';
export const SAVE_LESSONS_FAILED = "Ogden Agents couldn't save the lessons";
export const ADD_LESSONS_FAILED = "Ogden Agents couldn't start that step";
