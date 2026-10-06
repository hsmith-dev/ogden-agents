/**
 * The ticket watcher (story 4.8) on a real core with an in-memory store and
 * catalog: a watch opens only for Board on and trusted with an output
 * folder, and appends one `ticket.changed {ref}` per changed ref; Board off
 * closes it, trust or Board on starts it, so does a completed BMad Method
 * setup (entry 4.3), a Simple project never gets one;
 * a setup status that fails or names no folder, or a watch that rejects,
 * leaves none (told once) and the next event retries; `close()` awaits a
 * start under way and closes every watch. No ticket state lands in the
 * database. Entry 4.11: a project whose BMad Method lacks the ticket tree
 * gets no watch (told once) until an upgrade completes.
 */
import type { BmadCapability, BmadSetupStatus, WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createTicketWatcher, type BmadCatalogPort, type Core, type TicketStorePort, type TicketWatcherStep } from '../src/index.js';
import { openDatabase } from '../src/db/database.js';
import { openTestCore, tempDir, unusedCatalogParts } from './helpers.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

const status = (outputFolder: string | null): BmadSetupStatus => ({ state: 'current', outputFolder, bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] });

/** A store whose watches record their callback; `emit` fires each open watch of a repo. */
function fakeStore() {
  const open = new Map<string, Set<(refs: string[]) => void>>();
  const retro = new Map<string, Set<(epics: string[]) => void>>();
  const calls: Array<[string, string]> = [];
  let failWatch: Error | undefined;
  let hold: Promise<void> | undefined;
  const store: Pick<TicketStorePort, 'watch'> = {
    async watch(repoPath, outputFolder, onChange, options) {
      calls.push([repoPath, outputFolder]);
      if (hold !== undefined) await hold;
      if (failWatch !== undefined) throw failWatch;
      const set = open.get(repoPath) ?? new Set();
      open.set(repoPath, set);
      set.add(onChange);
      const onRetro = options?.onRetrospectiveChange;
      const retroSet = retro.get(repoPath) ?? new Set();
      retro.set(repoPath, retroSet);
      if (onRetro !== undefined) retroSet.add(onRetro);
      return {
        close: () => {
          set.delete(onChange);
          if (onRetro !== undefined) retroSet.delete(onRetro);
        },
      };
    },
  };
  return {
    store,
    calls,
    watching: (repoPath: string) => open.get(repoPath)?.size ?? 0,
    total: () => [...open.values()].reduce((sum, set) => sum + set.size, 0),
    emit: (repoPath: string, refs: string[]) => {
      for (const listener of [...(open.get(repoPath) ?? [])]) listener(refs);
    },
    emitRetro: (repoPath: string, epics: string[]) => {
      for (const listener of [...(retro.get(repoPath) ?? [])]) listener(epics);
    },
    failWatch: (error: Error | undefined) => (failWatch = error),
    hold: (promise: Promise<void> | undefined) => (hold = promise),
  };
}

