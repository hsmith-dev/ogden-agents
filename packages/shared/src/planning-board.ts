import { z } from 'zod';

/**
 * The board (story 4.1, frozen by 4.2): the project's tickets as
 * `tickets.py` reports them, their columns and statuses, and a ticket's
 * detail and status change.
 *
 * Part of epic 4's contract, split out of `planning.ts` (entry 4.12), which
 * re-exports it under the same names.
 */

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
