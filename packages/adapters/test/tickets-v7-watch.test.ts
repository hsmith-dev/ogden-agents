/**
 * `tickets-v7`'s watch (story 4.8) with a fake script runner on a real temp
 * repo: the first read builds the tree silently; a settled change reruns
 * `status` and reports only the refs whose rows changed (an identical rerun
 * reports nothing); reads are serialized; a failed read keeps the tree and
 * tells nothing; `tree` always runs; only refs matching the pattern are
 * reported; the output folder must be inside the repo and outside `.git`,
 * links included, and may not exist yet; `close` stops it.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TicketWatch } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { changedTicketRefs, createTicketsV7, ScriptRunError, type UvScriptRunner } from '../src/index.js';
import { defaultWatchDir, type WatchDir } from '../src/tickets-v7/folder-watch.js';
import { fakeSnapshot, GUARD, WATCH_GUARD } from './snapshot-fake.js';

const dirs: string[] = [];
const watches: TicketWatch[] = [];

afterEach(() => {
  for (const watch of watches.splice(0)) watch.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

function tempRepo(): string {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-tickets-watch-')));
  dirs.push(repo);
  mkdirSync(join(repo, '_bmad-output', 'epic-a'), { recursive: true });
  writeFileSync(join(repo, '_bmad-output', 'epic-a', 'plan.md'), 'status: draft\n');
  return repo;
}

const row = (ref: string, status: string) => ({ ref, id: Number(ref.split('.')[1]), epic: 'epic-a', title: `Ticket ${ref}`, type: 'story', status, state: 'backlog', blocked_reason: '' });

/** A runner whose `status` answers `tickets`, counting runs and the most in flight at once; `gate` holds runs until released. */
function fakeRunner() {
  const state = {
    tickets: [row('1.1', 'draft'), row('1.2', '')],
    epics: ['epic-a'] as string[],
    fail: false,
    runs: 0,
    inFlight: 0,
    maxInFlight: 0,
    gate: undefined as Promise<void> | undefined,
  };
  const runner: UvScriptRunner = {
    run: async () => {
      state.runs++;
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (state.gate !== undefined) await state.gate;
        await sleep(5);
        if (state.fail) throw new ScriptRunError('failed', { exitCode: 1 });
        return { tickets: state.tickets.map((each) => ({ ...each })), problems: [], folder: 'initiative-demo', epics: state.epics.map((slug) => ({ slug, id: null, status: 'active', after: [], blocks: [] })) };
      } finally {
        state.inFlight--;
      }
    },
    close: async () => {},
  };
  return { state, runner };
}

const TIMING = { debounceMs: 30, maxWaitMs: 150, pollMs: 100, confirmMs: 100 };

async function watched(repo: string, store: ReturnType<typeof createTicketsV7>, outputFolder = '_bmad-output') {
  const changes: string[][] = [];
  const watch = await store.watch(repo, outputFolder, (refs) => changes.push(refs), WATCH_GUARD);
  watches.push(watch);
  return { watch, changes };
}

const touch = (repo: string, content: string) => writeFileSync(join(repo, '_bmad-output', 'epic-a', 'plan.md'), content);

describe('tickets-v7 watch: retrospective files (epic 7, story 7.4)', () => {
  it('reports the epic whose retrospective file appeared, changed or went, with no ticket change, and not for the first read', async () => {
    const repo = tempRepo();
    const epicFolder = join(repo, '_bmad-output', 'initiative-demo', 'epic-a');
    mkdirSync(epicFolder, { recursive: true });
    writeFileSync(join(epicFolder, 'epic-a-retrospective.md'), '---\nverdict: accepted\n---\n');
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    const refs: string[][] = [];
    const epics: string[][] = [];
    const retroOn = { value: true };
    const watch = await store.watch(repo, '_bmad-output', (changed) => refs.push(changed), { ...WATCH_GUARD, retrospectivesOn: () => retroOn.value, onRetrospectiveChange: (changed) => epics.push(changed) });
    watches.push(watch);
    // The file that was there at the start is the baseline, not a change.
    expect(epics).toEqual([]);
    writeFileSync(join(epicFolder, 'epic-a-retrospective.md'), '---\nverdict: rejected\n---\nmore text\n');
    await waitFor(() => epics.length === 1, 'the retrospective change');
    expect(epics).toEqual([['epic-a']]);
    expect(refs).toEqual([]);
    const runs = state.runs;
    touch(repo, 'unrelated\n');
    await waitFor(() => state.runs > runs, 'a rerun');
    await sleep(100);
    expect(epics).toHaveLength(1);

    // With Retrospectives off no retrospective file is looked at: a change then reports nothing.
    retroOn.value = false;
    writeFileSync(join(epicFolder, 'epic-a-retrospective.md'), 'changed while off\n');
    touch(repo, 'while off\n');
    await sleep(400);
    expect(epics).toHaveLength(1);
  });
});

