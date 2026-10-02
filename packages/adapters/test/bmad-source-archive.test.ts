/**
 * The pinned-upstream archive module (story 4.14, `bmad-source/archive.ts`),
 * without the network: the content hash is the one `forks.lock` used (LF
 * normalized, path and contents in sorted order), the tar reader handles
 * what codeload serves (a pax global header, pax long paths), the selection
 * keeps only regular files under `include` and refuses the whole archive for
 * anything unsafe, the size cap refuses a bomb, and extraction writes only
 * inside its folder, never over anything.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { tar, tarGz, type TarEntry } from '../../../tests/fixtures/tar.js';
import { ArchiveRefusedError, extractTo, gunzipLimited, hashEntries, normalizeText, parseTar, selectVerified } from '../src/bmad-source/archive.js';

const TOP = 'BMAD-METHOD-1cbcfa272fe65787c06a1fa164a901f46117cca7';

/** A codeload-like tree: top folder, a skill, a CRLF text file, a binary, and a symlink outside `skills/`. */
function tree(extra: readonly TarEntry[] = []): TarEntry[] {
  return [
    { name: `${TOP}/`, type: 'dir' },
    { name: `${TOP}/README.md`, data: '# BMad\n' },
    { name: `${TOP}/docs/link.md`, type: 'symlink', link: '../README.md' },
    { name: `${TOP}/skills/`, type: 'dir' },
    { name: `${TOP}/skills/bmad/`, type: 'dir' },
    { name: `${TOP}/skills/bmad/SKILL.md`, data: '---\r\nname: bmad\r\n---\r\nBody\r\n' },
    { name: `${TOP}/skills/bmad-brainstorming/assets/brain-methods.csv`, data: 'a,b\n1,2\n' },
    { name: `${TOP}/skills/bmad/assets/logo.bin`, data: Buffer.from([0x89, 0x00, 0x0d, 0x0a, 0x01]) },
    ...extra,
  ];
}

/** {@link tree} with a precomposed `café.md`, for the normalization case. */
const withCafe = (extra: readonly TarEntry[]) => tree([{ name: `${TOP}/skills/caf\u00e9.md`, data: 'x' }, ...extra]);

const select = (entries: readonly TarEntry[], include = 'skills/') => selectVerified(parseTar(gunzipLimited(tarGz(entries, { globalComment: 'x' }), 1 << 20)), include);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-archive-'));
  dirs.push(dir);
  return dir;
};

describe('the content hash', () => {
  it('is the one forks.lock used: LF-normalized, over sorted paths and contents (a fixed value)', () => {
    const entries = select(tree());
    expect([...entries.keys()].sort()).toEqual(['bmad-brainstorming/assets/brain-methods.csv', 'bmad/SKILL.md', 'bmad/assets/logo.bin']);
    // Computed with the retired scripts/vendor-forks.mjs hashEntries on the same files.
    expect(hashEntries(entries)).toBe('sha256:6efb45970893b10f05f64831ed657527c3f4b1c8eef294a673f88652621fab3d');
  });

  it('normalizes CRLF in text but leaves a binary file alone, and ignores insertion order', () => {
    expect(normalizeText(Buffer.from('a\r\nb\r\n')).toString()).toBe('a\nb\n');
    const binary = Buffer.from([0x00, 0x0d, 0x0a]);
    expect(normalizeText(binary)).toEqual(binary);
    const entries = select(tree());
    expect(hashEntries(new Map([...entries].reverse()))).toBe(hashEntries(entries));
    const changed = new Map(entries).set('bmad/SKILL.md', Buffer.from('changed'));
    expect(hashEntries(changed)).not.toBe(hashEntries(entries));
  });
});

describe('the tar reader', () => {
  it('reads pax long paths and skips global headers', () => {
    const long = `${TOP}/skills/${'deep/'.repeat(30)}file.md`;
    const entries = parseTar(tar([{ name: long, data: 'x', pax: true }], { globalComment: 'abc' }));
    expect(entries).toEqual([expect.objectContaining({ path: long, type: 'file' })]);
    expect(select(tree([{ name: long, data: 'deep', pax: true }])).get(`${'deep/'.repeat(30)}file.md`)?.toString()).toBe('deep');
  });

  it('refuses an entry that runs past the end', () => {
    const whole = tar([{ name: `${TOP}/skills/a.md`, data: 'x'.repeat(2000) }]);
    expect(() => parseTar(whole.subarray(0, 1024))).toThrow(ArchiveRefusedError);
  });
});

