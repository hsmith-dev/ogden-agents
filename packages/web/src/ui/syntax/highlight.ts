import { useEffect, useMemo, useState } from 'react';

/**
 * Syntax colour (story 8.3; DESIGN.md Syntax colors): the language of a path
 * by its extension, and lines split into segments that carry one of the five
 * syntax tokens. The highlighter (Lezer) and its grammars load by dynamic
 * `import()` only when code in a known language renders; until they arrive,
 * and when they fail to, the text is plain. Colour never carries meaning.
 */

/** The five syntax tokens, as `--color-syntax-*`. */
export type SyntaxToken = 'keyword' | 'string' | 'number' | 'type' | 'comment';
/** One run of text on a line, coloured by its token (none: foreground). */
export interface Segment {
  text: string;
  token?: SyntaxToken;
}

/** The languages with a grammar. */
export type Language = 'javascript' | 'typescript' | 'tsx' | 'python' | 'css' | 'json' | 'html' | 'yaml' | 'go' | 'rust';

const EXTENSIONS: Record<string, Language> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  pyi: 'python',
  css: 'css',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  htm: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  go: 'go',
  rs: 'rust',
};

/** The language of `path` by its extension, or `undefined` (plain text). */
export function languageFor(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()];
}

/** The Tailwind class for each token: palette tokens only; comments italic. */
export const TOKEN_CLASSES: Readonly<Record<SyntaxToken, string>> = {
  keyword: 'text-syntax-keyword',
  string: 'text-syntax-string',
  number: 'text-syntax-number',
  type: 'text-syntax-type',
  comment: 'text-syntax-comment italic',
};

type LezerModule = typeof import('./lezer');
let lezer: Promise<LezerModule> | undefined;

/** The highlighter module, imported once per page; a failed import stays failed (plain text, no new requests). */
function loadLezer(): Promise<LezerModule> {
  lezer ??= import('./lezer');
  return lezer;
}

/** `lines` highlighted in `language`, or `undefined` when it can't be (no grammar, or the load failed). */
export async function highlight(lines: readonly string[], language: Language | undefined): Promise<Segment[][] | undefined> {
  if (language === undefined || lines.length === 0) return undefined;
  try {
    const module = await loadLezer();
    return await module.highlightLines(language, lines);
  } catch {
    return undefined;
  }
}

const plain = (lines: readonly string[]): Segment[][] => lines.map((text) => [{ text }]);

/**
 * `lines` as segments: plain at once, coloured once the highlighter and the
 * language's grammar have loaded. The lines are highlighted as one block.
 */
export function useHighlightedLines(lines: readonly string[], language: Language | undefined): Segment[][] {
  const key = useMemo(() => `${language ?? ''}\0${lines.join('\n')}`, [lines, language]);
  const [done, setDone] = useState<{ key: string; segments: Segment[][] } | undefined>(undefined);
  useEffect(() => {
    if (language === undefined || lines.length === 0) return;
    let live = true;
    void highlight(lines, language).then((segments) => {
      if (live && segments !== undefined) setDone({ key, segments });
    });
    return () => {
      live = false;
    };
    // `key` stands for `lines` and `language`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => (done !== undefined && done.key === key ? done.segments : plain(lines)), [done, key, lines]);
}
