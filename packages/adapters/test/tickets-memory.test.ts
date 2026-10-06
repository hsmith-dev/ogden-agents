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
import { GUARD } from './snapshot-fake.js';

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
    const answer = await store.tree('/repo', GUARD);
    expect(answer.folder).toBe('initiative-demo');
    expect(answer.tickets[1]).toMatchObject({ ref: '1.2', after: [1], blocks: [], hitl: false, file: null });
    await expect(store.tree('/other', GUARD)).rejects.toThrow(TicketsUnavailableError);
    // A copy: changing it changes nothing kept.
    answer.tickets[0]!.title = 'changed';
    expect((await store.tree('/repo', GUARD)).tickets[0]!.title).toBe('One');
  });

  it('tree carries each epic with its retrospective (story 7.2), null when there is none', async () => {
    const epics = [
      { slug: 'epic-a', id: 1, status: 'done', after: [], blocks: [], retrospective: { path: '_bmad-output/i/epic-a/epic-a-retrospective.md', verdict: 'rejected', date: '2026-10-05' } },
      { slug: 'epic-b', id: 2, status: 'in-progress', after: [], blocks: [] },
    ];
    const answer = await createMemoryTicketStore({ repos: { '/repo': { ...tree, epics } } }).tree('/repo', GUARD);
    expect(answer.epics.map((epic) => [epic.slug, epic.retrospective?.verdict ?? null])).toEqual([
      ['epic-a', 'rejected'],
      ['epic-b', null],
    ]);
  });

  it('emitRetrospective tells each open watch\'s retrospective listener, until it closes (story 7.4)', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    const heard: string[][] = [];
    const watch = await store.watch('/repo', '_bmad-output', () => {}, { onRetrospectiveChange: (epics) => heard.push(epics) });
    store.emitRetrospective(['epic-a']);
    expect(heard).toEqual([['epic-a']]);
    watch.close();
    store.emitRetrospective(['epic-b']);
    expect(heard).toEqual([['epic-a']]);
  });

  it('find answers a ticket with its text, and a missing one is NotFoundError', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree }, text: { '1.2': { description: 'Do two.' } } });
    expect(await store.find('/repo', '1.2', GUARD)).toMatchObject({ ref: '1.2', description: 'Do two.', verify: '', references: [], hasPlan: false });
    expect((await store.find('/repo', '1.1', GUARD)).hasPlan).toBe(true);
    await expect(store.find('/repo', '9.9', GUARD)).rejects.toThrow(NotFoundError);
  });

  it('mark changes the row as the plan would, tells each open watch, and refuses done', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    const told: string[][] = [];
    const watch = await store.watch('/repo', '_bmad-output', (refs) => told.push(refs));
    expect(store.watching('/repo')).toBe(1);
    expect(await store.mark('/repo', '1.2', 'ready-for-dev', GUARD)).toEqual({ ref: '1.2', status: 'ready-for-dev' });
    const row = (await store.tree('/repo', GUARD)).tickets[1]!;
    expect(row).toMatchObject({ status: 'ready-for-dev', state: 'backlog' });
    expect(boardColumnOf(row)).toBe('ready');
    await store.mark('/repo', '1.2', 'blocked', GUARD, { blockedReason: 'Waits on the API' });
    expect(boardColumnOf((await store.tree('/repo', GUARD)).tickets[1]!)).toBe('blocked');
    await expect(store.mark('/repo', '1.2', 'done', GUARD)).rejects.toThrow(StatusNotAllowedError);
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
    expect(await store.mark('/repo', '1.2', 'done', GUARD, { approve: true })).toEqual({ ref: '1.2', status: 'done' });
    expect(boardColumnOf((await store.tree('/repo', GUARD)).tickets[1]!)).toBe('done');
  });

  it('mark with an expected status that no longer matches is TicketChangedError and changes nothing (story 4.10)', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    await expect(store.mark('/repo', '1.2', 'ready-for-dev', GUARD, { expectedStatus: 'draft' })).rejects.toThrow(TicketChangedError);
    expect((await store.tree('/repo', GUARD)).tickets[1]!.status).toBe('');
    expect(await store.mark('/repo', '1.2', 'ready-for-dev', GUARD, { expectedStatus: '' })).toEqual({ ref: '1.2', status: 'ready-for-dev' });
    await expect(store.mark('/repo', '1.1', 'draft', GUARD, { expectedStatus: '' })).rejects.toThrow(TicketChangedError);
    expect(await store.mark('/repo', '1.1', 'draft', GUARD, { expectedStatus: 'in-review' })).toEqual({ ref: '1.1', status: 'draft' });
  });

  it('fail makes every operation unavailable until cleared', async () => {
    const store = createMemoryTicketStore({ repos: { '/repo': tree } });
    store.fail('uv_missing');
    const error = await store.tree('/repo', GUARD).catch((caught: unknown) => caught);
    expect((error as TicketsUnavailableError).reason).toBe('uv_missing');
    await expect(store.watch('/repo', '_bmad-output', () => {})).rejects.toThrow(TicketsUnavailableError);
    store.fail(undefined);
    expect((await store.tree('/repo', GUARD)).tickets).toHaveLength(2);
  });
});
