/**
 * `vcs-git` removing a chat's own worktree (epic 27, 27.3) against temp
 * repos (real git, no network): a direct child of `chatWorktreesRoot`
 * (`<data>/cw`) goes with git's record of it, its branch `ogden/chat/<ses>`
 * deleted only when merged (`keepUnmerged` keeps one with commits of its
 * own and says so); a link in its place is only unlinked; nothing outside
 * the root, and nothing when the root is a link; a run's branch rule is
 * unchanged.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VcsError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitVcs, createMemoryVcs } from '../src/index.js';

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
const SES2 = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
const LINK = process.platform === 'win32' ? 'junction' : 'dir';

/** A repo on `main` with one commit, and a data folder with the runs' `w` and the chats' `cw`. */
function setup() {
  const repo = temp('ogden-agents-cw-repo-');
  const data = temp('ogden-agents-cw-data-');
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  const runs = join(data, 'w');
  const chats = join(data, 'cw');
  mkdirSync(runs);
  mkdirSync(chats);
  const vcs = createGitVcs({
    hooksDir: join(data, 'tools', 'git-hooks-none'),
    worktreesRoot: runs,
    chatWorktreesRoot: chats,
    env: () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) }),
  });
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  return { repo, data, runs, chats, vcs, head };
}

const branches = (repo: string) => git(repo, 'branch', '--list', 'ogden/*', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean);

describe("vcs-git removes a chat's own worktree (27.3)", () => {
  it("removes the folder, git's record and a merged branch", async () => {
    const { repo, chats, vcs, head } = setup();
    const path = join(chats, 'aaaaaaaa');
    await vcs.addWorktree(repo, { path, branch: `ogden/chat/${SES}`, base: head });
    expect(await vcs.removeWorktree(repo, path, { deleteBranch: `ogden/chat/${SES}`, mergedOnly: true, keepUnmerged: true })).toEqual({ branchKept: false });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(repo, '.git', 'worktrees'))).toBe(false);
    expect(branches(repo)).toEqual([]);
  });

  it('keeps a branch with commits of its own, and says so', async () => {
    const { repo, chats, vcs, head } = setup();
    const path = join(chats, 'bbbbbbbb');
    await vcs.addWorktree(repo, { path, branch: `ogden/chat/${SES}`, base: head });
    writeFileSync(join(path, 'work.txt'), 'done\n');
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '--no-verify', '-m', 'work');
    expect(await vcs.removeWorktree(repo, path, { deleteBranch: `ogden/chat/${SES}`, mergedOnly: true, keepUnmerged: true })).toEqual({ branchKept: true });
    expect(existsSync(path)).toBe(false);
    expect(branches(repo)).toEqual([`ogden/chat/${SES}`]);
    // Without `keepUnmerged`, merged-only still refuses as before.
    const again = join(chats, 'cccccccc');
    await vcs.addWorktree(repo, { path: again, branch: `ogden/chat/${SES2}`, base: head });
    writeFileSync(join(again, 'more.txt'), 'more\n');
    git(again, 'add', '-A');
    git(again, 'commit', '-q', '--no-verify', '-m', 'more');
    await expect(vcs.removeWorktree(repo, again, { deleteBranch: `ogden/chat/${SES2}`, mergedOnly: true })).rejects.toBeInstanceOf(VcsError);
    expect(branches(repo)).toContain(`ogden/chat/${SES2}`);
  });

  it("only a chat's branch goes with a chat's folder, and a run's rule is unchanged", async () => {
    const { repo, runs, chats, vcs, head } = setup();
    const path = join(chats, 'dddddddd');
    await vcs.addWorktree(repo, { path, branch: `ogden/chat/${SES}`, base: head });
    for (const branch of ['main', 'ogden/dddddddd/1.1-run', 'ogden/chat/not-a-session', 'ogden/chat/']) {
      await expect(vcs.removeWorktree(repo, path, { deleteBranch: branch })).rejects.toBeInstanceOf(VcsError);
    }
    expect(existsSync(path)).toBe(true);
    // A run's folder never takes a chat's branch, and still takes its own.
    const run = join(runs, 'eeeeeeee');
    await vcs.addWorktree(repo, { path: run, branch: 'ogden/eeeeeeee/1.1-run', base: head });
    await expect(vcs.removeWorktree(repo, run, { deleteBranch: `ogden/chat/${SES}` })).rejects.toBeInstanceOf(VcsError);
    await vcs.removeWorktree(repo, run, { deleteBranch: 'ogden/eeeeeeee/1.1-run' });
    expect(existsSync(run)).toBe(false);
    expect(branches(repo)).toEqual([`ogden/chat/${SES}`]);
  });

  it("a link in a chat's place: only the link goes, its target stays", async () => {
    const { repo, chats, vcs, head } = setup();
    const target = temp('ogden-agents-cw-target-');
    writeFileSync(join(target, 'keep.txt'), 'keep\n');
    const path = join(chats, 'ffffffff');
    await vcs.addWorktree(repo, { path, branch: `ogden/chat/${SES}`, base: head });
    rmSync(path, { recursive: true, force: true });
    symlinkSync(target, path, LINK);
    await vcs.removeWorktree(repo, path, { deleteBranch: `ogden/chat/${SES}`, mergedOnly: true, keepUnmerged: true });
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep\n');
    expect(existsSync(join(repo, '.git', 'worktrees'))).toBe(false);
  });

  it('refuses a path outside the chats folder, and every removal when the chats folder is a link', async () => {
    const { repo, data, vcs } = setup();
    const outside = temp('ogden-agents-cw-outside-');
    mkdirSync(join(outside, 'gggggggg'));
    writeFileSync(join(outside, 'gggggggg', 'keep.txt'), 'keep\n');
    await expect(vcs.removeWorktree(repo, join(outside, 'gggggggg'), { deleteBranch: `ogden/chat/${SES}` })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.removeWorktree(repo, join(data, 'cw', 'not-a-chat'))).rejects.toBeInstanceOf(VcsError);
    rmSync(join(data, 'cw'), { recursive: true });
    symlinkSync(outside, join(data, 'cw'), LINK);
    await expect(vcs.removeWorktree(repo, join(data, 'cw', 'gggggggg'), { deleteBranch: `ogden/chat/${SES}` })).rejects.toBeInstanceOf(VcsError);
    expect(readdirSync(join(outside, 'gggggggg'))).toEqual(['keep.txt']);
  });
  it("finds its own record when git had to suffix the name (a user's worktree already owns it), and leaves the user's", async () => {
    const { repo, chats, vcs, head } = setup();
    const users = join(temp('ogden-agents-cw-user-'), 'hhhhhhhh');
    git(repo, 'worktree', 'add', '-q', '-b', 'users-branch', users);
    const path = join(chats, 'hhhhhhhh');
    await vcs.addWorktree(repo, { path, branch: `ogden/chat/${SES}`, base: head });
    expect(readdirSync(join(repo, '.git', 'worktrees')).sort()).toEqual(['hhhhhhhh', 'hhhhhhhh1']);
    expect(await vcs.removeWorktree(repo, path, { deleteBranch: `ogden/chat/${SES}`, mergedOnly: true, keepUnmerged: true })).toEqual({ branchKept: false });
    expect(readdirSync(join(repo, '.git', 'worktrees'))).toEqual(['hhhhhhhh']);
    expect(git(users, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('users-branch');
    expect(git(repo, 'worktree', 'list', '--porcelain')).toContain(users);
    expect(branches(repo)).toEqual([]);
  });

  it("never touches git's records through a .git/worktrees that is a link, and keeps the branch", async () => {
    const { repo, chats, vcs, head } = setup();
    const path = join(chats, 'iiiiiiii');
    await vcs.addWorktree(repo, { path, branch: `ogden/chat/${SES}`, base: head });
    const elsewhere = join(temp('ogden-agents-cw-records-'), 'worktrees');
    renameSync(join(repo, '.git', 'worktrees'), elsewhere);
    symlinkSync(elsewhere, join(repo, '.git', 'worktrees'), LINK);
    expect(await vcs.removeWorktree(repo, path, { deleteBranch: `ogden/chat/${SES}`, mergedOnly: true, keepUnmerged: true })).toEqual({ branchKept: true });
    expect(existsSync(path)).toBe(false);
    expect(readdirSync(elsewhere)).toEqual(['iiiiiiii']);
    expect(branches(repo)).toEqual([`ogden/chat/${SES}`]);
  });
});

