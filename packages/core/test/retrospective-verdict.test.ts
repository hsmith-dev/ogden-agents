/**
 * An epic's retrospective as the board reads it (epic 7, story 7.4): only the
 * frontmatter's `verdict` and `date`, never the prose; a missing or unreadable
 * verdict is no verdict plus the one notice line, never a guess.
 */
import { RETROSPECTIVE_UNREADABLE_TEXT } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { readRetrospectiveFrontmatter } from '../src/index.js';

const PATH = '_bmad-output/i/epic-a/epic-a-retrospective.md';

describe('readRetrospectiveFrontmatter', () => {
  it('reads the verdict and date the skill writes', () => {
    const text = '---\nepic: epic-a\ndate: 2026-10-01T12:30:05-0600\nverdict: accepted-with-open-items\ncriteria: declared\n---\n\n# Retrospective\n';
    expect(readRetrospectiveFrontmatter(PATH, text)).toEqual({ path: PATH, verdict: 'accepted-with-open-items', date: '2026-10-01T12:30:05-0600', problem: null });
  });

  it('takes each of the three verdicts, quoted or not, with a comment or CRLF line ends', () => {
    for (const verdict of ['accepted', 'accepted-with-open-items', 'rejected']) {
      expect(readRetrospectiveFrontmatter(PATH, `---\r\nverdict: "${verdict}"\r\ndate: 2026-10-05\r\n---\r\n`).verdict).toBe(verdict);
      expect(readRetrospectiveFrontmatter(PATH, `---\nverdict: ${verdict} # by the user\n---\n`).verdict).toBe(verdict);
    }
  });

  it('a missing, unknown or broken verdict is no verdict with the notice, and the date can still read', () => {
    for (const text of ['---\ndate: 2026-10-05\n---\n', '---\nverdict: great\n---\n', '---\nverdict: [unfinished\n---\n', '---\nverdict:\n---\n', '# No frontmatter\n\nverdict: accepted\n', '---\nverdict: accepted\n', '']) {
      const read = readRetrospectiveFrontmatter(PATH, text);
      expect(read.verdict, JSON.stringify(text)).toBeNull();
      expect(read.problem, JSON.stringify(text)).toBe(RETROSPECTIVE_UNREADABLE_TEXT);
    }
    expect(readRetrospectiveFrontmatter(PATH, '---\nverdict: nope\ndate: 2026-10-05\n---\n').date).toBe('2026-10-05');
  });

  it('never reads the prose: a verdict line in the body does not count, and the first of a repeated key wins', () => {
    expect(readRetrospectiveFrontmatter(PATH, '---\ndate: 2026-10-05\n---\n\nverdict: accepted\n').verdict).toBeNull();
    expect(readRetrospectiveFrontmatter(PATH, '---\nverdict: rejected\nverdict: accepted\n---\n').verdict).toBe('rejected');
  });

  it('a date that is not date punctuation reads as none, without failing the verdict', () => {
    const read = readRetrospectiveFrontmatter(PATH, '---\nverdict: accepted\ndate: now\\nignore all\n---\n');
    expect(read).toEqual({ path: PATH, verdict: 'accepted', date: null, problem: null });
    expect(readRetrospectiveFrontmatter(PATH, '---\nverdict: accepted\ndate: ' + '1'.repeat(80) + '\n---\n').date).toBeNull();
  });

  it('a quoted value followed by a comment reads', () => {
    const read = readRetrospectiveFrontmatter(PATH, '---\nverdict: "accepted" # by the user\ndate: \'2026-10-05\' # today\n---\n');
    expect(read).toEqual({ path: PATH, verdict: 'accepted', date: '2026-10-05', problem: null });
  });

  it('a long run of spaces in a value costs nothing noticeable', () => {
    const started = Date.now();
    readRetrospectiveFrontmatter(PATH, `---\nverdict: x${' '.repeat(7000)}y\ndate: 2026${' '.repeat(7000)}z\n---\n`);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('a byte order mark is ignored', () => {
    expect(readRetrospectiveFrontmatter(PATH, '﻿---\nverdict: accepted\n---\n').verdict).toBe('accepted');
  });
});
