import {
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS,
  BOARD_DROPPED_LABEL,
  BOARD_NO_EPIC_TITLE,
  boardBlockedText,
  boardColumnOf,
  boardWaitsForText,
  type BoardColumn,
  type TicketEpic,
  type TicketLink,
  type TicketRow,
  type TicketsResponse,
} from '@ogden-agents/shared';

/**
 * The board's pure model (story 4.9): tickets grouped by epic in build order,
 * each epic's status columns, and each card's one status line. The column is
 * `boardColumnOf(row)` (AD-8, AD-10): the files alone, never sessions or runs.
 */

/** One epic on the board: its folder slug, title, id (when the tree names it), its columns and its dropped tickets. */
export interface BoardEpicGroup {
  /** The epic folder (`''` for tickets in none). */
  slug: string;
  title: string;
  id: number | null;
  columns: ReadonlyArray<{ column: BoardColumn; rows: readonly TicketRow[] }>;
  /** Dropped tickets, filled only with the dropped filter on. */
  dropped: readonly TicketRow[];
}

/** `epic-planning-and-board` → "Planning and board". */
export function humanEpicTitle(slug: string): string {
  if (slug === '') return BOARD_NO_EPIC_TITLE;
  const words = slug.replace(/^epic-/, '').replace(/[-_]+/g, ' ').trim();
  if (words === '') return slug;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Groups the tickets by epic, in the order the epics first appear in build
 * order; inside each epic, the columns in {@link BOARD_COLUMNS} order. A
 * dropped ticket (`boardColumnOf` is `null`) is in no column; with
 * `showDropped` it is listed in the epic's dropped list, else left out (an
 * epic with only dropped tickets is then left out too).
 */
export function groupBoard(response: Pick<TicketsResponse, 'tickets' | 'epics'>, showDropped: boolean): BoardEpicGroup[] {
  const epicsBySlug = new Map<string, TicketEpic>(response.epics.map((epic) => [epic.slug, epic]));
  const groups = new Map<string, { columns: Map<BoardColumn, TicketRow[]>; dropped: TicketRow[] }>();
  for (const row of response.tickets) {
    const column = boardColumnOf(row);
    if (column === null && !showDropped) continue;
    const slug = row.epic ?? '';
    let group = groups.get(slug);
    if (group === undefined) {
      group = { columns: new Map(BOARD_COLUMNS.map((each) => [each, []])), dropped: [] };
      groups.set(slug, group);
    }
    if (column === null) group.dropped.push(row);
    else group.columns.get(column)!.push(row);
  }
  return [...groups].map(([slug, group]) => ({
    slug,
    title: humanEpicTitle(slug),
    id: epicsBySlug.get(slug)?.id ?? null,
    columns: BOARD_COLUMNS.map((column) => ({ column, rows: group.columns.get(column)! })),
    dropped: group.dropped,
  }));
}

/** A prerequisite as the board shows it: the ref (or the link as written) and whether it is met. */
export interface Prerequisite {
  label: string;
  met: boolean;
}

/** A prerequisite ticket is met once it is done or in review (`tickets.py` `classify`). */
const MET_STATES = new Set(['done', 'review']);

/** The tickets and epics looked up by ref, by epic and id, and by slug: built once per response. */
export interface TicketIndex {
  byRef: ReadonlyMap<string, TicketRow>;
  /** Key: `${epic}\u0000${id}`. */
  bySibling: ReadonlyMap<string, TicketRow>;
  epicBySlug: ReadonlyMap<string, TicketEpic>;
}

const siblingKey = (epic: string | null, id: TicketLink | null) => `${epic ?? ''}\u0000${String(id)}`;

export function indexTickets(rows: readonly TicketRow[], epics: readonly TicketEpic[]): TicketIndex {
  const byRef = new Map<string, TicketRow>();
  const bySibling = new Map<string, TicketRow>();
  for (const row of rows) {
    if (!byRef.has(row.ref)) byRef.set(row.ref, row);
    if (typeof row.id === 'number') {
      const key = siblingKey(row.epic, row.id);
      if (!bySibling.has(key)) bySibling.set(key, row);
    }
  }
  return { byRef, bySibling, epicBySlug: new Map(epics.map((epic) => [epic.slug, epic])) };
}

/**
 * Each of `row.after`, resolved: a sibling id `n` is the row in the same epic
 * with `id === n`; a string is the row whose `ref` is it, else an epic slug,
 * met when that epic is `done`. A link that resolves to nothing is unmet and
 * shown as written.
 */
export function prerequisitesOf(row: TicketRow, index: TicketIndex): Prerequisite[] {
  return row.after.map((link: TicketLink) => {
    if (typeof link === 'number') {
      const sibling = index.bySibling.get(siblingKey(row.epic, link));
      return sibling === undefined ? { label: String(link), met: false } : { label: sibling.ref, met: MET_STATES.has(sibling.state) };
    }
    const target = index.byRef.get(link);
    if (target !== undefined) return { label: target.ref, met: MET_STATES.has(target.state) };
    return { label: link, met: index.epicBySlug.get(link)?.status === 'done' };
  });
}

/** The refs (as shown) of `row`'s prerequisites that aren't met yet. */
export function unmetPrerequisites(row: TicketRow, index: TicketIndex): string[] {
  return prerequisitesOf(row, index)
    .filter((each) => !each.met)
    .map((each) => each.label);
}

/** What a card's one status line says, and which glyph goes with it. */
export interface CardStatus {
  kind: 'blocked' | 'waits' | 'column';
  text: string;
}

/** The columns whose cards say what they wait for: work not started yet. */
const WAITING_COLUMNS = new Set<BoardColumn | null>(['draft', 'ready']);

/**
 * The card's status line: blocked → "Blocked: <reason>" (or "Blocked"); a
 * Draft or Ready card with an unmet prerequisite → "Waits for 1.2, 1.4";
 * else the column's label.
 */
export function cardStatusLine(row: TicketRow, unmet: readonly string[]): CardStatus {
  const column = boardColumnOf(row);
  if (column === 'blocked') return { kind: 'blocked', text: boardBlockedText(row.blocked_reason ?? '') };
  if (unmet.length > 0 && WAITING_COLUMNS.has(column)) return { kind: 'waits', text: boardWaitsForText(unmet) };
  return { kind: 'column', text: column === null ? BOARD_DROPPED_LABEL : BOARD_COLUMN_LABELS[column] };
}
