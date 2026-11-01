/**
 * The `.gitignore` matcher behind project search (8.8): comments and
 * escapes, trailing spaces, negation, leading and inner `/` anchors,
 * folder-only patterns, `**`, character classes, nested files with the
 * deepest deciding, and a pathological pattern that stays fast (no RegExp
 * is built from a pattern).
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isIgnored, parseGitignore, parseGitignoreLine, readGitignore, ruleMatches, type GitignoreLevel } from '../src/workspace-files-node/gitignore.js';

/** Whether `path` (a `/`-joined path below the root) is ignored by one root `.gitignore` of `text`. */
const ignored = (text: string, path: string, folder = false): boolean => isIgnored([{ base: [], rules: parseGitignore(text) }], path.split('/'), folder);

describe('gitignore matcher', () => {
  it('skips blank lines and comments; \\# and \\! are literal; trailing spaces go unless escaped', () => {
    expect(parseGitignore('\n# a comment\n   \n')).toEqual([]);
    expect(ignored('\\#notes', '#notes')).toBe(true);
    expect(ignored('\\!bang', '!bang')).toBe(true);
    expect(ignored('a.log   ', 'a.log')).toBe(true);
    expect(ignored('a\\ ', 'a ')).toBe(true);
    expect(ignored('a\\ ', 'a')).toBe(false);
    expect(ignored('a.log\r\n', 'a.log')).toBe(true);
  });

  it('matches an unanchored name at any depth, an anchored one only from its folder', () => {
    expect(ignored('*.log', 'x.log')).toBe(true);
    expect(ignored('*.log', 'deep/er/x.log')).toBe(true);
    expect(ignored('*.log', 'x.logs')).toBe(false);
    expect(ignored('/build', 'build', true)).toBe(true);
    expect(ignored('/build', 'src/build', true)).toBe(false);
    expect(ignored('doc/frotz', 'doc/frotz')).toBe(true);
    expect(ignored('doc/frotz', 'a/doc/frotz')).toBe(false);
    expect(ignored('build', 'src/build', true)).toBe(true);
  });

  it('folder-only patterns match folders, not files', () => {
    expect(ignored('dist/', 'dist', true)).toBe(true);
    expect(ignored('dist/', 'dist', false)).toBe(false);
    expect(ignored('dist/', 'packages/web/dist', true)).toBe(true);
    expect(ignored('/out/', 'out', true)).toBe(true);
  });

  it('`**` matches any number of folders; a trailing `/**` everything inside, not the folder itself', () => {
    expect(ignored('**/foo', 'foo')).toBe(true);
    expect(ignored('**/foo', 'a/b/foo')).toBe(true);
    expect(ignored('**/foo/bar', 'x/foo/bar')).toBe(true);
    expect(ignored('a/**/b', 'a/b')).toBe(true);
    expect(ignored('a/**/b', 'a/x/y/b')).toBe(true);
    expect(ignored('a/**/b', 'a/x/y/c')).toBe(false);
    expect(ignored('abc/**', 'abc/x')).toBe(true);
    expect(ignored('abc/**', 'abc/x/y')).toBe(true);
    expect(ignored('abc/**', 'abc', true)).toBe(false);
    expect(ignored('**', 'anything/at/all')).toBe(true);
    // Not a whole segment: an ordinary star.
    expect(ignored('a**z', 'abcz')).toBe(true);
    expect(ignored('a**z', 'ab/cz')).toBe(false);
  });

  it('`?`, `[...]` ranges and negated classes, and escaped wildcards', () => {
    expect(ignored('?.txt', 'a.txt')).toBe(true);
    expect(ignored('?.txt', 'ab.txt')).toBe(false);
    expect(ignored('file[0-9].txt', 'file7.txt')).toBe(true);
    expect(ignored('file[0-9].txt', 'filex.txt')).toBe(false);
    expect(ignored('file[!0-9].txt', 'filex.txt')).toBe(true);
    expect(ignored('file[^0-9].txt', 'file1.txt')).toBe(false);
    expect(ignored('[]]x', ']x')).toBe(true);
    expect(ignored('a[b', 'a[b')).toBe(true);
    expect(ignored('\\*.txt', '*.txt')).toBe(true);
    expect(ignored('\\*.txt', 'a.txt')).toBe(false);
    expect(ignored('caf?', 'café')).toBe(true);
  });

  it('negation re-includes; the last matching rule wins', () => {
    expect(ignored('*.log\n!keep.log', 'keep.log')).toBe(false);
    expect(ignored('*.log\n!keep.log', 'x.log')).toBe(true);
    expect(ignored('!keep.log\n*.log', 'keep.log')).toBe(true);
  });

  it('a nested .gitignore applies below its folder only, and the deepest one decides', () => {
    const levels: GitignoreLevel[] = [
      { base: [], rules: parseGitignore('*.log\n') },
      { base: ['sub'], rules: parseGitignore('!keep.log\n/only-here.txt\n') },
    ];
    expect(isIgnored(levels, ['sub', 'x.log'], false)).toBe(true);
    expect(isIgnored(levels, ['sub', 'keep.log'], false)).toBe(false);
    expect(isIgnored(levels, ['keep.log'], false)).toBe(true);
    expect(isIgnored(levels, ['sub', 'only-here.txt'], false)).toBe(true);
    expect(isIgnored(levels, ['only-here.txt'], false)).toBe(false);
    expect(isIgnored(levels, ['sub', 'deeper', 'only-here.txt'], false)).toBe(false);
    // The folder holding a .gitignore is not matched by its own rules.
    expect(isIgnored([{ base: ['sub'], rules: parseGitignore('*\n') }], ['sub'], true)).toBe(false);
  });

  it('is case sensitive', () => {
    expect(ignored('*.LOG', 'x.log')).toBe(false);
  });

  it('a pathological pattern and a long name stay fast', () => {
    const rule = parseGitignoreLine(`${'*a'.repeat(100)}b`)!;
    const name = 'a'.repeat(4000);
    const deep = parseGitignoreLine(`${'**/'.repeat(100)}x`)!;
    const path = Array.from({ length: 200 }, () => 'a');
    const started = performance.now();
    expect(ruleMatches(rule, [name], false)).toBe(false);
    expect(ruleMatches(deep, path, false)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('readGitignore', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const temp = () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-gitignore-')));
    dirs.push(dir);
    return dir;
  };

  it('reads a regular file, and nothing from a link, a folder, a missing or a too large file', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'plain'), '*.log\n');
    expect(await readGitignore(join(dir, 'plain'))).toHaveLength(1);
    expect(await readGitignore(join(dir, 'missing'))).toEqual([]);
    mkdirSync(join(dir, 'folder'));
    expect(await readGitignore(join(dir, 'folder'))).toEqual([]);
    writeFileSync(join(dir, 'big'), `${'x'.repeat(1024 * 1024)}\n`);
    expect(await readGitignore(join(dir, 'big'))).toEqual([]);
    try {
      symlinkSync(join(dir, 'plain'), join(dir, 'link'));
    } catch {
      return; // No symlinks on this account.
    }
    expect(await readGitignore(join(dir, 'link'))).toEqual([]);
  });
});
