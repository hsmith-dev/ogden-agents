/**
 * Review's diff text into the diff viewer's files and hunks (story 8.3):
 * headers, C-quoted paths, new, deleted, renamed and binary files, `@@`
 * ranges, line numbers, the no-newline marker, counts, a cut diff, and text
 * that isn't a diff at all.
 */
import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/ui/diff/parse-unified';

const TWO_FILES = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const one = 1;',
  '-export const a = 1;',
  '+export const a = 2;',
  ' const three = 3;',
  '@@ -10,2 +10,3 @@ function tail() {',
  ' ten',
  '+ten and a half',
  ' eleven',
  'diff --git a/README.md b/README.md',
  'index 3333333..4444444 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1 @@',
  '-old',
  '\\ No newline at end of file',
  '+new',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('parseUnifiedDiff (story 8.3)', () => {
  it('reads a two-file diff into two files with their hunks, ranges, line numbers and counts', () => {
    const parsed = parseUnifiedDiff(TWO_FILES, false)!;
    expect(parsed.cut).toBe(false);
    expect(parsed.files.map(({ file }) => file)).toEqual([
      { path: 'src/a.ts', change: 'changed', additions: 2, deletions: 1, binary: false, tooLarge: false },
      { path: 'README.md', change: 'changed', additions: 1, deletions: 1, binary: false, tooLarge: false },
    ]);
    const [first, second] = parsed.files.map(({ hunks }) => hunks);
    expect(first!.map(({ id, oldStart, oldLines, newStart, newLines }) => ({ id, oldStart, oldLines, newStart, newLines }))).toEqual([
      { id: 'h0', oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 },
      { id: 'h1', oldStart: 10, oldLines: 2, newStart: 10, newLines: 3 },
    ]);
    expect(first![0]!.lines).toEqual([
      { kind: 'context', text: 'const one = 1;', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'export const a = 1;', oldLine: 2 },
      { kind: 'add', text: 'export const a = 2;', newLine: 2 },
      { kind: 'context', text: 'const three = 3;', oldLine: 3, newLine: 3 },
    ]);
    expect(first![1]!.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['context', 10, 10],
      ['add', undefined, 11],
      ['context', 11, 12],
    ]);
    // The no-newline markers are skipped.
    expect(second![0]!.lines).toEqual([
      { kind: 'remove', text: 'old', oldLine: 1 },
      { kind: 'add', text: 'new', newLine: 1 },
    ]);
  });

  it('names new, deleted and binary files by their change, a binary one with no hunks', () => {
    const text = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/icon.png b/icon.png',
      'new file mode 100644',
      'index 0000000..2222222',
      'Binary files /dev/null and b/icon.png differ',
    ].join('\n');
    const files = parseUnifiedDiff(text, false)!.files;
    expect(files.map(({ file }) => [file.path, file.change, file.binary, file.additions, file.deletions])).toEqual([
      ['src/new.ts', 'added', false, 2, 0],
      ['src/gone.ts', 'deleted', false, 0, 1],
      ['logo.png', 'changed', true, 0, 0],
      ['icon.png', 'added', true, 0, 0],
    ]);
    expect(files[0]!.hunks[0]!.lines.map((line) => line.newLine)).toEqual([1, 2]);
    expect(files[1]!.hunks[0]!.lines).toEqual([{ kind: 'remove', text: 'bye', oldLine: 1 }]);
    expect(files[2]!.hunks).toEqual([]);
  });

  it('reads a rename with its old path', () => {
    const text = ['diff --git a/old name.ts b/new name.ts', 'similarity index 90%', 'rename from old name.ts', 'rename to new name.ts', 'index 1..2 100644', '--- a/old name.ts', '+++ b/new name.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    const [entry] = parseUnifiedDiff(text, false)!.files;
    expect(entry!.file).toMatchObject({ path: 'new name.ts', previousPath: 'old name.ts', change: 'renamed', additions: 1, deletions: 1 });
  });

  it('reads rename lines as printed, with no side prefix to strip (a top-level c/ folder kept)', () => {
    const text = ['diff --git a/c/old.txt b/c/new.txt', 'similarity index 100%', 'rename from c/old.txt', 'rename to c/new.txt'].join('\n');
    expect(parseUnifiedDiff(text, false)!.files[0]!.file).toMatchObject({ path: 'c/new.txt', previousPath: 'c/old.txt', change: 'renamed' });
  });

  it('decodes a C-quoted path, octal UTF-8 bytes included', () => {
    const text = ['diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"', 'index 1..2 100644', '--- "a/caf\\303\\251.txt"', '+++ "b/caf\\303\\251.txt"', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    expect(parseUnifiedDiff(text, false)!.files[0]!.file.path).toBe('café.txt');
    // A quoted binary file has no --- and +++ lines: the header and the Binary line name it.
    const binary = ['diff --git "a/caf\\303\\251 \\"x\\".png" "b/caf\\303\\251 \\"x\\".png"', 'index 1..2 100644', 'Binary files "a/caf\\303\\251 \\"x\\".png" and "b/caf\\303\\251 \\"x\\".png" differ'].join('\n');
    expect(parseUnifiedDiff(binary, false)!.files[0]!.file).toMatchObject({ path: 'café "x".png', binary: true });
  });

  it('keeps an unquoted path with spaces from the header alone', () => {
    const text = ['diff --git a/my file.bin b/my file.bin', 'index 1..2 100644', 'Binary files a/my file.bin and b/my file.bin differ'].join('\n');
    expect(parseUnifiedDiff(text, false)!.files[0]!.file.path).toBe('my file.bin');
  });

  it('a cut diff keeps the lines parsed so far and says it was cut', () => {
    const cutAt = TWO_FILES.indexOf('+export const a = 2;') + '+export const a = 2;'.length;
    const parsed = parseUnifiedDiff(TWO_FILES.slice(0, cutAt), true)!;
    expect(parsed.cut).toBe(true);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual(['context', 'remove', 'add']);
    expect(parsed.files[0]!.file).toMatchObject({ additions: 1, deletions: 1 });
  });

  it('is null for text with no diff --git header', () => {
    expect(parseUnifiedDiff('', false)).toBeNull();
    expect(parseUnifiedDiff('something went wrong\n--- a\n+++ b\n', false)).toBeNull();
  });

  it('numbers 25 files and their hunks independently', () => {
    const text = Array.from({ length: 25 }, (_, index) => [`diff --git a/f${index}.txt b/f${index}.txt`, '--- a/f' + index + '.txt', `+++ b/f${index}.txt`, '@@ -1 +1 @@', '-a', '+b'].join('\n')).join('\n');
    const files = parseUnifiedDiff(text, false)!.files;
    expect(files).toHaveLength(25);
    expect(files.every(({ hunks }) => hunks.length === 1 && hunks[0]!.id === 'h0')).toBe(true);
  });
});
