#!/usr/bin/env node
// TEMPORARY (story 4.8): facts about Node's fs.watch on the CI runners, for the
// ticket watcher. Prints facts only and never fails; removed before review.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (name, fact) => console.log(`FACT ${name}: ${JSON.stringify(fact)}`);
const base = fs.realpathSync(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'watch-probe-')));

out('platform', { platform: process.platform, release: (await import('node:os')).release(), node: process.version, base });
if (process.platform === 'linux') {
  for (const name of ['max_user_watches', 'max_user_instances', 'max_queued_events']) {
    try {
      out(`inotify.${name}`, fs.readFileSync(`/proc/sys/fs/inotify/${name}`, 'utf8').trim());
    } catch (error) {
      out(`inotify.${name}`, String(error));
    }
  }
}

/** A watcher recording every event with its time; `opts.recursive` as given. */
function record(root, opts = { recursive: true }) {
  const events = [];
  const errors = [];
  let watcher;
  try {
    watcher = fs.watch(root, opts, (type, file) => events.push({ t: performance.now(), type, file: file === null ? null : String(file) }));
    watcher.on('error', (error) => errors.push(`${error.code ?? ''} ${error.message}`));
  } catch (error) {
    errors.push(`throw ${error.code ?? ''} ${error.message}`);
  }
  return { events, errors, watcher, close: () => watcher?.close() };
}