describe('tickets-v7 watch (story 4.8)', () => {
  it('reports only the changed refs; an identical rerun reports nothing; tree always runs', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    const { changes } = await watched(repo, store);
    expect(state.runs).toBe(1);
    expect(changes).toEqual([]);

    // The watch's tree is never served: tree runs the script each time.
    await sleep(250);
    expect((await store.tree(repo, GUARD)).tickets.map((each) => [each.ref, each.status])).toEqual([
      ['1.1', 'draft'],
      ['1.2', ''],
    ]);
    expect(state.runs).toBe(2);

    state.tickets = [row('1.1', 'in-progress'), row('1.2', '')];
    touch(repo, 'status: in-progress\n');
    await waitFor(() => changes.length === 1, 'the change');
    expect(changes).toEqual([['1.1']]);
    expect((await store.tree(repo, GUARD)).tickets[0]!.status).toBe('in-progress');

    // Added and removed rows are reported too.
    state.tickets = [row('1.1', 'in-progress'), row('1.3', '')];
    touch(repo, 'status: in-progress \n');
    await waitFor(() => changes.length === 2, 'the add and remove');
    expect(changes[1]).toEqual(['1.3', '1.2']);

    // A file change whose tree is the same: a read, no report.
    const runs = state.runs;
    touch(repo, 'status: in-progress  \n');
    await waitFor(() => state.runs === runs + 1, 'the rerun');
    await sleep(100);
    expect(changes).toHaveLength(2);
  });

  it('reads one at a time: changes during a read run one more after it', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    // Raw file events, with when the last one arrived: the OS may deliver them late (macOS, loaded CI), and an event
    // that settles after the catch-up read has started is a legitimate further read, so the test waits for the
    // events and their settling scans to be done before it lets the held read go.
    let events = 0;
    let lastEventAt = 0;
    const watchDir: WatchDir = (dir, listener, recursive) =>
      defaultWatchDir(dir, (type, name) => {
        events++;
        lastEventAt = Date.now();
        listener(type, name);
      }, recursive);
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING, watchDir });
    const { changes } = await watched(repo, store);
    // Let the arming's confirming scan pass, so nothing but the test's own writes is left to settle.
    await sleep(TIMING.confirmMs + 100);
    let release!: () => void;
    state.gate = new Promise((resolve) => (release = resolve));
    state.tickets = [row('1.1', 'built'), row('1.2', '')];
    touch(repo, 'a\n');
    await waitFor(() => state.runs === 2, 'the held read');
    // While it is held, two more settled changes.
    const before = events;
    touch(repo, 'bb\n');
    await waitFor(() => events > before, 'the second change event');
    await sleep(TIMING.debounceMs * 3);
    const middle = events;
    touch(repo, 'ccc\n');
    await waitFor(() => events > middle, 'the third change event');
    // Quiet: every event of the writes has arrived and been scanned, so the change is queued behind the held read.
    await waitFor(() => Date.now() - lastEventAt > TIMING.debounceMs * 6, 'the events to settle');
    // tree runs its own read, alongside the held one.
    const treeRead = store.tree(repo, GUARD);
    release();
    state.gate = undefined;
    await treeRead;
    await waitFor(() => changes.length === 1 && state.inFlight === 0, 'the reads');
    await sleep(TIMING.debounceMs * 6);
    expect(state.maxInFlight).toBeLessThanOrEqual(2);
    // The held read, one more for the changes during it, and the tree's own.
    expect(state.runs).toBe(4);
    expect(changes).toEqual([['1.1']]);
  });

  it('a failed read keeps the last tree and reports nothing; the next change retries', async () => {
    const repo = tempRepo();
    const failures: string[] = [];
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING, onFailure: (error) => failures.push(error instanceof ScriptRunError ? error.code : error.reason) });
    const { changes } = await watched(repo, store);
    state.fail = true;
    state.tickets = [row('1.1', 'blocked'), row('1.2', '')];
    touch(repo, 'x\n');
    await waitFor(() => state.runs === 2, 'the failed read');
    await sleep(50);
    expect(changes).toEqual([]);
    expect(failures).toEqual(['failed']);
    await expect(store.tree(repo, GUARD)).rejects.toThrow();
    state.fail = false;
    touch(repo, 'xy\n');
    await waitFor(() => changes.length === 1, 'the retry');
    expect(changes).toEqual([['1.1']]);
  });

  it('a failed first read leaves no tree: the next success reports every ref', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    state.fail = true;
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    const { changes } = await watched(repo, store);
    state.fail = false;
    touch(repo, 'y\n');
    await waitFor(() => changes.length === 1, 'the first success');
    expect(changes).toEqual([['1.1', '1.2']]);
  });

  it('a ref that is not a ticket ref is never reported', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    const { changes } = await watched(repo, store);
    state.tickets = [row('1.1', 'built'), { ...row('1.2', ''), ref: '--force' }];
    touch(repo, 'r\n');
    await waitFor(() => changes.length === 1, 'the change');
    await sleep(50);
    // `1.2`'s row is gone (its ref became `--force`), and `--force` itself is never reported.
    expect(changes).toEqual([['1.1', '1.2']]);
  });

  it('a missing output folder inside the repo is watched until it appears', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    const { changes } = await watched(repo, store, 'later/_bmad-output');
    expect(state.runs).toBe(1);
    state.tickets = [row('1.1', 'in-progress'), row('1.2', '')];
    mkdirSync(join(repo, 'later', '_bmad-output'), { recursive: true });
    writeFileSync(join(repo, 'later', '_bmad-output', 'plan.md'), 'status: in-progress\n');
    await waitFor(() => changes.length === 1, 'the appeared folder');
    expect(changes).toEqual([['1.1']]);
  });

  it('rejects an output folder outside the repo, in .git, a file, or a link out', async () => {
    const repo = tempRepo();
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-outside-')));
    dirs.push(outside);
    symlinkSync(outside, join(repo, 'out-link'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(repo, 'a-file'), 'x');
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    mkdirSync(join(repo, '.git'));
    for (const folder of ['../', '..', outside, '../missing', 'a-file', 'out-link', 'out-link/missing', '', '.', '.git', '.git/out', 'x/.git/out']) {
      await expect(store.watch(repo, folder, () => {}), folder).rejects.toThrow();
    }
    expect(state.runs).toBe(0);
  });

  it('close stops it: nothing is reported or run after, and a repeat is harmless', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/x/tickets.py', workDir: repo, watchTiming: TIMING });
    const { watch, changes } = await watched(repo, store);
    state.tickets = [row('1.1', 'done'), row('1.2', '')];
    touch(repo, 'z\n');
    const runs = state.runs;
    watch.close();
    watch.close();
    await sleep(200);
    expect(changes).toEqual([]);
    expect(state.runs).toBe(runs);
  });

  it('changedTicketRefs compares rows deeply', () => {
    const before = [row('1.1', 'draft'), row('1.2', '')].map((each) => ({ ...each, file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' }));
    const after = structuredClone(before);
    expect(changedTicketRefs(before as never, after as never)).toEqual([]);
    after[1]!.after = [1] as never;
    expect(changedTicketRefs(before as never, after as never)).toEqual(['1.2']);
  });
});

describe('the watch checks before each read (story 4.13: the script trust bound to the contents)', () => {
  it('runs nothing while beforeRun refuses, keeps the last tree, and reads again once it passes', async () => {
    const repo = tempRepo();
    const { state, runner } = fakeRunner();
    const store = createTicketsV7({ runner, snapshot: fakeSnapshot, script: () => '/verified/tickets.py', workDir: repo, watchTiming: TIMING });
    let allowed = true;
    let checks = 0;
    const changes: string[][] = [];
    const watch = await store.watch(repo, '_bmad-output', (refs) => changes.push(refs), {
      beforeRun: async () => {
        checks++;
        if (!allowed) throw new Error('scripts_changed');
        return GUARD;
      },
    });
    watches.push(watch);
    expect(state.runs).toBe(1);

    allowed = false;
    state.tickets = [row('1.1', 'in-progress'), row('1.2', '')];
    writeFileSync(join(repo, '_bmad-output', 'epic-a', 'plan.md'), 'status: in-progress\n');
    await waitFor(() => checks >= 2, 'the refused check');
    await sleep(300);
    expect(state.runs).toBe(1);
    expect(changes).toEqual([]);

    allowed = true;
    writeFileSync(join(repo, '_bmad-output', 'epic-a', 'plan.md'), 'status: in-progress\n\n');
    await waitFor(() => changes.length > 0, 'the change once allowed');
    expect(changes).toEqual([['1.1']]);
  });
});
