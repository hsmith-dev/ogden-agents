/**
 * `createTicketsJira`'s `TicketStorePort` decorator (epic 18 story 6;
 * AD-27, AD-28, AD-10): `tree`/`find`/`watch` pass straight through to the
 * wrapped store; `mark` pushes the new status to Jira for a Jira-sourced
 * ticket (one with a `tracker_id`) in a linked workspace, after the local
 * mark already succeeded, and never fails the local mark when the push
 * itself fails.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeJiraServer, type FakeJiraServer } from '../../../tests/fixtures/fake-jira-server.mjs';
import { createMemoryTicketStore } from '../src/tickets-memory/index.js';
import { createTicketsJira, type JiraLinkedCredential } from '../src/tickets-jira/ticket-store.js';

const GUARD = { scripts: 'fixture' };
const REPO = '/repo';

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fakeServer(options: Parameters<typeof startFakeJiraServer>[0] = {}): Promise<FakeJiraServer> {
  const server = await startFakeJiraServer(options);
  closers.push(() => server.close());
  return server;
}

function memoryStoreWith(row: { ref: string; tracker_id?: string; status?: string | null }) {
  return createMemoryTicketStore({
    repos: {
      [REPO]: {
        tickets: [{ ref: row.ref, id: 1, epic: 'epic-a', title: 'A ticket', type: 'story', status: row.status ?? 'in-progress', state: 'in-progress', tracker_id: row.tracker_id ?? '', blocked_reason: null, file: `${row.ref}.md` } as never],
      },
    },
  });
}

describe('createTicketsJira: tree/find/watch pass through unchanged', () => {
  it('tree and find answer exactly what the wrapped store does, for a repo with no linked board', async () => {
    const base = memoryStoreWith({ ref: '1', tracker_id: 'ENG-1' });
    const jira = createTicketsJira({ store: base, resolveLink: async () => undefined });
    expect(await jira.tree(REPO, GUARD)).toEqual(await base.tree(REPO, GUARD));
    expect(await jira.find(REPO, '1', GUARD)).toEqual(await base.find(REPO, '1', GUARD));
  });

  it('watch delegates to the wrapped store\'s own watch', async () => {
    const base = memoryStoreWith({ ref: '1' });
    const jira = createTicketsJira({ store: base, resolveLink: async () => undefined });
    const seen: string[][] = [];
    const watch = await jira.watch(REPO, 'out', (refs) => seen.push(refs));
    base.emit(REPO, ['1']);
    expect(seen).toEqual([['1']]);
    watch.close();
    expect(base.watching(REPO)).toBe(0);
  });
});

describe('createTicketsJira: mark pushes status to Jira for a linked, Jira-sourced ticket', () => {
  it('marks locally first, then pushes a matching transition', async () => {
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'x', status: { name: 'To Do' } } }] });
    const base = memoryStoreWith({ ref: '1', tracker_id: 'ENG-1', status: 'draft' });
    const link: JiraLinkedCredential = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const jira = createTicketsJira({ store: base, resolveLink: async () => link });

    const result = await jira.mark(REPO, '1', 'in-progress', GUARD);
    expect(result).toEqual({ ref: '1', status: 'in-progress' });
    expect((await base.find(REPO, '1', GUARD)).status).toBe('in-progress'); // the local mark happened
    expect(server.transitions).toEqual([{ issueKey: 'ENG-1', transitionId: '11', at: expect.any(Number) }]); // "Start Progress" -> In Progress
  });

  it('never pushes for a ticket with no tracker_id, even in a linked workspace', async () => {
    const server = await fakeServer({ issues: [] });
    const base = memoryStoreWith({ ref: '1', tracker_id: '' });
    const link: JiraLinkedCredential = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const jira = createTicketsJira({ store: base, resolveLink: async () => link });
    await jira.mark(REPO, '1', 'in-progress', GUARD);
    expect(server.transitions).toEqual([]);
    expect(server.log).toEqual([]); // not even a transitions-list call was made
  });

  it('never calls Jira at all for an unlinked workspace', async () => {
    const base = memoryStoreWith({ ref: '1', tracker_id: 'ENG-1' });
    const jira = createTicketsJira({ store: base, resolveLink: async () => undefined });
    await expect(jira.mark(REPO, '1', 'in-progress', GUARD)).resolves.toEqual({ ref: '1', status: 'in-progress' });
  });

  it('never forces a push when the board\'s workflow has no transition to the target status', async () => {
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'x', status: { name: 'To Do' } } }] }, );
    // Override with a workflow that has no "Blocked" transition at all.
    const narrow = await fakeServer({ issues: [{ key: 'ENG-2', fields: { summary: 'y', status: { name: 'To Do' } } }], transitions: { 'ENG-2': [{ id: '1', name: 'Start', to: { name: 'In Progress' } }] } });
    const base = memoryStoreWith({ ref: '1', tracker_id: 'ENG-2', status: 'in-progress' });
    const link: JiraLinkedCredential = { baseUrl: narrow.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const jira = createTicketsJira({ store: base, resolveLink: async () => link });
    await jira.mark(REPO, '1', 'blocked', GUARD);
    expect(narrow.transitions).toEqual([]); // listed, but nothing matched -- never forced
    void server;
  });

  it('reports a push failure but still returns the successful local mark result', async () => {
    const base = memoryStoreWith({ ref: '1', tracker_id: 'ENG-1', status: 'draft' });
    const link: JiraLinkedCredential = { baseUrl: 'http://127.0.0.1:1', email: 'a@b.com', token: 'x' }; // nothing listening
    const failures: unknown[] = [];
    const jira = createTicketsJira({ store: base, resolveLink: async () => link, onPushFailure: (error, context) => failures.push({ error, context }) });
    const result = await jira.mark(REPO, '1', 'in-progress', GUARD);
    expect(result).toEqual({ ref: '1', status: 'in-progress' });
    expect((await base.find(REPO, '1', GUARD)).status).toBe('in-progress'); // local mark still succeeded
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ context: { repoPath: REPO, ref: '1', issueKey: 'ENG-1' } });
  });

  it('pushes done when approve marks it, finding the Done-shaped transition', async () => {
    const server = await fakeServer({ issues: [{ key: 'ENG-1', fields: { summary: 'x', status: { name: 'In Review' } } }] });
    const base = memoryStoreWith({ ref: '1', tracker_id: 'ENG-1', status: 'in-review' });
    const link: JiraLinkedCredential = { baseUrl: server.url, email: 'dev@example.com', token: 'fake-jira-token' };
    const jira = createTicketsJira({ store: base, resolveLink: async () => link });
    await jira.mark(REPO, '1', 'done', GUARD, { approve: true });
    expect(server.transitions).toEqual([{ issueKey: 'ENG-1', transitionId: '31', at: expect.any(Number) }]); // "Mark Done" -> Done
  });
});
