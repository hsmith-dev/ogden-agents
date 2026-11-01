/**
 * `vcs-git`'s working tree (story 8.4) against temp repos: two turns'
 * snapshots each showing only their own file, a folder in no repo, the
 * Unstaged view (an untracked file as Added, an ignored one absent, the
 * repo's index unchanged), Staged, Branch against `main` (and none without
 * a base), binary and too large files, a worktree chat's commit with no
 * hook run and the main checkout unchanged, a tampered worktree refused,
 * and the snapshot store's guarantees: never a link out of the data folder,
 * never the repo's index, refs or objects, tree ids only, and git's
 * environment only the allowlist and git's own.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VcsError, type VcsFolder } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitWorkingTree } from '../src/index.js';
import { parseHunks } from '../src/vcs-git/working-tree.js';

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
function setup({ env }: { env?: () => Readonly<Record<string, string>> } = {}) {
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
  const vcs = createGitWorkingTree({ hooksDir: join(data, 'tools', 'git-hooks-none'), env: env ?? allowlist, snapshotsRoot });
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
