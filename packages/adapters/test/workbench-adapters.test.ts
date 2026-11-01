/**
 * Epic 8 entry 2's adapters: `workspace-files-node` with a chat worktree's
 * root (the data-folder fence lifted for it alone, everything else still
 * confined) and `locate` (checked as `read` is); and the in-memory stubs
 * the Workbench lanes test with (files, the working tree, the editor
 * launcher and the project-command runner).
 */
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { createMemoryEditorLauncher, createMemoryProjectCommandRunner, createMemoryVcsWorkingTree, createMemoryWorkspaceFiles, createWorkspaceFilesNode } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}
function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const PROTECTED = { refused: 'protected' };
const NOT_FOUND = { refused: 'not_found' };

describe('workspace-files-node: a chat worktree root (epic 8 entry 2)', () => {
  function setup() {
    const home = tempDir('ogden-wb-home-');
    const dataDir = tempDir('ogden-wb-data-');
    const worktree = join(dataDir, 'worktrees', 'chat');
    write(worktree, { 'src/a.ts': 'export const a = 1;\n', '.git': 'gitdir: ../../repo/.git/worktrees/chat\n' });
    write(dataDir, { 'ogden.db': 'DATABASE', 'worktrees/other/secret.ts': 'OTHER' });
    return { home, dataDir, worktree, port: createWorkspaceFilesNode({ home, dataDir }) };
  }

  it('lists and reads inside a worktree in the data folder only as a chat_worktree root', async () => {
    const { port, worktree } = setup();
    expect(await port.list(worktree, 'src')).toEqual(PROTECTED);
    expect(await port.read(worktree, 'src/a.ts')).toEqual(PROTECTED);
    expect(await port.list(worktree, 'src', 'chat_worktree')).toMatchObject({ entries: [{ name: 'a.ts', protected: false }] });
    expect(await port.read(worktree, 'src/a.ts', 'chat_worktree')).toMatchObject({ kind: 'text', content: 'export const a = 1;\n' });
    // The worktree's own `.git` file is still refused by name.
    expect(await port.read(worktree, '.git', 'chat_worktree')).toEqual(PROTECTED);
  });

  it('refuses a chat_worktree root that is the data folder, above it, or outside it', async () => {
    const { port, dataDir } = setup();
    for (const root of [dataDir, dirname(dataDir), tempDir('ogden-wb-elsewhere-')]) {
      expect(await port.list(root, '', 'chat_worktree'), root).toEqual(PROTECTED);
      expect(await port.read(root, 'ogden.db', 'chat_worktree'), root).toEqual(PROTECTED);
      expect(await port.locate!(root, 'ogden.db', 'chat_worktree'), root).toEqual(PROTECTED);
    }
  });

  it('keeps everything confined to the worktree: a link out to the rest of the data folder or a home fence is refused', async () => {
    const { port, worktree, dataDir, home } = setup();
    mkdirSync(join(home, '.ssh'));
    writeFileSync(join(home, '.ssh', 'id_rsa'), 'KEY');
    let linked = true;
    try {
      symlinkSync(join(dataDir, 'ogden.db'), join(worktree, 'db'));
      symlinkSync(join(dataDir, 'worktrees', 'other'), join(worktree, 'other'), process.platform === 'win32' ? 'junction' : 'dir');
      symlinkSync(join(home, '.ssh', 'id_rsa'), join(worktree, 'key'));
    } catch {
      linked = false;
    }
    if (!linked) return;
    for (const path of ['db', 'other/secret.ts', 'key']) {
      expect(await port.read(worktree, path, 'chat_worktree'), path).toEqual(PROTECTED);
      expect(await port.locate!(worktree, path, 'chat_worktree'), path).toEqual(PROTECTED);
    }
  });

  it("locates an allowed file's real path, refusing what read refuses", async () => {
    const root = tempDir('ogden-wb-project-');
    const home = tempDir('ogden-wb-home-');
    const dataDir = tempDir('ogden-wb-data-');
    write(root, { 'src/a.ts': 'a', '.git/config': '[core]', '.env': 'A=1' });
    const port = createWorkspaceFilesNode({ home, dataDir });
    expect(await port.locate!(root, 'src/a.ts')).toEqual({ realPath: join(root, 'src', 'a.ts') });
    expect(await port.locate!(root, '.env')).toEqual({ realPath: join(root, '.env') });
    expect(await port.locate!(root, '.git/config')).toEqual(PROTECTED);
    expect(await port.locate!(root, 'src')).toEqual(NOT_FOUND);
    expect(await port.locate!(root, 'gone.ts')).toEqual(NOT_FOUND);
    expect(port.search).toBeUndefined();
    const outside = tempDir('ogden-wb-out-');
    writeFileSync(join(outside, 'secret'), 'S');
    try {
      linkSync(join(outside, 'secret'), join(root, 'hard.txt'));
    } catch {
      return;
    }
    expect(await port.locate!(root, 'hard.txt')).toEqual({ refused: 'protected', reason: 'hard_link' });
  });
});