describe('the selection (Boundaries: refuse the whole archive for anything unsafe)', () => {
  it('keeps only regular files under include, keyed below it; a symlink outside include is ignored', () => {
    const entries = select(tree());
    expect(entries.get('bmad/SKILL.md')?.toString()).toBe('---\nname: bmad\n---\nBody\n');
    expect(entries.has('README.md')).toBe(false);
  });

  it("with include '' keeps the whole tree's files", () => {
    const entries = select(tree().filter((entry) => entry.type !== 'symlink'), '');
    expect([...entries.keys()].sort()).toEqual(['README.md', 'skills/bmad-brainstorming/assets/brain-methods.csv', 'skills/bmad/SKILL.md', 'skills/bmad/assets/logo.bin']);
  });

  const unsafe: Array<[string, TarEntry]> = [
    ['a traversal', { name: `${TOP}/skills/../../x`, data: 'x' }],
    ['an absolute path', { name: '/x', data: 'x' }],
    ['an absolute path in the tree', { name: `/${TOP}/skills/x`, data: 'x' }],
    ['a drive path', { name: 'C:x', data: 'x' }],
    ['a backslash', { name: `${TOP}/skills\\x`, data: 'x' }],
    ['a NUL', { name: `${TOP}/skills/a\u0000b`, data: 'x', pax: true }],
    ['a dot segment', { name: `${TOP}/skills/./x`, data: 'x' }],
    ['a symlink under skills/', { name: `${TOP}/skills/bmad/link`, type: 'symlink', link: '/etc/passwd' }],
    ['a hardlink under skills/', { name: `${TOP}/skills/bmad/hard`, type: 'hardlink', link: `${TOP}/README.md` }],
    ['a fifo under skills/', { name: `${TOP}/skills/bmad/pipe`, type: 'fifo' }],
    ['a duplicate', { name: `${TOP}/skills/bmad/SKILL.md`, data: 'again' }],
    ['a duplicate differing only in case', { name: `${TOP}/skills/bmad/skill.md`, data: 'again' }],
    ['a second top folder', { name: 'other/skills/x.md', data: 'x' }],
    ['a duplicate differing only in Unicode normalization', { name: `${TOP}/skills/caf\u0065\u0301.md`, data: 'x' }],
    ['a file that is also a folder of another file', { name: `${TOP}/skills/bmad/SKILL.md/inner.md`, data: 'x' }],
  ];
  for (const [what, entry] of unsafe) {
    it(`refuses ${what}`, () => {
      expect(() => select(withCafe([entry]))).toThrow(ArchiveRefusedError);
    });
  }

  it('accepts the tree itself (the cases above each add one entry)', () => {
    expect(select(withCafe([])).size).toBe(4);
  });

  it('refuses an archive with nothing under include, and an include that is not a folder path', () => {
    expect(() => select([{ name: `${TOP}/README.md`, data: 'x' }])).toThrow(/no files under/);
    expect(() => select(tree(), '../')).toThrow(ArchiveRefusedError);
    expect(() => select(tree(), 'skills')).toThrow(ArchiveRefusedError);
  });
});

describe('the size cap', () => {
  it('refuses an archive that unpacks past the cap, and input that is not gzip', () => {
    const bomb = gzipSync(Buffer.alloc(4 * 1024 * 1024));
    expect(() => gunzipLimited(bomb, 1024 * 1024)).toThrow(/more than/);
    expect(() => gunzipLimited(Buffer.from('not gzip'), 1024)).toThrow(ArchiveRefusedError);
    expect(gunzipLimited(bomb, 8 * 1024 * 1024)).toHaveLength(4 * 1024 * 1024);
  });
});

describe('extraction', () => {
  it('writes exactly the entries, folders 0700 and files 0600', () => {
    const dir = tempDir();
    extractTo(select(tree()), dir);
    expect(readFileSync(join(dir, 'bmad', 'SKILL.md'), 'utf8')).toBe('---\nname: bmad\n---\nBody\n');
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'bmad')).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, 'bmad', 'SKILL.md')).mode & 0o777).toBe(0o600);
    }
  });

  it.skipIf(process.platform === 'win32')('keeps an upstream executable bit: 0700 for a file whose tar mode has one', () => {
    const dir = tempDir();
    extractTo(select(tree([{ name: `${TOP}/skills/bmad/scripts/run.py`, data: 'print(1)\n', mode: 0o755 }])), dir);
    expect(statSync(join(dir, 'bmad', 'scripts', 'run.py')).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'bmad', 'SKILL.md')).mode & 0o777).toBe(0o600);
  });

  it('never overwrites a file and never writes outside its folder', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'there.md'), 'mine');
    expect(() => extractTo(new Map([['there.md', Buffer.from('x')]]), dir)).toThrow(/EEXIST/);
    expect(readFileSync(join(dir, 'there.md'), 'utf8')).toBe('mine');
    for (const key of ['../escape.md', '/abs.md', 'a/../../b.md', 'a\\b.md']) {
      expect(() => extractTo(new Map([[key, Buffer.from('x')]]), dir), key).toThrow(ArchiveRefusedError);
    }
  });
});
