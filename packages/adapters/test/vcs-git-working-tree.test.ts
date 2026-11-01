/**
 * `vcs-git`'s working tree (story 8.4) against temp repos: two turns'
 * snapshots each showing only their own file, a folder in no repo, the
 * Unstaged view (an untracked file as Added, an ignored one absent, the
 * repo's index unchanged), Staged, Branch against `main` (and none without
 * a base), binary and too large files, a worktree chat's commit with no
 * hook run and the main checkout unchanged, a tampered worktree refused,
 * and the snapshot store's guarantees: never a link out of the data folder,
 * never the repo's index, refs or objects, tree ids only, and git's
 * environment only the allowlist and git's own. Story 8.5's hunk actions
 * on the same fixtures: stage, unstage and revert of one hunk or a whole
 * file, This turn's revert, an added and a deleted file, stale ids, Undo,
 * the files refused, a project in a subfolder, a chat worktree, unquoted
 * paths, and no filter or hook run, the repo's other files byte for byte
 * unchanged.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VcsError, type VcsFolder } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitWorkingTree } from '../src/index.js';
import { parseHunks, splitPatch } from '../src/vcs-git/working-tree.js';

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

/** Every file under `dir`, relative, sorted. */
const filesUnder = (dir: string): string[] => (existsSync(dir) ? (readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => !entry.isDirectory()).map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1)).sort()) : []);

/** What a snapshot must never change: the repo's index, refs and objects. */
const repoState = (repo: string) => ({
  index: readFileSync(join(repo, '.git', 'index')).toString('base64'),
  refs: git(repo, 'for-each-ref'),
  head: git(repo, 'rev-parse', 'HEAD'),
  objects: filesUnder(join(repo, '.git', 'objects')),
});

/** A repo on `main` with one commit and an ignore rule, a data folder, and the working tree adapter over it. */
function setup({ env, now }: { env?: () => Readonly<Record<string, string>>; now?: () => number } = {}) {
  const repo = temp('ogden-agents-wt-repo-');
  const data = temp('ogden-agents-wt-data-');
  const markers = temp('ogden-agents-wt-markers-');
  const emptyConfig = join(data, 'empty-gitconfig');
  writeFileSync(emptyConfig, '');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  writeFileSync(join(repo, '.gitignore'), '*.log\n');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'prepare-commit-msg', 'reference-transaction', 'post-index-change']) {
    writeFileSync(join(repo, '.git', 'hooks', name), `#!/bin/sh\ntouch "${join(markers, name)}"\n`);
    chmodSync(join(repo, '.git', 'hooks', name), 0o755);
  }
  const allowlist = () => ({ PATH: process.env.PATH ?? '', HOME: data, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? '' } : {}) });
  const snapshotsRoot = join(data, 'snapshots');
  const vcs = createGitWorkingTree({ hooksDir: join(data, 'tools', 'git-hooks-none'), env: env ?? allowlist, snapshotsRoot, now });
  return { repo, data, markers, vcs, snapshotsRoot, folder: { path: repo } as VcsFolder, allowlist };
}

