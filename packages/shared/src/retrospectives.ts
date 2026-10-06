import { z } from 'zod';

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

/** `not_found` (404) from the look-back route: the project's BMad Method has no look-back step. */
export const LOOK_BACK_UNAVAILABLE_MESSAGE = "This project's BMad Method has no step for looking back on an epic.";
