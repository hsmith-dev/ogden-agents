/**
 * Line comments' texts and composer (story 8.6): `path:line` refs (a range,
 * a removed line), quotes masked (a key, an environment file's values) and
 * cut, ranges by side, the one composed message, and its caps (quotes go
 * first, then comments, counted in "and N more comments not included").
 */
import { describe, expect, it } from 'vitest';
import {
  commentButtonName,
  commentsToSendText,
  LineComment,
  lineCommentRef,
  linesInRange,
  MAX_QUOTE_LINE_CHARS,
  MAX_QUOTE_LINES,
  MAX_REVIEW_COMMENTS_CHARS,
  moreCommentsText,
  quoteLines,
  REVIEW_COMMENTS_HEADER,
  reviewCommentsGoWithText,
  reviewCommentsText,
  sendCommentsLabel,
  type DiffHunk,
} from '../src/index.js';

const comment = (fields: Partial<LineComment> = {}): LineComment => ({ id: 'c1', path: 'src/a.ts', side: 'new', start: 58, end: 58, quote: ['+ const total = 1;'], text: 'Round after summing.', createdAt: 1, ...fields });

describe('line comment texts (story 8.6)', () => {
  it('names a button, the bar, the send and Review with their counts, with no dashes', () => {
    expect(commentButtonName({ side: 'new', start: 58, end: 58 })).toBe('Comment on line 58');
    expect(commentButtonName({ side: 'old', start: 40, end: 40 })).toBe('Comment on removed line 40');
    expect(commentsToSendText(2)).toBe('Comments to send (2)');
    expect(sendCommentsLabel('Claude Code')).toBe('Send to Claude Code');
    expect(reviewCommentsGoWithText(2)).toBe('Your 2 comments go with it.');
    expect(moreCommentsText(3)).toBe('and 3 more comments not included');
    expect(moreCommentsText(1)).toBe('and 1 more comment not included');
    expect(`${REVIEW_COMMENTS_HEADER}${moreCommentsText(2)}`).not.toMatch(/[–—]/);
  });

  it('refs a line, a range and a removed line', () => {
    expect(lineCommentRef({ path: 'a.ts', side: 'new', start: 58, end: 58 })).toBe('a.ts:58');
    expect(lineCommentRef({ path: 'b.css', side: 'new', start: 71, end: 74 })).toBe('b.css:71-74');
    expect(lineCommentRef({ path: 'a.ts', side: 'old', start: 40, end: 40 })).toBe('a.ts:40 (removed line)');
  });
});

describe('quotes (story 8.6)', () => {
  it('signs each line and masks a key and an environment file value', () => {
    expect(quoteLines('a.ts', [{ kind: 'add', text: 'const k = "sk-ant-api03-abcdefghijklmnop";' }])).toEqual(['+ const k = "[redacted]";']); // secret-scan:allow: a made-up key
    expect(quoteLines('config/.env', [{ kind: 'remove', text: 'TOKEN=abc' }, { kind: 'context', text: 'PLAIN=value' }])).toEqual(['- TOKEN=[redacted]', '  PLAIN=[redacted]']);
  });

  it('cuts a long line and a long range', () => {
    const [long] = quoteLines('a.ts', [{ kind: 'add', text: 'x'.repeat(400) }]);
    expect(long!.length).toBe(2 + MAX_QUOTE_LINE_CHARS);
    expect(long!.endsWith('...')).toBe(true);
    const many = quoteLines('a.ts', Array.from({ length: 40 }, (_, index) => ({ kind: 'add' as const, text: `line ${index}` })));
    expect(many).toHaveLength(MAX_QUOTE_LINES);
    expect(many.at(-1)).toBe('...');
    expect(LineComment.safeParse(comment({ quote: many })).success).toBe(true);
  });

  it("takes a range's lines on its side only", () => {
    const hunks: Pick<DiffHunk, 'lines'>[] = [
      {
        lines: [
          { kind: 'context', text: 'a', oldLine: 39, newLine: 39 },
          { kind: 'remove', text: 'b', oldLine: 40 },
          { kind: 'add', text: 'B', newLine: 40 },
          { kind: 'context', text: 'c', oldLine: 41, newLine: 41 },
        ],
      },
    ];
    expect(linesInRange(hunks, 'new', 39, 41).map((line) => line.text)).toEqual(['a', 'B', 'c']);
    expect(linesInRange(hunks, 'old', 40, 40).map((line) => line.text)).toEqual(['b']);
  });
});

describe('the composed message (story 8.6)', () => {
  it('is the header, then per comment its ref, quote and text', () => {
    const text = reviewCommentsText([comment(), comment({ id: 'c2', path: 'b.css', start: 71, end: 74, quote: ['+ color: red;', '+ margin: 0;'], text: 'Use formatPrice.' })]);
    expect(text).toBe(
      [REVIEW_COMMENTS_HEADER, 'src/a.ts:58\n> + const total = 1;\nRound after summing.', 'b.css:71-74\n> + color: red;\n> + margin: 0;\nUse formatPrice.'].join('\n\n'),
    );
    expect(reviewCommentsText([])).toBe('');
  });

  it('masks the whole text again', () => {
    expect(reviewCommentsText([comment({ text: 'the key is sk-ant-api03-abcdefghijklmnop' })])).not.toContain('abcdefghijklmnop'); // secret-scan:allow: a made-up key
  });

  it('drops quotes first, then comments, counted in the last line', () => {
    const quote = Array.from({ length: 11 }, () => `+ ${'q'.repeat(300)}`);
    const comments = Array.from({ length: 50 }, (_, index) => comment({ id: `c${index}`, start: index + 1, end: index + 1, quote, text: 't'.repeat(600) }));
    const text = reviewCommentsText(comments);
    expect(text.length).toBeLessThanOrEqual(MAX_REVIEW_COMMENTS_CHARS);
    expect(text).not.toContain('> ');
    expect(text).toMatch(/and \d+ more comments not included$/);
    const short = comments.slice(0, 3).map((one) => ({ ...one, quote: quote.slice(0, 2) }));
    const few = reviewCommentsText(short, 2500);
    // Within the cap: the first comments keep their quotes, the last lost its own.
    expect(few.length).toBeLessThanOrEqual(2500);
    expect(few).toContain('src/a.ts:1\n> ');
    expect(few).toContain('src/a.ts:3\nttt');
  });
});