describe('vcs-git working tree (story 8.4)', () => {
  it("snapshots two turns: each lists only its own file, and the repo's index, refs and objects are untouched", async () => {
    const { repo, vcs, folder, data, snapshotsRoot } = setup();
    const before = repoState(repo);
    const outside = filesUnder(data).filter((path) => !path.startsWith('snapshots'));
    const s0 = (await vcs.snapshot(folder))!;
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    const s1 = (await vcs.snapshot(folder))!;
    writeFileSync(join(repo, 'b.txt'), 'two\n');
    const s2 = (await vcs.snapshot(folder))!;
    expect([s0, s1, s2].every((tree) => /^[0-9a-f]{40}$/.test(tree))).toBe(true);
    expect((await vcs.changedFiles(folder, { view: 'turn', startTree: s1, endTree: s2 })).files).toEqual([{ path: 'b.txt', change: 'added', additions: 1, deletions: 0, binary: false, tooLarge: false }]);
    expect((await vcs.changedFiles(folder, { view: 'turn', startTree: s0, endTree: s1 })).files.map((file) => file.path)).toEqual(['a.txt']);
    const diff = await vcs.fileDiff(folder, { view: 'turn', startTree: s1, endTree: s2 }, 'b.txt');
    expect(diff?.hunks).toEqual([{ id: expect.stringMatching(/^h1-[0-9a-f]{10}$/), oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: 'add', text: 'two', newLine: 1 }] }]);
    expect(await vcs.fileDiff(folder, { view: 'turn', startTree: s1, endTree: s2 }, 'a.txt')).toBeUndefined();
    expect(repoState(repo)).toEqual(before);
    // Everything written is in the snapshots folder (the hooks folder was there before, empty), and no temporary index is left.
    expect(filesUnder(data).filter((path) => !path.startsWith('snapshots'))).toEqual(outside);
    expect(filesUnder(join(snapshotsRoot, 'tmp'))).toEqual([]);
  });

  it('answers no snapshot and no changes for a folder in no repository', async () => {
    const { vcs } = setup();
    const plain = { path: temp('ogden-agents-wt-plain-') };
    writeFileSync(join(plain.path, 'a.txt'), 'x');
    expect(await vcs.snapshot(plain)).toBeUndefined();
    for (const view of ['unstaged', 'staged', 'branch'] as const) expect(await vcs.changedFiles(plain, { view }), view).toEqual({ files: [], truncated: false });
    expect(await vcs.fileDiff(plain, { view: 'unstaged' }, 'a.txt')).toBeUndefined();
  });

  it('lists Unstaged: a modified file, an untracked one as Added, never an ignored one; the index is unchanged', async () => {
    const { repo, vcs, folder } = setup();
    const before = repoState(repo);
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\nexport const b = 3;\n');
    writeFileSync(join(repo, 'new.ts'), 'new\n');
    writeFileSync(join(repo, 'debug.log'), 'ignored\n');
    const listed = await vcs.changedFiles(folder, { view: 'unstaged' });
    expect(listed.files).toEqual([
      { path: 'new.ts', change: 'added', additions: 1, deletions: 0, binary: false, tooLarge: false },
      { path: 'src/a.ts', change: 'changed', additions: 1, deletions: 1, binary: false, tooLarge: false },
    ]);
    const diff = await vcs.fileDiff(folder, { view: 'unstaged' }, 'src/a.ts');
    expect(diff?.hunks[0]?.lines).toEqual([
      { kind: 'context', text: 'export const a = 1;', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'export const b = 2;', oldLine: 2 },
      { kind: 'add', text: 'export const b = 3;', newLine: 2 },
    ]);
    expect((await vcs.fileDiff(folder, { view: 'unstaged' }, 'new.ts'))?.file.change).toBe('added');
    expect(await vcs.fileDiff(folder, { view: 'unstaged' }, 'debug.log')).toBeUndefined();
    expect(repoState(repo)).toEqual(before);
    // Paths are the folder's: a project in a subfolder sees only its own, relative to it.
    expect((await vcs.changedFiles({ path: join(repo, 'src') }, { view: 'unstaged' })).files.map((file) => file.path)).toEqual(['a.ts']);
  });

  it('lists Staged, and Branch against main from where they parted; none without a base branch', async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, 'README.md'), '# Staged\n');
    git(repo, 'add', 'README.md');
    expect((await vcs.changedFiles(folder, { view: 'staged' })).files.map((file) => file.path)).toEqual(['README.md']);
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files).toEqual([]);
    git(repo, 'commit', '-q', '--no-verify', '-m', 'readme');
    git(repo, 'switch', '-q', '-c', 'feature');
    writeFileSync(join(repo, 'feature.ts'), 'f\n');
    git(repo, 'add', 'feature.ts');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'feature');
    // Uncommitted work is not the branch's.
    writeFileSync(join(repo, 'later.ts'), 'l\n');
    // main moving on after they parted doesn't show either.
    git(repo, 'switch', '-q', 'main');
    git(repo, 'switch', '-q', 'feature');
    expect(await vcs.changedFiles(folder, { view: 'branch' })).toEqual({ base: 'main', files: [{ path: 'feature.ts', change: 'added', additions: 1, deletions: 0, binary: false, tooLarge: false }], truncated: false });
    git(repo, 'branch', '-q', '-m', 'main', 'trunk');
    expect(await vcs.changedFiles(folder, { view: 'branch' })).toEqual({ files: [], truncated: false });
  });

  it('marks a binary file and a 2 MiB change, with no hunks', async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, 'pixel.png'), Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'));
    writeFileSync(join(repo, 'big.txt'), `${'x'.repeat(99)}\n`.repeat(21 * 1024));
    const files = (await vcs.changedFiles(folder, { view: 'unstaged' })).files;
    expect(files.find((file) => file.path === 'pixel.png')).toMatchObject({ binary: true, tooLarge: false });
    expect(files.find((file) => file.path === 'big.txt')).toMatchObject({ binary: false, tooLarge: true });
    expect(await vcs.fileDiff(folder, { view: 'unstaged' }, 'pixel.png')).toMatchObject({ file: { binary: true }, hunks: [] });
    expect(await vcs.fileDiff(folder, { view: 'unstaged' }, 'big.txt')).toMatchObject({ file: { tooLarge: true }, hunks: [] });
  });

  it("commits a worktree chat's changes on its branch: one commit, no hook, the main checkout unchanged", async () => {
    const { repo, data, markers, vcs } = setup();
    const branch = 'ogden/chat/ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
    const worktree = join(data, 'wt', 'chat-1');
    mkdirSync(join(data, 'wt'));
    git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
    const folder: VcsFolder = { path: worktree, worktree: { repoPath: repo, branch } };
    const before = { ...repoState(repo), status: git(repo, 'status', '--porcelain'), readme: readFileSync(join(repo, 'README.md'), 'utf8') };
    const tip = git(repo, 'rev-parse', branch).trim();
    expect(await vcs.commitAll(folder, 'Nothing yet')).toBe('nothing');
    writeFileSync(join(worktree, 'README.md'), '# Changed in the chat\n');
    writeFileSync(join(worktree, 'added.ts'), 'a\n');
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files.map((file) => file.path)).toEqual(['README.md', 'added.ts']);
    const committed = await vcs.commitAll(folder, 'Save the chat');
    expect(committed).toEqual({ revision: git(repo, 'rev-parse', branch).trim(), files: 2 });
    expect(git(repo, 'rev-list', '--count', `${tip}..${branch}`).trim()).toBe('1');
    expect(git(repo, 'log', '-1', '--format=%s', branch).trim()).toBe('Save the chat');
    expect(readdirSync(markers)).toEqual([]);
    const { objects: _objects, refs: _refs, ...after } = { ...repoState(repo), status: git(repo, 'status', '--porcelain'), readme: readFileSync(join(repo, 'README.md'), 'utf8') };
    const { objects: _o, refs: _r, ...was } = before;
    expect(after).toEqual(was);
    expect(git(repo, 'remote').trim()).toBe('');
    expect(await vcs.commitAll(folder, 'Again')).toBe('nothing');
    // Only a worktree is committed.
    await expect(vcs.commitAll({ path: repo }, 'No')).rejects.toBeInstanceOf(VcsError);
  });

  it('runs nothing in a worktree whose own files were changed', async () => {
    const { repo, data, markers, vcs } = setup();
    const branch = 'ogden/chat/ses_01J9Z3K4M5N6P7Q8R9S0T1V2W4';
    const worktree = join(data, 'wt', 'chat-2');
    mkdirSync(join(data, 'wt'));
    git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
    writeFileSync(join(worktree, 'x.ts'), 'x\n');
    const tip = git(repo, 'rev-parse', branch).trim();
    const folder: VcsFolder = { path: worktree, worktree: { repoPath: repo, branch } };
    writeFileSync(join(repo, '.git', 'worktrees', 'chat-2', 'HEAD'), 'ref: refs/heads/main\n');
    await expect(vcs.commitAll(folder, 'Save')).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.changedFiles(folder, { view: 'unstaged' })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.snapshot(folder)).rejects.toBeInstanceOf(VcsError);
    writeFileSync(join(repo, '.git', 'worktrees', 'chat-2', 'HEAD'), `ref: refs/heads/${branch}\n`);
    writeFileSync(join(worktree, '.git'), `gitdir: ${join(repo, '.git')}\n`);
    await expect(vcs.commitAll(folder, 'Save')).rejects.toBeInstanceOf(VcsError);
    expect(git(repo, 'rev-parse', branch).trim()).toBe(tip);
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(readdirSync(markers)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('refuses a snapshots folder or a store that is a link out of the data folder, writing nothing there', async () => {
    const { repo, vcs, folder, snapshotsRoot } = setup();
    const elsewhere = temp('ogden-agents-wt-elsewhere-');
    symlinkSync(elsewhere, snapshotsRoot);
    await expect(vcs.snapshot(folder)).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.changedFiles(folder, { view: 'unstaged' })).rejects.toBeInstanceOf(VcsError);
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(snapshotsRoot);
    // A store (the repo's own folder in it) that is a link.
    const first = setup();
    await first.vcs.snapshot(first.folder);
    const [store] = readdirSync(first.snapshotsRoot).filter((name) => name !== 'tmp');
    rmSync(join(first.snapshotsRoot, store!), { recursive: true });
    symlinkSync(elsewhere, join(first.snapshotsRoot, store!));
    await expect(first.vcs.snapshot(first.folder)).rejects.toBeInstanceOf(VcsError);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(repo).not.toBe(first.repo);
  });

  it('refuses tree ids that are not hex, absolute and parent paths, and shows a link as its text', async () => {
    const { repo, vcs, folder } = setup();
    for (const startTree of ['HEAD', 'main', `${'a'.repeat(39)}`, '--output=/tmp/x']) {
      await expect(vcs.changedFiles(folder, { view: 'turn', startTree, endTree: 'b'.repeat(40) }), startTree).rejects.toBeInstanceOf(VcsError);
    }
    for (const path of ['/etc/passwd', '../x', 'a/../../x']) await expect(vcs.fileDiff(folder, { view: 'unstaged' }, path), path).rejects.toBeInstanceOf(VcsError);
    if (process.platform !== 'win32') {
      symlinkSync('/etc/passwd', join(repo, 'passwd-link'));
      const shown = await vcs.fileDiff(folder, { view: 'unstaged' }, 'passwd-link');
      expect(shown?.hunks[0]?.lines).toEqual([{ kind: 'add', text: '/etc/passwd', newLine: 1 }]);
      // The snapshot holds the link as a link: its tree is in Ogden's store, never the repo's objects.
      const s0 = (await vcs.snapshot(folder))!;
      expect(() => git(repo, 'cat-file', '-t', s0)).toThrow();
    }
  });

  it.skipIf(process.platform === 'win32')("gives git only the allowlist and git's own variables", async () => {
    const data = temp('ogden-agents-wt-env-');
    const dump = join(data, 'env.txt');
    const wrapper = join(data, 'git-wrapper.sh');
    writeFileSync(wrapper, `#!/bin/sh\nenv >> "${dump}"\necho --- >> "${dump}"\nexec git "$@"\n`);
    chmodSync(wrapper, 0o755);
    const { repo, allowlist } = setup();
    const vcs = createGitWorkingTree({ hooksDir: join(data, 'hooks'), env: allowlist, snapshotsRoot: join(data, 'snapshots'), git: wrapper });
    process.env.OGDEN_TEST_SECRET = 'leak';
    try {
      await vcs.snapshot({ path: repo });
      await vcs.changedFiles({ path: repo }, { view: 'unstaged' });
    } finally {
      delete process.env.OGDEN_TEST_SECRET;
    }
    const names = new Set(
      readFileSync(dump, 'utf8')
        .split('\n')
        .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
        .map((line) => line.slice(0, line.indexOf('='))),
    );
    const allowed = new Set([...Object.keys(allowlist()), 'GIT_TERMINAL_PROMPT', 'GIT_OPTIONAL_LOCKS', 'LC_ALL', 'LANG', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NO_LAZY_FETCH', 'PWD', 'SHLVL', 'OLDPWD', '_']);
    expect([...names].filter((name) => !allowed.has(name))).toEqual([]);
    expect(names.has('OGDEN_TEST_SECRET')).toBe(false);
  });
});

/** A shell script at `path` that leaves `marker` and passes its input through (a filter program, an upload-pack). */
const markerScript = (path: string, marker: string, exitCode = 0) => {
  writeFileSync(path, `#!/bin/sh\ntouch "${marker}"\ncat\nexit ${exitCode}\n`);
  chmodSync(path, 0o755);
  return path;
};

/** A worktree chat of `repo` in the data folder, on its own branch. */
function worktreeChat(repo: string, data: string, name: string) {
  const branch = `ogden/chat/ses_01J9Z3K4M5N6P7Q8R9S0T1V2${name.toUpperCase().padStart(2, 'X').slice(-2)}`;
  const worktree = join(data, 'wt', name);
  mkdirSync(join(data, 'wt'), { recursive: true });
  git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
  return { branch, worktree, folder: { path: worktree, worktree: { repoPath: repo, branch } } as VcsFolder };
}

describe('vcs-git working tree: what the repo config can make it run or write (story 8.4 review)', () => {
  it.skipIf(process.platform === 'win32')("never runs a filter program from the repo's or a worktree's config", async () => {
    const { repo, data, markers, vcs, folder } = setup();
    const marker = join(markers, 'filter');
    markerScript(join(data, 'filter.sh'), marker);
    git(repo, 'config', 'filter.evil.clean', join(data, 'filter.sh'));
    git(repo, 'config', 'filter.evil.smudge', join(data, 'filter.sh'));
    git(repo, 'config', 'filter.evil.process', join(data, 'filter.sh'));
    git(repo, 'config', 'filter.evil.required', 'true');
    writeFileSync(join(repo, '.gitattributes'), '* filter=evil\n');
    writeFileSync(join(repo, 'new.ts'), 'new\n');
    expect(await vcs.snapshot(folder)).toMatch(/^[0-9a-f]{40}$/);
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files.map((file) => file.path)).toEqual(['.gitattributes', 'new.ts']);
    expect((await vcs.fileDiff(folder, { view: 'unstaged' }, 'new.ts'))?.hunks).toHaveLength(1);
    // A worktree's own config (`config.worktree`) too, and its commit.
    git(repo, 'config', '--unset-all', 'filter.evil.clean');
    git(repo, 'config', '--unset-all', 'filter.evil.process');
    git(repo, 'config', 'extensions.worktreeConfig', 'true');
    const chat = worktreeChat(repo, data, 'f1');
    git(chat.worktree, 'config', '--worktree', 'filter.wt.clean', join(data, 'filter.sh'));
    git(chat.worktree, 'config', '--worktree', 'filter.wt.process', join(data, 'filter.sh'));
    writeFileSync(join(chat.worktree, '.gitattributes'), '* filter=wt\n');
    writeFileSync(join(chat.worktree, 'chat.ts'), 'c\n');
    await vcs.snapshot(chat.folder);
    await vcs.changedFiles(chat.folder, { view: 'unstaged' });
    await vcs.fileDiff(chat.folder, { view: 'unstaged' }, 'chat.ts');
    expect(await vcs.commitAll(chat.folder, 'Save')).toMatchObject({ files: 2 });
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')("never fetches a promisor remote's missing object, nor runs its upload-pack", async () => {
    const { repo, data, markers, vcs, folder } = setup();
    const marker = join(markers, 'upload-pack');
    markerScript(join(data, 'upload.sh'), marker, 1);
    const upstream = temp('ogden-agents-wt-upstream-');
    git(upstream, 'init', '-q', '--bare');
    git(repo, 'config', 'core.repositoryformatversion', '1');
    git(repo, 'config', 'extensions.partialClone', 'origin');
    git(repo, 'config', 'remote.origin.url', upstream);
    git(repo, 'config', 'remote.origin.promisor', 'true');
    git(repo, 'config', 'remote.origin.uploadpack', join(data, 'upload.sh'));
    git(repo, 'config', 'core.sshCommand', join(data, 'upload.sh'));
    git(repo, 'update-index', '--add', '--cacheinfo', `100644,${'1'.repeat(40)},missing.txt`);
    writeFileSync(join(repo, 'missing.txt'), 'here\n');
    await vcs.changedFiles(folder, { view: 'unstaged' }).catch(() => undefined);
    await vcs.fileDiff(folder, { view: 'unstaged' }, 'missing.txt').catch(() => undefined);
    await vcs.snapshot(folder).catch(() => undefined);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses to commit through a chat branch made to point at another branch, leaving main as it was", async () => {
    const { repo, data, vcs } = setup();
    const chat = worktreeChat(repo, data, 's1');
    writeFileSync(join(chat.worktree, 'x.ts'), 'x\n');
    const main = git(repo, 'rev-parse', 'main').trim();
    writeFileSync(join(repo, '.git', 'refs', 'heads', ...chat.branch.split('/')), 'ref: refs/heads/main\n');
    await expect(vcs.commitAll(chat.folder, 'Save')).rejects.toBeInstanceOf(VcsError);
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(main);
  });

  it('leaves no split index file in the repo after a snapshot or a view', async () => {
    const { repo, vcs, folder } = setup();
    git(repo, 'config', 'core.splitIndex', 'true');
    git(repo, 'config', 'core.untrackedCache', 'true');
    git(repo, 'update-index', '--split-index');
    const before = readdirSync(join(repo, '.git')).sort();
    const index = readFileSync(join(repo, '.git', 'index')).toString('base64');
    writeFileSync(join(repo, 'new.ts'), 'n\n');
    await vcs.snapshot(folder);
    await vcs.changedFiles(folder, { view: 'unstaged' });
    expect(readdirSync(join(repo, '.git')).sort()).toEqual(before);
    expect(readFileSync(join(repo, '.git', 'index')).toString('base64')).toBe(index);
  });

  it("reads a checkout with core.autocrlf=true as its own config says: an untouched CRLF file is unchanged, an edit is one line", async () => {
    const { repo, vcs, folder } = setup();
    git(repo, 'config', 'core.autocrlf', 'true');
    writeFileSync(join(repo, 'crlf.txt'), 'one\ntwo\nthree\n');
    git(repo, 'add', 'crlf.txt');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'crlf');
    // On disk as a Windows checkout has it.
    writeFileSync(join(repo, 'crlf.txt'), 'one\r\ntwo\r\nthree\r\n');
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files).toEqual([]);
    writeFileSync(join(repo, 'crlf.txt'), 'one\r\nTWO\r\nthree\r\n');
    expect((await vcs.changedFiles(folder, { view: 'unstaged' })).files).toEqual([{ path: 'crlf.txt', change: 'changed', additions: 1, deletions: 1, binary: false, tooLarge: false }]);
  });
});

