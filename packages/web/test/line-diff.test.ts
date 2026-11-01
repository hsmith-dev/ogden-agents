/**
 * The line diff behind chat edit rows (story 8.3; it replaces 2.10's
 * trimmed-ends hunk): Myers over lines, hunks with 3 lines of context, a new
 * file all added, a too-big middle shown as one replacement, and the word
 * change inside a paired line.
 */
import type { DiffHunk } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { diffTexts, MAX_EDIT_STEPS, wordChange } from '../src/ui/diff/line-diff';

const lines = (count: number, prefix = 'line') => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const marks = (hunk: DiffHunk) => hunk.lines.map((line) => `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}${line.text}`);

describe('diffTexts (story 8.3)', () => {
  it('shows an edit as its hunk: the changed lines with 3 lines of context and the ranges', () => {
    const before = lines(10).join('\n');
    const after = lines(10).map((line) => (line === 'line 5' ? 'LINE 5' : line)).join('\n');
    const hunks = diffTexts(before, after);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ id: 'h0', oldStart: 2, oldLines: 7, newStart: 2, newLines: 7 });
    expect(marks(hunks[0]!)).toEqual([' line 2', ' line 3', ' line 4', '-line 5', '+LINE 5', ' line 6', ' line 7', ' line 8']);
    expect(hunks[0]!.lines[3]).toEqual({ kind: 'remove', text: 'line 5', oldLine: 5 });
    expect(hunks[0]!.lines[4]).toEqual({ kind: 'add', text: 'LINE 5', newLine: 5 });
  });

  it('a new file (oldText null) is all added, from line 1', () => {
    const [hunk, ...rest] = diffTexts(null, 'new\nfile\n');
    expect(rest).toEqual([]);
    expect(hunk).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 });
    expect(marks(hunk!)).toEqual(['+new', '+file']);
  });

  it('far-apart changes are separate hunks; close ones share one', () => {
    const base = lines(30);
    const far = base.map((line) => (line === 'line 3' || line === 'line 25' ? `${line}!` : line));
    expect(diffTexts(base.join('\n'), far.join('\n')).map(({ id, newStart }) => [id, newStart])).toEqual([
      ['h0', 1],
      ['h1', 22],
    ]);
    const near = base.map((line) => (line === 'line 3' || line === 'line 9' ? `${line}!` : line));
    expect(diffTexts(base.join('\n'), near.join('\n'))).toHaveLength(1);
  });

  it('finds the real edit with Myers, not a replacement of everything between the ends', () => {
    const before = ['a', 'b', 'c', 'd', 'e'].join('\n');
    const after = ['a', 'x', 'b', 'c', 'e'].join('\n');
    expect(marks(diffTexts(before, after, 0)[0]!)).toEqual(['+x']);
    expect(marks(diffTexts(before, after, 0)[1]!)).toEqual(['-d']);
  });

  it('matching texts have no hunks; CRLF and a final newline do not count as changes', () => {
    expect(diffTexts('a\nb\n', 'a\nb\n')).toEqual([]);
    expect(diffTexts('a\r\nb\r\n', 'a\nb')).toEqual([]);
  });

  it(`past ${MAX_EDIT_STEPS} edit steps, shows the middle between the common ends as one replacement`, () => {
    const before = ['top', ...lines(2100, 'old'), 'bottom'].join('\n');
    const after = ['top', ...lines(2100, 'new'), 'bottom'].join('\n');
    const hunks = diffTexts(before, after);
    expect(hunks).toHaveLength(1);
    const kinds = hunks[0]!.lines.map((line) => line.kind);
    expect(kinds[0]).toBe('context');
    expect(kinds.filter((kind) => kind === 'remove')).toHaveLength(2100);
    expect(kinds.indexOf('add')).toBe(2101);
  });
});

describe('wordChange (story 8.3)', () => {
  it('is the differing middle of a paired line on each side', () => {
    expect(wordChange('export const a = 1;', 'export const a = 22;')).toEqual({ old: { start: 17, end: 18 }, new: { start: 17, end: 19 } });
    expect(wordChange('abc', 'abXc')).toEqual({ old: { start: 2, end: 2 }, new: { start: 2, end: 3 } });
  });

  it('is undefined when the lines match or share nothing', () => {
    expect(wordChange('same', 'same')).toBeUndefined();
    expect(wordChange('abc', 'xyz')).toBeUndefined();
  });
});
