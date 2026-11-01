/**
 * `vcs-git` moving a chat's uncommitted changes between the project folder
 * and its own worktree (epic 27, 27.4) against temp repos (real git, no
 * network): a round trip of an edit, an untracked file, staged changes and
 * a binary file, arriving unstaged, a CRLF file untouched byte for byte;
 * an overlap and a moved base answer `conflict` and move nothing; a source
 * changed mid-move leaves the target holding the changes and counts what
 * the source kept as `leftBehind`, never throwing; no filter or hook
 * runs; only the two folders are written (the repo's refs and another
 * worktree untouched); the snapshots are in Ogden's store, never the
 * repo's objects; and `addWorktree` on a kept branch.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VcsError, type VcsFolder } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitVcs, createGitWorkingTree } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** Plain git for the test's own setup: no hook, a local identity. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const BRANCH = `ogden/chat/${SES}`;
const BINARY = Buffer.from([0, 1, 2, 3, 255, 254, 0, 10, 13, 0]);
const CRLF = 'one\r\ntwo\r\n';

/** `git status --porcelain` of a folder, sorted lines. */
const status = (cwd: string): string[] =>
  git(cwd, 'status', '--porcelain=v1', '--untracked-files=all')
    .split('\n')
    .filter((line) => line !== '')
    .sort();

