/**
 * `workspace-files-node`'s project search (8.8): a word in a tracked file
 * and not in an ignored one, nested `.gitignore` with `!`, the match cap,
 * File names, Regex, a catastrophic pattern that answers at the deadline
 * while the event loop stays free, environment files searched masked only,
 * every refused path (`.git`, `*.git`, credential folders, hard links,
 * links out, a symlinked folder, a name no client can ask for), big and
 * binary files skipped, the files-looked-at cap, abort, and at most two
 * searches at once. Every result is one the port's own `read` opens.
 */
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { clampSearchFiles, type WorkspaceFilesPort, type WorkspaceSearchPortQuery } from '@ogden-agents/core';
import { REDACTED_SECRET, WORKSPACE_SEARCH_MAX_MATCHES } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceFilesNode, type WorkspaceFilesNodeOptions } from '../src/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function setup(files: Record<string, string | Buffer> = {}, options: Pick<WorkspaceFilesNodeOptions, 'searchLimits'> = {}) {
  const root = tempDir('ogden-search-project-');
  const home = tempDir('ogden-search-home-');
  const dataDir = tempDir('ogden-search-data-');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const port = createWorkspaceFilesNode({ home, dataDir, ...options }) as Required<WorkspaceFilesPort>;
  const search = (query: Partial<WorkspaceSearchPortQuery> & { q: string }) => port.search(root, { mode: 'text', matchCase: false, regex: false, ...query });
  return { root, home, dataDir, port, search };
}

function tryLink(target: string, at: string, folder: boolean): boolean {
  mkdirSync(dirname(at), { recursive: true });
  try {
    symlinkSync(target, at, folder && process.platform === 'win32' ? 'junction' : folder ? 'dir' : 'file');
    return true;
  } catch {
    return false;
  }
}

const paths = (result: { files: Array<{ path: string }> }) => result.files.map((file) => file.path);

/** Every result is a file the port's own `read` opens as text (or, for names, `locate` finds). */
async function expectAllReadable(port: Required<WorkspaceFilesPort>, root: string, result: { files: Array<{ path: string }> }) {
  for (const { path } of result.files) expect('refused' in (await port.locate(root, path)), path).toBe(false);
}

