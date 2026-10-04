/**
 * The block parser behind {@link Markdown} (story 4.7, extended for the chat
 * by the chat-Markdown story): text in, a tree of plain objects out, never
 * HTML. Every pattern here runs on one line at most {@link MAX_INLINE_LENGTH}
 * long and none backtracks, so a hostile text can't make parsing quadratic
 * in its length; nesting stops at {@link MAX_DEPTH}.
 */

/** Deeper quotes or lists than this render as plain text: a hostile file can't exhaust the stack. */
export const MAX_DEPTH = 8;

/**
 * A line or text longer than this shows as plain text: no block or inline
 * pattern runs on it, so a hostile line can't make the parse quadratic.
 */
export const MAX_INLINE_LENGTH = 4_000;

/** A table with more columns than this is a paragraph. */
const MAX_TABLE_COLUMNS = 64;

export type Align = 'left' | 'center' | 'right' | undefined;

/** One list item: its blocks, and its checkbox when it is a task (`- [ ]` / `- [x]`). */
export interface ListItem {
  task: 'done' | 'open' | undefined;
  blocks: Block[];
}

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string; language: string | undefined }
  | { kind: 'rule' }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'table'; align: Align[]; head: string[]; rows: string[][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_MARKER = /^( *)([-*+]|\d{1,9}[.)])[ \t]/;
const QUOTE_MARKER = /^ {0,3}>/;
const HEADING_MARKER = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const TASK_MARKER = /^\[([ xX])\](?:[ \t]|$)/;
const DELIMITER_CELL = /^:?-+:?$/;
/** A fence's language: the info string's first word, when it is a plain name. */
const LANGUAGE = /^[A-Za-z0-9+#._-]{1,32}$/;

const isLong = (line: string) => line.length > MAX_INLINE_LENGTH;
const isSpace = (char: string | undefined) => char === ' ' || char === '\t';

/** `text` without a leading `---` frontmatter block (closed by `---` or `...`). */
export function withoutFrontmatter(text: string): string {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return lines.join('\n');
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
  return end === -1 ? lines.join('\n') : lines.slice(end + 1).join('\n');
}

/** An ATX heading's level and text, its closing `#`s and spaces stripped by hand (no backtracking); `null` otherwise. */
function headingOf(line: string): { level: number; text: string } | null {
  if (isLong(line)) return null;
  const marker = HEADING_MARKER.exec(line);
  if (marker === null) return null;
  const from = marker[0].length;
  let end = line.length;
  while (end > from && isSpace(line[end - 1])) end--;
  let hashes = end;
  while (hashes > from && line[hashes - 1] === '#') hashes--;
  // A closing run of `#` counts only after a space (or as the whole text).
  if (hashes < end && (hashes === from || isSpace(line[hashes - 1]))) {
    end = hashes;
    while (end > from && isSpace(line[end - 1])) end--;
  }
  let begin = from;
  while (begin < end && isSpace(line[begin])) begin++;
  return { level: marker[1]!.length, text: line.slice(begin, end) };
}

/** A list item's indent, marker and text; `null` otherwise. */
function listItemOf(line: string): { indent: number; marker: string; text: string } | null {
  if (isLong(line)) return null;
  const marker = LIST_MARKER.exec(line);
  if (marker === null) return null;
  return { indent: marker[1]!.length, marker: marker[2]!, text: line.slice(marker[0].length).trimStart() };
}

/** A quoted line's text after `>` and one optional space; `null` otherwise. */
function quoteOf(line: string): string | null {
  if (isLong(line)) return null;
  const marker = QUOTE_MARKER.exec(line);
  if (marker === null) return null;
  const rest = line.slice(marker[0].length);
  return rest.startsWith(' ') ? rest.slice(1) : rest;
}

/**
 * A table row's cells, by one scan: `|` splits, `\|` is a literal pipe, and
 * one leading and one trailing `|` are dropped. `null` when the line has no
 * unescaped `|`, is long, or has too many cells.
 */
export function tableCells(line: string): string[] | null {
  if (isLong(line)) return null;
  const text = line.trim();
  const cells: string[] = [];
  let cell = '';
  let pipes = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (char === '\\' && text[at + 1] === '|') {
      cell += '|';
      at++;
    } else if (char === '|') {
      pipes++;
      // A leading pipe opens the row; it ends no cell.
      if (at > 0) cells.push(cell.trim());
      cell = '';
      if (cells.length > MAX_TABLE_COLUMNS) return null;
    } else {
      cell += char;
    }
  }
  if (pipes === 0) return null;
  // A trailing pipe closes the row; anything after the last pipe is a cell.
  if (!text.endsWith('|') || text.endsWith('\\|')) cells.push(cell.trim());
  return cells;
}

/** The alignments of a delimiter row (`| --- | :-: |`) with `columns` cells; `null` when it isn't one. */
function delimiterOf(line: string, columns: number): Align[] | null {
  const cells = tableCells(line);
  if (cells === null || cells.length !== columns) return null;
  const align: Align[] = [];
  for (const cell of cells) {
    if (!DELIMITER_CELL.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : undefined);
  }
  return align;
}

/** A table's header cells and alignments when `lines[index]` starts one; `null` otherwise. */
function tableStartAt(lines: readonly string[], index: number): { head: string[]; align: Align[] } | null {
  const next = lines[index + 1];
  if (next === undefined) return null;
  const head = tableCells(lines[index]!);
  if (head === null || head.length === 0) return null;
  const align = delimiterOf(next, head.length);
  return align === null ? null : { head, align };
}

