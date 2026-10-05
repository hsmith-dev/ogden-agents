/**
 * `vcs-git` story 5.5 against temp repos (real git, no network): the git
 * version check, worktrees in the data folder (two at once, a deep path for
 * Windows), diff stats as git counts them, a merge left uncommitted taking
 * an added file into its commit, removal that leaves no worktree, metadata
 * or branch and never touches anything but its own (a user's stale
 * worktree, a link's target, a folder outside the worktrees folder), and
 * Commit plan files committing exactly its paths.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VcsError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitVcs, gitVersionAtLeast, parseGitVersion } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

/** Plain git for the test's own setup: no hook, a local identity, long paths. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.longpaths=true', '-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** A repo on `main` with one commit and a data folder whose `w` is the worktrees folder (optionally deep). */
function setup({ deep = false }: { deep?: boolean } = {}) {
  const repo = temp('ogden-agents-wt-repo-');
  const top = temp('ogden-agents-wt-data-');
  // A data folder as deep as a long Windows user name and app-data path, past MAX_PATH once a nested repo file is added (spike 5.1).
  const data = deep ? join(top, ...Array.from({ length: 8 }, (_, index) => `ogden-agents-data-segment-${index}`)) : top;
  mkdirSync(data, { recursive: true });
  const emptyConfig = join(top, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  const nested = join(repo, 'packages', 'a-rather-long-package-name', 'src', 'components', 'deeply-nested-feature-folder');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'a-component-file-with-a-long-descriptive-name.tsx'), 'export const a = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  const root = join(data, 'w');
  mkdirSync(root);
  const vcs = createGitVcs({
    hooksDir: join(data, 'tools', 'git-hooks-none'),
    worktreesRoot: root,
    env: () => ({ PATH: process.env.PATH ?? '', HOME: top, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) }),
  });
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  return { repo, data, root, vcs, head, nested };
}

/** Commits `files` on the worktree's branch, as the agent would. */
function commitIn(worktree: string, files: Record<string, string>, message = 'work') {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(worktree, name, '..'), { recursive: true });
    writeFileSync(join(worktree, name), text);
  }
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '--no-verify', '-m', message);
}

const worktreeList = (repo: string) =>
  git(repo, 'worktree', 'list', '--porcelain')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '));

