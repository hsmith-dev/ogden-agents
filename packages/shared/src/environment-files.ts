/**
 * Environment files (`.env`, `.env.*`, `.envrc`, `*.env`, `.flaskenv`): the
 * Workbench's file viewer shows them with every value masked (8.1), and a
 * line comment quoting one of their lines keeps only `NAME=` (8.6). Moved
 * here from the file viewer's adapter so the web client masks the same way.
 */
import { REDACTED_SECRET } from './secret-patterns.js';

/**
 * A path segment as Ogden compares names: NFKC-normalized and case-folded
 * (upper then lower, so the long s `ſ` folds to `s`), with trailing dots and
 * spaces stripped (Windows ignores them, and macOS folds case).
 */
export function foldPathSegment(segment: string): string {
  return segment.normalize('NFKC').toUpperCase().toLowerCase().replace(/[. ]+$/, '');
}

/** Whether the file name (folded by {@link foldPathSegment}) is an environment file whose values are masked. */
export function isEnvironmentFileName(name: string): boolean {
  const folded = foldPathSegment(name);
  return /^\.env([._~#-]|$)/.test(folded) || /^\.envrc([._-]|$)/.test(folded) || /\.env(\.|$)/.test(folded) || folded === '.flaskenv';
}

/** `NAME=` (optionally `export NAME=`) at a line's start: the part kept. */
const ASSIGNMENT = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=)(.*)$/;
/**
 * A comment line split into its lead (spaces, `#`s, spaces) and its text,
 * or `null`: by hand, in one pass (a RegExp here backtracked on a long run
 * of `#` before a lone `\r`). The text may hold no line terminator, as `.` can't.
 */
function parseComment(line: string): [string, string] | null {
  let at = 0;
  while (at < line.length && /\s/.test(line[at]!)) at++;
  if (line[at] !== '#') return null;
  while (line[at] === '#') at++;
  while (at < line.length && /\s/.test(line[at]!)) at++;
  const text = line.slice(at);
  return /[\n\r\u2028\u2029]/.test(text) ? null : [line.slice(0, at), text];
}

/** One assignment's line with its value masked (an empty value stays empty). */
const maskAssignment = (name: string, value: string): string => (value.trim() === '' ? name : `${name}${REDACTED_SECRET}`);

/** The quote a value opens and leaves open at its line's end (`KEY="line one`), if any. */
type Quote = '"' | "'" | '`';

function openQuote(value: string): Quote | undefined {
  const trimmed = value.trimStart();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'" && quote !== '`') return undefined;
  return closes(trimmed.slice(1), quote) ? undefined : quote;
}

/** Whether `text` holds the closing `quote`: one not escaped with `\\` (for `"`, `'` and `` ` `` alike). */
const closes = (text: string, quote: Quote): boolean => {
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) if (at === 0 || text[at - 1] !== '\\') return true;
  return false;
};

/**
 * An environment file's text with every value masked: an assignment keeps
 * `NAME=` and its value becomes {@link REDACTED_SECRET}; inside a quoted
 * value left open across lines, every line is masked whole until its
 * closing quote; a comment keeps its `#` and its text is masked whole; a
 * blank line stays; any other line is masked whole. Line endings are kept.
 */
export function maskEnvironmentText(text: string): string {
  let open: Quote | undefined;
  return text
    .split(/(\r?\n)/)
    .map((part, index) => {
      // The odd parts are the line endings.
      if (index % 2 === 1) return part;
      if (open !== undefined) {
        // A multi-line value's continuation: masked whole, whatever it looks like (a base64 line ending `==`).
        if (closes(part, open)) open = undefined;
        return part.trim() === '' ? part : REDACTED_SECRET;
      }
      if (part.trim() === '') return part;
      const comment = parseComment(part);
      if (comment !== null) return comment[1] === '' ? part : `${comment[0]}${REDACTED_SECRET}`;
      const assignment = ASSIGNMENT.exec(part);
      if (assignment === null) return REDACTED_SECRET;
      open = openQuote(assignment[2]!);
      return maskAssignment(assignment[1]!, assignment[2]!);
    })
    .join('');
}