const isBlank = (line: string) => line.trim() === '';
const isRule = (line: string) => !isLong(line) && RULE.test(line);
const startsBlock = (line: string) =>
  !isLong(line) && (FENCE.test(line) || headingOf(line) !== null || isRule(line) || quoteOf(line) !== null || listItemOf(line) !== null);

/** A list item's checkbox and the text after it. */
function taskOf(text: string): { task: ListItem['task']; text: string } {
  const marker = TASK_MARKER.exec(text);
  if (marker === null) return { task: undefined, text };
  return { task: marker[1] === ' ' ? 'open' : 'done', text: text.slice(marker[0].length) };
}

/** The blocks of `lines`, up to {@link MAX_DEPTH} levels of quotes and lists. */
export function parseBlocks(lines: readonly string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (isBlank(line)) {
      index++;
      continue;
    }
    // A very long line is plain text on its own, before any block pattern runs on it.
    if (isLong(line)) {
      blocks.push({ kind: 'paragraph', text: line.trim() });
      index++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1]!;
      const info = line.slice(fence[0].length).trim().split(/[ \t]/, 1)[0] ?? '';
      // Closed by a line of at least as many of the same character, and nothing else.
      const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
      const body: string[] = [];
      index++;
      // An unclosed fence (a reply still streaming) runs to the end: the rest stays code until it closes.
      while (index < lines.length && (isLong(lines[index]!) || !closing.test(lines[index]!))) {
        body.push(lines[index]!);
        index++;
      }
      // The closing fence (or the end of the document).
      index++;
      blocks.push({ kind: 'code', text: body.join('\n'), language: LANGUAGE.test(info) ? info : undefined });
      continue;
    }
    if (isRule(line)) {
      blocks.push({ kind: 'rule' });
      index++;
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      // A heading with no text shows nothing.
      if (heading.text !== '') blocks.push({ kind: 'heading', level: heading.level, text: heading.text });
      index++;
      continue;
    }
    if (quoteOf(line) !== null && depth < MAX_DEPTH) {
      const inner: string[] = [];
      while (index < lines.length && !isBlank(lines[index]!)) {
        const current = lines[index]!;
        const quoted = quoteOf(current);
        // A line without `>` continues the quote's paragraph (lazy continuation), unless it starts a block.
        if (quoted === null && (inner.length === 0 || startsBlock(current))) break;
        inner.push(quoted ?? current);
        index++;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(inner, depth + 1) });
      continue;
    }
    const first = listItemOf(line);
    if (first !== null && depth < MAX_DEPTH) {
      const ordered = /\d/.test(first.marker);
      const indent = first.indent;
      const items: string[][] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        if (isLong(current)) break;
        const item = listItemOf(current);
        if (item !== null && item.indent <= indent + 1 && /\d/.test(item.marker) === ordered) {
          items.push([item.text]);
          index++;
          continue;
        }
        if (isBlank(current)) {
          // A blank line ends the list unless an indented line or another item follows.
          const following = lines[index + 1];
          if (following !== undefined && !isLong(following) && (/^\s{2,}\S/.test(following) || (listItemOf(following)?.indent ?? Infinity) <= indent + 1)) {
            items.at(-1)!.push('');
            index++;
            continue;
          }
          break;
        }
        // An indented line belongs to the item; an unindented one continues its paragraph unless it starts a block.
        if (/^\s{2,}\S/.test(current) || !startsBlock(current)) {
          items.at(-1)!.push(current.replace(new RegExp(`^ {0,${indent + 4}}`), ''));
          index++;
          continue;
        }
        break;
      }
      const start = ordered ? Number.parseInt(first.marker, 10) : 1;
      blocks.push({
        kind: 'list',
        ordered,
        start,
        items: items.map(([head = '', ...rest]) => {
          const { task, text } = taskOf(head);
          return { task, blocks: parseBlocks([text, ...rest], depth + 1) };
        }),
      });
      continue;
    }
    const table = tableStartAt(lines, index);
    if (table !== null) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && !isBlank(lines[index]!) && !startsBlock(lines[index]!)) {
        const cells = tableCells(lines[index]!) ?? [lines[index]!.trim()];
        // Each row has the header's columns: extra cells are dropped, missing ones are empty.
        rows.push(Array.from({ length: table.head.length }, (_, column) => cells[column] ?? ''));
        index++;
      }
      blocks.push({ kind: 'table', align: table.align, head: table.head, rows });
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      !isBlank(lines[index]!) &&
      (paragraph.length === 0 || (!startsBlock(lines[index]!) && tableStartAt(lines, index) === null))
    ) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

/**
 * `text` split into code spans and the text between them, by a linear scan:
 * a run of backticks opens a span closed by the next run of the same length;
 * a run with no such closer stays text. A length found to have no closer is
 * never searched for again.
 */
export function splitCodeSpans(text: string): Array<{ kind: 'text' | 'code'; value: string }> {
  const parts: Array<{ kind: 'text' | 'code'; value: string }> = [];
  const noCloser = new Set<number>();
  let last = 0;
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('`', at);
    if (open === -1) break;
    let length = 1;
    while (text[open + length] === '`') length++;
    let close = -1;
    if (!noCloser.has(length)) {
      const run = '`'.repeat(length);
      let from = open + length;
      for (;;) {
        const found = text.indexOf(run, from);
        if (found === -1) break;
        let size = 0;
        while (text[found + size] === '`') size++;
        if (size === length) {
          close = found;
          break;
        }
        from = found + size;
      }
      if (close === -1) noCloser.add(length);
    }
    if (close === -1) {
      at = open + length;
      continue;
    }
    if (open > last) parts.push({ kind: 'text', value: text.slice(last, open) });
    const code = text.slice(open + length, close);
    parts.push({ kind: 'code', value: code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') ? code.slice(1, -1) : code });
    last = at = close + length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}
