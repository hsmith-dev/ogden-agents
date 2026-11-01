/**
 * The Lezer side of syntax colour (story 8.3): loaded only by `highlight.ts`
 * through a dynamic `import()`, so neither this module nor any grammar is in
 * the entry chunk. Each grammar is its own dynamic import, fetched the first
 * time a diff in that language renders and kept for the page.
 */
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import type { Language, Segment, SyntaxToken } from './highlight';

/** A parsed tree, as `highlightCode` takes it. */
type Tree = Parameters<typeof highlightCode>[1];
interface Grammar {
  parse(input: string): Tree;
}

/** Every grammar by language, each its own chunk. */
const LOADERS: Record<Language, () => Promise<Grammar>> = {
  javascript: () => import('@lezer/javascript').then((module) => module.parser.configure({ dialect: 'jsx' })),
  typescript: () => import('@lezer/javascript').then((module) => module.parser.configure({ dialect: 'ts' })),
  tsx: () => import('@lezer/javascript').then((module) => module.parser.configure({ dialect: 'ts jsx' })),
  python: () => import('@lezer/python').then((module) => module.parser),
  css: () => import('@lezer/css').then((module) => module.parser),
  json: () => import('@lezer/json').then((module) => module.parser),
  html: () => import('@lezer/html').then((module) => module.parser),
  yaml: () => import('@lezer/yaml').then((module) => module.parser),
  go: () => import('@lezer/go').then((module) => module.parser),
  rust: () => import('@lezer/rust').then((module) => module.parser),
};

const grammars = new Map<Language, Promise<Grammar>>();

function grammarFor(language: Language): Promise<Grammar> {
  let grammar = grammars.get(language);
  if (grammar === undefined) {
    // Kept even when it fails: that language stays plain for the page, with no new requests.
    grammar = LOADERS[language]();
    grammars.set(language, grammar);
  }
  return grammar;
}

/**
 * Lezer's tags onto the five DESIGN.md syntax tokens (plan Design Notes).
 * A tag matches its sub-tags too: `keyword` covers every keyword kind,
 * `comment` line, block and doc comments, `string` special strings.
 */
export const SYNTAX_HIGHLIGHTER = tagHighlighter([
  { tag: [tags.keyword, tags.operatorKeyword, tags.self], class: 'keyword' },
  { tag: [tags.string, tags.regexp, tags.escape, tags.character], class: 'string' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.constant(tags.name)], class: 'number' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.attributeName, tags.namespace], class: 'type' },
  { tag: tags.comment, class: 'comment' },
]);

const TOKENS = new Set<string>(['keyword', 'string', 'number', 'type', 'comment']);

/**
 * `lines` highlighted as one block (so a string or comment spanning lines
 * holds), split back into one list of segments per line.
 */
export async function highlightLines(language: Language, lines: readonly string[]): Promise<Segment[][]> {
  const grammar = await grammarFor(language);
  const code = lines.join('\n');
  const tree = grammar.parse(code);
  const out: Segment[][] = [[]];
  highlightCode(
    code,
    tree,
    SYNTAX_HIGHLIGHTER,
    (text, classes) => {
      const token = classes.split(' ').find((name) => TOKENS.has(name)) as SyntaxToken | undefined;
      const line = out[out.length - 1]!;
      const last = line[line.length - 1];
      if (last !== undefined && last.token === token) last.text += text;
      else line.push(token === undefined ? { text } : { text, token });
    },
    () => out.push([]),
  );
  // Same line count as given (a trailing empty line has no break after it).
  while (out.length < lines.length) out.push([]);
  return out.slice(0, lines.length);
}
