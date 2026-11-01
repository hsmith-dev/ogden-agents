/**
 * The `workspace-files-node` adapter (Workbench Files, AD-36): lists one
 * folder (folders first, protected rows marked) and reads one file of a
 * project, read-only. Every refusal in the plan's matrix: `.git` and the
 * credential folders by name (case and trailing-dot variants), links out of
 * the project or into `.git` (chained, dangling), the home and data-folder
 * fences, a FIFO, a link swapped in after the check; plus the 1 MB cap,
 * binary detection and `.env` masking. The project's tree is unchanged.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkspaceFilesPort } from '@ogden-agents/core';
import { MAX_WORKSPACE_FILE_BYTES, REDACTED_SECRET, WorkspaceRelativePath } from '@ogden-agents/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceFilesNode, maskEnvironmentText } from '../src/index.js';

/**
 * Hooks into `node:fs/promises` (a pass-through otherwise), so a test can
 * swap a folder at the instants the adapter's own `afterCheck` hook can't
 * reach: just before its `stat` of the checked path, and just before its
 * re-`realpath` in `stillThere`.
 */
const fsHooks = vi.hoisted(() => ({ beforeStat: undefined as ((path: string) => void) | undefined, beforeRealpath: undefined as ((path: string) => void) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const stat = ((path: string, ...rest: unknown[]) => {
    fsHooks.beforeStat?.(String(path));
    return (actual.stat as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.stat;
  const realpath = ((path: string, ...rest: unknown[]) => {
    fsHooks.beforeRealpath?.(String(path));
    return (actual.realpath as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.realpath;
  return { ...actual, stat, realpath, default: { ...actual, stat, realpath } };
});
afterEach(() => {
  fsHooks.beforeStat = undefined;
  fsHooks.beforeRealpath = undefined;
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempDir(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/** A project with `files` (relative path → content), a separate home and data folder, and the adapter on them. */
function setup(files: Record<string, string | Buffer> = {}, options: { afterCheck?: (real: string) => void } = {}) {
  const root = tempDir('ogden-files-project-');
  const home = tempDir('ogden-files-home-');
  const dataDir = tempDir('ogden-files-data-');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const port: WorkspaceFilesPort = createWorkspaceFilesNode({ home, dataDir, ...(options.afterCheck === undefined ? {} : { afterCheck: options.afterCheck }) });
  return { root, home, dataDir, port };
}

/** A symlink (a junction on Windows for folders); false where this OS or account can't make one. */
function tryLink(target: string, at: string, folder: boolean): boolean {
  mkdirSync(dirname(at), { recursive: true });
  try {
    symlinkSync(target, at, folder && process.platform === 'win32' ? 'junction' : folder ? 'dir' : 'file');
    return true;
  } catch {
    return false;
  }
}

/** Every path below `dir`, with its size and mtime, to show nothing was written. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .sort()
    .map((entry) => {
      const info = statSync(join(dir, entry), { throwIfNoEntry: false });
      return `${entry}:${info?.size ?? '-'}:${info?.mtimeMs ?? '-'}`;
    });
}

const PROTECTED = { refused: 'protected' };
const NOT_FOUND = { refused: 'not_found' };

describe('workspace-files-node: listing', () => {
  it('lists the root folders first then files, names sorted, .git and credential folders marked protected', async () => {
    const { root, port } = setup({ 'src/a.ts': 'x', 'b.md': 'b', 'A.txt': 'a', '.git/config': '[core]', '.ssh/id_rsa': 'key', '.claude/settings.json': '{}', 'AGENTS.md': '#', '_bmad/x': 'y' });
    const listed = await port.list(root, '');
    expect(listed).toEqual({
      path: '',
      truncated: false,
      entries: [
        { name: '.claude', path: '.claude', kind: 'folder', protected: false },
        { name: '.git', path: '.git', kind: 'folder', protected: true },
        { name: '.ssh', path: '.ssh', kind: 'folder', protected: true },
        { name: '_bmad', path: '_bmad', kind: 'folder', protected: false },
        { name: 'src', path: 'src', kind: 'folder', protected: false },
        { name: 'A.txt', path: 'A.txt', kind: 'file', protected: false },
        { name: 'AGENTS.md', path: 'AGENTS.md', kind: 'file', protected: false },
        { name: 'b.md', path: 'b.md', kind: 'file', protected: false },
      ],
    });
  });

  it('lists a subfolder with workspace-relative paths', async () => {
    const { root, port } = setup({ 'src/a.ts': 'x', 'src/lib/b.ts': 'y' });
    expect(await port.list(root, 'src')).toEqual({
      path: 'src',
      truncated: false,
      entries: [
        { name: 'lib', path: 'src/lib', kind: 'folder', protected: false },
        { name: 'a.ts', path: 'src/a.ts', kind: 'file', protected: false },
      ],
    });
  });

  it('refuses to list .git, a credential folder, case and trailing-dot variants, and a pair like Library/Keychains', async () => {
    const { root, port } = setup({ '.git/HEAD': 'ref', '.ssh/k': 'k', 'Library/Keychains/x': 'k', '.aws/credentials': 'k' });
    for (const path of ['.git', '.GIT', '.git.', '.Git ', 'x/.git', '.ssh', '.SSH', 'Library/Keychains', 'library/keychains', '.aws']) {
      expect(await port.list(root, path), path).toEqual(PROTECTED);
    }
    // `Library` alone is not a credential folder.
    expect(await port.list(root, 'Library')).toMatchObject({ entries: [{ name: 'Keychains', protected: true }] });
  });

  it('answers not_found for a missing folder and for a file', async () => {
    const { root, port } = setup({ 'a.txt': 'a' });
    expect(await port.list(root, 'nope')).toEqual(NOT_FOUND);
    expect(await port.list(root, 'a.txt')).toEqual(NOT_FOUND);
  });

  it('answers not_found for a root that is missing or a link', async () => {
    const { root, port } = setup({ 'a.txt': 'a' });
    expect(await port.list(join(root, 'gone'), '')).toEqual(NOT_FOUND);
    const link = join(tempDir('ogden-files-link-'), 'root');
    if (!tryLink(root, link, true)) return;
    expect(await port.list(link, '')).toEqual(NOT_FOUND);
  });

  it('marks a link out of the project, into .git and into a credential folder protected; a link inside is shown as its target', async () => {
    const outside = tempDir('ogden-files-outside-');
    writeFileSync(join(outside, 'secret'), 'top secret');
    const { root, port } = setup({ '.git/config': '[core]', 'src/a.ts': 'x', '.aws/c': 'k' });
    if (!tryLink(outside, join(root, 'out'), true)) return;
    tryLink(join(root, '.git'), join(root, 'g'), true);
    tryLink(join(root, '.aws'), join(root, 'creds'), true);
    tryLink(join(root, 'src'), join(root, 'code'), true);
    tryLink(join(root, 'src', 'a.ts'), join(root, 'a-link.ts'), false);
    tryLink(join(root, 'missing'), join(root, 'dangling'), false);
    const listed = await port.list(root, '');
    expect('entries' in listed && listed.entries).toEqual(
      expect.arrayContaining([
        { name: 'out', path: 'out', kind: 'file', protected: true },
        { name: 'g', path: 'g', kind: 'file', protected: true },
        { name: 'creds', path: 'creds', kind: 'file', protected: true },
        { name: 'code', path: 'code', kind: 'folder', protected: false },
        { name: 'a-link.ts', path: 'a-link.ts', kind: 'file', protected: false },
        { name: 'dangling', path: 'dangling', kind: 'file', protected: false },
      ]),
    );
    expect(await port.list(root, 'out')).toEqual(PROTECTED);
    expect(await port.list(root, 'g')).toEqual(PROTECTED);
    expect(await port.list(root, 'code')).toMatchObject({ path: 'code', entries: [{ name: 'a.ts', path: 'code/a.ts' }] });
  });

  it('caps a folder at 5000 entries and says it is truncated', async () => {
    const { root, port } = setup();
    mkdirSync(join(root, 'many'));
    for (let index = 0; index < 5003; index++) writeFileSync(join(root, 'many', `f${index}`), '');
    const listed = await port.list(root, 'many');
    expect(listed).toMatchObject({ truncated: true });
    expect('entries' in listed && listed.entries.length).toBe(5000);
  });

  it('marks the data folder protected when it is inside the project', async () => {
    const root = tempDir('ogden-files-project-');
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'ogden.db'), 'db');
    const port = createWorkspaceFilesNode({ home: tempDir('ogden-files-home-'), dataDir: join(root, 'data') });
    expect(await port.list(root, '')).toMatchObject({ entries: [{ name: 'data', protected: true }] });
    expect(await port.list(root, 'data')).toEqual(PROTECTED);
    expect(await port.read(root, 'data/ogden.db')).toEqual(PROTECTED);
  });
});

describe('workspace-files-node: reading', () => {
  it('reads a text file with its size, unmasked', async () => {
    const { root, port } = setup({ 'src/a.ts': 'const a = 1;\nexport { a };\n' });
    expect(await port.read(root, 'src/a.ts')).toEqual({ kind: 'text', path: 'src/a.ts', content: 'const a = 1;\nexport { a };\n', size: 27, masked: false });
  });

  it('keeps AGENTS.md, CLAUDE.md, .claude and _bmad readable', async () => {
    const { root, port } = setup({ 'AGENTS.md': 'a', 'CLAUDE.md': 'c', '.claude/settings.json': '{}', '_bmad/core/config.yaml': 'k: v' });
    for (const path of ['AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '_bmad/core/config.yaml']) expect(await port.read(root, path), path).toMatchObject({ kind: 'text' });
  });

  it('answers too_large with no content over 1 MB, and reads a file exactly at the limit', async () => {
    const { root, port } = setup({ 'big.txt': Buffer.alloc(2 * 1024 * 1024, 'a'), 'edge.txt': Buffer.alloc(MAX_WORKSPACE_FILE_BYTES, 'b') });
    expect(await port.read(root, 'big.txt')).toEqual({ kind: 'too_large', path: 'big.txt', size: 2 * 1024 * 1024, limit: MAX_WORKSPACE_FILE_BYTES });
    expect(await port.read(root, 'edge.txt')).toMatchObject({ kind: 'text', size: MAX_WORKSPACE_FILE_BYTES });
  });

  it('answers binary for a NUL in the first 8 KB, text for one after it', async () => {
    const early = Buffer.concat([Buffer.from('PNG'), Buffer.from([0]), Buffer.from('rest')]);
    const late = Buffer.concat([Buffer.alloc(9000, 'a'), Buffer.from([0])]);
    const { root, port } = setup({ 'img.png': early, 'late.txt': late });
    expect(await port.read(root, 'img.png')).toEqual({ kind: 'binary', path: 'img.png', size: early.length });
    expect(await port.read(root, 'late.txt')).toMatchObject({ kind: 'text' });
  });

  it('refuses .git, credential folders and their case and trailing-dot variants without reading', async () => {
    const { root, port } = setup({ '.git/config': '[core]', '.git/HEAD': 'ref', '.ssh/id_rsa': 'key', 'sub/.git/config': 'x', '.netrc': 'machine x password y' });
    for (const path of ['.git/config', '.GIT/HEAD', '.git./HEAD', '.ssh/id_rsa', '.SSH./id_rsa', 'sub/.git/config', '.netrc']) {
      expect(await port.read(root, path), path).toEqual(PROTECTED);
    }
  });

  it('refuses a link out of the project, a link to .git, and a chain of links that ends in .git', async () => {
    const outside = tempDir('ogden-files-outside-');
    writeFileSync(join(outside, 'secret'), 'top secret');
    const { root, port } = setup({ '.git/config': '[core]' });
    if (!tryLink(join(outside, 'secret'), join(root, 'out'), false)) return;
    expect(await port.read(root, 'out')).toEqual(PROTECTED);
    tryLink(join(root, '.git'), join(root, 'g'), true);
    expect(await port.read(root, 'g/config')).toEqual(PROTECTED);
    tryLink(join(root, 'g'), join(root, 'h'), true);
    tryLink(join(root, 'h', 'config'), join(root, 'chain'), false);
    expect(await port.read(root, 'h/config')).toEqual(PROTECTED);
    expect(await port.read(root, 'chain')).toEqual(PROTECTED);
    tryLink(outside, join(root, 'outdir'), true);
    expect(await port.read(root, 'outdir/secret')).toEqual(PROTECTED);
  });

  it('reads through a link that stays inside, and answers not_found for a dangling link', async () => {
    const { root, port } = setup({ 'src/a.ts': 'inside' });
    if (!tryLink(join(root, 'src', 'a.ts'), join(root, 'alias.ts'), false)) return;
    expect(await port.read(root, 'alias.ts')).toMatchObject({ kind: 'text', path: 'alias.ts', content: 'inside' });
    tryLink(join(root, 'missing.ts'), join(root, 'dangling.ts'), false);
    expect(await port.read(root, 'dangling.ts')).toEqual(NOT_FOUND);
  });

  it('refuses a link into the home credential fences', async () => {
    const { root, home, port } = setup();
    mkdirSync(join(home, '.aws'));
    writeFileSync(join(home, '.aws', 'credentials'), 'aws_secret_access_key = x');
    if (!tryLink(join(home, '.aws', 'credentials'), join(root, 'innocent.txt'), false)) return;
    expect(await port.read(root, 'innocent.txt')).toEqual(PROTECTED);
  });

  it('refuses everything when the project is inside a home credential folder', async () => {
    const home = tempDir('ogden-files-home-');
    const root = join(home, '.config', 'project');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'a.txt'), 'a');
    const port = createWorkspaceFilesNode({ home, dataDir: tempDir('ogden-files-data-') });
    expect(await port.list(root, '')).toEqual(PROTECTED);
    expect(await port.read(root, 'a.txt')).toEqual(PROTECTED);
  });

  it('answers not_found for a missing file and a folder', async () => {
    const { root, port } = setup({ 'src/a.ts': 'x' });
    expect(await port.read(root, 'nope.ts')).toEqual(NOT_FOUND);
    expect(await port.read(root, 'src')).toEqual(NOT_FOUND);
  });

  it.skipIf(process.platform === 'win32')('never opens a FIFO', async () => {
    const { root, port } = setup();
    if (spawnSync('mkfifo', [join(root, 'pipe')]).status !== 0) return; // No mkfifo here.
    expect(await port.read(root, 'pipe')).toEqual(NOT_FOUND);
  });

  it.skipIf(process.platform === 'win32')('refuses a link swapped in after the check', async () => {
    const outside = tempDir('ogden-files-outside-');
    writeFileSync(join(outside, 'secret'), 'top secret');
    const { root, port } = setup({ 'a.txt': 'safe' }, {
      afterCheck: (real) => {
        unlinkSync(real);
        symlinkSync(join(outside, 'secret'), real);
      },
    });
    const read = await port.read(root, 'a.txt');
    expect(read).toEqual(PROTECTED);
    expect(JSON.stringify(read)).not.toContain('top secret');
  });

  it('a file swapped for another after the check is refused', async () => {
    const { root, port } = setup({ 'a.txt': 'safe', 'other.txt': 'replaced' }, {
      // Another file that exists all along, so it never shares the checked file's inode.
      afterCheck: (real) => renameSync(join(dirname(real), 'other.txt'), real),
    });
    expect(await port.read(root, 'a.txt')).toEqual(PROTECTED);
  });

  it('writes nothing', async () => {
    const { root, port } = setup({ 'src/a.ts': 'x', '.env': 'A=1', '.git/config': 'c' });
    const before = tree(root);
    await port.list(root, '');
    await port.list(root, 'src');
    await port.read(root, 'src/a.ts');
    await port.read(root, '.env');
    await port.read(root, '.git/config');
    expect(tree(root)).toEqual(before);
  });
});

describe('workspace-files-node: environment files', () => {
  it('masks every value in .env, keeps the names, and says masked', async () => {
    const raw = 'API_KEY=abc123\nexport TOKEN="quoted value"\nEMPTY=\n';
    const { root, port } = setup({ '.env': raw });
    expect(await port.read(root, '.env')).toEqual({
      kind: 'text',
      path: '.env',
      content: `API_KEY=${REDACTED_SECRET}\nexport TOKEN=${REDACTED_SECRET}\nEMPTY=\n`,
      size: Buffer.byteLength(raw),
      masked: true,
    });
  });

  it('masks .env.local, .envrc, prod.env, a case variant and a nested one, not envelope.txt', async () => {
    const { root, port } = setup({ '.env.local': 'A=1', '.envrc': 'export B=2', 'prod.env': 'C=3', '.ENV': 'D=4', 'app/.env': 'E=5', 'envelope.txt': 'F=6' });
    for (const path of ['.env.local', '.envrc', 'prod.env', '.ENV', 'app/.env']) expect(await port.read(root, path), path).toMatchObject({ masked: true, content: expect.stringContaining(REDACTED_SECRET) });
    expect(await port.read(root, 'envelope.txt')).toMatchObject({ masked: false, content: 'F=6' });
  });

  it('masks a file reached through a link by its real name', async () => {
    const { root, port } = setup({ 'config/.env': 'SECRET=1' });
    if (!tryLink(join(root, 'config', '.env'), join(root, 'settings.txt'), false)) return;
    expect(await port.read(root, 'settings.txt')).toMatchObject({ masked: true, content: `SECRET=${REDACTED_SECRET}` });
  });

  it('masks quoted, exported, multi-line and commented values, and every comment\'s text', () => {
    const text = [
      '# Database settings',
      'DB_URL="postgres://u:p@h/db"',
      "SINGLE='one two'",
      'export AWS_SECRET=xyz',
      'MULTI="line one',
      'line two',
      'line three"',
      '# OLD_KEY=leaked',
      '#export OLD_TOKEN=leaked2',
      '# key sk-ant-api03-abcdefghijklmnop',
      '',
      '   ',
      'NO_EQUALS_LINE',
      'SPACED = value',
    ].join('\r\n');
    expect(maskEnvironmentText(text).split('\r\n')).toEqual([
      `# ${REDACTED_SECRET}`,
      `DB_URL=${REDACTED_SECRET}`,
      `SINGLE=${REDACTED_SECRET}`,
      `export AWS_SECRET=${REDACTED_SECRET}`,
      `MULTI=${REDACTED_SECRET}`,
      REDACTED_SECRET,
      REDACTED_SECRET,
      `# ${REDACTED_SECRET}`,
      `#${REDACTED_SECRET}`,
      `# ${REDACTED_SECRET}`,
      '',
      '   ',
      REDACTED_SECRET,
      `SPACED =${REDACTED_SECRET}`,
    ]);
  });
});


describe('workspace-files-node: review rows (defensive check)', () => {
  /** Whether the temp folder's file system folds case (macOS and Windows by default). */
  const foldsCase = (root: string): boolean => existsSync(join(root, '.SSH'));

  it('refuses Unicode case-fold variants of a credential folder (long s, Kelvin sign) on read and list', async () => {
    const { root, port } = setup({ '.ssh/id_rsa': 'PRIVATE KEY', '.kube/config': 'token: k' });
    const expected = foldsCase(root) ? PROTECTED : NOT_FOUND;
    for (const path of ['.ſſh/id_rsa', '.ſsh/id_rsa', '.Kube/config']) {
      const read = await port.read(root, path);
      expect(read, path).toEqual(path.includes('K') ? PROTECTED : expected);
      expect(JSON.stringify(read)).not.toContain('PRIVATE KEY');
    }
    expect(await port.list(root, '.ſſh')).toEqual(expected);
    // Full-width letters: the file system never folds them to ASCII, but core's NFKC fold does, so the name is refused (stricter).
    expect(await port.read(root, '.ｓｓｈ/id_rsa')).toEqual(PROTECTED);
  });

  it("marks a project .claude that is a link to the home's .claude protected, and refuses reading through it", async () => {
    const { root, home, port } = setup();
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', '.credentials.json'), 'HOME_CLAUDE_LOGIN');
    if (!tryLink(join(home, '.claude'), join(root, '.claude'), true)) return;
    expect(await port.list(root, '')).toMatchObject({ entries: [{ name: '.claude', protected: true }] });
    expect(await port.list(root, '.claude')).toEqual(PROTECTED);
    expect(await port.read(root, '.claude/.credentials.json')).toEqual(PROTECTED);
  });

  it('marks a link to the data folder protected and refuses reading through it', async () => {
    const { root, dataDir, port } = setup();
    writeFileSync(join(dataDir, 'ogden.db'), 'DB_BYTES');
    if (!tryLink(dataDir, join(root, 'd'), true)) return;
    expect(await port.list(root, '')).toMatchObject({ entries: [{ name: 'd', protected: true }] });
    expect(await port.list(root, 'd')).toEqual(PROTECTED);
    expect(await port.read(root, 'd/ogden.db')).toEqual(PROTECTED);
  });

  it("keeps the home's .claude fenced when the home folder is inside the project", async () => {
    const root = tempDir('ogden-files-project-');
    const home = join(root, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', '.credentials.json'), 'HOME_CLAUDE_LOGIN');
    writeFileSync(join(root, 'a.txt'), 'a');
    const port = createWorkspaceFilesNode({ home, dataDir: tempDir('ogden-files-data-') });
    expect(await port.list(root, 'home')).toMatchObject({ entries: [{ name: '.claude', protected: true }] });
    expect(await port.read(root, 'home/.claude/.credentials.json')).toEqual(PROTECTED);
    expect(await port.read(root, 'a.txt')).toMatchObject({ kind: 'text' });
  });

  // A name that only starts with two dots (`..notes`, `...`) is inside the project.
  it('lists and reads a name that starts with two dots (..notes) as an ordinary file', async () => {
    const { root, port } = setup({ '..notes': 'mine' });
    expect(await port.list(root, '')).toMatchObject({ entries: [{ name: '..notes', protected: false }] });
    expect(await port.read(root, '..notes')).toMatchObject({ kind: 'text', content: 'mine' });
  });

  // Names with `\\` or `:` (legal on macOS and Linux) can't be asked for back, so they are listed protected.
  (process.platform === 'win32' ? it.skip : it)('lists only unprotected entries whose path the API accepts back', async () => {
    const { root, port } = setup({ 'a:b.txt': 'x', 'back\\slash.txt': 'y', 'ok.txt': 'z' });
    const listed = await port.list(root, '');
    if (!('entries' in listed)) throw new Error('not listed');
    for (const entry of listed.entries) if (!entry.protected) expect(WorkspaceRelativePath.safeParse(entry.path).success, entry.path).toBe(true);
  });

  // Check-to-open race: the identity read matches comes from an `lstat` of every folder on the way, so a folder
  // swapped for a link just before the following `stat`, and back just before `stillThere`, is refused.
  (process.platform === 'win32' ? it.skip : it)('refuses a folder on the way swapped for a link out and back around the open', async () => {
    const outside = tempDir('ogden-files-outside-');
    writeFileSync(join(outside, 'a.txt'), 'OUTSIDE_SECRET');
    const { root, port } = setup({ 'sub/a.txt': 'inside' });
    const sub = join(root, 'sub');
    fsHooks.beforeStat = (path) => {
      if (path !== join(sub, 'a.txt')) return;
      fsHooks.beforeStat = undefined;
      renameSync(sub, `${sub}-orig`);
      symlinkSync(outside, sub, 'dir');
      fsHooks.beforeRealpath = () => {
        fsHooks.beforeRealpath = undefined;
        unlinkSync(sub);
        renameSync(`${sub}-orig`, sub);
      };
    };
    const read = await port.read(root, 'sub/a.txt');
    expect(JSON.stringify(read)).not.toContain('OUTSIDE_SECRET');
    expect(read).toEqual(PROTECTED);
  });

  // Check-to-list race: the same swap around `opendir` is refused.
  (process.platform === 'win32' ? it.skip : it)('refuses a listed folder swapped for a link out and back around the opendir', async () => {
    const outside = tempDir('ogden-files-outside-');
    writeFileSync(join(outside, 'OUTSIDE_NAME'), 'x');
    const { root, port } = setup({ 'sub/a.txt': 'inside' });
    const sub = join(root, 'sub');
    fsHooks.beforeStat = (path) => {
      if (path !== sub) return;
      fsHooks.beforeStat = undefined;
      renameSync(sub, `${sub}-orig`);
      symlinkSync(outside, sub, 'dir');
      fsHooks.beforeRealpath = () => {
        fsHooks.beforeRealpath = undefined;
        unlinkSync(sub);
        renameSync(`${sub}-orig`, sub);
      };
    };
    const listed = await port.list(root, 'sub');
    expect(JSON.stringify(listed)).not.toContain('OUTSIDE_NAME');
    expect(listed).toEqual(PROTECTED);
  });

  // KNOWN LIMIT, deferred for a decision (not fixed in this story): a hard link in the project to a file outside it
  // is a regular file at a path inside, so a path check reads it. Any process that can write the project can
  // hard-link the user's own files in.
  it.fails('refuses a hard link to a file outside the project', async () => {
    const outside = tempDir('ogden-files-outside-');
    writeFileSync(join(outside, 'id_rsa'), 'OUTSIDE_SECRET');
    const { root, port } = setup();
    try {
      linkSync(join(outside, 'id_rsa'), join(root, 'notes.txt'));
    } catch {
      return; // Different volumes: no hard link here.
    }
    expect(JSON.stringify(await port.read(root, 'notes.txt'))).not.toContain('OUTSIDE_SECRET');
  });

  it.runIf(process.platform === 'win32')('Windows: refuses an 8.3 short name of .git and .ssh', async () => {
    const { root, port } = setup({ '.git/config': '[core]', '.ssh/id_rsa': 'key' });
    for (const [short, file] of [['GIT~1', 'config'], ['SSH~1', 'id_rsa']] as const) {
      if (!existsSync(join(root, short))) continue; // Short names off on this volume.
      expect(await port.read(root, `${short}/${file}`), short).toEqual(PROTECTED);
      expect(await port.list(root, short), short).toEqual(PROTECTED);
    }
  });

  it.runIf(process.platform === 'win32')('Windows: never reads a reserved device name', async () => {
    const { root, port } = setup({ 'a.txt': 'a' });
    for (const path of ['CON', 'NUL', 'nul.txt', 'aux.js', 'COM1', 'src/PRN']) expect(await port.read(root, path), path).not.toMatchObject({ kind: 'text' });
  });

  it.runIf(process.platform === 'win32')('Windows: masks .env reached with a trailing space or dot', async () => {
    const { root, port } = setup({ '.env': 'API_KEY=WIN_SECRET' });
    for (const path of ['.env ', '.env.', '.env. .']) {
      const read = await port.read(root, path);
      expect(JSON.stringify(read), path).not.toContain('WIN_SECRET');
    }
  });

  // Other common environment-file names are masked too.
  it('masks other environment-file names (.env-local, .env_production, prod.env.local, .flaskenv)', async () => {
    const { root, port } = setup({ '.env-local': 'A=ENV_SECRET', '.env_production': 'A=ENV_SECRET', 'prod.env.local': 'A=ENV_SECRET', '.flaskenv': 'A=ENV_SECRET' });
    for (const path of ['.env-local', '.env_production', 'prod.env.local', '.flaskenv']) expect(await port.read(root, path), path).toMatchObject({ masked: true });
  });

  // A multi-line value's continuation line that looks like `WORD=` (a base64 line ending in `=` or `==`) is masked whole.
  it('masks a base64 continuation line of a multi-line value', () => {
    const text = 'PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7==\n-----END PRIVATE KEY-----"\n';
    expect(maskEnvironmentText(text)).not.toContain('MIIEvQIBADAN');
  });

  // Every comment's text is masked whole, so a commented `NAME: value` secret is never shown.
  it('masks a commented secret written as NAME: value', () => {
    expect(maskEnvironmentText('# DB_PASSWORD: hunter2-secret\n')).not.toContain('hunter2-secret');
  });

  it('masks a whole file with lone CR or U+2028 line breaks, and a line after a BOM', () => {
    for (const text of ['A=CR_SECRET\rB=CR_SECRET2', 'A=LS_SECRET B=LS_SECRET2', '﻿A=BOM_SECRET']) {
      expect(maskEnvironmentText(text), JSON.stringify(text)).not.toMatch(/SECRET/);
    }
  });

  it('masks a link named .env that leads to an ordinary file', async () => {
    const { root, port } = setup({ 'plain.txt': 'B=PLAIN_SECRET' });
    if (!tryLink(join(root, 'plain.txt'), join(root, '.env'), false)) return;
    expect(JSON.stringify(await port.read(root, '.env'))).not.toContain('PLAIN_SECRET');
  });
});