/** A repo on `main` with text, binary and CRLF files, a data folder with `<data>/cw`, and both adapters over it, with an optional `git` program. */
function setup(gitProgram?: string, timeoutMs?: number) {
  const repo = temp('ogden-agents-mv-repo-');
  const data = temp('ogden-agents-mv-data-');
  const markers = temp('ogden-agents-mv-markers-');
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  writeFileSync(join(repo, 'bin.dat'), BINARY);
  writeFileSync(join(repo, 'crlf.txt'), CRLF);
  writeFileSync(join(repo, 'gone.txt'), 'deleted soon\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  for (const name of ['pre-commit', 'post-checkout', 'post-index-change', 'reference-transaction', 'pre-applypatch', 'post-applypatch']) {
    writeFileSync(join(repo, '.git', 'hooks', name), `#!/bin/sh\ntouch "${join(markers, name)}"\n`);
    chmodSync(join(repo, '.git', 'hooks', name), 0o755);
  }
  const chats = join(data, 'cw');
  mkdirSync(chats);
  const env = () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });
  const hooksDir = join(data, 'tools', 'git-hooks-none');
  const vcs = createGitVcs({ hooksDir, chatWorktreesRoot: chats, worktreesRoot: join(data, 'w'), env });
  const tree = createGitWorkingTree({ hooksDir, env, snapshotsRoot: join(data, 'snapshots'), ...(gitProgram === undefined ? {} : { git: gitProgram }), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  const path = join(chats, 'aaaaaaaa');
  const project: VcsFolder = { path: repo };
  const copy: VcsFolder = { path, worktree: { repoPath: repo, branch: BRANCH } };
  const makeCopy = () => vcs.addWorktree(repo, { path, branch: BRANCH, base: head });
  return { repo, data, markers, vcs, tree, head, path, project, copy, makeCopy };
}

/** The project's uncommitted changes: an edit, an untracked file, a staged new file, a staged edit, a binary edit and a deletion. */
function dirty(repo: string) {
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 10;\nexport const b = 2;\n');
  writeFileSync(join(repo, 'untracked.txt'), 'new\n');
  writeFileSync(join(repo, 'staged.txt'), 'staged\n');
  writeFileSync(join(repo, 'README.md'), '# Repo\n\nMore.\n');
  git(repo, 'add', 'staged.txt', 'README.md');
  writeFileSync(join(repo, 'bin.dat'), Buffer.concat([BINARY, BINARY]));
  rmSync(join(repo, 'gone.txt'));
}

/** What `dirty` left, as read in `folder`. */
function expectDirty(folder: string) {
  expect(readFileSync(join(folder, 'src', 'a.ts'), 'utf8')).toBe('export const a = 10;\nexport const b = 2;\n');
  expect(readFileSync(join(folder, 'untracked.txt'), 'utf8')).toBe('new\n');
  expect(readFileSync(join(folder, 'staged.txt'), 'utf8')).toBe('staged\n');
  expect(readFileSync(join(folder, 'README.md'), 'utf8')).toBe('# Repo\n\nMore.\n');
  expect(readFileSync(join(folder, 'bin.dat'))).toEqual(Buffer.concat([BINARY, BINARY]));
  expect(existsSync(join(folder, 'gone.txt'))).toBe(false);
  expect(readFileSync(join(folder, 'crlf.txt'), 'latin1')).toBe(CRLF);
}

/** The changes as they arrive: unstaged, the new files untracked. */
const ARRIVED = [' D gone.txt', ' M README.md', ' M bin.dat', ' M src/a.ts', '?? staged.txt', '?? untracked.txt'];

describe('vcs-git moves a chat\'s changes between the project folder and its worktree (27.4)', () => {
  it('round trip: every change moves to the copy unstaged, the project matches HEAD, and back again', async () => {
    const kit = setup();
    await kit.makeCopy();
    dirty(kit.repo);
    const refs = git(kit.repo, 'for-each-ref');

    const there = await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy });

    expect(there).toMatchObject({ result: 'moved', files: 6 });
    expectDirty(kit.path);
    expect(status(kit.repo)).toEqual([]);
    expect(readFileSync(join(kit.repo, 'crlf.txt'), 'latin1')).toBe(CRLF);
    expect(readFileSync(join(kit.repo, 'bin.dat'))).toEqual(BINARY);
    expect(status(kit.path)).toEqual(ARRIVED);
    // Snapshots are tree ids in Ogden's store: the project's (new blobs) is never in the repo's objects; the clean copy's is its HEAD tree.
    expect(there.snapshots.to).toBe(git(kit.repo, 'rev-parse', 'HEAD^{tree}').trim());
    expect(() => git(kit.repo, 'cat-file', '-t', there.snapshots.from)).toThrow();

    const back = await kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project });

    expect(back).toMatchObject({ result: 'moved', files: 6 });
    expectDirty(kit.repo);
    expect(status(kit.path)).toEqual([]);
    expect(status(kit.repo)).toEqual(ARRIVED);
    expect(git(kit.repo, 'for-each-ref')).toBe(refs);
    expect(existsSync(join(kit.markers, 'post-index-change'))).toBe(false);
    expect(existsSync(join(kit.markers, 'reference-transaction'))).toBe(false);
  });

  it('moves nothing when there is nothing to move', async () => {
    const kit = setup();
    await kit.makeCopy();
    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 0 });
    expect(status(kit.path)).toEqual([]);
  });

  it('overlap: the project has its own change to a file the copy changed (conflict, 1 file), nothing moved', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.path, 'src', 'a.ts'), 'copy\n');
    writeFileSync(join(kit.path, 'other.txt'), 'copy only\n');
    writeFileSync(join(kit.repo, 'src', 'a.ts'), 'project\n');

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project })).toMatchObject({ result: 'conflict', files: 1 });

    expect(readFileSync(join(kit.path, 'src', 'a.ts'), 'utf8')).toBe('copy\n');
    expect(readFileSync(join(kit.repo, 'src', 'a.ts'), 'utf8')).toBe('project\n');
    expect(existsSync(join(kit.repo, 'other.txt'))).toBe(false);
    expect(status(kit.path)).toEqual([' M src/a.ts', '?? other.txt']);
  });

  it('base moved: the copy\'s branch changed the same file since (conflict), nothing moved', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.path, 'README.md'), '# Copy\n');
    git(kit.path, 'commit', '-q', '--no-verify', '-am', 'copy');
    writeFileSync(join(kit.repo, 'README.md'), '# Repo\n\nProject.\n');

    const moved = await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy });

    expect(moved).toMatchObject({ result: 'conflict', files: 1 });
    expect(readFileSync(join(kit.repo, 'README.md'), 'utf8')).toBe('# Repo\n\nProject.\n');
    expect(readFileSync(join(kit.path, 'README.md'), 'utf8')).toBe('# Copy\n');
    expect(status(kit.path)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('a source changed mid-move: the target keeps the changes, the source keeps what it has, counted left behind', async () => {
    const data = temp('ogden-agents-mv-wrapper-');
    const once = join(data, 'once');
    const wrapper = join(data, 'git-wrapper.sh');
    const kit0 = { file: '' };
    const kit = setup(wrapper);
    kit0.file = join(kit.repo, 'src', 'a.ts');
    // Just before the changes are taken from the source, something writes it.
    writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in *" apply "*" -R --check"*) if [ ! -e "${once}" ] && [ "$PWD" = "${kit.repo}" ]; then touch "${once}"; echo late >> "${kit0.file}"; fi;; esac\nexec git "$@"\n`);
    chmodSync(wrapper, 0o755);
    await kit.makeCopy();
    writeFileSync(kit0.file, 'export const a = 10;\n');

    const moved = await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy });

    // Once the target applied it is never undone: nothing is lost, and what stayed is counted.
    expect(moved).toMatchObject({ result: 'moved', files: 1, leftBehind: 1 });
    expect(existsSync(once)).toBe(true);
    expect(readFileSync(kit0.file, 'utf8')).toBe('export const a = 10;\nlate\n');
    expect(readFileSync(join(kit.path, 'src', 'a.ts'), 'utf8')).toBe('export const a = 10;\n');
  });

  it.skipIf(process.platform === 'win32')('runs no filter program and no hook, either way', async () => {
    const kit = setup();
    const marker = join(kit.markers, 'filter-ran');
    const filter = join(kit.data, 'filter.sh');
    writeFileSync(filter, `#!/bin/sh\ntouch "${marker}"\ncat\n`);
    chmodSync(filter, 0o755);
    writeFileSync(join(kit.repo, '.gitattributes'), '*.txt filter=evil\n');
    git(kit.repo, 'add', '.gitattributes');
    git(kit.repo, 'commit', '-q', '--no-verify', '-m', 'attributes');
    await kit.vcs.addWorktree(kit.repo, { path: kit.path, branch: BRANCH, base: git(kit.repo, 'rev-parse', 'HEAD').trim() });
    for (const key of ['clean', 'smudge', 'process']) git(kit.repo, 'config', `filter.evil.${key}`, filter);
    git(kit.repo, 'config', 'filter.evil.required', 'true');
    rmSync(marker, { force: true });
    writeFileSync(join(kit.repo, 'note.txt'), 'hello\n');

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 1 });
    expect(await kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project })).toMatchObject({ result: 'moved', files: 1 });

    expect(readFileSync(join(kit.repo, 'note.txt'), 'utf8')).toBe('hello\n');
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(kit.markers)).toEqual([]);
  });

  it('writes only the two folders: another worktree of the repo and the refs are untouched', async () => {
    const kit = setup();
    await kit.makeCopy();
    const other = join(temp('ogden-agents-mv-other-'), 'other');
    git(kit.repo, 'worktree', 'add', '-q', '-b', 'mine', other, 'HEAD');
    writeFileSync(join(other, 'src', 'a.ts'), 'mine\n');
    dirty(kit.repo);
    const refs = git(kit.repo, 'for-each-ref');

    await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy });
    await kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project });

    expect(status(other)).toEqual([' M src/a.ts']);
    expect(readFileSync(join(other, 'src', 'a.ts'), 'utf8')).toBe('mine\n');
    expect(git(kit.repo, 'for-each-ref')).toBe(refs);
  });

  it.skipIf(process.platform === 'win32')('refuses a change through a link, moving nothing', async () => {
    const kit = setup();
    await kit.makeCopy();
    symlinkSync('/etc/hosts', join(kit.repo, 'hosts-link'));
    await expect(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).rejects.toBeInstanceOf(VcsError);
    expect(status(kit.path)).toEqual([]);
    expect(status(kit.repo)).toEqual(['?? hosts-link']);
  });

  it('refuses a tampered copy (its branch not the one named) before anything moves', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'x.txt'), 'x\n');
    await expect(kit.tree.moveChanges(kit.repo, { from: kit.project, to: { path: kit.path, worktree: { repoPath: kit.repo, branch: 'ogden/chat/ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4' } } })).rejects.toBeInstanceOf(VcsError);
    expect(status(kit.repo)).toEqual(['?? x.txt']);
  });
});