describe('the Workbench memory stubs', () => {
  it('workspace-files-memory lists, reads, searches uncapped and locates, recording each root kind', async () => {
    const port = createMemoryWorkspaceFiles();
    port.setFiles('/w', { 'src/a.ts': 'one\nTwo two\n', 'README.md': 'two', '.git/config': 'two' });
    expect(await port.list('/w', '')).toMatchObject({ entries: [{ name: '.git', kind: 'folder', protected: true }, { name: 'src', kind: 'folder' }, { name: 'README.md', kind: 'file' }] });
    expect(await port.read('/w', '.git/config')).toEqual(PROTECTED);
    expect(await port.search!('/w', { q: 'two', mode: 'text', matchCase: false }, 'chat_worktree')).toEqual({
      files: [{ path: 'README.md', matches: [{ line: 1, column: 1, preview: 'two' }] }, { path: 'src/a.ts', matches: [{ line: 2, column: 1, preview: 'Two two' }] }],
      truncated: false,
    });
    expect(await port.search!('/w', { q: 'a.ts', mode: 'names', matchCase: true })).toEqual({ files: [{ path: 'src/a.ts', matches: [] }], truncated: false });
    expect(await port.locate!('/w', 'src/a.ts')).toEqual({ realPath: '/w/src/a.ts' });
    expect(port.calls.map((call) => `${call.op} ${call.kind}`)).toContain('search chat_worktree');
    expect(createMemoryWorkspaceFiles({ search: false }).search).toBeUndefined();
  });

  it('vcs-memory working tree: stage moves a hunk to Staged, an outdated hunk is refused, commit clears', async () => {
    const vcs = createMemoryVcsWorkingTree();
    const w = { path: '/w' };
    const hunk = { id: 'h1', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ kind: 'add' as const, text: 'x', newLine: 1 }] };
    vcs.folder('/w').unstaged.push({ file: { path: 'a.ts', change: 'changed', additions: 1, deletions: 0, binary: false, tooLarge: false }, hunks: [hunk, { ...hunk, id: 'h2' }] });
    expect(await vcs.applyHunk(w, { target: { view: 'unstaged' }, action: 'stage', path: 'a.ts', hunkId: 'h1' })).toBe('applied');
    expect((await vcs.changedFiles(w, { view: 'staged' })).files).toMatchObject([{ path: 'a.ts', additions: 1 }]);
    vcs.outdated.add('h2');
    expect(await vcs.applyHunk(w, { target: { view: 'unstaged' }, action: 'revert', path: 'a.ts', hunkId: 'h2' })).toBe('outdated');
    expect(await vcs.applyHunk(w, { target: { view: 'unstaged' }, action: 'revert', path: 'b.ts' })).toBe('not_found');
    expect(await vcs.commitAll(w, 'msg')).toMatchObject({ files: 1 });
    expect((await vcs.changedFiles(w, { view: 'unstaged' })).files).toEqual([]);
    expect(await vcs.snapshot(w)).toMatch(/^[0-9a-f]{40}$/);
    expect(await vcs.commitAll(w, 'again')).toBe('nothing');
  });

  it('editor-launcher-memory records opens; project-commands-memory starts nothing until finished', async () => {
    const launcher = createMemoryEditorLauncher();
    expect(await launcher.open('vscode', '/w/a.ts', 3)).toBe('opened');
    expect(await launcher.open('zed', '/w/a.ts')).toBe('unavailable');
    expect(launcher.opens).toEqual([{ editorId: 'vscode', absolutePath: '/w/a.ts', line: 3, column: undefined }, { editorId: 'zed', absolutePath: '/w/a.ts', line: undefined, column: undefined }]);
    const runner = createMemoryProjectCommandRunner();
    const started = runner.start({ cwd: '/w', command: 'npm test' });
    runner.starts[0]!.write('FAIL a.ts\n');
    runner.starts[0]!.finish({ exitCode: 1 });
    expect(await started.done).toEqual({ exitCode: 1, stopped: false });
    expect(started.output()).toEqual({ text: 'FAIL a.ts\n', truncated: false });
    const stopped = runner.start({ cwd: '/w', command: 'npm run lint' });
    stopped.stop();
    expect(await stopped.done).toEqual({ exitCode: null, stopped: true });
  });
});
