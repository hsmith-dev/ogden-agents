import { BOARD_COLUMN_LABELS, boardColumnOf, BoardColumn, TicketLink, TicketStatus } from './planning-board.js';
import { CATALOG_GROUPS, CatalogGroup, catalogGroupLabel, catalogGroupRank, CatalogSkill } from './planning-catalog.js';

/**
 * The user-facing texts of the Plan and Board pages (stories 4.1 to 4.11):
 * the Plan home, the board and its ticket detail (4.9), changing a ticket's
 * status and reopening a Done one (4.10).
 *
 * Part of epic 4's contract, split out of `planning.ts` (entry 4.12), which
 * re-exports it under the same names.
 */

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
  const column = boardColumnOf({ status, state: '' });
  return column === null ? BOARD_DROP_LABEL : boardMoveToText(column);
}
/** Where `status` puts a ticket, in words ("Ready", "Dropped"). */
export function boardStatusPlaceText(status: TicketStatus): string {
  const column = boardColumnOf({ status, state: '' });
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
  const column = boardColumnOf({ status, state: '' });
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
