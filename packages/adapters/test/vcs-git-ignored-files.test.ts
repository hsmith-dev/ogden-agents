/**
 * `vcs-git` listing a chat copy's ignored files before the copy is removed
 * (user decision 2026-11-01) against a temp repo (real git, no network): a
 * `.env` in the copy is listed; a wholly ignored `node_modules` (and other
 * rebuildable folders, nested too) is left out and never walked; a file
 * named like a rebuildable folder is still listed; tracked and untracked
 * (not ignored) files aren't; the cap answers the first names and how many
 * more; nothing in the copy is opened (an unreadable ignored file is
 * listed all the same).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VcsFolder } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitVcs, createGitWorkingTree } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      chmodSync(join(dir, 'cw', 'aaaaaaaa', 'secret.key'), 0o600);
    } catch {
      // Only the copy's test has one.
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const SES = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const BRANCH = `ogden/chat/${SES}`;

async function setup() {
  const repo = temp('ogden-agents-ig-repo-');
  const data = temp('ogden-agents-ig-data-');
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  writeFileSync(join(repo, '.gitignore'), ['.env', 'secret.key', 'node_modules/', 'dist/', '__pycache__/', 'vendor/bundle/', 'logs/', 'build', ''].join('\n'));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  const chats = join(data, 'cw');
  mkdirSync(chats);
  const env = () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });
  const hooksDir = join(data, 'tools', 'git-hooks-none');
  const vcs = createGitVcs({ hooksDir, chatWorktreesRoot: chats, worktreesRoot: join(data, 'w'), env });
  const tree = createGitWorkingTree({ hooksDir, env, snapshotsRoot: join(data, 'snapshots') });
  const path = join(chats, 'aaaaaaaa');
  await vcs.addWorktree(repo, { path, branch: BRANCH, base: git(repo, 'rev-parse', 'HEAD').trim() });
  const copy: VcsFolder = { path, worktree: { repoPath: repo, branch: BRANCH } };
  return { repo, path, tree, copy };
}

describe("vcs-git lists a chat copy's ignored files (user decision 2026-11-01)", () => {
  it('lists a .env, leaves node_modules and other rebuildable folders out, and lists no tracked or plain untracked file', async () => {
    const kit = await setup();
    writeFileSync(join(kit.path, '.env'), 'TOKEN=1\n');
    writeFileSync(join(kit.path, 'untracked.txt'), 'new\n');
    writeFileSync(join(kit.path, 'build'), 'a file named build\n');
    for (const folder of ['node_modules/left-pad', 'packages/app/node_modules/x', 'dist', 'src/__pycache__', 'vendor/bundle/ruby']) {
      mkdirSync(join(kit.path, folder), { recursive: true });
      writeFileSync(join(kit.path, folder, 'index.js'), 'x\n');
    }
    mkdirSync(join(kit.path, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(join(kit.path, 'packages', 'app', 'src', '.env'), 'NESTED=1\n');
    // An ignored file nothing may read is listed by name all the same: its contents are never opened.
    writeFileSync(join(kit.path, 'secret.key'), 'k\n');
    if (process.platform !== 'win32') chmodSync(join(kit.path, 'secret.key'), 0o000);

    const listed = await kit.tree.ignoredFiles!(kit.copy, { limit: 20 });

    expect(listed).toEqual({ files: ['.env', 'build', 'packages/app/src/.env', 'secret.key'], more: 0 });
    expect(listed.files.some((name) => name.includes('node_modules') || name.includes('left-pad'))).toBe(false);
  });

  it('caps the list: the first names, sorted, and how many more; a wholly ignored folder is one entry', async () => {
    const kit = await setup();
    for (let index = 0; index < 25; index++) writeFileSync(join(kit.path, `.env.${String(index).padStart(2, '0')}`), 'x\n');
    writeFileSync(join(kit.repo, '.git', 'info', 'exclude'), '.env.*\n');
    mkdirSync(join(kit.path, 'logs'));
    for (let index = 0; index < 50; index++) writeFileSync(join(kit.path, 'logs', `${index}.log`), 'x\n');

    const listed = await kit.tree.ignoredFiles!(kit.copy, { limit: 20 });

    expect(listed.files).toHaveLength(20);
    expect(listed.files[0]).toBe('.env.00');
    // 25 `.env.*` and `logs/` as one entry: 26 in all.
    expect(listed.more).toBe(6);
    const all = await kit.tree.ignoredFiles!(kit.copy, { limit: 100 });
    expect(all.files.at(-1)).toBe('logs/');
    expect(all.more).toBe(0);
  });

  it('a folder in no repository has none', async () => {
    const kit = await setup();
    const plain = temp('ogden-agents-ig-plain-');
    writeFileSync(join(plain, '.env'), 'x\n');
    expect(await kit.tree.ignoredFiles!({ path: plain }, { limit: 20 })).toEqual({ files: [], more: 0 });
  });
});
