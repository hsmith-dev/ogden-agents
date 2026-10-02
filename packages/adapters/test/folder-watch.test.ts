/**
 * The bounded folder watcher behind `tickets-v7`'s watch (story 4.8), on a
 * real temp tree: a write, an atomic rename and a burst each settle (a burst
 * once); a worktree folder, `.git` and a link out are neither watched nor
 * reported; a subfolder and the root deleted and recreated are still seen;
 * `fs.watch` throwing, too many folders or entries, poll instead; a flooding
 * watcher is closed and re-armed; `close()` leaves no watcher or timer and
 * nothing fires after it.
 */
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultWatchDir, startFolderWatch, type FolderWatch, type FolderWatchTiming, type WatchDir } from '../src/tickets-v7/folder-watch.js';

const TIMING: Partial<FolderWatchTiming> = { debounceMs: 40, maxWaitMs: 200, pollMs: 100, capPollMs: 150, confirmMs: 100 };
const dirs: string[] = [];
const open: FolderWatch[] = [];

afterEach(() => {
  for (const watch of open.splice(0)) watch.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempTree(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-folder-watch-')));
  dirs.push(root);
  mkdirSync(join(root, 'out', 'epic-a'), { recursive: true });
  writeFileSync(join(root, 'out', 'tickets.toml'), 'one\n');
  writeFileSync(join(root, 'out', 'epic-a', 'plan.md'), 'status: draft\n');
  return root;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** `fs.watch` counting the watchers it opened and has not closed, and keeping each listener. */
function countingWatchDir(inner: WatchDir = defaultWatchDir) {
  const live = new Map<string, Array<(eventType: string, filename: string | null) => void>>();
  let openCount = 0;
  let opened = 0;
  const watchDir: WatchDir = (dir, listener, recursive) => {
    const watcher = inner(dir, listener, recursive);
    openCount++;
    opened++;
    const listeners = live.get(dir) ?? [];
    listeners.push(listener);
    live.set(dir, listeners);
    let closed = false;
    return {
      close() {
        if (!closed) {
          closed = true;
          openCount--;
          live.set(
            dir,
            (live.get(dir) ?? []).filter((each) => each !== listener),
          );
        }
        watcher.close();
      },
      on: (event, handler) => watcher.on(event, handler),
    };
  };
  return { watchDir, open: () => openCount, opened: () => opened, listeners: (dir: string) => live.get(dir) ?? [] };
}

/** Per-folder watchers unless `recursive` (the Windows default is covered by its own test). */
async function watchOut(root: string, options: { timing?: Partial<FolderWatchTiming>; watchDir?: WatchDir; onFallback?: (reason: string) => void; recursive?: boolean } = {}) {
  let settled = 0;
  const watch = await startFolderWatch({
    root: join(root, 'out'),
    onSettled: () => settled++,
    timing: { ...TIMING, ...options.timing },
    watchDir: options.watchDir,
    onFallback: options.onFallback,
    recursive: options.recursive ?? false,
  });
  open.push(watch);
  return { watch, settled: () => settled };
}

describe('folder-watch (story 4.8)', () => {
  it('a write settles once; an atomic rename settles; a burst coalesces into one', async () => {
    const root = tempTree();
    const counting = countingWatchDir();
    const { watch, settled } = await watchOut(root, { watchDir: counting.watchDir });
    expect(watch.state()).toMatchObject({ mode: 'watch', watchers: 2, timers: 1, pending: true });
    expect(counting.open()).toBe(2);
    // The confirming scan after arming finds nothing new.
    await waitFor(() => !watch.state().pending, 'the confirming scan');
    expect(watch.state()).toMatchObject({ timers: 0, pending: false });
    expect(settled()).toBe(0);

    writeFileSync(join(root, 'out', 'epic-a', 'plan.md'), 'status: in-progress\n');
    await waitFor(() => settled() === 1, 'the write');
    await sleep(150);
    expect(settled()).toBe(1);

    const tmp = join(root, 'out', 'epic-a', '.plan.md.tmp');
    writeFileSync(tmp, 'status: in-review\n');
    renameSync(tmp, join(root, 'out', 'epic-a', 'plan.md'));
    await waitFor(() => settled() === 2, 'the atomic rename');

    for (let i = 0; i < 50; i++) writeFileSync(join(root, 'out', 'epic-a', `f${i}.md`), `${i}\n`);
    await waitFor(() => settled() === 3, 'the burst');
    await sleep(300);
    expect(settled()).toBe(3);
  });

  it('never watches or reports a worktree folder, .git or a link out of the root', async () => {
    const root = tempTree();
    const outside = join(root, 'elsewhere');
    mkdirSync(outside);
    mkdirSync(join(root, 'out', 'wt', 'deep'), { recursive: true });
    writeFileSync(join(root, 'out', 'wt', '.git'), 'gitdir: /somewhere\n');
    mkdirSync(join(root, 'out', '.git'));
    symlinkSync(outside, join(root, 'out', 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const counting = countingWatchDir();
    const { settled } = await watchOut(root, { watchDir: counting.watchDir });
    // Only `out` and `out/epic-a`.
    expect(counting.open()).toBe(2);

    writeFileSync(join(root, 'out', 'wt', 'deep', 'plan.md'), 'status: done\n');
    writeFileSync(join(root, 'out', 'wt', 'plan.md'), 'status: done\n');
    writeFileSync(join(root, 'out', '.git', 'index'), 'x');
    writeFileSync(join(outside, 'plan.md'), 'status: done\n');
    await sleep(500);
    expect(settled()).toBe(0);
  });

  it('a subfolder deleted and recreated, and the root deleted and recreated, are still seen', async () => {
    const root = tempTree();
    const { watch, settled } = await watchOut(root);
    rmSync(join(root, 'out', 'epic-a'), { recursive: true });
    await waitFor(() => settled() === 1, 'the removal');
    mkdirSync(join(root, 'out', 'epic-a'));
    await sleep(200);
    writeFileSync(join(root, 'out', 'epic-a', 'plan.md'), 'status: built\n');
    await waitFor(() => settled() === 2, 'a write in the recreated folder');
    await waitFor(() => watch.state().watchers === 2, 'the recreated folder armed');

    rmSync(join(root, 'out'), { recursive: true });
    await waitFor(() => watch.state().mode === 'poll', 'polling for the missing root');
    expect(watch.state().watchers).toBe(0);
    const before = settled();
    mkdirSync(join(root, 'out', 'epic-b'), { recursive: true });
    writeFileSync(join(root, 'out', 'epic-b', 'plan.md'), 'status: draft\n');
    await waitFor(() => settled() > before && watch.state().mode === 'watch', 'the recreated root');
    const again = settled();
    writeFileSync(join(root, 'out', 'epic-b', 'plan.md'), 'status: in-progress\n');
    await waitFor(() => settled() > again, 'a write in the recreated root');
  });

  it('polls when fs.watch throws, and still sees a write', async () => {
    const root = tempTree();
    const reasons: string[] = [];
    const throwing: WatchDir = () => {
      throw Object.assign(new Error('UNC'), { code: 'UNKNOWN' });
    };
    const { watch, settled } = await watchOut(root, { watchDir: throwing, onFallback: (reason) => reasons.push(reason) });
    expect(watch.state()).toMatchObject({ mode: 'poll', watchers: 0, timers: 1 });
    expect(reasons).toEqual(['UNKNOWN']);
    writeFileSync(join(root, 'out', 'epic-a', 'plan.md'), 'status: in-progress\n');
    await waitFor(() => settled() === 1, 'the polled write');
  });

  it('a folder that cannot be armed for another reason (removed meanwhile) rescans instead of polling for good', async () => {
    const root = tempTree();
    let failNext = true;
    const flaky: WatchDir = (dir, listener, recursive) => {
      if (dir.endsWith('epic-a') && failNext) {
        failNext = false;
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      }
      return defaultWatchDir(dir, listener, recursive);
    };
    const reasons: string[] = [];
    const { watch, settled } = await watchOut(root, { watchDir: flaky, onFallback: (reason) => reasons.push(reason) });
    await waitFor(() => watch.state().watchers === 2, 'the re-armed folder');
    expect(watch.state().mode).toBe('watch');
    expect(reasons).toEqual([]);
    await waitFor(() => !watch.state().pending, 'the confirming scan');
    writeFileSync(join(root, 'out', 'epic-a', 'plan.md'), 'status: built\n');
    await waitFor(() => settled() === 1, 'the write');
  });

  it('a root that appears later is polled until it is there, then watched', async () => {
    const parent = tempTree();
    const nested = join(parent, 'out', 'later', 'root');
    let settled = 0;
    const watch = await startFolderWatch({ root: nested, onSettled: () => settled++, timing: TIMING, recursive: false });
    open.push(watch);
    expect(watch.state()).toMatchObject({ mode: 'poll', watchers: 0 });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'plan.md'), 'x\n');
    await waitFor(() => settled === 1 && watch.state().mode === 'watch', 'the appeared root');
  });

  it('a parent swapped for a link to a look-alike tree is missing: a write in the link target never settles', async () => {
    // Polling (no folder watcher open), because Windows refuses to rename a folder above an open watch handle.
    const parent = tempTree();
    const nested = join(parent, 'out', 'later', 'root');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'plan.md'), 'x\n');
    let settled = 0;
    const watch = await startFolderWatch({ root: nested, onSettled: () => settled++, timing: { ...TIMING, maxDirs: 0 }, recursive: false });
    open.push(watch);
    expect(watch.state()).toMatchObject({ mode: 'poll', watchers: 0 });
    const elsewhere = join(parent, 'elsewhere');
    mkdirSync(join(elsewhere, 'root'), { recursive: true });
    writeFileSync(join(elsewhere, 'root', 'plan.md'), 'x\n');
    renameSync(join(parent, 'out', 'later'), join(parent, 'moved'));
    symlinkSync(elsewhere, join(parent, 'out', 'later'), process.platform === 'win32' ? 'junction' : 'dir');
    // The swap itself reads as the root going missing (one settle), then nothing from the target.
    await waitFor(() => settled === 1, 'the root treated as missing');
    writeFileSync(join(elsewhere, 'root', 'plan.md'), 'changed\n');
    writeFileSync(join(elsewhere, 'root', 'new.md'), 'new\n');
    await sleep(500);
    expect(settled).toBe(1);
  });

  it('with the default mode, folders with subfolders can be renamed while watched, and the rename settles (Windows: one recursive watcher)', async () => {
    const root = tempTree();
    mkdirSync(join(root, 'out', 'epic-a', 'sub', 'deeper'), { recursive: true });
    writeFileSync(join(root, 'out', 'epic-a', 'sub', 'deeper', 'plan.md'), 'x\n');
    let settled = 0;
    const watch = await startFolderWatch({ root: join(root, 'out'), onSettled: () => settled++, timing: TIMING });
    open.push(watch);
    await sleep(250);
    expect(watch.state().mode).toBe('watch');
    // Per-folder handles on Windows made this EPERM (story 4.8 CI): the user, git or an agent couldn't rename an epic.
    renameSync(join(root, 'out', 'epic-a'), join(root, 'out', 'epic-b'));
    renameSync(join(root, 'out', 'epic-b', 'sub'), join(root, 'out', 'epic-b', 'sub2'));
    await waitFor(() => settled >= 1, 'the renamed folders');
    const before = settled;
    writeFileSync(join(root, 'out', 'epic-b', 'sub2', 'deeper', 'plan.md'), 'changed\n');
    await waitFor(() => settled > before, 'a write under the renamed folder');
    rmSync(join(root, 'out', 'epic-b'), { recursive: true });
    await waitFor(() => settled > before + 1, 'the removed folder');
  });

  it('recursive mode: a write settles, a worktree write does not, and close leaves nothing open', async () => {
    const root = tempTree();
    mkdirSync(join(root, 'out', 'wt', 'deep'), { recursive: true });
    writeFileSync(join(root, 'out', 'wt', '.git'), 'gitdir: elsewhere\n');
    const counting = countingWatchDir();
    const { watch, settled } = await watchOut(root, { watchDir: counting.watchDir, recursive: true });
    expect(watch.state()).toMatchObject({ mode: 'watch', watchers: 1 });
    await sleep(250);
    writeFileSync(join(root, 'out', 'wt', 'deep', 'x.md'), 'x\n');
    await sleep(500);
    expect(settled()).toBe(0);
    writeFileSync(join(root, 'out', 'epic-a', 'plan.md'), 'status: in-progress\n');
    await waitFor(() => settled() === 1, 'the plan write');
    watch.close();
    expect(watch.state()).toMatchObject({ watchers: 0, timers: 0, closed: true });
    expect(counting.open()).toBe(0);
  });

  it('a same-size rewrite that keeps the file timestamp still settles (Windows clock ticks; story 4.8 CI)', async () => {
    const root = tempTree();
    const plan = join(root, 'out', 'epic-a', 'plan.md');
    // Polling, so only the fingerprint can see it.
    const { settled } = await watchOut(root, { timing: { maxDirs: 0 } });
    const { atime, mtime } = statSync(plan);
    writeFileSync(plan, 'status: built\n'.padEnd('status: draft\n'.length));
    utimesSync(plan, atime, mtime);
    await waitFor(() => settled() === 1, 'the same-size rewrite');
  });

  it('a watcher error like ENOSPC falls back to polling for good', async () => {
    const root = tempTree();
    const handlers: Array<(error: Error) => void> = [];
    const erroring: WatchDir = (dir, listener, recursive) => {
      const watcher = defaultWatchDir(dir, listener, recursive);
      return {
        close: () => watcher.close(),
        on: (event, handler) => {
          handlers.push(handler);
          return watcher.on(event, handler);
        },
      };
    };
    const { watch, settled } = await watchOut(root, { watchDir: erroring });
    handlers[0]!(Object.assign(new Error('no space'), { code: 'ENOSPC' }));
    expect(watch.state()).toMatchObject({ mode: 'poll', watchers: 0 });
    writeFileSync(join(root, 'out', 'tickets.toml'), 'two\n');
    await waitFor(() => settled() === 1, 'the polled write');
  });

  it('past the folder or entry cap it polls, with no watcher open', async () => {
    const root = tempTree();
    const counting = countingWatchDir();
    const byDirs = await watchOut(root, { watchDir: counting.watchDir, timing: { maxDirs: 1 } });
    expect(byDirs.watch.state()).toMatchObject({ mode: 'poll', watchers: 0 });
    expect(counting.opened()).toBe(0);
    writeFileSync(join(root, 'out', 'tickets.toml'), 'two\n');
    // At the slower cap poll.
    await waitFor(() => byDirs.settled() === 1, 'the polled write');

    const byEntries = await watchOut(tempTree(), { watchDir: counting.watchDir, timing: { maxScanEntries: 1 } });
    expect(byEntries.watch.state()).toMatchObject({ mode: 'poll', watchers: 0 });
    expect(counting.opened()).toBe(0);
  });

  it('a flooding watcher is closed and the next scan re-arms it', async () => {
    const root = tempTree();
    const counting = countingWatchDir();
    const { watch } = await watchOut(root, { watchDir: counting.watchDir, timing: { floodLimit: 5 } });
    const out = join(root, 'out');
    const [listener] = counting.listeners(out);
    for (let i = 0; i < 6; i++) listener!('change', null);
    expect(watch.state().watchers).toBe(1);
    await waitFor(() => watch.state().watchers === 2 && !watch.state().pending, 'the re-armed watcher');
    expect(counting.open()).toBe(2);
  });

  it('close() leaves no watcher or timer, nothing fires after it, and a repeat is harmless', async () => {
    const root = tempTree();
    const counting = countingWatchDir();
    const { watch, settled } = await watchOut(root, { watchDir: counting.watchDir, timing: { debounceMs: 300, maxWaitMs: 1000 } });
    writeFileSync(join(root, 'out', 'tickets.toml'), 'two\n');
    // A change pending (debounced) when it closes.
    await waitFor(() => watch.state().pending, 'the pending change');
    watch.close();
    watch.close();
    expect(watch.state()).toEqual({ mode: 'watch', watchers: 0, timers: 0, pending: false, closed: true });
    expect(counting.open()).toBe(0);
    writeFileSync(join(root, 'out', 'tickets.toml'), 'three\n');
    await sleep(400);
    expect(settled()).toBe(0);

    const polling = await watchOut(tempTree(), { timing: { maxDirs: 1 } });
    expect(polling.watch.state().timers).toBe(1);
    polling.watch.close();
    expect(polling.watch.state()).toMatchObject({ watchers: 0, timers: 0 });
  });
});