describe('vcs-git working tree: git files that are links or FIFOs (story 8.4 review)', () => {
  const kinds = process.platform === 'win32' ? (['link'] as const) : (['link', 'fifo'] as const);
  /** Replaces `path` with a FIFO, or a link to a file outside holding `secret`. */
  const replace = (path: string, kind: 'link' | 'fifo', outside: string) => {
    rmSync(path, { force: true });
    if (kind === 'fifo') execFileSync('mkfifo', [path]);
    else symlinkSync(outside, path);
  };

  for (const kind of kinds) {
    it.skipIf(process.platform === 'win32' && kind === 'link')(`refuses an index that is a ${kind}, quickly, copying nothing`, async () => {
      const { repo, vcs, folder, data } = setup();
      const outside = join(temp('ogden-agents-wt-secret-'), 'id_rsa');
      writeFileSync(outside, 'SECRET KEY\n');
      replace(join(repo, '.git', 'index'), kind, outside);
      const started = Date.now();
      await expect(vcs.snapshot(folder)).rejects.toBeInstanceOf(VcsError);
      await expect(vcs.changedFiles(folder, { view: 'unstaged' })).rejects.toBeInstanceOf(VcsError);
      expect(Date.now() - started).toBeLessThan(5_000);
      const copied = filesUnder(data).filter((path) => readFileSync(join(data, path), 'utf8').includes('SECRET KEY'));
      expect(copied).toEqual([]);
    });

    for (const which of ['.git link', 'admin HEAD'] as const) {
      it.skipIf(process.platform === 'win32' && kind === 'link')(`refuses a worktree whose ${which} is a ${kind}, quickly`, async () => {
        const { repo, data, vcs } = setup();
        const chat = worktreeChat(repo, data, which === '.git link' ? 'g1' : 'h1');
        const outside = join(temp('ogden-agents-wt-secret-'), 'file');
        writeFileSync(outside, which === '.git link' ? `gitdir: ${join(repo, '.git', 'worktrees', which === '.git link' ? 'g1' : 'h1')}\n` : `ref: refs/heads/${chat.branch}\n`);
        replace(which === '.git link' ? join(chat.worktree, '.git') : join(repo, '.git', 'worktrees', 'h1', 'HEAD'), kind, outside);
        const started = Date.now();
        await expect(vcs.changedFiles(chat.folder, { view: 'unstaged' })).rejects.toBeInstanceOf(VcsError);
        await expect(vcs.commitAll(chat.folder, 'Save')).rejects.toBeInstanceOf(VcsError);
        expect(Date.now() - started).toBeLessThan(5_000);
      });
    }
  }
});

