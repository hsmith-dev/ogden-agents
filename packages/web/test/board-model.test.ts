/**
 * The board's pure model (story 4.9): grouping by epic in build order with
 * the columns in order and dropped tickets behind the filter; prerequisites
 * resolved by sibling id, by ref and by epic slug (met when done or in
 * review; unresolved links unmet and shown as written); the card's one
 * status line in priority order; epic titles from slugs.
 */
import { TicketEpic, TicketRow, TicketsResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { cardStatusLine, groupBoard, humanEpicTitle, isFinishedTicket, indexTickets, prerequisitesOf, unmetPrerequisites } from '../src/planning/board-model';

const row = (fields: Record<string, unknown>) =>
  TicketRow.parse({ id: null, epic: 'epic-first', title: 'A ticket', type: 'story', status: '', state: 'planned', blocked_reason: '', ...fields });

const ROWS = [
  row({ ref: '1.1', id: 1, status: 'ready-for-dev', state: 'backlog' }),
  row({ ref: '2.1', id: 1, epic: 'epic-second', status: 'in-review', state: 'review' }),
  row({ ref: '1.2', id: 2, state: 'planned' }),
  row({ ref: '1.3', id: 3, after: [2] }),
  row({ ref: '1.4', id: 4, status: 'blocked', state: 'in-progress', blocked_at: '2026-10-01', blocked_reason: 'Needs the API key' }),
  row({ ref: '1.5', id: 5, status: 'dropped', state: 'dropped' }),
];
const EPICS = [
  TicketEpic.parse({ slug: 'epic-first', id: 1, status: 'in-progress', after: [], blocks: [] }),
  TicketEpic.parse({ slug: 'epic-second', id: 2, status: 'done', after: [], blocks: [] }),
];

describe('groupBoard', () => {
  it('groups by epic in first-seen build order, with each column in order and dropped hidden', () => {
    const groups = groupBoard(TicketsResponse.parse({ tickets: ROWS, problems: [], epics: EPICS }), false);
    expect(groups.map((group) => [group.slug, group.title, group.id])).toEqual([
      ['epic-first', 'First', 1],
      ['epic-second', 'Second', 2],
    ]);
    const first = groups[0]!;
    expect(first.columns.map((each) => each.column)).toEqual(['draft', 'ready', 'in_progress', 'in_review', 'built', 'done', 'blocked']);
    const refsIn = (column: string) => first.columns.find((each) => each.column === column)!.rows.map((each) => each.ref);
    expect(refsIn('ready')).toEqual(['1.1']);
    expect(refsIn('draft')).toEqual(['1.2', '1.3']);
    expect(refsIn('blocked')).toEqual(['1.4']);
    expect(first.dropped).toEqual([]);
    expect(groups[1]!.columns.find((each) => each.column === 'in_review')!.rows.map((each) => each.ref)).toEqual(['2.1']);
  });

  it('lists dropped tickets with the filter on; one epic’s folder (no epics) still groups by row.epic', () => {
    const groups = groupBoard({ tickets: ROWS, epics: [] }, true);
    expect(groups[0]!.dropped.map((each) => each.ref)).toEqual(['1.5']);
    expect(groups.every((group) => group.id === null)).toBe(true);
  });

  it('leaves out an epic whose tickets are all dropped, until the filter is on', () => {
    const only = [row({ ref: '3.1', id: 1, epic: 'epic-gone', status: 'dropped', state: 'dropped' })];
    expect(groupBoard({ tickets: only, epics: [] }, false)).toEqual([]);
    expect(groupBoard({ tickets: only, epics: [] }, true)).toHaveLength(1);
  });
});

describe('prerequisites', () => {
  it('a sibling id resolves in the same epic; planned is unmet', () => {
    expect(unmetPrerequisites(ROWS[3]!, indexTickets(ROWS, EPICS))).toEqual(['1.2']);
  });

  it('met when the prerequisite is in review or done', () => {
    const rows = ROWS.map((each) => (each.ref === '1.2' ? { ...each, state: 'review' } : each));
    expect(unmetPrerequisites(rows[3]!, indexTickets(rows, EPICS))).toEqual([]);
    const done = ROWS.map((each) => (each.ref === '1.2' ? { ...each, state: 'done' } : each));
    expect(unmetPrerequisites(done[3]!, indexTickets(done, EPICS))).toEqual([]);
  });

  it('a string resolves by ref, else as an epic slug (met when that epic is done); nothing resolved is unmet as written', () => {
    const ticket = row({ ref: '1.9', id: 9, after: ['2.1', 'epic-second', 'epic-first', 'nowhere', 42] });
    expect(prerequisitesOf(ticket, indexTickets(ROWS, EPICS))).toEqual([
      { label: '2.1', met: true },
      { label: 'epic-second', met: true },
      { label: 'epic-first', met: false },
      { label: 'nowhere', met: false },
      { label: '42', met: false },
    ]);
  });
});

describe('cardStatusLine', () => {
  it('blocked first (the word and its reason), then Waits for (Draft and Ready only), then the column label', () => {
    expect(cardStatusLine(ROWS[4]!, ['1.2'])).toEqual({ kind: 'blocked', text: 'Blocked: Needs the API key' });
    expect(cardStatusLine({ ...ROWS[4]!, blocked_reason: '' }, [])).toEqual({ kind: 'blocked', text: 'Blocked' });
    expect(cardStatusLine(ROWS[3]!, ['1.2', '1.4'])).toEqual({ kind: 'waits', text: 'Waits for 1.2, 1.4' });
    expect(cardStatusLine(ROWS[0]!, [])).toEqual({ kind: 'column', text: 'Ready' });
    expect(cardStatusLine(ROWS[0]!, ['1.2'])).toEqual({ kind: 'waits', text: 'Waits for 1.2' });
    // Work already under way or past it shows its column, whatever it waited for.
    expect(cardStatusLine(ROWS[1]!, ['1.2'])).toEqual({ kind: 'column', text: 'In review' });
    expect(cardStatusLine(ROWS[5]!, ['1.2'])).toEqual({ kind: 'column', text: 'Dropped' });
    expect(cardStatusLine(ROWS[5]!, [])).toEqual({ kind: 'column', text: 'Dropped' });
  });
});

describe('humanEpicTitle', () => {
  it('turns a slug into words', () => {
    expect(humanEpicTitle('epic-planning-and-board')).toBe('Planning and board');
    expect(humanEpicTitle('backlog')).toBe('Backlog');
    expect(humanEpicTitle('')).toBe('Not in an epic');
  });
});

describe('a finished epic and its retrospective (epic 7, story 7.4)', () => {
  const row = (ref: string, epic: string, state: string, status = '') => TicketRow.parse({ ref, id: 1, epic, title: ref, type: 'story', status, state, blocked_reason: '' });
  const response = (tickets: TicketRow[], epics: unknown[] = []) => TicketsResponse.parse({ tickets, problems: [], epics });

  it('a ticket is finished when done or dropped, not when built or in review', () => {
    expect(isFinishedTicket({ status: 'done', state: 'done' })).toBe(true);
    expect(isFinishedTicket({ status: 'dropped', state: 'dropped' })).toBe(true);
    expect(isFinishedTicket({ status: 'dropped', state: 'backlog' })).toBe(true);
    for (const [status, state] of [['built', 'review'], ['in-review', 'review'], ['', 'planned'], ['blocked', 'backlog']] as const) expect(isFinishedTicket({ status, state }), `${status} ${state}`).toBe(false);
  });

  it('an epic is finished when every ticket is, judged over dropped tickets even when the filter hides them', () => {
    const tickets = [row('1.1', 'epic-a', 'done', 'done'), row('1.2', 'epic-a', 'dropped', 'dropped'), row('2.1', 'epic-b', 'done', 'done'), row('2.2', 'epic-b', 'review', 'built')];
    const groups = groupBoard(response(tickets), false);
    expect(groups.map((group) => [group.slug, group.finished])).toEqual([
      ['epic-a', true],
      ['epic-b', false],
    ]);
    expect(groupBoard(response(tickets), true).map((group) => group.finished)).toEqual([true, false]);
  });

  it('carries each epic\'s retrospective from the tree, null when none', () => {
    const epics = [
      { slug: 'epic-a', id: 1, status: 'done', after: [], blocks: [], retrospective: { path: 'x/epic-a-retrospective.md', verdict: 'rejected', date: '2026-10-05' } },
      { slug: 'epic-b', id: 2, status: 'active', after: [], blocks: [] },
    ];
    const groups = groupBoard(response([row('1.1', 'epic-a', 'done', 'done'), row('2.1', 'epic-b', 'planned')], epics), false);
    expect(groups.map((group) => group.retrospective?.verdict ?? null)).toEqual(['rejected', null]);
  });
});
