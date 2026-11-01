/**
 * `workspace-files-node` project search (8.8), security review rows.
 *
 * (1) No result from a refused path or from outside the root, in Text,
 * Regex and File names modes. (2) No environment file value unmasked, in a
 * match, a preview or a column. (3) No hang, event-loop block or memory
 * blow-up from a pattern, a `.gitignore`, a tree's shape, concurrency,
 * aborts or the regex worker dying.
 *
 * The rows for issues found in review (backtick and escaped-quote values,
 * editor backups, a crafted comment line, `.gitignore` size and shape)
 * failed before the review fixes; every row is kept as a regression row.
 */
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkspaceFilesPort, WorkspaceSearchPortQuery, WorkspaceSearchPortResult } from '@ogden-agents/core';
import { REDACTED_SECRET } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceFilesNode, type WorkspaceFilesNodeOptions } from '../src/index.js';
import { parseGitignore } from '../src/workspace-files-node/gitignore.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

type Options = Omit<WorkspaceFilesNodeOptions, 'home' | 'dataDir'> & { home?: string; dataDir?: string; root?: string };

function setup(files: Record<string, string | Buffer> = {}, options: Options = {}) {
  const root = options.root ?? tempDir('ogden-sec-project-');
  const home = options.home ?? tempDir('ogden-sec-home-');
  const dataDir = options.dataDir ?? tempDir('ogden-sec-data-');
  writeTree(root, files);
  const { root: _root, home: _home, dataDir: _data, ...rest } = options;
  const port = createWorkspaceFilesNode({ home, dataDir, ...rest }) as Required<WorkspaceFilesPort>;
  const search = (query: Partial<WorkspaceSearchPortQuery> & { q: string }) => port.search(root, { mode: 'text', matchCase: false, regex: false, ...query });
  return { root, home, dataDir, port, search };
}

function link(target: string, at: string, folder = false): void {
  mkdirSync(dirname(at), { recursive: true });
  symlinkSync(target, at, folder ? 'dir' : 'file');
}

const paths = (result: { files: Array<{ path: string }> }) => result.files.map((file) => file.path);
const everything = (result: WorkspaceSearchPortResult) => JSON.stringify(result);

/** Every way of asking for everything: Text (literal and Regex) and File names (literal and Regex). */
async function searchEverything(search: ReturnType<typeof setup>['search'], word: string) {
  return {
    text: await search({ q: word }),
    textRegex: await search({ q: '[\\s\\S]', regex: true }),
    names: await search({ q: '/', mode: 'names' }),
    namesRegex: await search({ q: '', mode: 'names', regex: true }),
  };
}

/** Runs `run` while a 20 ms ticker measures the longest the event loop went without a turn. */
async function withLoopWatch<T>(run: () => Promise<T>): Promise<{ value: T; longestGap: number; took: number }> {
  let longestGap = 0;
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - last);
    last = now;
  }, 20);
  const started = performance.now();
  try {
    const value = await run();
    // One more turn, so a block at the very end is measured too.
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { value, longestGap, took: performance.now() - started };
  } finally {
    clearInterval(ticker);
  }
}