describe('parseHunks', () => {
  it('numbers each side, skips the no-newline marker, and gives stable ids', () => {
    const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ title\n a\n-b\n+c\n\\ No newline at end of file\n@@ -10 +10,0 @@\n-z\n';
    const hunks = parseHunks(patch);
    expect(hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines])).toEqual([
      [1, 2, 1, 2],
      [10, 1, 10, 0],
    ]);
    expect(hunks[0]!.lines).toEqual([
      { kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'b', oldLine: 2 },
      { kind: 'add', text: 'c', newLine: 2 },
    ]);
    expect(hunks.map((hunk) => hunk.id)).toEqual([expect.stringMatching(/^h1-[0-9a-f]{10}$/), expect.stringMatching(/^h2-[0-9a-f]{10}$/)]);
    expect(parseHunks(patch).map((hunk) => hunk.id)).toEqual(hunks.map((hunk) => hunk.id));
  });
});

/** Twenty numbered lines, with `changes` (1-based line: new text) made. */
const numbered = (changes: Record<number, string> = {}): string => `${Array.from({ length: 20 }, (_, index) => changes[index + 1] ?? `line ${index + 1}`).join('\n')}\n`;

/** Every file of the working tree but `.git`, with its bytes. */
const treeBytes = (dir: string): Record<string, string> =>
  Object.fromEntries(
    filesUnder(dir)
      .filter((path) => path !== '.git' && !path.startsWith(`.git/`) && !path.startsWith('.git\\'))
      .map((path) => [path, readFileSync(join(dir, path)).toString('base64')]),
  );

