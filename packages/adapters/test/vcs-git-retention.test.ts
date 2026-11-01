/**
 * `vcs-git`'s retention half (epic 27, 27.6) against temp repos (real git,
 * no network): a chat worktree's changes saved for a put-away (modified,
 * new and deleted files; a clean copy saves `null`; a detached HEAD, a merge
 * in progress and a nested repository are refused), its folder removed
 * through `VcsPort.removeWorktree` with the branch kept, then Restore (on
 * its branch, tracked edits unstaged, untracked back, deletions back; the
 * branch gone, moved or the path taken change nothing; a half put-away copy
 * repaired in place), and the store's cleanup (only unreferenced objects
 * past the grace, never through a link, no store removed whole while a
 * project can't be read). The repo's own objects, refs and index never
 * change, and nothing is written outside `<data>/snapshots` and `<data>/cw`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { VcsError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitChatWorktree, createGitVcs } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.longpaths=true', '-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const BRANCH = `ogden/chat/${SES}`;
const DAY = 24 * 60 * 60 * 1000;
/** A store no project maps to. */
const ORPHAN = '0123456789abcdef';

/** Every file under `root` (relative, sorted), with its size and time. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

/** The repo's own state that nothing here may change: its objects, refs and index. */
function repoState(repo: string): string {
  const objects = filesUnder(join(repo, '.git', 'objects')).join('\n');
  const refs = git(repo, 'for-each-ref', '--format=%(refname) %(objectname)');
  const index = readFileSync(join(repo, '.git', 'index')).toString('base64');
  return `${objects}\n${refs}\n${index}`;
}

/** A repo on `main`, a data folder with `cw` and `snapshots`, and a chat worktree on its branch with a tracked file, one to delete, and one ignored. */
async function setup(options: { now?: () => number } = {}) {
  const repo = temp('ogden-agents-ret-repo-');
  const data = temp('ogden-agents-ret-data-');
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  writeFileSync(join(repo, 'gone.txt'), 'delete me\n');
  writeFileSync(join(repo, '.gitignore'), '.env\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  const chats = join(data, 'cw');
  mkdirSync(chats);
  const env = () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });
  const hooksDir = join(data, 'tools', 'git-hooks-none');
  const vcs = createGitVcs({ hooksDir, worktreesRoot: join(data, 'w'), chatWorktreesRoot: chats, env });
  const snapshotsRoot = join(data, 'snapshots');
  const port = createGitChatWorktree({ hooksDir, env, snapshotsRoot, chatWorktreesRoot: chats, now: options.now });
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  const path = join(chats, 'aaaaaaaa');
  await vcs.addWorktree(repo, { path, branch: BRANCH, base: head });
  return { repo, data, chats, vcs, port, head, path, snapshotsRoot };
}

/** What a worktree looks like: its files (not `.git`) and their content. */
const contents = (path: string): Record<string, string> =>
  Object.fromEntries(
    filesUnder(path)
      .filter((file) => file !== '.git')
      .map((file) => [file, readFileSync(join(path, file), 'utf8')]),
  );

