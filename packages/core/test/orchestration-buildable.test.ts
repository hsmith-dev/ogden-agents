/**
 * The tickets a manager may propose a build for (epic 15, story 15.11): the board's ready tickets with their prerequisites met and no build
 * going. A read only list: it never throws and starts nothing.
 */
import type { TicketRow, WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { MAX_BUILDABLE_TICKETS, createBuildableTickets } from '../src/index.js';

const WS = 'ws_01J00000000000000000000000' as WorkspaceId;
const row = (ref: string, extra: Partial<TicketRow> = {}): TicketRow =>
  ({ ref, id: ref, epic: '1', title: `Ticket ${ref}`, type: 'story', status: 'ready-for-dev', state: 'planned', blocked_reason: null, file: null, tracker_id: '', assignee: '', hitl: false, after: [], ...extra }) as unknown as TicketRow;

const make = (tickets: TicketRow[], options: { pieces?: string[]; active?: string[]; fail?: boolean; epics?: unknown[]; limit?: number } = {}) =>
  createBuildableTickets({
    bmad: { pieces: () => (options.pieces ?? ['board', 'builds']) as never },
    board: {
      async tickets() {
        if (options.fail === true) throw new Error('no scripts');
        return { tickets, problems: [], folder: null, epics: (options.epics ?? []) as never };
      },
    },
    entities: { activeRunForTicket: (_ws: WorkspaceId, ref: string) => (options.active?.includes(ref) === true ? ({ id: 'run_x' } as never) : undefined) },
    limit: options.limit,
  });

describe('the tickets a build may be proposed for', () => {
  it('are the ready ones in the board order, with their title', async () => {
    const list = await make([row('1.1'), row('1.2', { status: 'draft' }), row('1.3', { status: 'done' }), row('1.4', { status: null })])(WS);
    expect(list).toEqual([{ ref: '1.1', title: 'Ticket 1.1' }]);
  });

  it('leave out a ticket whose prerequisite is not done or in review, and keep one whose prerequisite is', async () => {
    const list = await make([row('1.1', { state: 'planned' }), row('1.2', { after: [1] }), row('1.3', { state: 'done', status: 'done' }), row('1.4', { after: [3] }), row('1.5', { state: 'review', status: 'in-review' }), row('1.6', { after: [5] })])(WS);
    expect(list.map((ticket) => ticket.ref)).toEqual(['1.1', '1.4', '1.6']);
  });

  it('leave out a ticket with a build going', async () => {
    const list = await make([row('1.1'), row('1.2')], { active: ['1.1'] })(WS);
    expect(list.map((ticket) => ticket.ref)).toEqual(['1.2']);
  });

  it('are none while Board or Unattended builds is off, or the board cannot be read', async () => {
    expect(await make([row('1.1')], { pieces: ['board'] })(WS)).toEqual([]);
    expect(await make([row('1.1')], { pieces: ['builds'] })(WS)).toEqual([]);
    expect(await make([row('1.1')], { fail: true })(WS)).toEqual([]);
  });

  it('are cut to a few, so the manager\'s input stays small', async () => {
    const many = Array.from({ length: MAX_BUILDABLE_TICKETS + 10 }, (_, index) => row(`2.${index + 1}`));
    expect(await make(many)(WS)).toHaveLength(MAX_BUILDABLE_TICKETS);
    expect(await make(many, { limit: 2 })(WS)).toHaveLength(2);
  });
});
