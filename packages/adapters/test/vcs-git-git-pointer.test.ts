/**
 * A project whose `.git` is a file (user decision 2026-11-01, AD-37; story
 * 8.4 review #12): the working tree adapter follows the pointer only for a
 * standard linked worktree (`<repo>/.git/worktrees/<name>` whose `gitdir`
 * points back at this `.git` file) or submodule (inside
 * `<super>/.git/modules/`, its `core.worktree` this project). A pointer to
 * an unrelated repo, one at a worktree folder whose back-link names another
 * checkout, and a relative one leading out are refused with the plain
 * sentence, for the views, a snapshot and a worktree chat's commit, and
 * the other repo is never read or written.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { VcsError, type VcsFolder } from '@ogden-agents/core';
import { GIT_POINTER_UNUSUAL_MESSAGE } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitWorkingTree } from '../src/index.js';

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
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** A repo on `main` with one commit. */
function repoAt(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '--initial-branch=main');
  git(dir, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(dir, 'README.md'), '# Repo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'first');
  return dir;
}

function setup() {
  const root = temp('ogden-agents-gitptr-');
  const data = temp('ogden-agents-gitptr-data-');
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  const env = () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });
  const vcs = createGitWorkingTree({ hooksDir: join(data, 'tools', 'git-hooks-none'), env, snapshotsRoot: join(data, 'snapshots') });
  return { root, vcs };
}

/** The other repo as it was: what a refusal must leave untouched. */
const stateOf = (repo: string) => ({ index: readFileSync(join(repo, '.git', 'index')).toString('base64'), refs: git(repo, 'for-each-ref'), status: git(repo, 'status', '--porcelain') });

async function expectRefused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(VcsError);
  expect((error as VcsError).message).toBe(GIT_POINTER_UNUSUAL_MESSAGE);
}

/** Every operation 8.4 runs git for refuses `project`, and `other` is left as it was. */
async function expectAllRefused(vcs: ReturnType<typeof setup>['vcs'], project: string, other: string) {
  const before = stateOf(other);
  const folder: VcsFolder = { path: project };
  for (const view of ['unstaged', 'staged', 'branch'] as const) await expectRefused(vcs.changedFiles(folder, { view }));
  await expectRefused(vcs.fileDiff(folder, { view: 'unstaged' }, 'README.md'));
  await expectRefused(vcs.snapshot(folder));
  // A worktree chat of this project: refused before any worktree check runs git in it.
  await expectRefused(vcs.commitAll({ path: join(project, 'wt'), worktree: { repoPath: project, branch: 'ogden/chat/x' } }, 'Save'));
  expect(stateOf(other)).toEqual(before);
}

describe("vcs-git working tree: a project's .git file (user decision 2026-11-01)", () => {
  it('the message is plain words, with no em or en dash', () => {
    expect(GIT_POINTER_UNUSUAL_MESSAGE).toBe("Ogden can't read this project's git: its .git file points somewhere unusual.");
    expect(GIT_POINTER_UNUSUAL_MESSAGE).not.toMatch(/[–—]/);
  });

  it('follows a linked worktree: views and a snapshot read it', async () => {
    const { root, vcs } = setup();
    const main = repoAt(join(root, 'main'));
    const worktree = join(root, 'feature');
    git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree, 'HEAD');
    writeFileSync(join(worktree, 'README.md'), '# Feature\n');
    writeFileSync(join(worktree, 'new.txt'), 'new\n');
    const folder: VcsFolder = { path: worktree };
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files.map((file) => [file.path, file.change])).toEqual([
      ['README.md', 'changed'],
      ['new.txt', 'added'],
    ]);
    expect(await vcs.snapshot(folder)).toMatch(/^[0-9a-f]{40}$/);
    // A subfolder of the worktree finds the same `.git` file.
    mkdirSync(join(worktree, 'src'));
    writeFileSync(join(worktree, 'src', 'b.ts'), 'b\n');
    expect((await vcs.changedFiles({ path: join(worktree, 'src') }, { view: 'unstaged' })).files.map((file) => file.path)).toEqual(['b.ts']);
  });

  it('follows a submodule: views and a snapshot read it', async () => {
    const { root, vcs } = setup();
    const library = repoAt(join(root, 'library'));
    const superproject = repoAt(join(root, 'super'));
    git(superproject, 'submodule', 'add', '-q', library, 'vendor/library');
    const sub = join(superproject, 'vendor', 'library');
    expect(readFileSync(join(sub, '.git'), 'utf8')).toMatch(/^gitdir: /);
    writeFileSync(join(sub, 'README.md'), '# Changed\n');
    const folder: VcsFolder = { path: sub };
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files.map((file) => [file.path, file.change])).toEqual([['README.md', 'changed']]);
    expect(await vcs.snapshot(folder)).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses a submodule folder whose core.worktree names another checkout', async () => {
    const { root, vcs } = setup();
    const library = repoAt(join(root, 'library'));
    const superproject = repoAt(join(root, 'super'));
    git(superproject, 'submodule', 'add', '-q', library, 'vendor/library');
    // A second folder pointing at the same module: its core.worktree names vendor/library, not this one.
    const project = join(root, 'copy');
    mkdirSync(project);
    writeFileSync(join(project, '.git'), `gitdir: ${join(superproject, '.git', 'modules', 'vendor', 'library')}\n`);
    await expectAllRefused(vcs, project, superproject);
  });

  it('refuses a pointer to an unrelated repo', async () => {
    const { root, vcs } = setup();
    const other = repoAt(join(root, 'other'));
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(project, 'README.md'), 'mine\n');
    writeFileSync(join(project, '.git'), `gitdir: ${join(other, '.git')}\n`);
    await expectAllRefused(vcs, project, other);
  });

  it("refuses a pointer at a worktree folder whose back-link names another checkout", async () => {
    const { root, vcs } = setup();
    const main = repoAt(join(root, 'main'));
    git(main, 'worktree', 'add', '-q', '-b', 'feature', join(root, 'feature'), 'HEAD');
    // Looks like a linked worktree, but `.git/worktrees/feature/gitdir` points at `feature/.git`, not here.
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(project, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'feature')}\n`);
    await expectAllRefused(vcs, project, main);
    // A forged admin folder that points back here, but whose commondir names another repo.
    const other = repoAt(join(root, 'other'));
    const forged = join(main, '.git', 'worktrees', 'forged');
    mkdirSync(forged);
    writeFileSync(join(forged, 'gitdir'), `${join(project, '.git')}\n`);
    writeFileSync(join(forged, 'commondir'), `${join(other, '.git')}\n`);
    writeFileSync(join(forged, 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(project, '.git'), `gitdir: ${forged}\n`);
    await expectAllRefused(vcs, project, other);
  });

  it('refuses a relative pointer that leads out to another repo', async () => {
    const { root, vcs } = setup();
    const other = repoAt(join(root, 'elsewhere', 'other'));
    const project = join(root, 'a', 'b', 'project');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, '.git'), `gitdir: ${relative(project, join(other, '.git'))}\n`);
    expect(readFileSync(join(project, '.git'), 'utf8')).toMatch(/^gitdir: \.\.\//);
    await expectAllRefused(vcs, project, other);
    // Through `modules` and back out by `..`: the real path is what counts.
    const superproject = repoAt(join(root, 'super'));
    mkdirSync(join(superproject, '.git', 'modules'));
    writeFileSync(join(project, '.git'), `gitdir: ${relative(project, join(superproject, '.git', 'modules'))}/../../../elsewhere/other/.git\n`);
    await expectAllRefused(vcs, project, other);
  });
});