describe("vcs-memory mirrors git's removal rules (27.3)", () => {
  it('keeps or refuses an unmerged branch as isMerged says, and takes only a chat worktree\'s own branch', async () => {
    const vcs = createMemoryVcs();
    const repo = '/repo';
    const state = vcs.repo(repo);
    const head = state.branches.get('main')!;
    await vcs.addWorktree(repo, { path: '/data/cw/aaaaaaaa', branch: `ogden/chat/${SES}`, base: head });
    expect(await vcs.isMerged(repo, `ogden/chat/${SES}`)).toBe(false);
    await expect(vcs.removeWorktree(repo, '/data/cw/aaaaaaaa', { deleteBranch: `ogden/chat/${SES2}` })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.removeWorktree(repo, '/data/cw/aaaaaaaa', { deleteBranch: 'ogden/chat/not-a-session' })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.removeWorktree(repo, '/data/cw/aaaaaaaa', { deleteBranch: `ogden/chat/${SES}`, mergedOnly: true })).rejects.toBeInstanceOf(VcsError);
    await vcs.addWorktree(repo, { path: '/data/cw/bbbbbbbb', branch: `ogden/chat/${SES2}`, base: head });
    expect(await vcs.removeWorktree(repo, '/data/cw/bbbbbbbb', { deleteBranch: `ogden/chat/${SES2}`, mergedOnly: true, keepUnmerged: true })).toEqual({ branchKept: true });
    state.merged.add(`ogden/chat/${SES2}`);
    expect(await vcs.removeWorktree(repo, '/data/cw/bbbbbbbb', { deleteBranch: `ogden/chat/${SES2}`, mergedOnly: true, keepUnmerged: true })).toEqual({ branchKept: false });
    expect(state.branches.has(`ogden/chat/${SES2}`)).toBe(false);
  });
});

