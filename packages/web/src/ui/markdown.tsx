import { Fragment, useMemo, type ComponentProps, type ReactNode } from 'react';
import { cn } from './utils';

/**
 * Markdown, read-only and safe (story 4.7's document sheet): a small subset
 * rendered as React elements, never as HTML. Headings, paragraphs, bullet
 * and numbered lists, fenced and inline code, emphasis and strong, block
 * quotes and rules. A link shows as its text only (no `href`, so no
 * `javascript:` or other URL is ever followed), an image as its alt text,
 * raw HTML as the text it is, and a leading YAML frontmatter block is hidden.
 * No dependency: everything else stays plain text.
 */

/** Deeper quotes or lists than this render as plain text: a hostile file can't exhaust the stack. */
const MAX_DEPTH = 8;

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_MARKER = /^( *)([-*+]|\d{1,9}[.)])[ \t]/;
const QUOTE_MARKER = /^ {0,3}>/;
const HEADING_MARKER = /^ {0,3}(#{1,6})(?:[ \t]|$)/;

/**
 * A line or text longer than this shows as plain text: no block or inline
 * pattern runs on it, so a hostile line can't make the parse quadratic.
 */
const MAX_INLINE_LENGTH = 4_000;

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

const isBlank = (line: string) => line.trim() === '';
const isRule = (line: string) => !isLong(line) && RULE.test(line);
const startsBlock = (line: string) =>
  !isLong(line) && (FENCE.test(line) || headingOf(line) !== null || isRule(line) || quoteOf(line) !== null || listItemOf(line) !== null);

/** The blocks of `lines`, up to {@link MAX_DEPTH} levels of quotes and lists. */
function parseBlocks(lines: readonly string[], depth = 0): Block[] {
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
      // Closed by a line of at least as many of the same character, and nothing else.
      const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
      const body: string[] = [];
      index++;
      while (index < lines.length && (isLong(lines[index]!) || !closing.test(lines[index]!))) {
        body.push(lines[index]!);
        index++;
      }
      // The closing fence (or the end of the document).
      index++;
      blocks.push({ kind: 'code', text: body.join('\n') });
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
      blocks.push({ kind: 'list', ordered, start, items: items.map((item) => parseBlocks(item, depth + 1)) });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && !isBlank(lines[index]!) && (paragraph.length === 0 || !startsBlock(lines[index]!))) {
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

/**
 * Links and images (as their text), strong and emphasis, within one line.
 * Every other character is text, raw HTML included. Code spans are found
 * first by {@link splitCodeSpans}.
 */
const INLINE =
  /!\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)|\[([^\]\n]+)\]\((?:[^()\n]|\([^()\n]*\))*\)|\*\*(\S(?:[^\n]*?\S)?)\*\*|__(\S(?:[^\n]*?\S)?)__|\*(\S(?:[^\n]*?\S)?)\*|(?<![A-Za-z0-9])_(\S(?:[^\n]*?\S)?)_(?![A-Za-z0-9])/g;

function inline(text: string, depth = 0): ReactNode[] {
  if (depth > MAX_DEPTH) return [text];
  // Each line on its own (a soft break shows as a space), and a very long line as plain text.
  if (text.includes('\n')) {
    return text.split('\n').map((line, index) => (
      <Fragment key={index}>
        {index === 0 ? null : '\n'}
        {inline(line, depth)}
      </Fragment>
    ));
  }
  if (isLong(text)) return [text];
  const nodes: ReactNode[] = [];
  for (const part of splitCodeSpans(text)) {
    if (part.kind === 'code') {
      nodes.push(
        <code key={nodes.length} className="rounded-sm bg-muted px-1 font-mono text-mono-compact">
          {part.value}
        </code>,
      );
      continue;
    }
    const segment = part.value;
    let last = 0;
    for (const match of segment.matchAll(INLINE)) {
      const at = match.index;
      if (at > last) nodes.push(segment.slice(last, at));
      const key = nodes.length;
      const [, alt, linkText, strong1, strong2, em1, em2] = match;
      if (alt !== undefined) {
        nodes.push(alt);
      } else if (linkText !== undefined) {
        // A link is its text only: no href, nothing to follow.
        nodes.push(<span key={key}>{inline(linkText, depth + 1)}</span>);
      } else if (strong1 !== undefined || strong2 !== undefined) {
        nodes.push(<strong key={key}>{inline((strong1 ?? strong2)!, depth + 1)}</strong>);
      } else {
        nodes.push(<em key={key}>{inline((em1 ?? em2)!, depth + 1)}</em>);
      }
      last = at + match[0].length;
    }
    if (last < segment.length) nodes.push(segment.slice(last));
  }
  return nodes;
}

/** A heading's tag: the document's levels start under the sheet's own title (`h2`), each level its own element as far as `h6` allows. */
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;
const HEADING_CLASSES = ['text-title', 'text-heading', 'text-label', 'text-label', 'text-label', 'text-label'] as const;

function renderBlocks(blocks: readonly Block[], tight = false): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const Tag = HEADING_TAGS[block.level - 1]!;
        return (
          <Tag key={index} className={cn('m-0 break-words text-foreground', HEADING_CLASSES[block.level - 1])}>
            {inline(block.text)}
          </Tag>
        );
      }
      case 'paragraph':
        return tight ? (
          <span key={index} className="block break-words">
            {inline(block.text)}
          </span>
        ) : (
          <p key={index} className="m-0 break-words">
            {inline(block.text)}
          </p>
        );
      case 'code':
        return (
          <pre key={index} className="m-0 overflow-x-auto rounded-md bg-muted p-3 font-mono text-mono-compact">
            <code>{block.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={index} className="m-0 border-0 border-t border-border" />;
      case 'quote':
        return (
          <blockquote key={index} className="m-0 flex flex-col gap-2 border-l-2 border-border pl-3 text-muted-foreground">
            {renderBlocks(block.blocks)}
          </blockquote>
        );
      case 'list': {
        const items = block.items.map((item, position) => (
          <li key={position} className="break-words">
            <div className="flex flex-col gap-1">{renderBlocks(item, true)}</div>
          </li>
        ));
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start} className="m-0 flex list-decimal flex-col gap-1 pl-6">
            {items}
          </ol>
        ) : (
          <ul key={index} className="m-0 flex list-disc flex-col gap-1 pl-6">
            {items}
          </ul>
        );
      }
    }
  });
}

export interface MarkdownProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The Markdown text. */
  source: string;
}

/** Renders `source` as the safe subset this file describes. */
export function Markdown({ source, className, ...props }: MarkdownProps) {
  // Parsed once per text: the session view re-renders on every event.
  const blocks = useMemo(() => parseBlocks(withoutFrontmatter(source).split(/\r?\n/)), [source]);
  return (
    <div data-slot="markdown" className={cn('flex flex-col gap-3 text-body text-foreground', className)} {...props}>
      {renderBlocks(blocks)}
    </div>
  );
}