describe('vcs-git saves a chat worktree for a put-away and restores it (27.6)', () => {
  it('saves modified, new and deleted files; Restore brings them back on the branch, unstaged, and the repo is untouched', async () => {
    const { repo, data, vcs, port, head, path, snapshotsRoot } = await setup();
    writeFileSync(join(path, 'a.txt'), 'two\n');
    writeFileSync(join(path, 'new.txt'), 'new\n');
    rmSync(join(path, 'gone.txt'));
    writeFileSync(join(path, '.env'), 'SECRET=1\n');
    // A staged edit: it comes back unstaged.
    git(path, 'add', 'a.txt');
    const outside = filesUnder(data).filter((file) => !file.startsWith('snapshots') && !file.startsWith('cw') && !file.startsWith('tools'));

    const saved = await port.saveForPutAway(repo, path, BRANCH);
    expect(saved).toMatchObject({ head, files: 3 });
    expect(saved.snapshotTree).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(path)).toBe(true);
    // Nothing is left in the store's tmp, and nothing was written outside the snapshots folder.
    expect(filesUnder(join(snapshotsRoot, 'tmp'))).toEqual([]);

    await vcs.removeWorktree(repo, path, {});
    expect(existsSync(path)).toBe(false);
    expect(git(repo, 'branch', '--list', BRANCH).trim()).not.toBe('');
    // The staged blob the copy wrote into the repo is still readable from the store after the repo forgets it.
    git(repo, 'reflog', 'expire', '--expire=now', '--all');
    git(repo, 'gc', '-q', '--prune=now');

    const beforeRestore = repoState(repo);
    expect(await port.restore(repo, { path, branch: BRANCH, head: saved.head, snapshotTree: saved.snapshotTree })).toBe('restored');
    expect(repoState(repo)).toBe(beforeRestore);
    expect(contents(path)).toEqual({ '.gitignore': '.env\n', 'a.txt': 'two\n', 'new.txt': 'new\n' });
    // Cleanup never touches the repo either.
    await port.pruneSnapshots([{ folder: repo, keep: [saved.snapshotTree!] }], { olderThanMs: 0 });
    expect(repoState(repo)).toBe(beforeRestore);
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(BRANCH);
    // Tracked edits unstaged, the new file untracked, the deletion back.
    expect(git(path, 'status', '--porcelain=v1').split('\n').filter(Boolean).sort()).toEqual([' D gone.txt', ' M a.txt', '?? new.txt']);
    expect(filesUnder(data).filter((file) => !file.startsWith('snapshots') && !file.startsWith('cw') && !file.startsWith('tools'))).toEqual(outside);
  });

  it("never writes the repo's objects, refs or index while saving", async () => {
    const { repo, port, path } = await setup();
    writeFileSync(join(path, 'a.txt'), 'two\n');
    writeFileSync(join(path, 'big.bin'), Buffer.alloc(4096, 7));
    const before = repoState(repo);
    await port.saveForPutAway(repo, path, BRANCH);
    expect(repoState(repo)).toBe(before);
  });

  it('saves a clean copy as null with no files, and restores it on the new tip even after the branch moved', async () => {
    const { repo, vcs, port, head, path } = await setup();
    const saved = await port.saveForPutAway(repo, path, BRANCH);
    expect(saved).toEqual({ snapshotTree: null, head, files: 0 });
    await vcs.removeWorktree(repo, path, {});
    // The branch moves on (a commit made elsewhere).
    git(repo, 'branch', '-f', BRANCH, git(repo, 'commit-tree', '-p', head, '-m', 'later', `${head}^{tree}`).trim());
    expect(await port.restore(repo, { path, branch: BRANCH, head, snapshotTree: null })).toBe('restored');
    expect(contents(path)).toEqual({ '.gitignore': '.env\n', 'a.txt': 'one\n', 'gone.txt': 'delete me\n' });
  });

  it('refuses a detached HEAD, a merge in progress and a nested repository, saving nothing', async () => {
    const detached = await setup();
    git(detached.path, 'checkout', '-q', '--detach');
    await expect(detached.port.saveForPutAway(detached.repo, detached.path, BRANCH)).rejects.toThrow(VcsError);

    const merging = await setup();
    const gitDir = git(merging.path, 'rev-parse', '--absolute-git-dir').trim();
    writeFileSync(join(gitDir, 'MERGE_HEAD'), `${merging.head}\n`);
    await expect(merging.port.saveForPutAway(merging.repo, merging.path, BRANCH)).rejects.toThrow(VcsError);

    const nested = await setup();
    mkdirSync(join(nested.path, 'inner'));
    git(join(nested.path, 'inner'), 'init', '-q');
    writeFileSync(join(nested.path, 'inner', 'x.txt'), 'x\n');
    git(join(nested.path, 'inner'), 'add', '-A');
    git(join(nested.path, 'inner'), 'commit', '-q', '--no-verify', '-m', 'inner');
    await expect(nested.port.saveForPutAway(nested.repo, nested.path, BRANCH)).rejects.toThrow(VcsError);

    // A folder outside `<data>/cw` is refused before git runs.
    await expect(nested.port.saveForPutAway(nested.repo, nested.repo, BRANCH)).rejects.toThrow(VcsError);
  });

  it('answers branch_missing, branch_moved and path_taken, changing nothing', async () => {
    const { repo, vcs, port, head, path } = await setup();
    writeFileSync(join(path, 'a.txt'), 'two\n');
    const saved = await port.saveForPutAway(repo, path, BRANCH);
    await vcs.removeWorktree(repo, path, {});

    // Something else at the path.
    mkdirSync(path);
    writeFileSync(join(path, 'other.txt'), 'mine\n');
    expect(await port.restore(repo, { path, branch: BRANCH, head, snapshotTree: saved.snapshotTree })).toBe('path_taken');
    expect(contents(path)).toEqual({ 'other.txt': 'mine\n' });
    rmSync(path, { recursive: true });

    // The branch moved on: the saved changes were made on the commit before.
    const moved = git(repo, 'commit-tree', '-p', head, '-m', 'later', `${head}^{tree}`).trim();
    git(repo, 'branch', '-f', BRANCH, moved);
    expect(await port.restore(repo, { path, branch: BRANCH, head, snapshotTree: saved.snapshotTree })).toBe('branch_moved');
    expect(existsSync(path)).toBe(false);

    git(repo, 'branch', '-D', BRANCH);
    expect(await port.restore(repo, { path, branch: BRANCH, head, snapshotTree: saved.snapshotTree })).toBe('branch_missing');
    expect(existsSync(path)).toBe(false);
  });

  it('repairs a half put-away copy in place, and replaces the record of one whose folder went but whose record stayed', async () => {
    const inPlace = await setup();
    writeFileSync(join(inPlace.path, 'a.txt'), 'two\n');
    writeFileSync(join(inPlace.path, 'new.txt'), 'new\n');
    const saved = await inPlace.port.saveForPutAway(inPlace.repo, inPlace.path, BRANCH);
    // The removal stopped half way: some files gone.
    rmSync(join(inPlace.path, 'a.txt'));
    rmSync(join(inPlace.path, 'new.txt'));
    expect(await inPlace.port.restore(inPlace.repo, { path: inPlace.path, branch: BRANCH, head: saved.head, snapshotTree: saved.snapshotTree })).toBe('restored');
    expect(contents(inPlace.path)).toMatchObject({ 'a.txt': 'two\n', 'new.txt': 'new\n' });

    const stale = await setup();
    writeFileSync(join(stale.path, 'new.txt'), 'new\n');
    const kept = await stale.port.saveForPutAway(stale.repo, stale.path, BRANCH);
    // The folder went, git's record of it stayed.
    rmSync(stale.path, { recursive: true });
    expect(existsSync(join(stale.repo, '.git', 'worktrees', 'aaaaaaaa'))).toBe(true);
    expect(await stale.port.restore(stale.repo, { path: stale.path, branch: BRANCH, head: kept.head, snapshotTree: kept.snapshotTree })).toBe('restored');
    expect(contents(stale.path)).toMatchObject({ 'new.txt': 'new\n' });
  });
});