describe('vcs-git: git version (story 5.5)', () => {
  it('parses git --version answers and compares them with the minimum', () => {
    expect(parseGitVersion('git version 2.39.2')).toEqual([2, 39, 2]);
    expect(parseGitVersion('git version 2.45.1.windows.1\n')).toEqual([2, 45, 1]);
    expect(parseGitVersion('git version 2.54.0 (Apple Git-157)')).toEqual([2, 54, 0]);
    expect(parseGitVersion('git version 3.0')).toEqual([3, 0, 0]);
    expect(parseGitVersion('not git')).toBeUndefined();
    expect(gitVersionAtLeast([2, 39, 2], '2.39.2')).toBe(true);
    expect(gitVersionAtLeast([2, 39, 1], '2.39.2')).toBe(false);
    expect(gitVersionAtLeast([2, 30, 9], '2.39.2')).toBe(false);
    expect(gitVersionAtLeast([2, 40, 0], '2.39.2')).toBe(true);
    expect(gitVersionAtLeast([3, 0, 0], '2.39.2')).toBe(true);
  });

  it("reports this computer's git as usable, and a git that can't be run as missing", async () => {
    const { vcs } = setup();
    const check = await vcs.check();
    expect(check.ok).toBe(true);
    const missing = createGitVcs({ hooksDir: join(temp('ogden-agents-wt-hooks-'), 'none'), git: join(temp('ogden-agents-wt-nogit-'), 'no-such-git'), env: () => ({ PATH: '' }) });
    expect(await missing.check()).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('vcs-git: worktrees in the data folder (story 5.5)', () => {
  it('two worktrees for two tickets live outside the repo with no shared files, on a deep data path too', async () => {
    const { repo, root, vcs, head, nested } = setup({ deep: true });
    const one = join(root, 'aaaaaaaa');
    const two = join(root, 'bbbbbbbb');
    await vcs.addWorktree(repo, { path: one, branch: 'ogden/aaaaaaaa/1.1-one', base: head });
    await vcs.addWorktree(repo, { path: two, branch: 'ogden/bbbbbbbb/1.2-two', base: head });
    const deepFile = join(one, 'packages', 'a-rather-long-package-name', 'src', 'components', 'deeply-nested-feature-folder', 'a-component-file-with-a-long-descriptive-name.tsx');
    expect(deepFile.length).toBeGreaterThan(process.platform === 'win32' ? 260 : 0);
    expect(readFileSync(deepFile, 'utf8')).toBe('export const a = 1;\n');
    commitIn(one, { 'src/one.txt': 'one\n' });
    commitIn(two, { 'src/two.txt': 'two\n' });
    expect(existsSync(join(one, 'src', 'two.txt'))).toBe(false);
    expect(existsSync(join(two, 'src', 'one.txt'))).toBe(false);
    // The repo has no worktree folder in it, and its own files are untouched.
    expect(readdirSync(repo).sort()).toEqual(['.git', 'README.md', 'packages']);
    expect(existsSync(nested)).toBe(true);
    expect((await vcs.diff(repo, head, 'ogden/aaaaaaaa/1.1-one')).files).toEqual(['src/one.txt']);
    expect((await vcs.diff(repo, head, 'ogden/bbbbbbbb/1.2-two')).files).toEqual(['src/two.txt']);
    // Removal works at the deep path too, and leaves nothing.
    await vcs.removeWorktree(repo, one, { deleteBranch: 'ogden/aaaaaaaa/1.1-one' });
    await vcs.removeWorktree(repo, two, { deleteBranch: 'ogden/bbbbbbbb/1.2-two' });
    expect(existsSync(one) || existsSync(two)).toBe(false);
    expect(worktreeList(repo)).toHaveLength(1);
    expect(git(repo, 'branch', '--list', 'ogden/*').trim()).toBe('');
  });

  it('diff stats match git diff --numstat', async () => {
    const { repo, root, vcs, head } = setup();
    const path = join(root, 'cccccccc');
    await vcs.addWorktree(repo, { path, branch: 'ogden/cccccccc/1.1-stats', base: head });
    commitIn(path, { 'README.md': '# Repo\nmore\nlines\n', 'src/new.txt': 'a\nb\nc\nd\n', 'bin.dat': '\u0000\u0001binary' });
    const numstat = git(repo, 'diff', '--numstat', head, 'refs/heads/ogden/cccccccc/1.1-stats')
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split('\t'));
    const expected = {
      files: numstat.length,
      insertions: numstat.reduce((sum, [added]) => sum + (added === '-' ? 0 : Number(added)), 0),
      deletions: numstat.reduce((sum, [, deleted]) => sum + (deleted === '-' ? 0 : Number(deleted)), 0),
    };
    expect(await vcs.diffStats(repo, head, 'ogden/cccccccc/1.1-stats')).toEqual(expected);
  });

  it('a merge left uncommitted takes an added file (the done mark) into its merge commit', async () => {
    const { repo, root, vcs, head } = setup();
    const path = join(root, 'dddddddd');
    await vcs.addWorktree(repo, { path, branch: 'ogden/dddddddd/1.1-merge', base: head });
    commitIn(path, { 'src/built.txt': 'built\n' });
    const revision = git(repo, 'rev-parse', 'refs/heads/ogden/dddddddd/1.1-merge').trim();
    expect(await vcs.merge(repo, revision)).toBe('merged');
    mkdirSync(join(repo, '_bmad-output'), { recursive: true });
    writeFileSync(join(repo, '_bmad-output', 'plan.md'), 'status: done\n');
    await vcs.add(repo, ['_bmad-output/plan.md']);
    await vcs.commit(repo, 'Merge with the done mark');
    expect(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);
    expect(git(repo, 'show', '--name-only', '--format=', '-m', '--first-parent', 'HEAD').split(/\r?\n/).filter(Boolean).sort()).toEqual(['_bmad-output/plan.md', 'src/built.txt']);
    expect(git(repo, 'status', '--porcelain').trim()).toBe('');
    // The merged branch goes with `-d` (merged only), the worktree with it.
    await vcs.removeWorktree(repo, path, { deleteBranch: 'ogden/dddddddd/1.1-merge', mergedOnly: true });
    expect(git(repo, 'branch', '--list', 'ogden/*').trim()).toBe('');
  });

  it("keeps an unmerged branch when only a merged one may go, and never deletes a branch Ogden didn't make", async () => {
    const { repo, root, vcs, head } = setup();
    const path = join(root, 'eeeeeeee');
    await vcs.addWorktree(repo, { path, branch: 'ogden/eeeeeeee/1.1-unmerged', base: head });
    commitIn(path, { 'src/x.txt': 'x\n' });
    await expect(vcs.removeWorktree(repo, path, { deleteBranch: 'ogden/eeeeeeee/1.1-unmerged', mergedOnly: true })).rejects.toBeInstanceOf(VcsError);
    expect(git(repo, 'branch', '--list', 'ogden/*').trim()).not.toBe('');
    await expect(vcs.removeWorktree(repo, join(root, 'ffffffff'), { deleteBranch: 'main' })).rejects.toBeInstanceOf(VcsError);
    expect(git(repo, 'branch', '--list', 'main').trim()).not.toBe('');
  });

  it("removes only its own worktree's metadata: a user's stale worktree elsewhere keeps its own", async () => {
    const { repo, root, vcs, head } = setup();
    const users = join(temp('ogden-agents-wt-user-'), 'mine');
    git(repo, 'worktree', 'add', '-q', '-b', 'users-branch', users);
    // The user's worktree is on a drive that isn't there right now: git would prune it.
    rmSync(users, { recursive: true, force: true });
    const path = join(root, 'gggggggg');
    await vcs.addWorktree(repo, { path, branch: 'ogden/gggggggg/1.1-own', base: head });
    await vcs.removeWorktree(repo, path, { deleteBranch: 'ogden/gggggggg/1.1-own' });
    expect(readdirSync(join(repo, '.git', 'worktrees'))).toEqual(['mine']);
    expect(git(repo, 'branch', '--list', 'users-branch').trim()).not.toBe('');
  });

  it('removes a worktree whose folder is already gone, or that the agent locked, and leaves no metadata or branch', async () => {
    const { repo, root, vcs, head } = setup();
    const gone = join(root, 'hhhhhhhh');
    await vcs.addWorktree(repo, { path: gone, branch: 'ogden/hhhhhhhh/1.1-gone', base: head });
    rmSync(gone, { recursive: true, force: true });
    await vcs.removeWorktree(repo, gone, { deleteBranch: 'ogden/hhhhhhhh/1.1-gone' });
    const locked = join(root, 'iiiiiiii');
    await vcs.addWorktree(repo, { path: locked, branch: 'ogden/iiiiiiii/1.1-locked', base: head });
    writeFileSync(join(repo, '.git', 'worktrees', 'iiiiiiii', 'locked'), 'mine\n');
    await vcs.removeWorktree(repo, locked, { deleteBranch: 'ogden/iiiiiiii/1.1-locked' });
    expect(existsSync(join(repo, '.git', 'worktrees'))).toBe(false);
    expect(worktreeList(repo)).toHaveLength(1);
    expect(git(repo, 'branch', '--list', 'ogden/*').trim()).toBe('');
  });

  it("never removes outside its worktrees folder, the repo itself, or a link's target", async () => {
    const { repo, data, root, vcs } = setup();
    const outside = temp('ogden-agents-wt-outside-');
    writeFileSync(join(outside, 'keep.txt'), 'keep\n');
    // Outside the worktrees folder, the repo, a folder inside it: refused, nothing removed.
    await expect(vcs.removeWorktree(repo, outside)).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.removeWorktree(repo, repo)).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.removeWorktree(repo, join(data, 'jjjjjjjj'))).rejects.toBeInstanceOf(VcsError);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
    // A link in the worktrees folder: the link goes, its target stays.
    const link = join(root, 'kkkkkkkk');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    await vcs.removeWorktree(repo, link);
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep\n');
  });

  it('refuses every removal when the worktrees folder itself is a link', async () => {
    const { repo, data, vcs } = setup();
    const elsewhere = temp('ogden-agents-wt-elsewhere-');
    mkdirSync(join(elsewhere, 'llllllll'));
    writeFileSync(join(elsewhere, 'llllllll', 'keep.txt'), 'keep\n');
    rmSync(join(data, 'w'), { recursive: true });
    symlinkSync(elsewhere, join(data, 'w'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(vcs.removeWorktree(repo, join(data, 'w', 'llllllll'))).rejects.toBeInstanceOf(VcsError);
    expect(existsSync(join(elsewhere, 'llllllll', 'keep.txt'))).toBe(true);
  });

  it("knows whether a commit is in the checked-out branch's history", async () => {
    const { repo, vcs, head } = setup();
    expect(await vcs.isAncestor(repo, head)).toBe(true);
    git(repo, 'checkout', '-q', '--orphan', 'other');
    git(repo, 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'unrelated');
    expect(await vcs.isAncestor(repo, head)).toBe(false);
  });
});

describe('vcs-git: Commit plan files (story 5.5)', () => {
  it('commits exactly the given paths, new and changed, leaving other staged changes staged; no hook runs', async () => {
    const { repo, vcs } = setup();
    const markers = temp('ogden-agents-wt-markers-');
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch "${join(markers, 'pre-commit')}"\n`, { mode: 0o755 });
    mkdirSync(join(repo, '_bmad-output', 'epic'), { recursive: true });
    writeFileSync(join(repo, '_bmad-output', 'epic', 'story-plan.md'), 'status: ready-for-dev\n');
    writeFileSync(join(repo, '_bmad-output', 'epic', 'tickets.toml'), '[[entry]]\nid = 1\n');
    writeFileSync(join(repo, 'README.md'), '# Changed and staged\n');
    git(repo, 'add', 'README.md');
    writeFileSync(join(repo, 'other.txt'), 'untracked\n');
    const revision = await vcs.commitPaths(repo, ['_bmad-output/epic/story-plan.md', '_bmad-output/epic/tickets.toml'], 'Plan files for ticket 1.1');
    expect(revision).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').split(/\r?\n/).filter(Boolean).sort()).toEqual(['_bmad-output/epic/story-plan.md', '_bmad-output/epic/tickets.toml']);
    expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('README.md');
    expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toContain('?? other.txt');
    expect(readdirSync(markers)).toEqual([]);
    await expect(vcs.commitPaths(repo, ['../escape'], 'no')).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.commitPaths(repo, [], 'no')).rejects.toBeInstanceOf(VcsError);
  });
});