describe('workspace-files-node search', () => {
  it('finds a word in a tracked file with line, column and preview, never in an ignored folder', async () => {
    const { search, port, root } = setup({
      '.gitignore': 'dist/\n',
      'src/a.ts': 'one\ntwo\n  const needle = 1;\n',
      'dist/a.js': 'needle\n',
    });
    const result = await search({ q: 'needle' });
    expect(result).toEqual({ files: [{ path: 'src/a.ts', matches: [{ line: 3, column: 9, preview: '  const needle = 1;' }] }], truncated: false });
    await expectAllReadable(port, root, result);
  });

  it('honours a nested .gitignore with negation, in both modes', async () => {
    const { search } = setup({ 'sub/.gitignore': '*.log\n!keep.log\n', 'sub/x.log': 'needle\n', 'sub/keep.log': 'needle\n', 'top.log': 'needle\n' });
    expect(paths(await search({ q: 'needle' }))).toEqual(['top.log', 'sub/keep.log']);
    expect(paths(await search({ q: '.log', mode: 'names' }))).toEqual(['top.log', 'sub/keep.log']);
  });

  it('stops past the match cap, truncated, and the clamp holds it to 500', async () => {
    const { search } = setup({ 'a.txt': Array.from({ length: 600 }, (_, i) => `needle ${i}`).join('\n') });
    const result = await search({ q: 'needle' });
    expect(result.truncated).toBe(true);
    const clamped = clampSearchFiles(result.files);
    expect(clamped.files[0]!.matches).toHaveLength(WORKSPACE_SEARCH_MAX_MATCHES);
    expect(clamped.files[0]!.matches.at(-1)).toEqual({ line: 500, column: 1, preview: 'needle 499' });
  });

  it('File names matches the whole relative path, case folded unless Match case', async () => {
    const { search } = setup({ 'src/a.ts': 'x', 'src/b.ts': 'x', 'A.TS.md': 'x' });
    expect(await search({ q: 'a.ts', mode: 'names' })).toEqual({ files: [{ path: 'A.TS.md', matches: [] }, { path: 'src/a.ts', matches: [] }], truncated: false });
    expect(paths(await search({ q: 'a.ts', mode: 'names', matchCase: true }))).toEqual(['src/a.ts']);
    expect(paths(await search({ q: 'src/', mode: 'names' }))).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('a literal is matched as written; Regex runs a pattern, in both modes; Match case holds', async () => {
    const { search } = setup({ 'math.ts': 'export function add(b: number) {\n  return add(1);\n}\n', 'other.ts': 'a.b(c)\nAdd(x\n' });
    expect(paths(await search({ q: 'a.b(c)' }))).toEqual(['other.ts']);
    const found = await search({ q: 'add\\(\\w+', regex: true });
    expect(found.files).toEqual([
      { path: 'math.ts', matches: [{ line: 1, column: 17, preview: 'export function add(b: number) {' }, { line: 2, column: 10, preview: '  return add(1);' }] },
      { path: 'other.ts', matches: [{ line: 2, column: 1, preview: 'Add(x' }] },
    ]);
    expect(paths(await search({ q: 'add\\(\\w+', regex: true, matchCase: true }))).toEqual(['math.ts']);
    expect(paths(await search({ q: '^m.*\\.ts$', regex: true, mode: 'names' }))).toEqual(['math.ts']);
  });

  it('counts the column in UTF-16 units of the whole line, and cuts a long line around the match', async () => {
    const { search } = setup({ 'u.txt': '😀é needle\n', 'long.txt': `${'x'.repeat(1000)}needle${'y'.repeat(1000)}\n` });
    const result = await search({ q: 'needle' });
    expect(result.files.find((file) => file.path === 'u.txt')!.matches[0]!.column).toBe(5);
    const long = result.files.find((file) => file.path === 'long.txt')!.matches[0]!;
    expect(long.column).toBe(1001);
    expect(long.preview).toHaveLength(240);
    expect(long.preview).toContain('needle');
  });

  it('a catastrophic Regex answers at the deadline, truncated, while the event loop stays free', { timeout: 20_000 }, async () => {
    const { search } = setup({ 'a.txt': `${'a'.repeat(40)}!\n` }, { searchLimits: { timeoutMs: 1_500 } });
    let longestGap = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last);
      last = now;
    }, 20);
    const started = performance.now();
    try {
      const result = await search({ q: '(a+)+$', regex: true });
      expect(result).toEqual({ files: [], truncated: true });
    } finally {
      clearInterval(ticker);
    }
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(1_400);
    expect(took).toBeLessThan(8_000);
    // The main thread never ran the pattern.
    expect(longestGap).toBeLessThan(1_000);
  });

  it('searches an environment file in its masked text only: a secret never matches or shows', async () => {
    const { search } = setup({ '.env': 'API_KEY=sk-live-123\n', 'config/app.env': 'TOKEN=sk-live-456\n' });
    expect(await search({ q: 'sk-live' })).toEqual({ files: [], truncated: false });
    expect(await search({ q: 'sk-live', regex: true })).toEqual({ files: [], truncated: false });
    const named = await search({ q: 'API_KEY' });
    expect(named.files).toEqual([{ path: '.env', matches: [{ line: 1, column: 1, preview: `API_KEY=${REDACTED_SECRET}` }] }]);
  });

  it('never answers a refused path: .git, *.git, credential folders, hard links, links out, a symlinked folder, an unaskable name', async () => {
    const outside = tempDir('ogden-search-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'needle\n');
    mkdirSync(join(outside, 'folder'));
    writeFileSync(join(outside, 'folder', 'x.txt'), 'needle\n');
    const { search, port, root } = setup({
      '.git/config': 'needle\n',
      'bare.git/x': 'needle\n',
      '.ssh/id': 'needle\n',
      'nested/.aws/credentials': 'needle\n',
      'src/a.ts': 'needle\n',
      'node_modules/pkg/index.js': 'needle\n',
    });
    linkSync(join(root, 'src', 'a.ts'), join(root, 'hard.ts'));
    const links = [tryLink(join(outside, 'secret.txt'), join(root, 'out.txt'), false), tryLink(join(outside, 'folder'), join(root, 'outdir'), true), tryLink(join(root, 'node_modules'), join(root, 'linked'), true)];
    let unaskable = false;
    if (process.platform !== 'win32') {
      writeFileSync(join(root, 'we:ird.txt'), 'needle\n');
      unaskable = true;
    }
    const result = await search({ q: 'needle' });
    // `src/a.ts` has a second name (`hard.ts`), so both are hard links: refused. Only the node_modules copy is left.
    expect(paths(result)).toEqual(['node_modules/pkg/index.js']);
    const names = await search({ q: '', mode: 'names', regex: true });
    for (const path of paths(names)) expect(path).not.toMatch(/(^|\/)(\.git|bare\.git|\.ssh|\.aws|hard\.ts|out\.txt|outdir|linked)(\/|$)|we:ird/);
    expect(paths(names)).toContain('node_modules/pkg/index.js');
    await expectAllReadable(port, root, result);
    await expectAllReadable(port, root, names);
    expect(links.length + Number(unaskable)).toBeGreaterThan(0);
  });

  it('skips a file over 1 MB and a binary one', async () => {
    const { search } = setup({ 'big.txt': `needle\n${'x'.repeat(2 * 1024 * 1024)}`, 'logo.png': Buffer.from('\u0089PNG\u0000\u0000needle', 'latin1'), 'ok.txt': 'needle' });
    expect(paths(await search({ q: 'needle' }))).toEqual(['ok.txt']);
  });

  it('stops at the files-looked-at cap, truncated', async () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`f${i}.txt`, 'needle']));
    const { search } = setup(files, { searchLimits: { maxFiles: 3 } });
    const result = await search({ q: 'needle' });
    expect(result).toEqual({ files: [{ path: 'f0.txt', matches: [{ line: 1, column: 1, preview: 'needle' }] }, { path: 'f1.txt', matches: [{ line: 1, column: 1, preview: 'needle' }] }, { path: 'f2.txt', matches: [{ line: 1, column: 1, preview: 'needle' }] }], truncated: true });
    const names = await search({ q: 'f', mode: 'names' });
    expect(names.files).toHaveLength(3);
    expect(names.truncated).toBe(true);
  });

  it('is truncated when the files cap cuts the last batch short (5 files, cap 3), in both modes', async () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}.txt`, 'needle']));
    const { search } = setup(files, { searchLimits: { maxFiles: 3 } });
    const text = await search({ q: 'needle' });
    expect(paths(text)).toEqual(['f0.txt', 'f1.txt', 'f2.txt']);
    expect(text.truncated).toBe(true);
    expect((await search({ q: 'f', mode: 'names' })).truncated).toBe(true);
  });

  it('File names counts the cap after locate: an allowed match after a refused one in the same batch still counts', async () => {
    const files: Record<string, string> = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`a/m${String(i).padStart(3, '0')}.txt`, 'x']));
    files['b/m0.txt'] = 'x';
    files['b/m1.txt'] = 'x';
    const { search, root } = setup(files);
    // `b/m0.txt` gets a second name, so it is a refused hard link; `b/m1.txt` after it is the 501st allowed match.
    linkSync(join(root, 'b', 'm0.txt'), join(root, 'other.bin'));
    const result = await search({ q: 'm', mode: 'names' });
    expect(paths(result)).not.toContain('b/m0.txt');
    expect(paths(result).at(-1)).toBe('b/m1.txt');
    expect(result.files).toHaveLength(501);
    expect(result.truncated).toBe(true);
  });

  it('numbers lines as the viewer does: one trailing line ending starts no new line', async () => {
    const { search } = setup({ 'a.txt': 'x\n', 'b.txt': 'x\n\n', 'c.txt': 'x\r\n' });
    const result = await search({ q: '^$', regex: true });
    expect(result.files).toEqual([{ path: 'b.txt', matches: [{ line: 2, column: 1, preview: '' }] }]);
  });

  it('stops when the client goes away: an aborted search answers at once, a running Regex is terminated', { timeout: 20_000 }, async () => {
    const { search } = setup({ 'a.txt': `${'a'.repeat(40)}!\n` });
    const gone = new AbortController();
    gone.abort();
    expect(await search({ q: 'a', signal: gone.signal })).toEqual({ files: [], truncated: true });
    const leaving = new AbortController();
    const started = performance.now();
    setTimeout(() => leaving.abort(), 300);
    expect(await search({ q: '(a+)+$', regex: true, signal: leaving.signal })).toEqual({ files: [], truncated: true });
    // Well before the 5 s deadline.
    expect(performance.now() - started).toBeLessThan(4_000);
  });

  it('runs at most two searches at once; the third waits its turn', { timeout: 30_000 }, async () => {
    const limit = 800;
    const { search } = setup({ 'a.txt': `${'a'.repeat(40)}!\n` }, { searchLimits: { timeoutMs: limit } });
    const started = performance.now();
    const took = await Promise.all([0, 1, 2].map(async () => {
      await search({ q: '(a+)+$', regex: true });
      return performance.now() - started;
    }));
    const sorted = [...took].sort((a, b) => a - b);
    // The third started only once one of the first two had stopped at its deadline.
    expect(sorted[2]!).toBeGreaterThanOrEqual(2 * limit - 50);
  });

  it('answers nothing for a missing root, and nothing for a chat worktree outside the data folder', async () => {
    const { port, root } = setup({ 'a.txt': 'needle' });
    const query = { q: 'needle', mode: 'text' as const, matchCase: false, regex: false };
    expect(await port.search(join(root, 'missing'), query)).toEqual({ files: [], truncated: false });
    expect(await port.search(root, query, 'chat_worktree')).toEqual({ files: [], truncated: false });
  });
});
