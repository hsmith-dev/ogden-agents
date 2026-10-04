/**
 * The `tickets-memory` stub of `TicketStorePort` (story 4.2): every port
 * method answers as `tickets-v7` would, from memory: the tree it was given,
 * one ticket with its text, a mark that changes the row as the plan would
 * (never `done`) and tells each open watch, and watches that close.
 */
import { NotFoundError, StatusNotAllowedError, TicketChangedError, TicketsUnavailableError } from '@ogden-agents/core';
import { boardColumnOf } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryTicketStore } from '../src/index.js';

const tree = {
  tickets: [
    { ref: '1.1', id: 1, epic: 'epic-a', title: 'One', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
    { ref: '1.2', id: 2, epic: 'epic-a', title: 'Two', type: 'story', status: '', state: 'planned', blocked_reason: '', after: [1] },
  ],
  folder: 'initiative-demo',
};

describe('tickets-memory (story 4.2)', () => {
  it('tree answers the repo’s tickets with the shared defaults; another repo is unavailable', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    const answer = await store.tree('/repo');
    expect(answer.folder).toBe('initiative-demo');
    expect(answer.tickets[1]).toMatchObject({ ref: '1.2', after: [1], blocks: [], hitl: false, file: null });
    await expect(store.tree('/other')).rejects.toThrow(TicketsUnavailableError);
    // A copy: changing it changes nothing kept.
    answer.tickets[0]!.title = 'changed';
    expect((await store.tree('/repo')).tickets[0]!.title).toBe('One');
  });

  it('find answers a ticket with its text, and a missing one is NotFoundError', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree }, text: { '1.2': { description: 'Do two.' } } });
    expect(await store.find('/repo', '1.2')).toMatchObject({ ref: '1.2', description: 'Do two.', verify: '', references: [], hasPlan: false });
    expect((await store.find('/repo', '1.1')).hasPlan).toBe(true);
    await expect(store.find('/repo', '9.9')).rejects.toThrow(NotFoundError);
  });

  it('mark changes the row as the plan would, tells each open watch, and refuses done', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    const told: string[][] = [];
    const watch = await store.watch('/repo', '_bmad-output', (refs) => told.push(refs));
    expect(store.watching('/repo')).toBe(1);
    expect(await store.mark('/repo', '1.2', 'ready-for-dev')).toEqual({ ref: '1.2', status: 'ready-for-dev' });
    const row = (await store.tree('/repo')).tickets[1]!;
    expect(row).toMatchObject({ status: 'ready-for-dev', state: 'backlog' });
    expect(boardColumnOf(row)).toBe('ready');
    await store.mark('/repo', '1.2', 'blocked', { blockedReason: 'Waits on the API' });
    expect(boardColumnOf((await store.tree('/repo')).tickets[1]!)).toBe('blocked');
    await expect(store.mark('/repo', '1.2', 'done')).rejects.toThrow(StatusNotAllowedError);
    expect(told).toEqual([['1.2'], ['1.2']]);

    store.emit('/repo', ['1.1']);
    expect(told.at(-1)).toEqual(['1.1']);
    watch.close();
    watch.close();
    expect(store.watching('/repo')).toBe(0);
    store.emit('/repo', ['1.1']);
    expect(told).toHaveLength(3);
    expect(store.calls.map((call) => call[0])).toEqual(['watch', 'mark', 'tree', 'mark', 'tree', 'mark']);
    // Only core's approve writes done (story 5.2).
    expect(await store.mark('/repo', '1.2', 'done', { approve: true })).toEqual({ ref: '1.2', status: 'done' });
    expect(boardColumnOf((await store.tree('/repo')).tickets[1]!)).toBe('done');
  });

  it('mark with an expected status that no longer matches is TicketChangedError and changes nothing (story 4.10)', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    await expect(store.mark('/repo', '1.2', 'ready-for-dev', { expectedStatus: 'draft' })).rejects.toThrow(TicketChangedError);
    expect((await store.tree('/repo')).tickets[1]!.status).toBe('');
    expect(await store.mark('/repo', '1.2', 'ready-for-dev', { expectedStatus: '' })).toEqual({ ref: '1.2', status: 'ready-for-dev' });
    await expect(store.mark('/repo', '1.1', 'draft', { expectedStatus: '' })).rejects.toThrow(TicketChangedError);
    expect(await store.mark('/repo', '1.1', 'draft', { expectedStatus: 'in-review' })).toEqual({ ref: '1.1', status: 'draft' });
  });

  it('fail makes every operation unavailable until cleared', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    store.fail('uv_missing');
    const error = await store.tree('/repo').catch((caught: unknown) => caught);
    expect((error as TicketsUnavailableError).reason).toBe('uv_missing');
    await expect(store.watch('/repo', '_bmad-output', () => {})).rejects.toThrow(TicketsUnavailableError);
    store.fail(undefined);
    expect((await store.tree('/repo')).tickets).toHaveLength(2);
  });
});
