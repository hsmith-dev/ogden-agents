import { Fragment, useId, type ReactNode } from 'react';
import { MAX_DEPTH, MAX_INLINE_LENGTH, splitCodeSpans } from './markdown-parse';

/**
 * Inline Markdown (story 4.7; links and soft breaks for the chat by the
 * chat-Markdown story): code spans, links, images, strong and emphasis
 * within one line, as React elements. Every other character is text, raw
 * HTML included.
 *
 * `document` (the document sheet, 4.7's decision): a link or an image is its
 * text, a soft break a space. `chat` (an agent's reply): a link whose address
 * is http, https or mailto opens in a new tab, any other is its text; an
 * image is a link to its address, never loaded; a bare web address is a
 * link; a soft break is a line break.
 */
export type MarkdownVariant = 'document' | 'chat';

/** Inline rendering state for one {@link Markdown}: its variant and the lines already rendered. */
export interface InlineContext {
  variant: MarkdownVariant;
  /**
   * Rendered lines by their text, kept across renders of one message: while
   * a reply streams only its newest lines are rendered again, and an
   * unchanged line hands React the same elements.
   */
  cache: Map<string, ReactNode[]>;
}

/** Lines kept in an {@link InlineContext}'s cache before it starts over. */
const MAX_CACHED_LINES = 5_000;

/** Links, images, strong and emphasis; code spans are found first by {@link splitCodeSpans}. */
const INLINE =
  /!\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)|\[([^\]\n]+)\]\(((?:[^()\n]|\([^()\n]*\))*)\)|\*\*(\S(?:[^\n]*?\S)?)\*\*|__(\S(?:[^\n]*?\S)?)__|\*(\S(?:[^\n]*?\S)?)\*|(?<![A-Za-z0-9])_(\S(?:[^\n]*?\S)?)_(?![A-Za-z0-9])/g;

/** A bare address in text (chat only): one greedy class, so no backtracking. */
const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<>"'`]+/gi;
/** Characters that end a sentence rather than an address. */
const TRAILING = /[.,;:!?'")\]}*_]/;

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * The address a link may follow: an absolute http, https or mailto URL with
 * no space or control character, normalized by `URL`; `null` for anything
 * else (a relative or file path, `javascript:`, `data:`, `file:`).
 */
export function safeHref(destination: string): string | null {
  let target = destination.trim();
  // `<url>` or `url "title"`: the address only.
  if (target.startsWith('<')) {
    const end = target.indexOf('>');
    if (end === -1) return null;
    target = target.slice(1, end);
  } else {
    target = target.split(/[ \t]/, 1)[0] ?? '';
  }
  if (target === '' || /[\u0000- \u007f-\u009f]/.test(target)) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol !== 'mailto:' && url.hostname === '') return null;
  return url.href;
}

/**
 * A followable link: opens in a new tab with no access to this page, and
 * shows its full address under it on hover and on keyboard focus (also its
 * accessible description).
 */
function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  const hint = useId();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-describedby={hint}
      data-slot="markdown-link"
      className="group/link relative break-words text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
    >
      {children}
      <span
        id={hint}
        data-slot="markdown-link-address"
        className="pointer-events-none absolute top-full left-0 z-10 mt-1 hidden w-max max-w-[min(32rem,80vw)] rounded-sm border border-border bg-popover px-2 py-1 font-mono text-mono-compact break-all text-popover-foreground no-underline group-hover/link:block group-focus-visible/link:block"
      >
        {href}
      </span>
    </a>
  );
}

/** Pushes plain `text` onto `nodes`, its bare web and mail addresses as links when `linking` (chat). */
function pushText(nodes: ReactNode[], text: string, linking: boolean) {
  if (!linking) {
    nodes.push(text);
    return;
  }
  let last = 0;
  for (const match of text.matchAll(BARE_URL)) {
    let address = match[0];
    // A sentence's closing punctuation, and a `)` the address didn't open, stay text.
    while (address.length > 0 && TRAILING.test(address.at(-1)!)) address = address.slice(0, -1);
    let opened = 0;
    for (const char of address) if (char === '(') opened++;
    let closed = 0;
    for (const char of address) if (char === ')') closed++;
    while (closed > opened && address.endsWith(')')) {
      address = address.slice(0, -1);
      closed--;
    }
    const href = safeHref(address);
    if (href === null) continue;
    const at = match.index;
    // `<https://…>` (an autolink): the brackets go with the link.
    const bracketed = text[at - 1] === '<' && text[at + address.length] === '>';
    const from = bracketed ? at - 1 : at;
    if (from > last) nodes.push(text.slice(last, from));
    nodes.push(
      <SafeLink key={nodes.length} href={href}>
        {address}
      </SafeLink>,
    );
    last = at + address.length + (bracketed ? 1 : 0);
  }
  if (last < text.length) nodes.push(text.slice(last));
}

/**
 * One line's inline elements, nested at most {@link MAX_DEPTH} deep.
 * `linking`: bare addresses become links (chat, outside a link's own text).
 */
function line(text: string, context: InlineContext, depth: number, linking: boolean): ReactNode[] {
  if (depth > MAX_DEPTH || text.length > MAX_INLINE_LENGTH) return [text];
  const chat = context.variant === 'chat';
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
      if (at > last) pushText(nodes, segment.slice(last, at), linking);
      const key = nodes.length;
      const [, alt, imageTarget, linkText, linkTarget, strong1, strong2, em1, em2] = match;
      if (alt !== undefined) {
        // An image is never loaded: in the chat, a link to it.
        const href = chat ? safeHref(imageTarget ?? '') : null;
        nodes.push(
          href === null ? (
            alt
          ) : (
            <SafeLink key={key} href={href}>
              {`Image: ${alt.trim() === '' ? 'untitled' : alt}`}
            </SafeLink>
          ),
        );
      } else if (linkText !== undefined) {
        const href = chat ? safeHref(linkTarget ?? '') : null;
        const label = line(linkText, context, depth + 1, false);
        // A link to anything but a web or mail address (and every link in a document) is its text only.
        nodes.push(
          href === null ? (
            <span key={key}>{label}</span>
          ) : (
            <SafeLink key={key} href={href}>
              {label}
            </SafeLink>
          ),
        );
      } else if (strong1 !== undefined || strong2 !== undefined) {
        nodes.push(<strong key={key}>{line((strong1 ?? strong2)!, context, depth + 1, linking)}</strong>);
      } else {
        nodes.push(<em key={key}>{line((em1 ?? em2)!, context, depth + 1, linking)}</em>);
      }
      last = at + match[0].length;
    }
    if (last < segment.length) pushText(nodes, segment.slice(last), linking);
  }
  return nodes;
}

/** A whole line, from the cache when this message rendered it before. */
function cachedLine(text: string, context: InlineContext): ReactNode[] {
  const hit = context.cache.get(text);
  if (hit !== undefined) return hit;
  const nodes = line(text, context, 0, context.variant === 'chat');
  if (context.cache.size >= MAX_CACHED_LINES) context.cache.clear();
  context.cache.set(text, nodes);
  return nodes;
}

/**
 * `text`'s inline elements, each line on its own: a soft break is a space
 * in a document and a line break in the chat; a very long line is plain text.
 */
export function inline(text: string, context: InlineContext): ReactNode[] {
  if (!text.includes('\n')) return cachedLine(text, context);
  return text.split('\n').map((each, index) => (
    <Fragment key={index}>
      {index === 0 ? null : context.variant === 'chat' ? <br /> : '\n'}
      {cachedLine(each, context)}
    </Fragment>
  ));
}
