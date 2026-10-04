/**
 * The catalog's lenient TOML subset reader (story 4.4): tables, arrays of
 * tables, one-line basic and literal strings and arrays of them (over
 * several lines, with comments and a trailing comma); everything else is
 * skipped without losing the place and its key answers the unreadable
 * marker, and nothing throws. The pinned
 * upstream module records read as BMad Method writes them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readToml, TOML_UNREADABLE } from '../src/bmad-catalog/toml.js';

const UPSTREAM_SKILLS = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'bmad-upstream', 'skills');

const plain = (table: ReadonlyMap<string, unknown> | undefined) => (table === undefined ? undefined : Object.fromEntries(table));

describe('readToml', () => {
  it('reads tables, root keys, basic and literal strings with escapes, and string arrays', () => {
    const doc = readToml(
      [
        'title = "root" # a comment',
        '',
        '[bmod]',
        'code = "method"',
        "path = 'C:\\no\\escapes'",
        '"quoted key" = "tab\\there \\"q\\" \\u00e9 \\U0001F600"',
        'skills = [',
        '  "a", # first',
        "  'b',",
        '  # a comment line',
        '  "c",',
        ']',
        'empty = []',
        'one = ["x"]',
        '[ other . "dotted.name" ]',
        'k = "v"',
      ].join('\n'),
    );
    expect(plain(doc.tables.get(''))).toEqual({ title: 'root' });
    expect(plain(doc.tables.get('bmod'))).toEqual({
      code: 'method',
      path: 'C:\\no\\escapes',
      'quoted key': 'tab\there "q" é 😀',
      skills: ['a', 'b', 'c'],
      empty: [],
      one: ['x'],
    });
    expect(plain(doc.tables.get('other.dotted.name'))).toEqual({ k: 'v' });
  });

  it('reads arrays of tables in order', () => {
    const doc = readToml('[[members]]\nskill = "a"\ntitle = "A"\n\n[[members]]\nskill = "b"\n\n[[groups]]\nid = "g"\n');
    expect(doc.arrays.get('members')?.map(plain)).toEqual([{ skill: 'a', title: 'A' }, { skill: 'b' }]);
    expect(doc.arrays.get('groups')?.map(plain)).toEqual([{ id: 'g' }]);
  });

  it('skips what it does not keep and still reads the keys after it', () => {
    const doc = readToml(
      [
        '[t]',
        'n = 3',
        'flag = true',
        'when = 2026-10-02',
        'inline = { a = "x", b = [1, 2] }',
        'mixed = ["a", 1]',
        'nested = [["a"], ["b"]]',
        'objects = [{ skill = "bmad", version = "6.13.0" }, { skill = "x" }]',
        'multi = """',
        '[not-a-table]',
        'key = "not a key"',
        '"""',
        "lit = '''",
        'nor = "this"',
        "'''",
        'dotted.key = "skipped"',
        'trailing = "x" junk',
        'unclosed = "no end',
        'after = "read"',
      ].join('\n'),
    );
    // Each key that is there but unreadable answers the marker; the dotted key is skipped entirely.
    const U = TOML_UNREADABLE;
    expect(plain(doc.tables.get('t'))).toEqual({ n: U, flag: U, when: U, inline: U, mixed: U, nested: U, objects: U, multi: U, lit: U, trailing: U, unclosed: U, after: 'read' });
    expect(doc.tables.has('not-a-table')).toBe(false);
  });

  it('keeps the first of a repeated key or table, and drops keys under a header it cannot read', () => {
    const doc = readToml('[a]\nk = "first"\nk = "second"\n[a]\nother = "x"\n[bad header\nlost = "x"\n[[mismatch]\nlost2 = "x"\n[b]\nk = "b"\n');
    expect(plain(doc.tables.get('a'))).toEqual({ k: 'first' });
    expect(plain(doc.tables.get('b'))).toEqual({ k: 'b' });
    expect([...doc.tables.keys()].sort()).toEqual(['', 'a', 'b']);
    expect(doc.arrays.size).toBe(0);
  });

  it('never throws, on garbage, bad escapes, unclosed arrays or a BOM and CRLF', () => {
    for (const text of ['', '[', '[[', '=', '= "x"', 'k = [', 'k = ["a", ', 'k = "\\x"', 'k = "\\uZZZZ"', 'k = "\\uD800"', '\u0000\u0001', '{'.repeat(10_000), 'k = ' + '['.repeat(10_000)]) {
      expect(() => readToml(text), JSON.stringify(text.slice(0, 20))).not.toThrow();
    }
    expect(plain(readToml('k = "\\x"\nok = "y"').tables.get(''))).toEqual({ k: TOML_UNREADABLE, ok: 'y' });
    expect(plain(readToml('\uFEFF[bmod]\r\ncode = "m" # c\r\nskills = [\r\n  "a",\r\n]\r\n').tables.get('bmod'))).toEqual({ code: 'm', skills: ['a'] });
    expect(readToml(undefined as unknown as string).tables.get('')?.size).toBe(0);
  });

  it('reads the pinned upstream module records and roster', () => {
    const method = readToml(readFileSync(join(UPSTREAM_SKILLS, 'bmod-method', 'bmod.toml'), 'utf8')).tables.get('bmod');
    expect(method?.get('code')).toBe('method');
    expect(method?.get('version')).toBe('6.13.0-next');
    expect(method?.get('skills')).toContain('bmad-spec');
    // `required_skills` holds inline tables here: there, but unreadable.
    expect(method?.get('required_skills')).toBe(TOML_UNREADABLE);
    const core = readToml(readFileSync(join(UPSTREAM_SKILLS, 'bmod-core-tools', 'bmod.toml'), 'utf8')).tables.get('bmod');
    expect(core?.get('code')).toBe('core-tools');
    expect(core?.get('required_skills')).toEqual(['bmad']);
    const roster = readToml(readFileSync(join(UPSTREAM_SKILLS, 'bmod-method', 'roster.toml'), 'utf8'));
    expect(roster.arrays.get('members')?.map((member) => [member.get('skill'), member.get('title')])).toEqual([
      ['bmad-agent-analyst', 'Business Analyst'],
      ['bmad-agent-pm', 'Product Manager'],
      ['bmad-agent-ux-designer', 'UX Designer'],
      ['bmad-agent-architect', 'System Architect'],
      ['bmad-agent-dev', 'Senior Software Engineer'],
    ]);
    // The upstream skill `bmad`'s own `bmod.toml` has no `[bmod]` table: not a module record.
    expect(readToml(readFileSync(join(UPSTREAM_SKILLS, 'bmad', 'bmod.toml'), 'utf8')).tables.has('bmod')).toBe(false);
  });
});