describe("vcs-git cleans the snapshot store (27.6)", () => {
  /** The loose objects in the repo's store. */
  const storeObjects = (snapshotsRoot: string): string[] => {
    const [store] = readdirSync(snapshotsRoot).filter((name) => /^[0-9a-f]{16}$/.test(name) && name !== ORPHAN);
    return store === undefined ? [] : filesUnder(join(snapshotsRoot, store, 'objects')).filter((file) => /^[0-9a-f]{2}[\\/]/.test(file));
  };
  const age = (root: string, ms: number) => {
    const when = new Date(Date.now() - ms);
    for (const file of filesUnder(root)) utimesSync(join(root, file), when, when);
  };

  it('removes only unreferenced objects past the grace; a kept tree and a fresh object stay', async () => {
    const { repo, port, path, snapshotsRoot } = await setup();
    writeFileSync(join(path, 'a.txt'), 'kept\n');
    const kept = await port.saveForPutAway(repo, path, BRANCH);
    writeFileSync(join(path, 'a.txt'), 'dropped\n');
    const dropped = await port.saveForPutAway(repo, path, BRANCH);
    expect(dropped.snapshotTree).not.toBe(kept.snapshotTree);
    age(snapshotsRoot, 2 * DAY);
    writeFileSync(join(path, 'a.txt'), 'fresh\n');
    const fresh = await port.saveForPutAway(repo, path, BRANCH);
    const before = storeObjects(snapshotsRoot);
    const pruned = await port.pruneSnapshots([{ folder: repo, keep: [kept.snapshotTree!] }], { olderThanMs: DAY });
    expect(pruned.objects).toBeGreaterThan(0);
    const after = storeObjects(snapshotsRoot);
    const has = (id: string) => after.some((file) => file.replace(/[\\/]/, '') === id);
    expect(has(kept.snapshotTree!)).toBe(true);
    expect(has(fresh.snapshotTree!)).toBe(true);
    expect(has(dropped.snapshotTree!)).toBe(false);
    expect(after.length).toBeLessThan(before.length);
  });

  it('keeps everything of a busy project, removes an unmapped store only when every project was found, and old tmp files', async () => {
    // Temporary files are judged by their change time, which only the clock moves past.
    let clock = 0;
    const { repo, port, path, snapshotsRoot } = await setup({ now: () => Date.now() + clock });
    writeFileSync(join(path, 'a.txt'), 'two\n');
    await port.saveForPutAway(repo, path, BRANCH);
    const orphan = join(snapshotsRoot, ORPHAN);
    mkdirSync(join(orphan, 'objects', 'ab'), { recursive: true });
    writeFileSync(join(orphan, 'objects', 'ab', 'c'.repeat(38)), 'x');
    writeFileSync(join(snapshotsRoot, 'tmp', 'left.index'), 'x');
    age(snapshotsRoot, 2 * DAY);
    clock = 2 * DAY;
    const before = storeObjects(snapshotsRoot);

    // A project that can't be read: no store removed whole.
    const unreadable = await port.pruneSnapshots([{ folder: repo, keep: null }, { folder: join(repo, 'missing-project'), keep: null }], { olderThanMs: DAY });
    expect(unreadable).toEqual({ objects: 0, stores: 0, temporary: 1, refused: 1 });
    expect(existsSync(orphan)).toBe(true);
    expect(storeObjects(snapshotsRoot)).toEqual(before);

    const all = await port.pruneSnapshots([{ folder: repo, keep: null }], { olderThanMs: DAY });
    expect(all.stores).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(storeObjects(snapshotsRoot)).toEqual(before);
  });

  it('deletes nothing through a link: the snapshots folder or a store a link', async () => {
    const { repo, port, path, snapshotsRoot, data } = await setup();
    writeFileSync(join(path, 'a.txt'), 'two\n');
    await port.saveForPutAway(repo, path, BRANCH);
    age(snapshotsRoot, 2 * DAY);
    const [store] = readdirSync(snapshotsRoot).filter((name) => /^[0-9a-f]{16}$/.test(name));
    // A store that is a link to elsewhere.
    const elsewhere = temp('ogden-agents-ret-elsewhere-');
    mkdirSync(join(elsewhere, 'objects', 'ab'), { recursive: true });
    writeFileSync(join(elsewhere, 'objects', 'ab', 'd'.repeat(38)), 'x');
    utimesSync(join(elsewhere, 'objects', 'ab', 'd'.repeat(38)), new Date(Date.now() - 2 * DAY), new Date(Date.now() - 2 * DAY));
    rmSync(join(snapshotsRoot, store!), { recursive: true });
    symlinkSync(elsewhere, join(snapshotsRoot, store!), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await port.pruneSnapshots([{ folder: repo, keep: [] }], { olderThanMs: DAY })).toMatchObject({ objects: 0, refused: 1 });
    expect(existsSync(join(elsewhere, 'objects', 'ab', 'd'.repeat(38)))).toBe(true);

    // The snapshots folder itself a link.
    const linked = join(data, 'snapshots-real');
    rmSync(join(snapshotsRoot, store!));
    rmSync(snapshotsRoot, { recursive: true });
    mkdirSync(join(linked, 'tmp'), { recursive: true });
    writeFileSync(join(linked, 'tmp', 'old'), 'x');
    utimesSync(join(linked, 'tmp', 'old'), new Date(Date.now() - 2 * DAY), new Date(Date.now() - 2 * DAY));
    symlinkSync(linked, snapshotsRoot, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await port.pruneSnapshots([{ folder: repo, keep: [] }], { olderThanMs: DAY })).toEqual({ objects: 0, stores: 0, temporary: 0, refused: 1 });
    expect(existsSync(join(linked, 'tmp', 'old'))).toBe(true);
  });
});

