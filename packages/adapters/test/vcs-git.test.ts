/**
 * `vcs-git` against temp repos (story 5.2): a worktree in a separate data
 * folder on its own branch, the checkout's status (staged, unstaged,
 * untracked, under `_bmad-output/` too), a branch's diff, a local merge, and
 * the guarantees approve rests on: no hook ever runs (the repo's, or one an
 * agent wrote into the branch, with the repo pointing `core.hooksPath` at
 * it), and a conflicting merge leaves the checkout unchanged.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VcsError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitVcs } from '../src/index.js';

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

/** A repo on `main` with one commit, whose own hooks (in `.git/hooks` and in `.husky`, its `core.hooksPath`) would leave a file in `markers`. */
function setup() {
  const repo = temp('ogden-agents-vcs-repo-');
  const data = temp('ogden-agents-vcs-data-');
  const markers = temp('ogden-agents-vcs-markers-');
  // No global or system git config for Ogden's calls: what a fresh CI runner or a new computer has.
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  // Files as written, LF, whatever the OS's git does by default (Windows runners set core.autocrlf).
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  const hook = (dir: string, name: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), `#!/bin/sh\ntouch "${join(markers, name)}"\n`);
    chmodSync(join(dir, name), 0o755);
  };
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'post-merge', 'post-checkout', 'pre-merge-commit', 'reference-transaction']) hook(join(repo, '.git', 'hooks'), name);
  const vcs = createGitVcs({ hooksDir: join(data, 'tools', 'git-hooks-none'), env: () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) }) });
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  return { repo, data, markers, vcs, head, hook };
}