/** Runs `act` against a fresh tree with a recursive watcher; reports latency of the first event matching `match`, totals and the quiet time. */
async function scenario(name, setup, act, match = () => true, { wait = 3000, opts = { recursive: true } } = {}) {
  const root = fs.mkdtempSync(path.join(base, `${name.replace(/\W+/g, '-')}-`));
  try {
    await setup?.(root);
    const rec = record(root, opts);
    await sleep(300); // Linux's recursive watch adds its inotify watches asynchronously.
    const start = performance.now();
    await act(root);
    const deadline = performance.now() + wait;
    while (performance.now() < deadline && !rec.events.some((e) => e.t >= start && match(e))) await sleep(10);
    const first = rec.events.find((e) => e.t >= start && match(e));
    await sleep(Math.min(wait, 1500));
    const after = rec.events.filter((e) => e.t >= start);
    rec.close();
    out(name, {
      firstMatchMs: first === undefined ? null : Math.round(first.t - start),
      events: after.length,
      lastEventMs: after.length === 0 ? null : Math.round(after[after.length - 1].t - start),
      sample: after.slice(0, 8).map((e) => `${e.type}:${e.file}`),
      distinctFiles: new Set(after.map((e) => e.file)).size,
      errors: rec.errors,
    });
    return after;
  } catch (error) {
    out(name, { threw: `${error.code ?? ''} ${error.message}` });
  } finally {
    await sleep(50);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
  return [];
}

const PLAN = path.join('epic-a', 'story-one-plan.md');
const tree = (root) => {
  fs.mkdirSync(path.join(root, 'epic-a'), { recursive: true });
  fs.writeFileSync(path.join(root, PLAN), '---\nstatus: draft\n---\n');
  fs.writeFileSync(path.join(root, 'tickets.toml'), '[[entry]]\nid = 1\n');
};
const isPlan = (e) => e.file !== null && e.file.replace(/\\/g, '/').endsWith('story-one-plan.md');

// 1. A plain write into a plan file (what an agent's Write tool does).
await scenario('write-plan', tree, (root) => fs.writeFileSync(path.join(root, PLAN), '---\nstatus: in-progress\n---\n'), isPlan);
// 2. Atomic save: write a temp file beside it, rename over (VS Code, many tools).
await scenario('atomic-rename-over', tree, (root) => {
  const tmp = path.join(root, 'epic-a', '.story-one-plan.md.tmp');
  fs.writeFileSync(tmp, '---\nstatus: in-progress\n---\n');
  fs.renameSync(tmp, path.join(root, PLAN));
}, isPlan);
// 3. vim-style: move the original to a backup, write a new file, delete the backup.
await scenario('vim-backup-swap', tree, (root) => {
  const target = path.join(root, PLAN);
  fs.renameSync(target, `${target}~`);
  fs.writeFileSync(target, '---\nstatus: in-progress\n---\n');
  fs.unlinkSync(`${target}~`);
}, isPlan);
// 4. A new folder and a file inside it straight away (a new epic): is the file's event seen?
await scenario('new-dir-then-file', tree, (root) => {
  fs.mkdirSync(path.join(root, 'epic-b'));
  fs.writeFileSync(path.join(root, 'epic-b', 'story-two-plan.md'), 'x');
}, (e) => e.file !== null && e.file.includes('story-two-plan.md'));
// 4b. A file written into the new folder 500 ms later.
await scenario('new-dir-file-later', tree, async (root) => {
  fs.mkdirSync(path.join(root, 'epic-b'));
  await sleep(500);
  fs.writeFileSync(path.join(root, 'epic-b', 'story-two-plan.md'), 'x');
}, (e) => e.file !== null && e.file.includes('story-two-plan.md'));
// 5. Deleted and recreated subfolder, then a write inside it later.
await scenario('dir-delete-recreate', tree, async (root) => {
  fs.rmSync(path.join(root, 'epic-a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'epic-a'));
  await sleep(500);
  fs.writeFileSync(path.join(root, PLAN), 'again');
}, (e) => isPlan(e) && e.t > 0, { wait: 4000 });
// 6. A burst of 300 files (git checkout of a big change).
await scenario('burst-300', (root) => {
  tree(root);
  for (let i = 0; i < 10; i++) fs.mkdirSync(path.join(root, `d${i}`));
}, (root) => {
  for (let i = 0; i < 300; i++) fs.writeFileSync(path.join(root, `d${i % 10}`, `f${i}.md`), `n${i}`);
});
// 7. Rename storm: 100 renames.
await scenario('rename-100', (root) => {
  tree(root);
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(root, `r${i}.md`), 'r');
}, (root) => {
  for (let i = 0; i < 100; i++) fs.renameSync(path.join(root, `r${i}.md`), path.join(root, `s${i}.md`));
});
// 8. A symlink inside the tree to a folder outside it: are writes in the target reported?
const outside = fs.mkdtempSync(path.join(base, 'outside-'));
await scenario('symlink-out', (root) => {
  tree(root);
  fs.symlinkSync(outside, path.join(root, 'link-out'), process.platform === 'win32' ? 'junction' : 'dir');
}, (root) => fs.writeFileSync(path.join(outside, 'secret.md'), 'x'), (e) => e.file !== null && e.file.includes('secret'), { wait: 2000 });
// 9. A worktree-like folder inside the tree: events arrive, so the filter must drop them.
await scenario('worktree-inside', (root) => {
  tree(root);
  fs.mkdirSync(path.join(root, '.worktrees', 'wt1'), { recursive: true });
}, (root) => fs.writeFileSync(path.join(root, '.worktrees', 'wt1', 'x.md'), 'x'), (e) => e.file !== null && e.file.includes('wt1'));
// 10. Real git checkout between two branches differing in 50 files.
await scenario('git-checkout-50', (root) => {
  tree(root);
  const git = (...args) => execFileSync('git', ['-c', 'user.email=p@p', '-c', 'user.name=p', '-c', 'commit.gpgsign=false', ...args], { cwd: root, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(root, 'epic-a', `p${i}.md`), 'a');
  git('add', '-A');
  git('commit', '-qm', 'a');
  git('checkout', '-qb', 'other');
  for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(root, 'epic-a', `p${i}.md`), 'b');
  git('commit', '-qam', 'b');
}, (root) => execFileSync('git', ['checkout', '-q', 'main'], { cwd: root, stdio: 'ignore' }));
// 11. The watched root itself removed, then recreated: does the watcher error, close, keep reporting?
{
  const root = fs.mkdtempSync(path.join(base, 'root-gone-'));
  tree(root);
  const rec = record(root);
  let closed = false;
  rec.watcher?.on('close', () => {
    closed = true;
  });
  await sleep(300);
  fs.rmSync(root, { recursive: true, force: true });
  await sleep(800);
  const afterRemove = { events: rec.events.length, errors: [...rec.errors], closed };
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tickets.toml'), 'x');
  await sleep(800);
  out('root-removed', { afterRemove, afterRecreate: { events: rec.events.length - afterRemove.events, errors: rec.errors, closed }, sample: rec.events.slice(-5).map((e) => `${e.type}:${e.file}`) });
  rec.close();
  fs.rmSync(root, { recursive: true, force: true });
}
// 12. Watch setup cost and resources for a big tree (2000 folders): time, errors, inotify count.
{
  const root = fs.mkdtempSync(path.join(base, 'big-'));
  for (let i = 0; i < 2000; i++) fs.mkdirSync(path.join(root, `a${i % 40}`, `b${i}`), { recursive: true });
  const t0 = performance.now();
  const rec = record(root);
  const syncMs = Math.round(performance.now() - t0);
  await sleep(1500);
  fs.writeFileSync(path.join(root, 'a7', 'b1007', 'deep.md'), 'x');
  await sleep(800);
  let inotify = null;
  if (process.platform === 'linux') {
    try {
      inotify = fs.readdirSync('/proc/self/fdinfo').reduce((n, fd) => {
        try {
          return n + (fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^inotify wd:/gm)?.length ?? 0);
        } catch {
          return n;
        }
      }, 0);
    } catch (error) {
      inotify = String(error);
    }
  }
  out('big-tree-2000-dirs', { syncSetupMs: syncMs, deepSeen: rec.events.some((e) => e.file?.includes('deep.md')), inotifyWatches: inotify, errors: rec.errors });
  rec.close();
  await sleep(200);
  if (process.platform === 'linux') {
    const left = fs.readdirSync('/proc/self/fdinfo').reduce((n, fd) => {
      try {
        return n + (fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^inotify wd:/gm)?.length ?? 0);
      } catch {
        return n;
      }
    }, 0);
    out('big-tree-after-close-inotify', left);
  }
  // Polling fallback cost: one full stat scan of the same tree.
  const t1 = performance.now();
  let count = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      count++;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else fs.statSync(path.join(dir, entry.name));
    }
  };
  walk(root);
  out('poll-scan-2000-dirs', { entries: count, ms: Math.round(performance.now() - t1) });
  fs.rmSync(root, { recursive: true, force: true });
}
// 13. Non-recursive per-folder watch for comparison (write in a subfolder).
await scenario('nonrecursive-subdir', tree, (root) => fs.writeFileSync(path.join(root, PLAN), 'y'), isPlan, { opts: { recursive: false }, wait: 1500 });
// 14. A write delivered in two chunks: is the content complete when the first event fires?
{
  const root = fs.mkdtempSync(path.join(base, 'partial-'));
  tree(root);
  const target = path.join(root, PLAN);
  const sizes = [];
  const watcher = fs.watch(root, { recursive: true }, (_type, file) => {
    if (file !== null && String(file).endsWith('story-one-plan.md')) sizes.push(fs.statSync(target, { throwIfNoEntry: false })?.size ?? -1);
  });
  await sleep(300);
  const fd = fs.openSync(target, 'w');
  fs.writeSync(fd, 'a'.repeat(1000));
  await sleep(200);
  fs.writeSync(fd, 'b'.repeat(1000));
  fs.closeSync(fd);
  await sleep(800);
  watcher.close();
  out('partial-write-sizes-at-event', sizes);
  fs.rmSync(root, { recursive: true, force: true });
}
// 15. Unicode and spaces in the path; a UNC admin-share path on Windows (network-ish).
await scenario('unicode-space-path', (root) => {
  fs.mkdirSync(path.join(root, 'épic ä'), { recursive: true });
  fs.writeFileSync(path.join(root, 'épic ä', 'plan.md'), 'x');
}, (root) => fs.writeFileSync(path.join(root, 'épic ä', 'plan.md'), 'y'), (e) => e.file !== null && e.file.includes('plan.md'));
if (process.platform === 'win32') {
  const unc = `\\\\localhost\\${base[0]}$${base.slice(2)}`;
  try {
    fs.mkdirSync(path.join(unc, 'unc-tree', 'epic-a'), { recursive: true });
    const rec = record(path.join(unc, 'unc-tree'));
    await sleep(300);
    const start = performance.now();
    fs.writeFileSync(path.join(unc, 'unc-tree', 'epic-a', 'p.md'), 'x');
    await sleep(2000);
    out('unc-path', { unc, firstMs: rec.events[0] === undefined ? null : Math.round(rec.events[0].t - start), events: rec.events.length, errors: rec.errors });
    rec.close();
  } catch (error) {
    out('unc-path', { unc, threw: `${error.code ?? ''} ${error.message}` });
  }
}
// 16. Close releases everything: the process exits on its own once the last watcher closes.
{
  const root = fs.mkdtempSync(path.join(base, 'close-'));
  tree(root);
  const watchers = Array.from({ length: 20 }, () => fs.watch(root, { recursive: true }, () => {}));
  for (const each of watchers) each.close();
  const recClosed = record(root);
  recClosed.close();
  fs.writeFileSync(path.join(root, PLAN), 'after close');
  await sleep(500);
  out('events-after-close', recClosed.events.length);
  fs.rmSync(root, { recursive: true, force: true });
}
fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 });
out('done', true);