/** A file's permission bits. */
const modeOf = (file: string): number => lstatSync(file).mode & 0o777;

/** The snapshot ids a thrown hand-off carries in its details. */
const thrownSnapshots = async (promise: Promise<unknown>): Promise<VcsError> => {
  const error = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(VcsError);
  expect((error as VcsError).details.snapshots).toEqual({ from: expect.stringMatching(/^[0-9a-f]{40}$/), to: expect.stringMatching(/^[0-9a-f]{40}$/) });
  return error as VcsError;
};

describe.skipIf(process.platform === 'win32')('vcs-git hand-off loses nothing when a write fails (27.4 review pass 1)', () => {
  it('keeps each moved file private: a 0600 tracked and a 0600 untracked file stay 0600 in both folders, both ways', async () => {
    const kit = setup();
    writeFileSync(join(kit.repo, 'secret.env'), 'A=1\n');
    git(kit.repo, 'add', 'secret.env');
    git(kit.repo, 'commit', '-q', '--no-verify', '-m', 'secret');
    await kit.vcs.addWorktree(kit.repo, { path: kit.path, branch: BRANCH, base: git(kit.repo, 'rev-parse', 'HEAD').trim() });
    chmodSync(join(kit.repo, 'secret.env'), 0o600);
    writeFileSync(join(kit.repo, 'secret.env'), 'A=2\n');
    writeFileSync(join(kit.repo, 'new.key'), 'key\n', { mode: 0o600 });
    chmodSync(join(kit.repo, 'new.key'), 0o600);

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 2, leftBehind: 0 });
    expect(modeOf(join(kit.path, 'secret.env'))).toBe(0o600);
    expect(modeOf(join(kit.path, 'new.key'))).toBe(0o600);
    expect(modeOf(join(kit.repo, 'secret.env'))).toBe(0o600);

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project })).toMatchObject({ result: 'moved', files: 2, leftBehind: 0 });
    expect(readFileSync(join(kit.repo, 'secret.env'), 'utf8')).toBe('A=2\n');
    expect(modeOf(join(kit.repo, 'secret.env'))).toBe(0o600);
    expect(modeOf(join(kit.repo, 'new.key'))).toBe(0o600);
  });

  it('a partly staged file keeps its staged version in the project; its working version moves', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'README.md'), '# Staged\n');
    git(kit.repo, 'add', 'README.md');
    writeFileSync(join(kit.repo, 'README.md'), '# Working\n');

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 1 });

    expect(readFileSync(join(kit.path, 'README.md'), 'utf8')).toBe('# Working\n');
    expect(git(kit.repo, 'show', ':README.md')).toBe('# Staged\n');
  });

  it('a source folder it cannot write: the copy holds every change, the source keeps what it could not give up, counted left behind, with the snapshots', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'src', 'a.ts'), 'edited\n');
    git(kit.repo, 'add', 'src/a.ts');
    writeFileSync(join(kit.repo, 'src', 'new.ts'), 'new\n');
    chmodSync(join(kit.repo, 'src'), 0o555);
    try {
      const moved = await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy });
      // What stayed keeps its staging.
      expect(git(kit.repo, 'diff', '--cached', '--name-only').trim()).toBe('src/a.ts');
      expect(moved.result).toBe('moved');
      expect(moved.leftBehind).toBeGreaterThan(0);
      expect(moved.snapshots.from).toMatch(/^[0-9a-f]{40}$/);
      expect(readFileSync(join(kit.path, 'src', 'a.ts'), 'utf8')).toBe('edited\n');
      expect(readFileSync(join(kit.path, 'src', 'new.ts'), 'utf8')).toBe('new\n');
      // Nothing lost: what couldn't be taken is still there.
      expect(readFileSync(join(kit.repo, 'src', 'new.ts'), 'utf8')).toBe('new\n');
    } finally {
      chmodSync(join(kit.repo, 'src'), 0o755);
    }
  });

  it('a forward apply that fails partway is not put back from the snapshot: thrown with targetClean false and the snapshots, the source untouched', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'README.md'), '# Edited\n');
    writeFileSync(join(kit.repo, 'src', 'a.ts'), 'edited\n');
    chmodSync(join(kit.path, 'src'), 0o555);
    try {
      const error = await thrownSnapshots(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy }));
      // `-R` can't take back a partial write: the copy may be half-written, so it is never reported clean.
      expect(error.details.targetClean).toBe(false);
    } finally {
      chmodSync(join(kit.path, 'src'), 0o755);
    }
    expect(readFileSync(join(kit.repo, 'README.md'), 'utf8')).toBe('# Edited\n');
    expect(readFileSync(join(kit.repo, 'src', 'a.ts'), 'utf8')).toBe('edited\n');
  });

  it('a git timeout on the forward apply loses nothing: thrown with the snapshots, the source untouched', async () => {
    const data = temp('ogden-agents-mv-slow-');
    const wrapper = join(data, 'git-wrapper.sh');
    const kit = setup(wrapper, 1500);
    writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in *" apply "*) case "$*" in *"--check"*|*" -R"*) ;; *) if [ "$PWD" = "${kit.path}" ]; then sleep 4; fi;; esac;; esac\nexec git "$@"\n`);
    chmodSync(wrapper, 0o755);
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'src', 'a.ts'), 'edited\n');
    writeFileSync(join(kit.repo, 'untracked.txt'), 'new\n');

    const error = await thrownSnapshots(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy }));

    // Nothing to reverse: not reported clean, so the copy is never removed on a guess.
    expect(error.details.targetClean).toBe(false);
    expect(readFileSync(join(kit.repo, 'src', 'a.ts'), 'utf8')).toBe('edited\n');
    expect(readFileSync(join(kit.repo, 'untracked.txt'), 'utf8')).toBe('new\n');
  }, 20_000);

  it('a git timeout while the source is cleaned loses nothing: the copy holds the changes, the source keeps them, counted left behind', async () => {
    const data = temp('ogden-agents-mv-slow-');
    const wrapper = join(data, 'git-wrapper.sh');
    const kit = setup(wrapper, 1500);
    writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in *" apply "*" -R"*) case "$*" in *"--check"*) ;; *) if [ "$PWD" = "${kit.repo}" ]; then sleep 4; fi;; esac;; esac\nexec git "$@"\n`);
    chmodSync(wrapper, 0o755);
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'src', 'a.ts'), 'edited\n');
    writeFileSync(join(kit.repo, 'untracked.txt'), 'new\n');

    const moved = await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy });

    expect(moved).toMatchObject({ result: 'moved', files: 2, leftBehind: 2 });
    expect(readFileSync(join(kit.path, 'src', 'a.ts'), 'utf8')).toBe('edited\n');
    expect(readFileSync(join(kit.path, 'untracked.txt'), 'utf8')).toBe('new\n');
    expect(readFileSync(join(kit.repo, 'src', 'a.ts'), 'utf8')).toBe('edited\n');
    expect(readFileSync(join(kit.repo, 'untracked.txt'), 'utf8')).toBe('new\n');
  }, 20_000);

  it('refuses a copy that is a link to a worktree, moving nothing', async () => {
    const kit = setup();
    await kit.makeCopy();
    const link = join(kit.data, 'cw', 'linklink');
    symlinkSync(kit.path, link);
    writeFileSync(join(kit.repo, 'x.txt'), 'x\n');
    await expect(kit.tree.moveChanges(kit.repo, { from: kit.project, to: { path: link, worktree: { repoPath: kit.repo, branch: BRANCH } } })).rejects.toBeInstanceOf(VcsError);
    expect(status(kit.repo)).toEqual(['?? x.txt']);
    expect(status(kit.path)).toEqual([]);
  });

  it('a forward apply that fails because something wrote the copy meanwhile: that write survives, targetClean false', async () => {
    const data = temp('ogden-agents-mv-race-');
    const wrapper = join(data, 'git-wrapper.sh');
    const kit = setup(wrapper);
    writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in *" apply "*) case "$*" in *"--check"*|*" -R"*) ;; *) if [ "$PWD" = "${kit.path}" ]; then echo theirs > "${join(kit.path, 'README.md')}"; fi;; esac;; esac\nexec git "$@"\n`);
    chmodSync(wrapper, 0o755);
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'README.md'), '# Edited\n');

    const error = await thrownSnapshots(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy }));

    expect(error.details.targetClean).toBe(false);
    expect(readFileSync(join(kit.path, 'README.md'), 'utf8')).toBe('theirs\n');
    expect(readFileSync(join(kit.repo, 'README.md'), 'utf8')).toBe('# Edited\n');
  });

  it('refuses text that is not UTF-8 before writing anything, with the snapshots', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const error = await thrownSnapshots(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy }));
    expect(error.message).toBe("A changed file isn't UTF-8 text, so nothing moved.");
    expect(status(kit.path)).toEqual([]);
    expect(readFileSync(join(kit.repo, 'latin1.txt'))).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  });

  it('with * text=auto, LF files move byte for byte', async () => {
    const kit = setup();
    writeFileSync(join(kit.repo, '.gitattributes'), '* text=auto\n');
    git(kit.repo, 'add', '.gitattributes');
    git(kit.repo, 'commit', '-q', '--no-verify', '-m', 'attributes');
    await kit.vcs.addWorktree(kit.repo, { path: kit.path, branch: BRANCH, base: git(kit.repo, 'rev-parse', 'HEAD').trim() });
    writeFileSync(join(kit.repo, 'README.md'), '# Edited\n');
    writeFileSync(join(kit.repo, 'lf.txt'), 'one\ntwo\n');

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 2, leftBehind: 0 });
    expect(readFileSync(join(kit.path, 'README.md'), 'latin1')).toBe('# Edited\n');
    expect(readFileSync(join(kit.path, 'lf.txt'), 'latin1')).toBe('one\ntwo\n');
    expect(await kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project })).toMatchObject({ result: 'moved', files: 2, leftBehind: 0 });
    expect(readFileSync(join(kit.repo, 'lf.txt'), 'latin1')).toBe('one\ntwo\n');
  });

  it('refuses bytes git would change (a new CRLF file under * text=auto, mixed endings with core.autocrlf=true); CRLF already in the index moves as it is', async () => {
    const kit = setup();
    await kit.makeCopy();
    // CRLF committed before the attribute: git keeps the index's CRLF, so the bytes arrive as they are.
    writeFileSync(join(kit.repo, '.gitattributes'), '* text=auto\n');
    writeFileSync(join(kit.repo, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n');
    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', leftBehind: 0 });
    expect(readFileSync(join(kit.path, 'crlf.txt'), 'latin1')).toBe('one\r\ntwo\r\nthree\r\n');
    // A new CRLF file under text=auto would be normalized: refused, nothing moved.
    writeFileSync(join(kit.path, 'new.txt'), 'a\r\nb\r\n');
    const error = await thrownSnapshots(kit.tree.moveChanges(kit.repo, { from: kit.copy, to: kit.project }));
    expect(error.message).toMatch(/bytes/);
    expect(existsSync(join(kit.repo, 'new.txt'))).toBe(false);
    expect(existsSync(join(kit.repo, '.gitattributes'))).toBe(false);
    expect(readFileSync(join(kit.path, 'new.txt'), 'latin1')).toBe('a\r\nb\r\n');

    const other = setup();
    await other.makeCopy();
    git(other.repo, 'config', 'core.autocrlf', 'true');
    writeFileSync(join(other.repo, 'mixed.txt'), 'one\r\ntwo\n');
    await expect(other.tree.moveChanges(other.repo, { from: other.project, to: other.copy })).rejects.toBeInstanceOf(VcsError);
    expect(readFileSync(join(other.repo, 'mixed.txt'), 'utf8')).toBe('one\r\ntwo\n');
    expect(existsSync(join(other.path, 'mixed.txt'))).toBe(false);
  });

  it('with core.fileMode=false a 0755 script arrives 0755', async () => {
    const kit = setup();
    git(kit.repo, 'config', 'core.fileMode', 'false');
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'run.sh'), '#!/bin/sh\n');
    chmodSync(join(kit.repo, 'run.sh'), 0o755);
    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', leftBehind: 0 });
    expect(modeOf(join(kit.path, 'run.sh'))).toBe(0o755);
  });

  it('refuses a merge in progress (with its unmerged files) and a revert marker in the copy, before any snapshot', async () => {
    const kit = setup();
    await kit.makeCopy();
    git(kit.repo, 'checkout', '-q', '-b', 'side');
    writeFileSync(join(kit.repo, 'README.md'), '# Side\n');
    git(kit.repo, 'commit', '-q', '--no-verify', '-am', 'side');
    git(kit.repo, 'checkout', '-q', 'main');
    writeFileSync(join(kit.repo, 'README.md'), '# Main\n');
    git(kit.repo, 'commit', '-q', '--no-verify', '-am', 'main');
    expect(() => git(kit.repo, 'merge', '-q', '--no-edit', 'side')).toThrow();
    await expect(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).rejects.toThrow(/in progress/);
    expect(existsSync(join(kit.data, 'snapshots'))).toBe(false);

    const other = setup();
    await other.makeCopy();
    writeFileSync(join(other.repo, 'x.txt'), 'x\n');
    writeFileSync(git(other.path, 'rev-parse', '--path-format=absolute', '--git-path', 'REVERT_HEAD').trim(), `${other.head}\n`);
    await expect(other.tree.moveChanges(other.repo, { from: other.project, to: other.copy })).rejects.toBeInstanceOf(VcsError);
    expect(status(other.repo)).toEqual(['?? x.txt']);
  });

  it('refuses entries marked assume-unchanged or skip-worktree', async () => {
    const kit = setup();
    await kit.makeCopy();
    git(kit.repo, 'update-index', '--assume-unchanged', 'README.md');
    writeFileSync(join(kit.repo, 'README.md'), '# Hidden\n');
    await expect(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).rejects.toThrow(/skip or assume unchanged/);
    git(kit.repo, 'update-index', '--no-assume-unchanged', 'README.md');
    git(kit.repo, 'update-index', '--skip-worktree', 'src/a.ts');
    await expect(kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).rejects.toThrow(/skip or assume unchanged/);
    expect(readFileSync(join(kit.repo, 'README.md'), 'utf8')).toBe('# Hidden\n');
  });

  it('an intent-to-add file that moved leaves no entry behind in the project', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.repo, 'new.txt'), 'new\n');
    git(kit.repo, 'add', '-N', 'new.txt');
    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 1, leftBehind: 0 });
    expect(status(kit.repo)).toEqual([]);
    expect(readFileSync(join(kit.path, 'new.txt'), 'utf8')).toBe('new\n');
  });

  it('unstages thousands of long staged paths (no command line too long), nothing left staged', async () => {
    const kit = setup();
    await kit.makeCopy();
    const long = 'n'.repeat(150);
    for (let dir = 0; dir < 40; dir++) {
      mkdirSync(join(kit.repo, `${long}-${dir}`));
      for (let file = 0; file < 100; file++) writeFileSync(join(kit.repo, `${long}-${dir}`, `${long}-${file}.txt`), `${dir} ${file}\n`);
    }
    git(kit.repo, 'add', '-A');

    expect(await kit.tree.moveChanges(kit.repo, { from: kit.project, to: kit.copy })).toMatchObject({ result: 'moved', files: 4000, leftBehind: 0 });

    expect(git(kit.repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(status(kit.repo)).toEqual([]);
    expect(readFileSync(join(kit.path, `${long}-39`, `${long}-99.txt`), 'utf8')).toBe('39 99\n');
  }, 60_000);
});

describe('vcs-git addWorktree on a kept branch (27.4)', () => {
  it('checks the existing branch out as it is, its commits kept', async () => {
    const kit = setup();
    await kit.makeCopy();
    writeFileSync(join(kit.path, 'kept.txt'), 'kept\n');
    git(kit.path, 'add', 'kept.txt');
    git(kit.path, 'commit', '-q', '--no-verify', '-m', 'kept');
    const tip = git(kit.path, 'rev-parse', 'HEAD').trim();
    await kit.vcs.removeWorktree(kit.repo, kit.path);

    const again = join(kit.data, 'cw', 'bbbbbbbb');
    await kit.vcs.addWorktree(kit.repo, { path: again, branch: BRANCH, base: kit.head, existingBranch: true });

    expect(git(again, 'symbolic-ref', 'HEAD').trim()).toBe(`refs/heads/${BRANCH}`);
    expect(git(again, 'rev-parse', 'HEAD').trim()).toBe(tip);
    expect(readFileSync(join(again, 'kept.txt'), 'utf8')).toBe('kept\n');
    await expect(kit.vcs.addWorktree(kit.repo, { path: join(kit.data, 'cw', 'cccccccc'), branch: 'main', base: kit.head, existingBranch: true })).rejects.toBeInstanceOf(VcsError);
  });
});
