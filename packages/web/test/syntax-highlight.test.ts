/**
 * Syntax colour (story 8.3): a path's language by extension, TypeScript
 * keywords, strings and comments as their tokens, an unknown language plain
 * with no grammar loaded, a failed load plain, and every token the
 * highlighter gives is one the palette keeps readable (`SYNTAX_COLORS`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNTAX_COLORS } from '../src/appearance/palette';
import { highlight, languageFor, TOKEN_CLASSES, type Segment } from '../src/ui/syntax/highlight';

afterEach(() => {
  vi.doUnmock('@lezer/python');
  vi.resetModules();
});

const tokensOf = (segments: Segment[][]) => segments.flat().filter((segment) => segment.token !== undefined).map((segment) => [segment.token, segment.text.trim()]);

describe('syntax colour (story 8.3)', () => {
  it('knows a language by its extension, and none for an unknown one', () => {
    expect(languageFor('src/a.ts')).toBe('typescript');
    expect(languageFor('src/App.tsx')).toBe('tsx');
    expect(languageFor('lib/x.MJS')).toBe('javascript');
    expect(languageFor('tool.py')).toBe('python');
    expect(languageFor('config/ci.yml')).toBe('yaml');
    expect(languageFor('notes.xyz')).toBeUndefined();
    expect(languageFor('Makefile')).toBeUndefined();
    expect(languageFor('.gitignore')).toBeUndefined();
  });

  it('colours TypeScript keywords, strings and comments, line by line, as one block', async () => {
    const lines = ['// a note', 'export const a: string = "hi";', '/* spans', '   lines */ let n = 42;'];
    const segments = (await highlight(lines, 'typescript'))!;
    expect(segments).toHaveLength(4);
    // Every line's text is kept whole.
    expect(segments.map((line) => line.map((segment) => segment.text).join(''))).toEqual(lines);
    const tokens = tokensOf(segments);
    expect(tokens).toContainEqual(['comment', '// a note']);
    expect(tokens).toContainEqual(['keyword', 'export']);
    expect(tokens).toContainEqual(['keyword', 'const']);
    expect(tokens).toContainEqual(['string', '"hi"']);
    expect(tokens).toContainEqual(['number', '42']);
    // The block comment holds across the line break.
    expect(segments[3]![0]).toEqual({ text: '   lines */', token: 'comment' });
  });

  it('an unknown language stays plain and loads no grammar', async () => {
    expect(await highlight(['some text'], undefined)).toBeUndefined();
  });

  it('a grammar that fails to load leaves the text plain for the page, with no second try', async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock('@lezer/python', () => {
      loads++;
      throw new Error('offline');
    });
    const fresh = await import('../src/ui/syntax/highlight');
    expect(await fresh.highlight(['def f(): pass'], 'python')).toBeUndefined();
    expect(await fresh.highlight(['x = 1'], 'python')).toBeUndefined();
    expect(loads).toBe(1);
  });

  it('every token it colours is a palette syntax colour, and only those classes', () => {
    for (const [token, classes] of Object.entries(TOKEN_CLASSES)) {
      expect(SYNTAX_COLORS).toContain(`syntax-${token}`);
      expect(classes.split(' ').filter((name) => name.startsWith('text-'))).toEqual([`text-syntax-${token}`]);
    }
  });
});