function fakeCatalog(statuses: Map<string, BmadSetupStatus | Error>, missing: Map<string, BmadCapability[]>): BmadCatalogPort & { statusCalls: string[] } {
  const statusCalls: string[] = [];
  return {
    ...unusedCatalogParts,
    statusCalls,
    missingCapabilities: async (repoPath, wanted) => wanted.filter((capability) => (missing.get(repoPath) ?? []).includes(capability)),
    detect: async () => ({ hasBmad: true, hasOutput: true }),
    skills: async () => [],
    setupStatus: async (repoPath) => {
      statusCalls.push(repoPath);
      const answer = statuses.get(repoPath) ?? status('_bmad-output');
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function setup(statuses = new Map<string, BmadSetupStatus | Error>(), missing = new Map<string, BmadCapability[]>()) {
  const core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board', 'builds', 'retrospectives'] });
  const store = fakeStore();
  const catalog = fakeCatalog(statuses, missing);
  const errors: Array<[WorkspaceId, TicketWatcherStep]> = [];
  const watcher = createTicketWatcher({
    events: core.events,
    entities: core.entities,
    bmad: core.bmad,
    trust: core.bmadScriptTrust,
    catalog,
    tickets: store.store,
    onError: (workspaceId, step) => errors.push([workspaceId, step]),
  });
  return { core, store, catalog, watcher, errors };
}

const changedRefs = (core: Core, after: number) => core.events.readAfter(after).flatMap((event) => (event.type === 'ticket.changed' ? [[event.workspaceId, event.streamId, event.payload]] : []));

const retroEvents = (core: Core, after: number) => core.events.readAfter(after).flatMap((event) => (event.type === 'retrospective.changed' ? [[event.workspaceId, event.payload]] : []));

describe('ticket watcher: retrospective files (epic 7, story 7.4)', () => {
  it('appends one retrospective.changed per epic, only with Retrospectives on, and ticket.changed stays for rows', async () => {
    const { core, store, watcher } = setup();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    watcher.start();
    await waitFor(() => watcher.watching(workspace.id), 'the watch');
    const off = core.events.lastSeq();
    store.emitRetro(workspace.realPath!, ['epic-a']);
    expect(retroEvents(core, off)).toEqual([]);

    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board', 'retrospectives'] });
    const before = core.events.lastSeq();
    store.emitRetro(workspace.realPath!, ['epic-a', 'epic-b']);
    expect(retroEvents(core, before)).toEqual([
      [workspace.id, { epic: 'epic-a' }],
      [workspace.id, { epic: 'epic-b' }],
    ]);
    expect(changedRefs(core, before)).toEqual([]);
    // Board off: the watch is closed and nothing follows.
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    const seq = core.events.lastSeq();
    store.emitRetro(workspace.realPath!, ['epic-a']);
    expect(retroEvents(core, seq)).toEqual([]);
    await watcher.close();
  });
});

describe('ticket watcher (story 4.8)', () => {
  it('watches a project with Board on and trusted, and appends one ticket.changed per ref', async () => {
    const { core, store, catalog, watcher } = setup();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    watcher.start();
    await waitFor(() => watcher.watching(workspace.id), 'the watch');
    expect(store.calls).toEqual([[workspace.realPath, '_bmad-output']]);
    expect(catalog.statusCalls).toEqual([workspace.realPath]);

    const before = core.events.lastSeq();
    store.emit(workspace.realPath!, ['1.1', '1.2']);
    expect(changedRefs(core, before)).toEqual([
      [workspace.id, workspace.id, { ref: '1.1' }],
      [workspace.id, workspace.id, { ref: '1.2' }],
    ]);
    await watcher.close();
    expect(store.total()).toBe(0);
    // Nothing after close.
    const seq = core.events.lastSeq();
    store.emit(workspace.realPath!, ['1.1']);
    expect(core.events.lastSeq()).toBe(seq);
  });

  it('a project not set up gets no watch until its BMad Method setup completes (entry 4.3)', async () => {
    const statuses = new Map<string, BmadSetupStatus | Error>();
    const { core, store, watcher, errors } = setup(statuses);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    statuses.set(workspace.realPath!, { ...status(null), state: 'not_set_up', installedVersion: null });
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    watcher.start();
    await waitFor(() => errors.length === 1, 'the no-folder report');
    expect(errors).toEqual([[workspace.id, 'no_output_folder']]);
    expect(watcher.watching(workspace.id)).toBe(false);
    expect(store.calls).toEqual([]);

    // Setup names the output folder and appends `bmad.setup_completed`: the watch starts.
    const done = status('_bmad-output');
    statuses.set(workspace.realPath!, done);
    core.events.append({ type: 'bmad.setup_completed', workspaceId: workspace.id, streamId: workspace.id, payload: { status: done } });
    await waitFor(() => watcher.watching(workspace.id), 'the watch after setup');
    expect(store.calls).toEqual([[workspace.realPath, '_bmad-output']]);
    await watcher.close();
  });

  it('a project without the ticket tree gets no watch (told once) until an upgrade completes (entry 4.11)', async () => {
    const missing = new Map<string, BmadCapability[]>();
    const { core, store, watcher, errors } = setup(new Map(), missing);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    missing.set(workspace.realPath!, ['ticket_tree']);
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    watcher.start();
    await waitFor(() => errors.length === 1, 'the reduced-mode report');
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    await sleep(30);
    expect(errors).toEqual([[workspace.id, 'reduced_mode']]);
    expect(watcher.watching(workspace.id)).toBe(false);
    expect(store.calls).toEqual([]);

    // Upgraded: the capability is there and `bmad.setup_completed` decides again.
    missing.delete(workspace.realPath!);
    const done = status('_bmad-output');
    core.events.append({ type: 'bmad.setup_completed', workspaceId: workspace.id, streamId: workspace.id, payload: { status: done } });
    await waitFor(() => watcher.watching(workspace.id), 'the watch after the upgrade');
    expect(store.calls).toEqual([[workspace.realPath, '_bmad-output']]);
    await watcher.close();
  });

  it('Board off closes the watch; on again reopens; trust given later starts it; Simple never watches', async () => {
    const { core, store, watcher } = setup();
    const board = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const simple = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    await core.bmadScriptTrust.trustScripts(simple.id);
    watcher.start();
    core.permissions.updateSettings(board.id, { bmadPieces: ['board'] });
    await sleep(30);
    // Board on, not trusted: nothing.
    expect(watcher.watching(board.id)).toBe(false);
    expect(store.calls).toEqual([]);
    await core.bmadScriptTrust.trustScripts(board.id);
    await waitFor(() => watcher.watching(board.id), 'the trusted watch');

    core.permissions.updateSettings(board.id, { bmadPieces: [] });
    // Closed in the event's own listener, not behind a decision.
    expect(watcher.watching(board.id)).toBe(false);
    expect(store.watching(board.realPath!)).toBe(0);
    // A change reported by a closed watch appends nothing.
    const seq = core.events.lastSeq();
    store.emit(board.realPath!, ['1.1']);
    expect(changedRefs(core, seq)).toEqual([]);

    core.permissions.updateSettings(board.id, { bmadPieces: ['board'] });
    await waitFor(() => watcher.watching(board.id), 'the reopened watch');
    expect(store.watching(board.realPath!)).toBe(1);

    // Planning only (or nothing): never watched, never asked.
    core.permissions.updateSettings(simple.id, { bmadPieces: ['planning'] });
    await sleep(30);
    expect(watcher.watching(simple.id)).toBe(false);
    expect(store.calls.filter(([repo]) => repo === simple.realPath)).toEqual([]);
    await watcher.close();
  });

  it('a new project created with Board on is decided when trusted', async () => {
    const { core, watcher } = setup();
    watcher.start();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'), { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    await waitFor(() => watcher.watching(workspace.id), 'the watch');
    await watcher.close();
  });

  it('a failing or folderless setup status, or a watch that rejects, leaves no watch (told once) and the next event retries', async () => {
    const statuses = new Map<string, BmadSetupStatus | Error>();
    const { core, store, catalog, watcher, errors } = setup(statuses);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    statuses.set(workspace.realPath!, new Error('setup.py is not built yet'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    watcher.start();
    await waitFor(() => catalog.statusCalls.length === 1, 'the status');
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    await waitFor(() => catalog.statusCalls.length === 2, 'the retried status');
    await sleep(20);
    expect(watcher.watching(workspace.id)).toBe(false);
    expect(errors).toEqual([[workspace.id, 'setup_status']]);

    statuses.set(workspace.realPath!, status(null));
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_every_time' });
    await waitFor(() => catalog.statusCalls.length === 3, 'the folderless status');
    await sleep(20);
    expect(watcher.watching(workspace.id)).toBe(false);
    expect(store.calls).toEqual([]);

    statuses.delete(workspace.realPath!);
    store.failWatch(new Error('outside the repo'));
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    await waitFor(() => store.calls.length === 1, 'the rejected watch');
    await sleep(20);
    expect(watcher.watching(workspace.id)).toBe(false);
    expect(errors.at(-1)).toEqual([workspace.id, 'watch']);

    store.failWatch(undefined);
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_every_time' });
    await waitFor(() => watcher.watching(workspace.id), 'the watch');
    await watcher.close();
  });

  it('Board off while a start is under way closes nothing late: the started watch is closed at once', async () => {
    const { core, store, watcher } = setup();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    let release!: () => void;
    store.hold(new Promise((resolve) => (release = resolve)));
    watcher.start();
    await waitFor(() => store.calls.length === 1, 'the watch under way');
    core.permissions.updateSettings(workspace.id, { bmadPieces: [] });
    release();
    await sleep(30);
    expect(watcher.watching(workspace.id)).toBe(false);
    expect(store.total()).toBe(0);
    await watcher.close();
  });

  it('close() awaits a start under way and closes what it opens', async () => {
    const { core, store, watcher } = setup();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    await core.bmadScriptTrust.trustScripts(workspace.id);
    let release!: () => void;
    store.hold(new Promise((resolve) => (release = resolve)));
    watcher.start();
    await waitFor(() => store.calls.length === 1, 'the watch under way');
    let closed = false;
    const closing = watcher.close().then(() => (closed = true));
    await sleep(20);
    expect(closed).toBe(false);
    release();
    await closing;
    expect(store.total()).toBe(0);
    expect(watcher.watching(workspace.id)).toBe(false);
    await watcher.close();
  });

  it('keeps no ticket state in the database: no table or column names a ticket or its status', () => {
    const db = openDatabase(tempDir());
    try {
      const tables = db.sqlite.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        expect(table, table).not.toMatch(/ticket/i);
        const columns = db.sqlite.prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${table}')`).all().map((c) => c.name);
        // A run names its ticket by ref only (AD-7); nothing else names a ticket, and nothing holds a status.
        for (const column of columns.map((name) => `${table}.${name}`).filter((name) => name !== 'runs.ticket_ref')) expect(column).not.toMatch(/ticket|status/i);
      }
    } finally {
      db.close();
    }
  });
});