describe('vcs-git working tree: hunk actions (story 8.5)', () => {
  /** The fixture with `list.txt` committed, then edited at lines 2 and 18 (two hunks), and its Unstaged ids. */
  async function twoHunks(options: Parameters<typeof setup>[0] = {}) {
    const fixture = setup(options);
    const { repo, vcs, folder } = fixture;
    writeFileSync(join(repo, 'list.txt'), numbered());
    git(repo, 'add', 'list.txt');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'list');
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    const hunks = (await vcs.fileDiff(folder, { view: 'unstaged' }, 'list.txt'))!.hunks;
    expect(hunks).toHaveLength(2);
    return { ...fixture, hunks };
  }
  const index = (repo: string, path: string) => git(repo, 'show', `:${path}`);
  const onDisk = (repo: string, path: string) => readFileSync(join(repo, path), 'utf8');

  it('stages the first hunk and reverts the second: the index holds only the first, the folder only lacks the second, nothing else changes, no hook runs', async () => {
    const { repo, vcs, folder, hunks, markers } = await twoHunks();
    const others = treeBytes(repo);
    delete others['list.txt'];
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'list.txt', hunkId: hunks[0]!.id })).toEqual({ outcome: 'applied' });
    expect(index(repo, 'list.txt')).toBe(numbered({ 2: 'TWO' }));
    // The folder is unchanged; Unstaged keeps the second hunk only, with the id it had.
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    const left = (await vcs.fileDiff(folder, { view: 'unstaged' }, 'list.txt'))!.hunks;
    expect(left.map((hunk) => hunk.lines.filter((line) => line.kind === 'add').map((line) => line.text))).toEqual([['EIGHTEEN']]);
    const reverted = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'list.txt', hunkId: left[0]!.id });
    expect(reverted).toEqual({ outcome: 'applied', undo: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(index(repo, 'list.txt')).toBe(numbered({ 2: 'TWO' }));
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO' }));
    const after = treeBytes(repo);
    delete after['list.txt'];
    expect(after).toEqual(others);
    expect(readdirSync(markers)).toEqual([]);
  });

  it('unstages one of two staged hunks, leaving the folder; reverts the first of two Unstaged hunks, leaving the index', async () => {
    const { repo, vcs, folder, hunks } = await twoHunks();
    git(repo, 'add', 'list.txt');
    const staged = (await vcs.fileDiff(folder, { view: 'staged' }, 'list.txt'))!.hunks;
    expect(staged.map((hunk) => hunk.id)).toEqual(hunks.map((hunk) => hunk.id));
    expect(await vcs.applyHunk!(folder, { target: { view: 'staged' }, action: 'unstage', path: 'list.txt', hunkId: staged[1]!.id })).toEqual({ outcome: 'applied' });
    expect(index(repo, 'list.txt')).toBe(numbered({ 2: 'TWO' }));
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    // Back to two unstaged hunks: revert the first, the index untouched.
    git(repo, 'reset', '-q', '--', 'list.txt');
    const before = readFileSync(join(repo, '.git', 'index')).toString('base64');
    const result = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'list.txt', hunkId: hunks[0]!.id });
    expect(result.outcome).toBe('applied');
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 18: 'EIGHTEEN' }));
    expect(readFileSync(join(repo, '.git', 'index')).toString('base64')).toBe(before);
  });

  it("reverts one of a turn's two hunks in the folder; one edited since is outdated and the file untouched", async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, 'list.txt'), numbered());
    const startTree = (await vcs.snapshot(folder))!;
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    const endTree = (await vcs.snapshot(folder))!;
    const target = { view: 'turn' as const, startTree, endTree };
    const hunks = (await vcs.fileDiff(folder, target, 'list.txt'))!.hunks;
    expect(hunks).toHaveLength(2);
    // The second hunk edited since the turn: nothing is written.
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO', 18: 'EIGHTEEN!' }));
    expect(await vcs.applyHunk!(folder, { target, action: 'revert', path: 'list.txt', hunkId: hunks[1]!.id })).toEqual({ outcome: 'outdated' });
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO', 18: 'EIGHTEEN!' }));
    // The first still applies; the second stays as the user left it.
    expect((await vcs.applyHunk!(folder, { target, action: 'revert', path: 'list.txt', hunkId: hunks[0]!.id })).outcome).toBe('applied');
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 18: 'EIGHTEEN!' }));
    // This turn's view is the snapshots': a second revert of the same hunk no longer applies.
    expect(await vcs.applyHunk!(folder, { target, action: 'revert', path: 'list.txt', hunkId: hunks[0]!.id })).toEqual({ outcome: 'outdated' });
  });

  it("stages an untracked file as added; brings back a file the turn deleted, unless it was made again since", async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, 'new.ts'), 'one\ntwo\n');
    const [added] = (await vcs.fileDiff(folder, { view: 'unstaged' }, 'new.ts'))!.hunks;
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'new.ts', hunkId: added!.id })).toEqual({ outcome: 'applied' });
    expect(git(repo, 'diff', '--cached', '--name-status').trim()).toBe('A\tnew.ts');
    expect(index(repo, 'new.ts')).toBe('one\ntwo\n');
    const startTree = (await vcs.snapshot(folder))!;
    rmSync(join(repo, 'README.md'));
    const endTree = (await vcs.snapshot(folder))!;
    const target = { view: 'turn' as const, startTree, endTree };
    const diff = (await vcs.fileDiff(folder, target, 'README.md'))!;
    expect(diff.file.change).toBe('deleted');
    writeFileSync(join(repo, 'README.md'), 'made again\n');
    expect(await vcs.applyHunk!(folder, { target, action: 'revert', path: 'README.md', hunkIds: diff.hunks.map((hunk) => hunk.id) })).toEqual({ outcome: 'outdated' });
    expect(onDisk(repo, 'README.md')).toBe('made again\n');
    rmSync(join(repo, 'README.md'));
    expect((await vcs.applyHunk!(folder, { target, action: 'revert', path: 'README.md', hunkIds: diff.hunks.map((hunk) => hunk.id) })).outcome).toBe('applied');
    expect(onDisk(repo, 'README.md')).toBe('# Repo\n');
  });

  it("applies a whole file only with the ids shown, and a stale id writes nothing", async () => {
    const { repo, vcs, folder, hunks } = await twoHunks();
    const indexBefore = readFileSync(join(repo, '.git', 'index')).toString('base64');
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'list.txt', hunkIds: [hunks[0]!.id] })).toEqual({ outcome: 'outdated' });
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'list.txt', hunkIds: [...hunks.map((hunk) => hunk.id), 'h3-0000000000'] })).toEqual({ outcome: 'outdated' });
    // The file changed after it was shown: the old ids are stale.
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO!', 18: 'EIGHTEEN' }));
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'list.txt', hunkId: hunks[0]!.id })).toEqual({ outcome: 'outdated' });
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'list.txt', hunkIds: hunks.map((hunk) => hunk.id) })).toEqual({ outcome: 'outdated' });
    expect(readFileSync(join(repo, '.git', 'index')).toString('base64')).toBe(indexBefore);
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO!', 18: 'EIGHTEEN' }));
    const now = (await vcs.fileDiff(folder, { view: 'unstaged' }, 'list.txt'))!.hunks;
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'list.txt', hunkIds: now.map((hunk) => hunk.id) })).toEqual({ outcome: 'applied' });
    expect(index(repo, 'list.txt')).toBe(numbered({ 2: 'TWO!', 18: 'EIGHTEEN' }));
    expect(await vcs.fileDiff(folder, { view: 'unstaged' }, 'list.txt')).toBeUndefined();
  });

  it('undoes a revert once, in its own folder and path only; an edited file or an old undo is refused', async () => {
    let clock = 1_000_000;
    const { repo, vcs, folder, hunks, data } = await twoHunks({ now: () => clock });
    const reverted = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'list.txt', hunkId: hunks[1]!.id });
    const undo = reverted.outcome === 'applied' ? reverted.undo! : '';
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO' }));
    const chat = worktreeChat(repo, data, 'u1');
    expect(await vcs.undoRevert!(chat.folder, { undo, path: 'list.txt' })).toEqual({ outcome: 'not_found' });
    expect(await vcs.undoRevert!(folder, { undo, path: 'README.md' })).toEqual({ outcome: 'not_found' });
    expect(await vcs.undoRevert!(folder, { undo: 'f'.repeat(32), path: 'list.txt' })).toEqual({ outcome: 'not_found' });
    // Edited where the hunk goes back: nothing is put back, and the undo is kept.
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO', 17: 'x', 18: 'y', 19: 'z' }));
    expect(await vcs.undoRevert!(folder, { undo, path: 'list.txt' })).toEqual({ outcome: 'outdated' });
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO', 17: 'x', 18: 'y', 19: 'z' }));
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO' }));
    expect(await vcs.undoRevert!(folder, { undo, path: 'list.txt' })).toEqual({ outcome: 'applied' });
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    expect(await vcs.undoRevert!(folder, { undo, path: 'list.txt' })).toEqual({ outcome: 'not_found' });
    // Kept for 30 minutes only.
    const again = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'list.txt', hunkId: hunks[1]!.id });
    clock += 31 * 60 * 1000;
    expect(await vcs.undoRevert!(folder, { undo: again.outcome === 'applied' ? again.undo! : '', path: 'list.txt' })).toEqual({ outcome: 'not_found' });
  });

  it.skipIf(process.platform === 'win32')('refuses a binary file, a link, a submodule and a path under a linked folder, writing nothing', async () => {
    const { repo, vcs, folder } = setup();
    const elsewhere = temp('ogden-agents-wt-linked-');
    writeFileSync(join(repo, 'pixel.png'), Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'));
    symlinkSync('/etc/hosts', join(repo, 'hosts-link'));
    mkdirSync(join(repo, 'linked'));
    writeFileSync(join(repo, 'linked', 'f.txt'), 'one\n');
    git(repo, 'add', 'linked/f.txt');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'linked');
    rmSync(join(repo, 'linked'), { recursive: true });
    writeFileSync(join(elsewhere, 'f.txt'), 'outside\n');
    symlinkSync(elsewhere, join(repo, 'linked'));
    git(repo, 'update-index', '--add', '--cacheinfo', `160000,${git(repo, 'rev-parse', 'HEAD').trim()},module`);
    const indexBefore = readFileSync(join(repo, '.git', 'index')).toString('base64');
    for (const path of ['pixel.png', 'hosts-link']) {
      expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path, hunkId: 'h1-0000000000' }), path).toEqual({ outcome: 'unsupported' });
      expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path, hunkId: 'h1-0000000000' }), path).toEqual({ outcome: 'unsupported' });
    }
    expect(await vcs.applyHunk!(folder, { target: { view: 'staged' }, action: 'unstage', path: 'module', hunkId: 'h1-0000000000' })).toEqual({ outcome: 'unsupported' });
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'linked/f.txt', hunkId: 'h1-0000000000' })).toEqual({ outcome: 'unsupported' });
    expect(readFileSync(join(repo, '.git', 'index')).toString('base64')).toBe(indexBefore);
    expect(readFileSync(join(elsewhere, 'f.txt'), 'utf8')).toBe('outside\n');
    expect(existsSync(join(repo, 'pixel.png')) && existsSync(join(repo, 'hosts-link'))).toBe(true);
  });

  it('refuses a parent, absolute or empty path, and an action its view does not offer, before git runs', async () => {
    const { vcs, folder } = setup();
    for (const path of ['../x', '/etc/passwd', 'a/../../x', '']) {
      await expect(vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path, hunkId: 'h1' }), path).rejects.toBeInstanceOf(VcsError);
      await expect(vcs.undoRevert!(folder, { undo: 'a'.repeat(32), path }), path).rejects.toBeInstanceOf(VcsError);
    }
    await expect(vcs.applyHunk!(folder, { target: { view: 'branch' }, action: 'revert', path: 'a.ts', hunkId: 'h1' })).rejects.toBeInstanceOf(VcsError);
    await expect(vcs.applyHunk!(folder, { target: { view: 'staged' }, action: 'stage', path: 'a.ts', hunkId: 'h1' })).rejects.toBeInstanceOf(VcsError);
    // A folder in no repository: nothing to act on.
    expect(await vcs.applyHunk!({ path: temp('ogden-agents-wt-plain-') }, { target: { view: 'unstaged' }, action: 'stage', path: 'a.ts', hunkId: 'h1' })).toEqual({ outcome: 'not_found' });
  });

  it.skipIf(process.platform === 'win32')("runs no filter program and no hook, and a .env revert writes only that file", async () => {
    const { repo, data, markers, vcs, folder } = setup();
    const marker = join(markers, 'filter');
    markerScript(join(data, 'filter.sh'), marker);
    writeFileSync(join(repo, '.env'), numbered());
    git(repo, 'add', '.env');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'env');
    git(repo, 'config', 'filter.evil.clean', join(data, 'filter.sh'));
    git(repo, 'config', 'filter.evil.smudge', join(data, 'filter.sh'));
    git(repo, 'config', 'filter.evil.process', join(data, 'filter.sh'));
    git(repo, 'config', 'filter.evil.required', 'true');
    writeFileSync(join(repo, '.gitattributes'), '* filter=evil\n');
    writeFileSync(join(repo, '.env'), numbered({ 2: 'SECRET=two', 18: 'SECRET=eighteen' }));
    const others = treeBytes(repo);
    delete others['.env'];
    const hunks = (await vcs.fileDiff(folder, { view: 'unstaged' }, '.env'))!.hunks;
    expect((await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: '.env', hunkId: hunks[0]!.id })).outcome).toBe('applied');
    // Ids are numbered in the file's diff: the one left is read again.
    const [left] = (await vcs.fileDiff(folder, { view: 'unstaged' }, '.env'))!.hunks;
    const reverted = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: '.env', hunkId: left!.id });
    expect(reverted.outcome).toBe('applied');
    expect(await vcs.undoRevert!(folder, { undo: reverted.outcome === 'applied' ? reverted.undo! : '', path: '.env' })).toEqual({ outcome: 'applied' });
    expect(onDisk(repo, '.env')).toBe(numbered({ 2: 'SECRET=two', 18: 'SECRET=eighteen' }));
    const after = treeBytes(repo);
    delete after['.env'];
    expect(after).toEqual(others);
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(markers)).toEqual([]);
  });

  it('acts in a project in a subfolder of the repo, in a chat worktree with its own index, and on a path git would quote', async () => {
    const { repo, data, vcs } = setup();
    writeFileSync(join(repo, 'src', 'list.txt'), numbered());
    writeFileSync(join(repo, 'café notes.txt'), numbered());
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'more');
    // The project is `src`: its paths are relative to it.
    writeFileSync(join(repo, 'src', 'list.txt'), numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    const sub = { path: join(repo, 'src') };
    const subHunks = (await vcs.fileDiff(sub, { view: 'unstaged' }, 'list.txt'))!.hunks;
    expect((await vcs.applyHunk!(sub, { target: { view: 'unstaged' }, action: 'stage', path: 'list.txt', hunkId: subHunks[1]!.id })).outcome).toBe('applied');
    expect(index(repo, 'src/list.txt')).toBe(numbered({ 18: 'EIGHTEEN' }));
    // A name with a space and a non-ASCII letter.
    writeFileSync(join(repo, 'café notes.txt'), numbered({ 2: 'TWO' }));
    const quoted = (await vcs.fileDiff({ path: repo }, { view: 'unstaged' }, 'café notes.txt'))!.hunks;
    expect((await vcs.applyHunk!({ path: repo }, { target: { view: 'unstaged' }, action: 'revert', path: 'café notes.txt', hunkId: quoted[0]!.id })).outcome).toBe('applied');
    expect(onDisk(repo, 'café notes.txt')).toBe(numbered());
    // A chat's worktree: its own index, the main checkout's untouched.
    const mainIndex = readFileSync(join(repo, '.git', 'index')).toString('base64');
    const chat = worktreeChat(repo, data, 'w1');
    writeFileSync(join(chat.worktree, 'src', 'list.txt'), numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    const chatHunks = (await vcs.fileDiff(chat.folder, { view: 'unstaged' }, 'src/list.txt'))!.hunks;
    expect((await vcs.applyHunk!(chat.folder, { target: { view: 'unstaged' }, action: 'stage', path: 'src/list.txt', hunkId: chatHunks[0]!.id })).outcome).toBe('applied');
    expect(git(chat.worktree, 'show', ':src/list.txt')).toBe(numbered({ 2: 'TWO' }));
    expect(readFileSync(join(repo, '.git', 'index')).toString('base64')).toBe(mainIndex);
    // A tampered worktree runs nothing.
    writeFileSync(join(repo, '.git', 'worktrees', 'w1', 'HEAD'), 'ref: refs/heads/main\n');
    await expect(vcs.applyHunk!(chat.folder, { target: { view: 'unstaged' }, action: 'stage', path: 'src/list.txt', hunkId: chatHunks[1]!.id })).rejects.toBeInstanceOf(VcsError);
  });
});