describe('search security (1): refused paths and the project boundary', () => {
  it('never answers .git internals, a folder ending .git, any case or trailing-dot variant, or a .git pointer file, in any mode', async () => {
    const { search } = setup({
      '.git/config': 'needle\n',
      '.git/objects/ab/cdef': 'needle\n',
      'sub/.git': 'gitdir: ../.git/worktrees/sub\nneedle\n',
      'mirror.git/HEAD': 'needle\n',
      'Mirror.GIT/refs': 'needle\n',
      'deep/x/backup.git./config': 'needle\n',
      'ok.txt': 'needle\n',
    });
    const all = await searchEverything(search, 'needle');
    for (const result of Object.values(all)) {
      for (const path of paths(result)) expect(path).not.toMatch(/\.git\.?(\/|$)/i);
    }
    expect(paths(all.text)).toEqual(['ok.txt']);
    expect(paths(all.names)).toEqual([]);
    expect(paths(all.namesRegex)).toEqual(['ok.txt']);
  });

  it('never answers a credential folder when the project is the home folder, and a project below it keeps its own .claude readable', async () => {
    const home = tempDir('ogden-sec-homeproject-');
    const { search } = setup(
      {
        '.ssh/id_ed25519': 'needle\n',
        '.aws/credentials': 'needle\n',
        '.config/gh/hosts.yml': 'needle\n',
        '.docker/config.json': 'needle\n',
        '.netrc': 'needle\n',
        'Library/Keychains/login.db': 'needle\n',
        'nested/.gnupg/key': 'needle\n',
        '.claude/CLAUDE.md': 'needle\n',
      },
      { root: home, home },
    );
    const all = await searchEverything(search, 'needle');
    // The home's own `.claude` is a credential fence too (only a project's `.claude` is readable).
    for (const result of Object.values(all)) expect(paths(result)).toEqual([]);
    // A project below the home keeps its own `.claude` readable.
    const project = join(home, 'code', 'app');
    writeTree(project, { '.claude/CLAUDE.md': 'needle\n', '.ssh/id': 'needle\n' });
    const port = createWorkspaceFilesNode({ home, dataDir: tempDir('ogden-sec-data-') }) as Required<WorkspaceFilesPort>;
    expect(paths(await port.search(project, { q: 'needle', mode: 'text', matchCase: false, regex: false }))).toEqual(['.claude/CLAUDE.md']);
  });

  it('never answers the data folder when it lies inside the project, nor a link into it', async () => {
    const root = tempDir('ogden-sec-project-');
    const dataDir = join(root, 'ogden-data');
    mkdirSync(dataDir);
    const { search } = setup({ 'ogden-data/ogden.db': 'needle\n', 'ogden-data/logs/x.log': 'needle\n', 'ok.txt': 'needle\n' }, { root, dataDir });
    link(join(dataDir, 'ogden.db'), join(root, 'db-link.txt'));
    link(join(dataDir, 'logs'), join(root, 'logs-link'), true);
    const all = await searchEverything(search, 'needle');
    for (const result of Object.values(all)) expect(paths(result).filter((path) => path !== 'ok.txt')).toEqual([]);
  });

  it('never answers a hard-linked file outside node_modules, in any mode; one under node_modules is searched', async () => {
    const outside = tempDir('ogden-sec-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'needle OUTSIDE_SECRET\n');
    const { search, root } = setup({ 'node_modules/pkg/a.js': 'needle\n' });
    try {
      linkSync(join(outside, 'secret.txt'), join(root, 'hard.txt'));
    } catch {
      return; // Different volumes: no hard link to make.
    }
    linkSync(join(root, 'node_modules/pkg/a.js'), join(root, 'node_modules/pkg/b.js'));
    const all = await searchEverything(search, 'needle');
    for (const result of Object.values(all)) {
      expect(paths(result)).not.toContain('hard.txt');
      expect(everything(result)).not.toContain('OUTSIDE_SECRET');
    }
    expect(paths(all.text)).toEqual(['node_modules/pkg/a.js', 'node_modules/pkg/b.js']);
  });

  it('never answers through a link out of the root (file, folder, relative ..), into .git, or into a home credential folder; a link inside reads its target', async () => {
    const outside = tempDir('ogden-sec-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'needle OUTSIDE_SECRET\n');
    mkdirSync(join(outside, 'folder'));
    writeFileSync(join(outside, 'folder', 'x.txt'), 'needle OUTSIDE_SECRET\n');
    const { search, root, home } = setup({ '.git/config': 'needle GIT_SECRET\n', 'src/real.txt': 'needle inside\n' });
    writeTree(home, { '.ssh/id_rsa': 'needle HOME_SECRET\n' });
    link(join(outside, 'secret.txt'), join(root, 'abs-out.txt'));
    link(join(outside, 'folder'), join(root, 'dir-out'), true);
    // A relative link that climbs out with `..`.
    const rel = join('..', ...outside.split('/').slice(-1), 'secret.txt');
    link(rel, join(root, 'rel-out.txt'));
    link(join(root, '.git', 'config'), join(root, 'git-config.txt'));
    link(join(root, '.git'), join(root, 'gitdir'), true);
    link(join(home, '.ssh', 'id_rsa'), join(root, 'key.txt'));
    link(join(root, 'src', 'real.txt'), join(root, 'alias.txt'));
    link(join(root, 'src'), join(root, 'src-alias'), true);
    link(join(root, 'loop.txt'), join(root, 'loop.txt'));
    const all = await searchEverything(search, 'needle');
    for (const result of Object.values(all)) {
      const text = everything(result);
      for (const secret of ['OUTSIDE_SECRET', 'GIT_SECRET', 'HOME_SECRET']) expect(text).not.toContain(secret);
      for (const path of paths(result)) expect(path).not.toMatch(/^(abs-out\.txt|dir-out|rel-out\.txt|git-config\.txt|gitdir|key\.txt|loop\.txt)(\/|$)/);
      // A folder link is never entered.
      for (const path of paths(result)) expect(path.startsWith('src-alias/')).toBe(false);
    }
    expect(paths(all.text)).toEqual(['alias.txt', 'src/real.txt']);
  });

  it('never answers a file swapped for a link out after its path was checked', async () => {
    const outside = tempDir('ogden-sec-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'needle OUTSIDE_SECRET\n');
    let swapped = 0;
    const { search } = setup(
      { 'a.txt': 'needle inside\n' },
      {
        afterCheck: (real) => {
          if (!real.endsWith('a.txt')) return;
          unlinkSync(real);
          symlinkSync(join(outside, 'secret.txt'), real);
          swapped++;
        },
      },
    );
    const result = await search({ q: 'needle' });
    expect(swapped).toBe(1);
    expect(everything(result)).not.toContain('OUTSIDE_SECRET');
    expect(result.files).toEqual([]);
  });

  it('never answers a file swapped for another regular file (a renamed-in outside copy) after the check', async () => {
    const outside = tempDir('ogden-sec-outside-');
    const { search, root } = setup(
      { 'a.txt': 'needle inside\n' },
      {
        afterCheck: (real) => {
          if (!real.endsWith('a.txt')) return;
          writeFileSync(join(root, 'swap.tmp'), 'needle SWAPPED_SECRET\n');
          renameSync(join(root, 'swap.tmp'), real);
        },
      },
    );
    void outside;
    const result = await search({ q: 'needle' });
    expect(everything(result)).not.toContain('SWAPPED_SECRET');
  });

  it('never answers a name a client could not ask for back (`:` or `\\` in it), in any mode', async () => {
    if (process.platform === 'win32') return;
    const { search } = setup({ 'we:ird.txt': 'needle\n', 'back\\slash.txt': 'needle\n', 'dir:x/inner.txt': 'needle\n', 'ok.txt': 'needle\n' });
    const all = await searchEverything(search, 'needle');
    for (const result of Object.values(all)) expect(paths(result).filter((path) => path !== 'ok.txt')).toEqual([]);
  });

  it('answers nothing for a chat worktree root that is the data folder itself or outside it', async () => {
    const { port, root, dataDir } = setup({ 'a.txt': 'needle\n' });
    writeTree(dataDir, { 'b.txt': 'needle\n' });
    const query = { q: 'needle', mode: 'text' as const, matchCase: false, regex: false };
    expect(await port.search(dataDir, query, 'chat_worktree')).toEqual({ files: [], truncated: false });
    expect(await port.search(root, query, 'chat_worktree')).toEqual({ files: [], truncated: false });
    // As a plain project, the data folder is fenced whole.
    expect((await port.search(dataDir, query)).files).toEqual([]);
  });
});

describe('search security (2): environment files masked', () => {
  const SECRET = 'S3CR3T-VALUE-77';
  const envNames = ['.env', '.env.local', '.ENV.Production', '.envrc', 'prod.env', 'config/app.env', '.flaskenv', '.env.example'];

  it('never matches or shows a value from any environment file name, in Text, Regex or names mode', async () => {
    const files = Object.fromEntries(envNames.map((name) => [name, `# ${SECRET}\nKEY=${SECRET}\nexport OTHER="${SECRET}"\n${SECRET}\n`]));
    const { search } = setup(files);
    for (const q of [SECRET, 'S3CR3T', 'VALUE-77']) {
      expect((await search({ q })).files).toEqual([]);
      expect((await search({ q, regex: true })).files).toEqual([]);
    }
    for (const q of ['S3CR3T', '=\\S', '=(?!\\[redacted\\])', '(?<=KEY=).', '[0-9]{2}$', '.+']) {
      const result = await search({ q, regex: true });
      expect(everything(result), q).not.toContain('S3CR3T');
    }
    const names = await search({ q: 'env', mode: 'names' });
    expect(names.files.every((file) => file.matches.length === 0)).toBe(true);
  });

  it('points a Regex column into the masked text only, and its preview is that masked line', async () => {
    const { search } = setup({ '.env': `KEY=${SECRET}\n` });
    const result = await search({ q: '=.', regex: true });
    expect(result.files).toEqual([{ path: '.env', matches: [{ line: 1, column: 4, preview: `KEY=${REDACTED_SECRET}` }] }]);
  });

  it('masks every line of a double-quoted value left open across lines, even ones that look like assignments', async () => {
    const { search } = setup({ '.env': `KEY="-----BEGIN KEY-----\nTOKENPART=${SECRET}\nc2VjcmV0dG9rZW4=\n-----END KEY-----"\nAFTER=x\n` });
    for (const q of ['TOKENPART', 'c2VjcmV0', SECRET, 'BEGIN', 'END KEY']) expect((await search({ q })).files, q).toEqual([]);
    expect(paths(await search({ q: 'AFTER' }))).toEqual(['.env']);
  });

  it('masks a lone carriage return line split (the viewer splits on \\r, the masker does not)', async () => {
    const { search } = setup({ '.env': `A=x\rB=${SECRET}\n# note\rKEY=${SECRET}\n` });
    const result = await search({ q: '[\\s\\S]', regex: true });
    expect(everything(result)).not.toContain(SECRET);
  });

  it('masks a link to an environment file by its target name, and a link named .env by its own name', async () => {
    const { search, root } = setup({ '.env': `KEY=${SECRET}\n`, 'plain.txt': `KEY=${SECRET}\n` });
    link(join(root, '.env'), join(root, 'innocent.txt'));
    link(join(root, 'plain.txt'), join(root, 'config', '.env'));
    const result = await search({ q: 'KEY' });
    const byPath = Object.fromEntries(result.files.map((file) => [file.path, file.matches[0]!.preview]));
    expect(byPath['innocent.txt']).toBe(`KEY=${REDACTED_SECRET}`);
    expect(byPath['config/.env']).toBe(`KEY=${REDACTED_SECRET}`);
  });

  // FINDING: a backtick-quoted multi-line value (dotenv supports `KEY=\`...\``) is not known to the masker:
  // each continuation line is classified on its own, so a line shaped `NAME=` (a base64 line ending in `=`)
  // keeps its whole text as the "name".
  it('masks every line of a backtick-quoted multi-line value', async () => {
    const { search } = setup({ '.env': 'PRIVATE_KEY=`-----BEGIN KEY-----\nc2VjcmV0dG9rZW4=\nMIIBc2VjcmV0=abc\n-----END KEY-----`\n' });
    const result = await search({ q: 'c2VjcmV0' });
    expect(everything(result)).not.toContain('c2VjcmV0');
  });

  // FINDING: dotenv treats `\'` inside a single-quoted value as an escape, so `KEY='it\'s` stays open; the
  // masker (`closes` uses a bare `includes("'")`) thinks it is closed, and the next line is read as `NAME=`.
  it("masks a single-quoted value kept open by an escaped quote", async () => {
    const { search } = setup({ '.env': "PASSWORD='it\\'s\nhunter2secret=\n'\n" });
    const result = await search({ q: 'hunter2' });
    expect(everything(result)).not.toContain('hunter2secret');
  });

  // FINDING (beyond the stated `.env`, `.env.*`, `.envrc`, `*.env` set): an editor backup `.env~` (and
  // `.env#`, `.envrc.local`) is not an environment file name, so it is searched and previewed unmasked.
  it('masks an editor backup of an environment file (.env~)', async () => {
    const { search } = setup({ '.env~': `KEY=${SECRET}\n`, '.envrc.local': `KEY=${SECRET}\n` });
    expect(everything(await search({ q: SECRET }))).not.toContain(SECRET);
  });
});

describe('search security (3): hangs, event-loop blocks and memory', () => {
  it('a catastrophic Regex on a 1 MB line is stopped at the deadline, the event loop free', { timeout: 30_000 }, async () => {
    const { search } = setup({ 'a.txt': `${'a'.repeat(1024 * 1024 - 2)}!` }, { searchLimits: { timeoutMs: 1_000 } });
    const { value, longestGap, took } = await withLoopWatch(() => search({ q: '(a|aa)+$', regex: true }));
    expect(value).toEqual({ files: [], truncated: true });
    expect(took).toBeLessThan(10_000);
    expect(longestGap).toBeLessThan(1_500);
  });

  it('a Regex that kills its worker (stack overflow) answers truncated, and the next search still works', { timeout: 30_000 }, async () => {
    const { search } = setup({ 'a.txt': `${'ab'.repeat(500_000)}\n`, 'b.txt': 'needle\n' });
    const dead = await search({ q: '(a|b)*c', regex: true });
    expect(dead.truncated).toBe(true);
    expect(paths(await search({ q: 'needle' }))).toEqual(['b.txt']);
    expect(paths(await search({ q: 'need.e', regex: true }))).toEqual(['b.txt']);
  });

  it('a worst-case literal (199 a then b) over 1 MB lines stays fast on the main thread', { timeout: 30_000 }, async () => {
    const files = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}.txt`, 'a'.repeat(1024 * 1024 - 1)]));
    const { search } = setup(files);
    const { value, longestGap } = await withLoopWatch(() => search({ q: `${'a'.repeat(199)}b` }));
    expect(value.files).toEqual([]);
    expect(longestGap).toBeLessThan(1_500);
  });

  it('a FIFO, and a link to one, never block the walk', { timeout: 30_000 }, async () => {
    if (process.platform === 'win32') return;
    const { search, root } = setup({ 'ok.txt': 'needle\n' });
    execFileSync('mkfifo', [join(root, 'pipe.txt')]);
    link(join(root, 'pipe.txt'), join(root, 'pipe-link.txt'));
    const { value, took } = await withLoopWatch(() => search({ q: 'needle' }));
    expect(paths(value)).toEqual(['ok.txt']);
    expect(took).toBeLessThan(5_000);
    expect(paths(await search({ q: 'pipe', mode: 'names' }))).toEqual([]);
  });

  it('many queued searches that are aborted leave the queue, and a fresh search runs at once', { timeout: 30_000 }, async () => {
    const { search } = setup({ 'a.txt': `${'a'.repeat(40)}!\n`, 'b.txt': 'needle\n' }, { searchLimits: { timeoutMs: 20_000 } });
    const controllers = Array.from({ length: 40 }, () => new AbortController());
    const pending = controllers.map((controller) => search({ q: '(a+)+$', regex: true, signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    for (const controller of controllers) controller.abort();
    const results = await Promise.all(pending);
    expect(results.every((result) => result.truncated)).toBe(true);
    const started = performance.now();
    expect(paths(await search({ q: 'needle' }))).toEqual(['b.txt']);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('a deep tree with a .gitignore at every level, and many empty folders, answer within the deadline', { timeout: 60_000 }, async () => {
    const { search, root } = setup({}, { searchLimits: { timeoutMs: 3_000 } });
    let deep = root;
    for (let depth = 0; depth < 120; depth++) {
      deep = join(deep, 'd');
      mkdirSync(deep);
      writeFileSync(join(deep, '.gitignore'), '*.log\n!keep.log\nbuild/\n**/tmp/**\n');
    }
    writeFileSync(join(deep, 'needle.txt'), 'needle\n');
    for (let i = 0; i < 3_000; i++) mkdirSync(join(root, 'wide', String(i)), { recursive: true });
    const { value, longestGap, took } = await withLoopWatch(() => search({ q: 'needle' }));
    expect(took).toBeLessThan(15_000);
    expect(longestGap).toBeLessThan(1_500);
    expect(value.files.length + Number(value.truncated)).toBeGreaterThan(0);
  });

  it('a .gitignore of many-star patterns against long names stays linear', { timeout: 30_000 }, async () => {
    const star = `${'*a'.repeat(400)}*b`;
    const files: Record<string, string> = { '.gitignore': `${Array.from({ length: 50 }, () => star).join('\n')}\n**/${star}/**\n` };
    for (let i = 0; i < 200; i++) files[`${'a'.repeat(200)}${i}.txt`] = 'needle\n';
    const { search } = setup(files);
    const { value, longestGap } = await withLoopWatch(() => search({ q: 'needle' }));
    expect(value.files).toHaveLength(200);
    expect(longestGap).toBeLessThan(1_500);
  });

  it('a .gitignore over 1 MB is left unread', async () => {
    const { search } = setup({ '.gitignore': `x.txt\n${'#'.repeat(1024 * 1024)}\n`, 'x.txt': 'needle\n' });
    expect(paths(await search({ q: 'needle' }))).toEqual(['x.txt']);
  });

  // FINDING: `maskEnvironmentText`'s COMMENT regex `^(\s*#+\s*)(.*)$` backtracks quadratically on a line of many
  // `#` followed by a character `.` can't match (`\r`). It runs on the main thread inside `read`, which every
  // Text search calls on each environment file (and which the file viewer calls too); the deadline can't interrupt it.
  it('an environment file of `#`s and a lone \\r does not block the event loop', { timeout: 120_000 }, async () => {
    const { search } = setup({ '.env': `${'#'.repeat(120_000)}a\rb\n` }, { searchLimits: { timeoutMs: 500 } });
    const { longestGap } = await withLoopWatch(() => search({ q: 'zzz' }));
    expect(longestGap).toBeLessThan(2_000);
  });

  // FINDING: `parseGitignoreLine` strips a trailing `/` run with `line.replace(/\/+$/, '')`, which is quadratic
  // on a long run of `/` followed by another character and a final `/`. A `.gitignore` written into the
  // project (up to 1 MB) blocks the main thread while it parses; the deadline can't interrupt it.
  it('a .gitignore line of many `/` does not block the event loop', { timeout: 120_000 }, async () => {
    const { search } = setup({ '.gitignore': `${'/'.repeat(120_000)}x/\n`, 'a.txt': 'needle\n' }, { searchLimits: { timeoutMs: 500 } });
    const { longestGap } = await withLoopWatch(() => search({ q: 'needle' }));
    expect(longestGap).toBeLessThan(2_000);
  });

  // FINDING: every entry of a folder is tested against every rule of every `.gitignore` above it in one
  // synchronous loop. A large `.gitignore` (100,000 short rules, under 1 MB) and a folder of
  // three thousand files block the main thread for seconds; the deadline can't interrupt it.
  it('a .gitignore of many rules and a folder of many files do not block the event loop', { timeout: 180_000 }, async () => {
    const rules = Array.from({ length: 100_000 }, (_, i) => `x${i}*y`).join('\n');
    const files: Record<string, string> = { '.gitignore': `${rules}\n` };
    for (let i = 0; i < 3_000; i++) files[`file${i}.txt`] = 'needle\n';
    const { search } = setup(files, { searchLimits: { timeoutMs: 500 } });
    const { longestGap } = await withLoopWatch(() => search({ q: 'needle' }));
    expect(longestGap).toBeLessThan(2_000);
  });

  // FINDING: a parsed `.gitignore` keeps one token object per character (and `Array.from` of the text):
  // a 1 MB rule costs ~90 MB of heap. Each folder's levels stay alive while its children wait in the
  // breadth-first queue, so N sibling folders each with a 1 MB `.gitignore` and a subfolder hold N times that.
  it('a 1 MB .gitignore parses into a bounded amount of memory (under 32 MB)', () => {
    const before = process.memoryUsage().heapUsed;
    const rules = parseGitignore('a'.repeat(1024 * 1024 - 1));
    const grown = process.memoryUsage().heapUsed - before;
    expect(rules).toHaveLength(1);
    expect(grown).toBeLessThan(32 * 1024 * 1024);
  });

  it('six sibling folders with 1 MB .gitignore files keep the search under 256 MB of extra heap', { timeout: 120_000 }, async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      files[`s${i}/.gitignore`] = `${'a'.repeat(1024 * 1024 - 1)}`;
      files[`s${i}/child/x.txt`] = 'needle\n';
    }
    const { search } = setup(files, { searchLimits: { timeoutMs: 60_000 } });
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 2);
    try {
      const result = await search({ q: 'needle' });
      peak = Math.max(peak, process.memoryUsage().heapUsed);
      expect(result.files).toHaveLength(6);
    } finally {
      clearInterval(sampler);
    }
    expect(peak - before).toBeLessThan(256 * 1024 * 1024);
  });
});