describe('vcs-git retention safety (27.6 review)', () => {
  const LINK = process.platform === 'win32' ? 'junction' : 'dir';

  it('refuses a copy with hidden index entries, partly staged changes, or anything named .git below its top', async () => {
    const flagged = await setup();
    git(flagged.path, 'update-index', '--assume-unchanged', 'a.txt');
    writeFileSync(join(flagged.path, 'a.txt'), 'hidden edit\n');
    await expect(flagged.port.saveForPutAway(flagged.repo, flagged.path, BRANCH)).rejects.toMatchObject({ details: { reason: 'index_flags' } });

    const skipped = await setup();
    git(skipped.path, 'update-index', '--skip-worktree', 'a.txt');
    await expect(skipped.port.saveForPutAway(skipped.repo, skipped.path, BRANCH)).rejects.toMatchObject({ details: { reason: 'index_flags' } });

    const partly = await setup();
    writeFileSync(join(partly.path, 'a.txt'), 'staged\n');
    git(partly.path, 'add', 'a.txt');
    writeFileSync(join(partly.path, 'a.txt'), 'staged then edited\n');
    await expect(partly.port.saveForPutAway(partly.repo, partly.path, BRANCH)).rejects.toMatchObject({ details: { reason: 'partly_staged' } });

    for (const make of [
      (path: string) => (mkdirSync(join(path, 'sub')), writeFileSync(join(path, 'sub', '.git'), 'gitdir: elsewhere\n')),
      (path: string) => mkdirSync(join(path, 'd', '.git'), { recursive: true }),
      (path: string) => (mkdirSync(join(path, 'X', '.GIT'), { recursive: true }), writeFileSync(join(path, 'X', '.GIT', 'y'), 'y\n')),
    ]) {
      const nested = await setup();
      make(nested.path);
      await expect(nested.port.saveForPutAway(nested.repo, nested.path, BRANCH)).rejects.toMatchObject({ details: { reason: 'nested_git' } });
      expect(existsSync(nested.path)).toBe(true);
    }
  });

  it('never saves or restores through a link at the copy\'s path: the user\'s worktree elsewhere is untouched', async () => {
    const { repo, data, port, path, head } = await setup();
    // The user's own worktree on the chat branch, elsewhere, and a link to it where the copy goes.
    const saved = await port.saveForPutAway(repo, path, BRANCH);
    rmSync(path, { recursive: true });
    git(repo, 'worktree', 'prune');
    const elsewhere = join(temp('ogden-agents-ret-user-'), 'mine');
    git(repo, 'worktree', 'add', '-q', elsewhere, BRANCH);
    writeFileSync(join(elsewhere, 'a.txt'), 'my own edit\n');
    symlinkSync(elsewhere, path, LINK);
    await expect(port.saveForPutAway(repo, path, BRANCH)).rejects.toThrow(VcsError);
    expect(await port.restore(repo, { path, branch: BRANCH, head, snapshotTree: saved.snapshotTree })).toBe('path_taken');
    expect(readFileSync(join(elsewhere, 'a.txt'), 'utf8')).toBe('my own edit\n');
    void data;
  });

  it('repairs in place without overwriting a newer edit, and restores with an extra untracked file present', async () => {
    const { repo, port, path } = await setup();
    writeFileSync(join(path, 'a.txt'), 'saved\n');
    writeFileSync(join(path, 'new.txt'), 'new\n');
    const saved = await port.saveForPutAway(repo, path, BRANCH);
    rmSync(join(path, 'new.txt'));
    writeFileSync(join(path, 'a.txt'), 'newer edit\n');
    writeFileSync(join(path, 'extra.txt'), 'extra\n');
    expect(await port.restore(repo, { path, branch: BRANCH, head: saved.head, snapshotTree: saved.snapshotTree })).toBe('restored');
    expect(contents(path)).toMatchObject({ 'a.txt': 'newer edit\n', 'new.txt': 'new\n', 'extra.txt': 'extra\n' });
  });

  it("finds git's record of a copy whose folder went through a linked data folder", async () => {
    const realData = temp('ogden-agents-ret-realdata-');
    const linkParent = temp('ogden-agents-ret-linkdata-');
    const linkedData = join(linkParent, 'data');
    symlinkSync(realData, linkedData, LINK);
    const repo = temp('ogden-agents-ret-repo-');
    git(repo, 'init', '-q', '--initial-branch=main');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
    const emptyConfig = join(realData, 'empty-gitconfig');
    writeFileSync(emptyConfig, '');
    const chats = join(linkedData, 'cw');
    mkdirSync(chats);
    const env = () => ({ PATH: process.env.PATH ?? '', HOME: realData, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });
    const hooksDir = join(realData, 'tools', 'git-hooks-none');
    const vcs = createGitVcs({ hooksDir, worktreesRoot: join(linkedData, 'w'), chatWorktreesRoot: chats, env });
    const port = createGitChatWorktree({ hooksDir, env, snapshotsRoot: join(linkedData, 'snapshots'), chatWorktreesRoot: chats });
    const path = join(chats, 'aaaaaaaa');
    await vcs.addWorktree(repo, { path, branch: BRANCH, base: git(repo, 'rev-parse', 'HEAD').trim() });
    writeFileSync(join(path, 'new.txt'), 'new\n');
    const saved = await port.saveForPutAway(repo, path, BRANCH);
    rmSync(path, { recursive: true });
    expect(await port.restore(repo, { path, branch: BRANCH, head: saved.head, snapshotTree: saved.snapshotTree })).toBe('restored');
    expect(contents(path)).toMatchObject({ 'new.txt': 'new\n' });
  });

  it('freshens objects the store already holds when a copy is saved again', async () => {
    const { repo, port, path, snapshotsRoot } = await setup();
    writeFileSync(join(path, 'a.txt'), 'two\n');
    const first = await port.saveForPutAway(repo, path, BRANCH);
    const [store] = readdirSync(snapshotsRoot).filter((name) => /^[0-9a-f]{16}$/.test(name));
    const object = join(snapshotsRoot, store!, 'objects', first.snapshotTree!.slice(0, 2), first.snapshotTree!.slice(2));
    const old = new Date(Date.now() - 2 * DAY);
    utimesSync(object, old, old);
    expect((await port.saveForPutAway(repo, path, BRANCH)).snapshotTree).toBe(first.snapshotTree);
    expect(statSync(object).mtimeMs).toBeGreaterThan(Date.now() - DAY);
  });

  it('prunes a store shared by two projects of one repo with their keep lists joined, and keeps it all when either is busy', async () => {
    const { repo, port, path, snapshotsRoot } = await setup();
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(path, 'a.txt'), 'kept by the repo\n');
    const one = await port.saveForPutAway(repo, path, BRANCH);
    writeFileSync(join(path, 'a.txt'), 'kept by the sub project\n');
    const two = await port.saveForPutAway(repo, path, BRANCH);
    const [store] = readdirSync(snapshotsRoot).filter((name) => /^[0-9a-f]{16}$/.test(name));
    const has = (tree: string) => existsSync(join(snapshotsRoot, store!, 'objects', tree.slice(0, 2), tree.slice(2)));
    const old = new Date(Date.now() - 2 * DAY);
    for (const file of filesUnder(join(snapshotsRoot, store!))) utimesSync(join(snapshotsRoot, store!, file), old, old);
    await port.pruneSnapshots([{ folder: repo, keep: [] }, { folder: join(repo, 'sub'), keep: null }], { olderThanMs: DAY });
    expect(has(one.snapshotTree!) && has(two.snapshotTree!)).toBe(true);
    await port.pruneSnapshots([{ folder: repo, keep: [one.snapshotTree!] }, { folder: join(repo, 'sub'), keep: [two.snapshotTree!] }], { olderThanMs: DAY });
    expect(has(one.snapshotTree!) && has(two.snapshotTree!)).toBe(true);
  });

  it('removes an orphan store beside a readable project in no repo, but never one holding a protected tree; an in-flight temp index stays', async () => {
    const { repo, port, snapshotsRoot } = await setup();
    const plain = temp('ogden-agents-ret-plain-');
    const orphan = (name: string, id: string) => {
      mkdirSync(join(snapshotsRoot, name, 'objects', id.slice(0, 2)), { recursive: true });
      const file = join(snapshotsRoot, name, 'objects', id.slice(0, 2), id.slice(2));
      writeFileSync(file, 'x');
      const old = new Date(Date.now() - 2 * DAY);
      utimesSync(file, old, old);
    };
    const kept = 'e'.repeat(40);
    orphan('1111111111111111', 'd'.repeat(40));
    orphan('2222222222222222', kept);
    mkdirSync(join(snapshotsRoot, 'tmp'), { recursive: true });
    // A temporary index copied with the real index's old time, mid-snapshot.
    const inFlight = join(snapshotsRoot, 'tmp', 'live.index');
    writeFileSync(inFlight, 'x');
    utimesSync(inFlight, new Date(Date.now() - 9 * DAY), new Date(Date.now() - 9 * DAY));
    const pruned = await port.pruneSnapshots([{ folder: repo, keep: [] }, { folder: plain, keep: [] }], { olderThanMs: DAY, protect: [kept] });
    expect(pruned).toMatchObject({ stores: 1, temporary: 0, refused: 0 });
    expect(existsSync(join(snapshotsRoot, '1111111111111111'))).toBe(false);
    expect(existsSync(join(snapshotsRoot, '2222222222222222'))).toBe(true);
    expect(existsSync(inFlight)).toBe(true);
  });
});