describe('vcs-git working tree: hunk actions, review rows (story 8.5)', () => {
  const onDisk = (repo: string, path: string) => readFileSync(join(repo, path), 'utf8');

  it("refuses a This turn revert once the turn's lines are in the file twice, or not at all, writing nothing", async () => {
    const { repo, vcs, folder } = setup();
    const block = Array.from({ length: 8 }, (_, index) => `same ${index + 1}`);
    const start = [...block, 'middle 1', 'middle 2', 'middle 3', 'middle 4', 'middle 5', 'middle 6', 'middle 7', ...block];
    writeFileSync(join(repo, 'twice.txt'), `${start.join('\n')}\n`);
    const startTree = (await vcs.snapshot(folder))!;
    const turned = [...start];
    turned[3] = 'changed by the turn';
    writeFileSync(join(repo, 'twice.txt'), `${turned.join('\n')}\n`);
    const endTree = (await vcs.snapshot(folder))!;
    const target = { view: 'turn' as const, startTree, endTree };
    const [hunk] = (await vcs.fileDiff(folder, target, 'twice.txt'))!.hunks;
    // The user moves the turn's block, so its lines are at the end too: two copies.
    const twice = [...turned.slice(0, 8), 'middle', ...turned.slice(0, 8)];
    writeFileSync(join(repo, 'twice.txt'), `${twice.join('\n')}\n`);
    expect(await vcs.applyHunk!(folder, { target, action: 'revert', path: 'twice.txt', hunkId: hunk!.id })).toEqual({ outcome: 'outdated' });
    expect(onDisk(repo, 'twice.txt')).toBe(`${twice.join('\n')}\n`);
    // The user deleted the turn's block: Revert must not edit the other, unchanged copy.
    const deleted = turned.slice(8);
    writeFileSync(join(repo, 'twice.txt'), `${deleted.join('\n')}\n`);
    expect(await vcs.applyHunk!(folder, { target, action: 'revert', path: 'twice.txt', hunkId: hunk!.id })).toEqual({ outcome: 'outdated' });
    expect(onDisk(repo, 'twice.txt')).toBe(`${deleted.join('\n')}\n`);
    writeFileSync(join(repo, 'twice.txt'), `${turned.join('\n')}\n`);
    expect((await vcs.applyHunk!(folder, { target, action: 'revert', path: 'twice.txt', hunkId: hunk!.id })).outcome).toBe('applied');
    expect(onDisk(repo, 'twice.txt')).toBe(`${start.join('\n')}\n`);
  });

  it('refuses an undo after an edit anywhere in the file, and an undo asked for another view', async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, 'list.txt'), numbered());
    git(repo, 'add', 'list.txt');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'list');
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO', 18: 'EIGHTEEN' }));
    const hunks = (await vcs.fileDiff(folder, { view: 'unstaged' }, 'list.txt'))!.hunks;
    const reverted = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: 'list.txt', hunkId: hunks[1]!.id });
    const undo = reverted.outcome === 'applied' ? reverted.undo! : '';
    expect(await vcs.undoRevert!(folder, { undo, path: 'list.txt', view: 'turn' })).toEqual({ outcome: 'not_found' });
    // An edit far from the hunk's lines: still refused, and nothing written.
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO', 5: 'five, edited' }));
    expect(await vcs.undoRevert!(folder, { undo, path: 'list.txt', view: 'unstaged' })).toEqual({ outcome: 'outdated' });
    expect(onDisk(repo, 'list.txt')).toBe(numbered({ 2: 'TWO', 5: 'five, edited' }));
    writeFileSync(join(repo, 'list.txt'), numbered({ 2: 'TWO' }));
    expect(await vcs.undoRevert!(folder, { undo, path: 'list.txt', view: 'unstaged' })).toEqual({ outcome: 'applied' });
  });

  it.skipIf(process.platform === 'win32')('keeps a private file private through a revert and its undo', async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, '.env'), numbered());
    git(repo, 'add', '.env');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'env');
    writeFileSync(join(repo, '.env'), numbered({ 2: 'KEY=two' }));
    chmodSync(join(repo, '.env'), 0o600);
    const [hunk] = (await vcs.fileDiff(folder, { view: 'unstaged' }, '.env'))!.hunks;
    const reverted = await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'revert', path: '.env', hunkId: hunk!.id });
    expect(lstatSync(join(repo, '.env')).mode & 0o777).toBe(0o600);
    expect(await vcs.undoRevert!(folder, { undo: reverted.outcome === 'applied' ? reverted.undo! : '', path: '.env', view: 'unstaged' })).toEqual({ outcome: 'applied' });
    expect(lstatSync(join(repo, '.env')).mode & 0o777).toBe(0o600);
  });

  it('acts on a path holding " b/"', async () => {
    const { repo, vcs, folder } = setup();
    mkdirSync(join(repo, 'x b'));
    writeFileSync(join(repo, 'x b', 'l.txt'), 'one\n');
    const [hunk] = (await vcs.fileDiff(folder, { view: 'unstaged' }, 'x b/l.txt'))!.hunks;
    expect(await vcs.applyHunk!(folder, { target: { view: 'unstaged' }, action: 'stage', path: 'x b/l.txt', hunkId: hunk!.id })).toEqual({ outcome: 'applied' });
    expect(git(repo, 'show', ':x b/l.txt')).toBe('one\n');
  });

  const caseInsensitive = (() => {
    const probe = mkdtempSync(join(tmpdir(), 'ogden-agents-wt-case-'));
    try {
      writeFileSync(join(probe, 'A'), '');
      return existsSync(join(probe, 'a'));
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();

  it.skipIf(!caseInsensitive)('refuses a path whose name on disk differs only in case, writing nothing', async () => {
    const { repo, vcs, folder } = setup();
    writeFileSync(join(repo, 'notes.txt'), numbered());
    const startTree = (await vcs.snapshot(folder))!;
    writeFileSync(join(repo, 'notes.txt'), numbered({ 2: 'TWO' }));
    const endTree = (await vcs.snapshot(folder))!;
    const target = { view: 'turn' as const, startTree, endTree };
    const [hunk] = (await vcs.fileDiff(folder, target, 'notes.txt'))!.hunks;
    rmSync(join(repo, 'notes.txt'));
    writeFileSync(join(repo, 'Notes.txt'), numbered({ 2: 'TWO' }));
    expect(await vcs.applyHunk!(folder, { target, action: 'revert', path: 'notes.txt', hunkId: hunk!.id })).toEqual({ outcome: 'unsupported' });
    expect(readdirSync(repo)).toContain('Notes.txt');
    expect(onDisk(repo, 'Notes.txt')).toBe(numbered({ 2: 'TWO' }));
  });
});

describe('splitPatch', () => {
  const patch = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n@@ -10 +10,0 @@\n-z\n';
  it('keeps the header lines a hunk action needs and each hunk with its id', () => {
    const split = splitPatch(patch, 'x')!;
    expect(split.header).toEqual(['diff --git a/x b/x', '--- a/x', '+++ b/x']);
    expect(split.hunks.map((hunk) => hunk.id)).toEqual(parseHunks(patch).map((hunk) => hunk.id));
    expect(split.hunks[0]!.lines).toEqual(['@@ -1,2 +1,2 @@', ' a', '-b', '+c', '\\ No newline at end of file']);
  });
  it('refuses another path in a header, a rename, a link or a submodule, and text that was not UTF-8', () => {
    expect(splitPatch(patch, 'y')).toBeUndefined();
    expect(splitPatch(patch.replace('+++ b/x', '+++ b/../etc/passwd'), 'x')).toBeUndefined();
    const spaced = 'diff --git a/x b/l.txt b/x b/l.txt\n--- a/x b/l.txt\t\n+++ b/x b/l.txt\t\n@@ -1 +1 @@\n-a\n+b\n';
    expect(splitPatch(spaced, 'x b/l.txt')?.header).toEqual(['diff --git a/x b/l.txt b/x b/l.txt', '--- a/x b/l.txt\t', '+++ b/x b/l.txt\t']);
    expect(splitPatch(spaced, 'x')).toBeUndefined();
    expect(splitPatch(patch.replace('index 1..2 100644\n', 'similarity index 90%\nrename from y\nrename to x\n'), 'x')).toBeUndefined();
    expect(splitPatch(patch.replace('index 1..2 100644\n', 'new file mode 120000\n'), 'x')).toBeUndefined();
    expect(splitPatch(patch.replace('index 1..2 100644\n', 'deleted file mode 160000\n'), 'x')).toBeUndefined();
    expect(splitPatch(patch.replace(' a\n', ' \uFFFD\n'), 'x')).toBeUndefined();
    expect(splitPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n', 'x')).toBeUndefined();
  });
});