describe('vcs-git (story 5.2)', () => {
  it("reads the checked-out branch and its commit; nothing for a detached HEAD, an empty repo or a folder that isn't one", async () => {
    const { repo, vcs, head } = setup();
    expect(await vcs.head(repo)).toEqual({ branch: 'main', revision: head });
    git(repo, 'checkout', '-q', '--detach');
    expect(await vcs.head(repo)).toBeUndefined();
    const empty = temp('ogden-agents-vcs-empty-');
    git(empty, 'init', '-q');
    expect(await vcs.head(empty)).toBeUndefined();
    expect(await vcs.head(temp('ogden-agents-vcs-plain-'))).toBeUndefined();
  });

  it('adds a worktree in the data folder on its own branch (none in the repo), and removes it keeping the branch', async () => {
    const { repo, data, vcs, head, markers } = setup();
    const path = join(data, 'w', 'abcdefgh');
    mkdirSync(join(data, 'w'));
    await vcs.addWorktree(repo, { path, branch: 'ogden/1.1-build-it', base: head });
    expect(readFileSync(join(path, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('ogden/1.1-build-it');
    expect(readdirSync(repo).sort()).toEqual(['.git', 'README.md', 'src']);
    const paths = await vcs.worktreeGitPaths(path, 'ogden/abcdefgh/1.1-build-it');
    expect(paths.commonDir).toBe(join(repo, '.git'));
    // The run's own ref and reflog folders, made if missing (review loop 1).
    expect(paths.branchRefDir).toBe(join(repo, '.git', 'refs', 'heads', 'ogden', 'abcdefgh'));
    expect(paths.branchLogDir).toBe(join(repo, '.git', 'logs', 'refs', 'heads', 'ogden', 'abcdefgh'));
    expect(existsSync(paths.branchRefDir) && existsSync(paths.branchLogDir)).toBe(true);
    expect(paths.gitDir).toBe(join(repo, '.git', 'worktrees', 'abcdefgh'));
    // A run folder that already exists is never reused.
    await expect(vcs.addWorktree(repo, { path, branch: 'ogden/other', base: head })).rejects.toBeInstanceOf(VcsError);
    await vcs.removeWorktree(repo, path);
    expect(existsSync(path)).toBe(false);
    expect(git(repo, 'branch', '--format=%(refname:short)').trim().split('\n').sort()).toEqual(['main', 'ogden/1.1-build-it']);
    // With deleteBranch, the branch goes too (a run that never started).
    await vcs.addWorktree(repo, { path, branch: 'ogden/1.2-gone', base: head });
    await vcs.removeWorktree(repo, path, { deleteBranch: 'ogden/1.2-gone' });
    expect(git(repo, 'branch', '--format=%(refname:short)')).not.toContain('ogden/1.2-gone');
    // Removing a worktree that is already gone is fine.
    await vcs.removeWorktree(repo, path);
    expect(readdirSync(markers)).toEqual([]);
  });

  it('refuses a branch, revision or path it did not make before running git', async () => {
    const { repo, data, vcs, head } = setup();
    for (const branch of ['-x', 'a..b', 'a b', 'ogden/x.lock', 'x@{1}', '']) {
      await expect(vcs.addWorktree(repo, { path: join(data, 'p'), branch, base: head }), branch).rejects.toBeInstanceOf(VcsError);
    }
    await expect(vcs.addWorktree(repo, { path: join(data, 'p'), branch: 'ogden/ok', base: 'HEAD~1' })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.addWorktree(repo, { path: 'relative', branch: 'ogden/ok', base: head })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.add(repo, ['../outside'])).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.diff(repo, 'main', 'ogden/ok')).rejects.toBeInstanceOf(VcsError);
  });

  it('lists staged, unstaged and untracked changes, those under _bmad-output too', async () => {
    const { repo, vcs } = setup();
    expect(await vcs.status(repo)).toEqual([]);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
    writeFileSync(join(repo, 'new.txt'), 'x');
    mkdirSync(join(repo, '_bmad-output', 'plans'), { recursive: true });
    writeFileSync(join(repo, '_bmad-output', 'plans', 'p.md'), '# p\n');
    git(repo, 'add', 'new.txt');
    expect((await vcs.status(repo)).sort()).toEqual(['_bmad-output/plans/p.md', 'new.txt', 'src/a.ts']);
  });

  it("diffs a branch against its base, merges it locally with one commit, and no hook runs, not even one the branch brought", async () => {
    const { repo, data, vcs, head, markers, hook } = setup();
    // The repo points git at husky's folder, as a husky project does; the agent writes hooks there in its branch.
    git(repo, 'config', 'core.hooksPath', '.husky');
    const path = join(data, 'w', 'run1');
    mkdirSync(join(data, 'w'));
    await vcs.addWorktree(repo, { path, branch: 'ogden/1.1-x', base: head });
    writeFileSync(join(path, 'src', 'b.ts'), 'export const b = 1;\n');
    for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'post-merge', 'pre-merge-commit']) hook(join(path, '.husky'), name);
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '--no-verify', '-m', 'agent');
    const { diff, files, truncated } = await vcs.diff(repo, head, 'ogden/1.1-x');
    expect(files.sort()).toEqual(['.husky/commit-msg', '.husky/post-commit', '.husky/post-merge', '.husky/pre-commit', '.husky/pre-merge-commit', 'src/b.ts']);
    expect(diff).toContain('+export const b = 1;');
    expect(truncated).toBe(false);
    expect((await vcs.diff(repo, head, 'ogden/1.1-x', { maxBytes: 10 })).truncated).toBe(true);
    expect(await vcs.isMerged(repo, 'ogden/1.1-x')).toBe(false);

    expect(await vcs.branchRevision(repo, 'ogden/1.1-x')).toBe(git(repo, 'rev-parse', 'ogden/1.1-x').trim());
    expect(await vcs.branchRevision(repo, 'ogden/none')).toBeUndefined();
    expect(await vcs.merge(repo, (await vcs.branchRevision(repo, 'ogden/1.1-x'))!)).toBe('merged');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 3;\n');
    await vcs.add(repo, ['src/a.ts']);
    await vcs.commit(repo, 'Merge ogden/1.1-x: ticket 1.1 done');
    expect(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3);
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('Merge ogden/1.1-x: ticket 1.1 done');
    expect(git(repo, 'show', 'HEAD:src/a.ts')).toBe('export const a = 3;\n');
    expect(await vcs.status(repo)).toEqual([]);
    expect(await vcs.isMerged(repo, 'ogden/1.1-x')).toBe(true);
    expect(readdirSync(markers)).toEqual([]);
  });

  it('a conflicting merge is aborted: the checkout is exactly as before', async () => {
    const { repo, data, vcs, head } = setup();
    const path = join(data, 'w', 'run2');
    mkdirSync(join(data, 'w'));
    await vcs.addWorktree(repo, { path, branch: 'ogden/1.2-y', base: head });
    writeFileSync(join(path, 'src', 'a.ts'), 'export const a = "branch";\n');
    git(path, 'commit', '-q', '--no-verify', '-am', 'branch');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = "main";\n');
    git(repo, 'commit', '-q', '--no-verify', '-am', 'main');
    const before = git(repo, 'rev-parse', 'HEAD').trim();
    // An uncommitted file under _bmad-output stays as it was.
    mkdirSync(join(repo, '_bmad-output'));
    writeFileSync(join(repo, '_bmad-output', 'notes.md'), 'mine\n');

    expect(await vcs.merge(repo, git(repo, 'rev-parse', 'ogden/1.2-y').trim())).toBe('conflict');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
    expect(readFileSync(join(repo, 'src', 'a.ts'), 'utf8')).toBe('export const a = "main";\n');
    expect(await vcs.status(repo)).toEqual(['_bmad-output/notes.md']);
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    // Aborting with no merge in progress changes nothing.
    await vcs.abortMerge(repo);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('commits as Ogden Agents in a repo with no identity, and refuses to run with anything in its hooks folder', async () => {
    const { repo, data, vcs, head } = setup();
    git(repo, 'config', '--unset', 'user.name');
    git(repo, 'config', '--unset', 'user.email');
    // No identity guessed from the host name either (macOS can, a Linux runner can't): git must be given one.
    git(repo, 'config', 'user.useConfigOnly', 'true');
    const path = join(data, 'w', 'run3');
    mkdirSync(join(data, 'w'));
    await vcs.addWorktree(repo, { path, branch: 'ogden/1.3-z', base: head });
    writeFileSync(join(path, 'c.txt'), 'c\n');
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '--no-verify', '-m', 'c');
    expect(await vcs.merge(repo, git(repo, 'rev-parse', 'ogden/1.3-z').trim())).toBe('merged');
    // The fallback identity applies only where git has none (no repo or global config here: HOME is the temp data folder).
    await vcs.commit(repo, 'merge');
    expect(execFileSync('git', ['log', '-1', '--format=%an <%ae>'], { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_NOSYSTEM: '1' } }).trim()).toBe('Ogden Agents <ogden-agents@localhost>');

    writeFileSync(join(data, 'tools', 'git-hooks-none', 'pre-commit'), '#!/bin/sh\n');
    await expect(vcs.status(repo)).rejects.toBeInstanceOf(VcsError);
  });

  it("merges the reviewed revision only, never touches the user's merge in progress, and never overwrites an ignored file (review loop 1)", async () => {
    const { repo, data, vcs, head } = setup();
    mkdirSync(join(data, 'w'));
    const path = join(data, 'w', 'run4');
    await vcs.addWorktree(repo, { path, branch: 'ogden/1.4-r', base: head });
    writeFileSync(join(path, 'b.txt'), 'reviewed\n');
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '--no-verify', '-m', 'reviewed');
    const reviewed = git(path, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(path, 'c.txt'), 'later\n');
    git(path, 'add', '-A');
    git(path, 'commit', '-q', '--no-verify', '-m', 'later');
    expect(await vcs.merge(repo, reviewed)).toBe('merged');
    expect(existsSync(join(repo, 'b.txt'))).toBe(true);
    expect(existsSync(join(repo, 'c.txt'))).toBe(false);
    await vcs.abortMerge(repo);

    // The user's own merge in progress: refused, and left exactly as it was.
    const other = join(data, 'w', 'run5');
    await vcs.addWorktree(repo, { path: other, branch: 'ogden/1.5-u', base: head });
    writeFileSync(join(other, 'src', 'a.ts'), 'export const a = "theirs";\n');
    git(other, 'commit', '-q', '--no-verify', '-am', 'theirs');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = "ours";\n');
    git(repo, 'commit', '-q', '--no-verify', '-am', 'ours');
    expect(() => git(repo, 'merge', 'ogden/1.5-u')).toThrow();
    expect(await vcs.operationInProgress(repo)).toBe(true);
    expect(await vcs.merge(repo, reviewed)).toBe('refused');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
    git(repo, 'merge', '--abort');
    expect(await vcs.operationInProgress(repo)).toBe(false);

    // An ignored file the branch would overwrite: refused, the file kept.
    writeFileSync(join(repo, '.gitignore'), 'b.txt\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'ignore');
    writeFileSync(join(repo, 'b.txt'), 'mine, ignored\n');
    expect(await vcs.merge(repo, reviewed)).toBe('refused');
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('mine, ignored\n');
    expect(await vcs.operationInProgress(repo)).toBe(false);
  });

  it('reports staged changes and the top folder, and restores a file from HEAD', async () => {
    const { repo, vcs } = setup();
    expect(await vcs.topLevel(repo)).toBe(repo);
    mkdirSync(join(repo, 'sub'));
    expect(await vcs.topLevel(join(repo, 'sub'))).toBe(repo);
    expect(await vcs.topLevel(temp('ogden-agents-vcs-none-'))).toBeUndefined();
    expect(await vcs.staged(repo)).toEqual([]);
    writeFileSync(join(repo, 'src', 'a.ts'), 'changed\n');
    git(repo, 'add', 'src/a.ts');
    expect(await vcs.staged(repo)).toEqual(['src/a.ts']);
    await vcs.restore(repo, ['src/a.ts']);
    expect(readFileSync(join(repo, 'src', 'a.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(await vcs.staged(repo)).toEqual([]);
  });
});
