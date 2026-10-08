/**
 * `tickets-jira`'s minimal BMad frontmatter writer/reader (epic 18 story 5),
 * mirroring `_bmad/method/scripts/tickets.py`'s `parse_frontmatter` and
 * `set_frontmatter_value`: a file this module writes must be readable by
 * `tickets.py` directly, and a targeted field update must never disturb
 * any other line.
 */
import { describe, expect, it } from 'vitest';
import { bodyAfterFrontmatter, parseFrontmatterBlock, setFrontmatterField, writeFrontmatterBlock } from '../src/tickets-jira/bmad-frontmatter.js';

describe('writeFrontmatterBlock', () => {
  it('quotes strings, writes booleans and numbers bare, and skips empty values', () => {
    const block = writeFrontmatterBlock([
      ['id', 7],
      ['type', 'story'],
      ['title', 'Fix the thing'],
      ['hitl', false],
      ['covers', ['R1', 'R2']],
      ['unknown', undefined],
      ['notes', ''],
    ]);
    expect(block).toBe('---\nid: 7\ntype: story\ntitle: "Fix the thing"\nhitl: false\ncovers: ["R1", "R2"]\n---\n');
  });

  it('round-trips through parseFrontmatterBlock', () => {
    const block = writeFrontmatterBlock([
      ['id', 3],
      ['title', 'A "quoted" title, with a comma'],
      ['covers', ['AD-28']],
      ['hitl', true],
    ]);
    expect(parseFrontmatterBlock(block)).toEqual({ id: 3, title: 'A "quoted" title, with a comma', covers: ['AD-28'], hitl: true });
  });
});

describe('parseFrontmatterBlock', () => {
  it('parses a real tickets.py-pulled story file (the exact shape cmd_pull writes)', () => {
    const text = '---\nid: 1\ntype: story\ntitle: "Tracer bullet"\nparent: epic-jira-tracker-link\ncovers: [E18-R1, E18-R3]\nafter: []\nhitl: true\nrisk: high\n---\n\n# Tracer bullet\n\n## Description\n\nSomething.\n';
    expect(parseFrontmatterBlock(text)).toEqual({ id: 1, type: 'story', title: 'Tracer bullet', parent: 'epic-jira-tracker-link', covers: ['E18-R1', 'E18-R3'], after: [], hitl: true, risk: 'high' });
  });

  it('parses an empty list and an empty frontmatter block', () => {
    expect(parseFrontmatterBlock('---\nafter: []\n---\n')).toEqual({ after: [] });
    expect(parseFrontmatterBlock('no frontmatter here')).toEqual({});
  });

  it('ignores a comment line and blank lines inside the block', () => {
    expect(parseFrontmatterBlock('---\n# a comment\nid: 2\n\ntype: bug\n---\n')).toEqual({ id: 2, type: 'bug' });
  });
});

describe('bodyAfterFrontmatter', () => {
  it('returns everything after the closing ---', () => {
    expect(bodyAfterFrontmatter('---\nid: 1\n---\n\n# Title\n\nBody text.\n')).toBe('\n# Title\n\nBody text.\n');
  });

  it('returns the whole text when there is no frontmatter block', () => {
    expect(bodyAfterFrontmatter('just text')).toBe('just text');
  });
});

describe('setFrontmatterField (matching tickets.py set_frontmatter_value)', () => {
  it('replaces an existing field, touching no other line', () => {
    const text = '---\ntitle: "Fix the thing"\nticket: 3\nstatus: draft\nassignee: ""\n---\n';
    const updated = setFrontmatterField(text, 'status', 'in-progress');
    expect(updated).toBe('---\ntitle: "Fix the thing"\nticket: 3\nstatus: in-progress\nassignee: ""\n---\n');
  });

  it('appends a field that was not present', () => {
    const text = '---\ntitle: "Fix the thing"\nticket: 3\n---\n';
    const updated = setFrontmatterField(text, 'status', 'blocked');
    expect(parseFrontmatterBlock(updated)).toMatchObject({ title: 'Fix the thing', ticket: 3, status: 'blocked' });
  });

  it('removes the field entirely when the new value is empty (matching tickets.py)', () => {
    const text = '---\nticket: 3\nstatus: blocked\nblocked_reason: "waiting on review"\n---\n';
    const updated = setFrontmatterField(text, 'blocked_reason', '');
    expect(parseFrontmatterBlock(updated)).toEqual({ ticket: 3, status: 'blocked' });
  });

  it('preserves the body after the frontmatter block', () => {
    const text = '---\nticket: 3\nstatus: draft\n---\n\n# A plan has no body in tickets.py, but this one is tolerant of one.\n';
    const updated = setFrontmatterField(text, 'status', 'built');
    expect(updated.endsWith('# A plan has no body in tickets.py, but this one is tolerant of one.\n')).toBe(true);
  });

  it('throws when there is no frontmatter block at all', () => {
    expect(() => setFrontmatterField('no frontmatter', 'status', 'built')).toThrow();
  });
});
