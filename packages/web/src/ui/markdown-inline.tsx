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
  /** The characters of the lines in {@link cache}. */
  cachedChars: number;
}

/** Lines kept in an {@link InlineContext}'s cache before it starts over. */
const MAX_CACHED_LINES = 5_000;
/** Characters kept in that cache before it starts over: one long line streaming in can't fill memory. */
const MAX_CACHED_CHARS = 1_000_000;

/**
 * Links, images, strong and emphasis; code spans are found first by
 * {@link splitCodeSpans}. A link's text holds no `[`, so a run of brackets
 * is scanned once, not once per bracket.
 */
const INLINE =
  /!\[([^[\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)|\[([^[\]\n]+)\]\(((?:[^()\n]|\([^()\n]*\))*)\)|\*\*(\S(?:[^\n]*?\S)?)\*\*|(?<![A-Za-z0-9])__(\S(?:[^\n]*?\S)?)__(?![A-Za-z0-9])|\*(\S(?:[^\n]*?\S)?)\*|(?<![A-Za-z0-9_])_(\S(?:[^\n]*?\S)?)_(?![A-Za-z0-9_])/g;

/** A bare address in text (chat only): one greedy class, so no backtracking. */
const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<>"'`]+/gi;
/** Characters that end a sentence rather than an address. */
const TRAILING = /[.,;:!?'"\]}*]/;

/**
 * Characters that make an address read as something else: C0 and C1
 * controls, spaces, and invisible or direction-changing marks (zero-width
 * spaces and joiners, bidi overrides and isolates, line and paragraph
 * separators, the byte order mark).
 */
const UNSAFE_CHARACTERS = /[\u0000-\u0020\u007f-\u00a0\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\u3164\ufeff\uffa0]/;

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * The address a link may follow: an absolute http, https or mailto URL with
 * no space, control, invisible or direction-changing character and no user
 * name or password, normalized by `URL`; `null` for anything else (a
 * relative or file path, `javascript:`, `data:`, `file:`).
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
  if (target === '' || UNSAFE_CHARACTERS.test(target)) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
  if (url.protocol !== 'mailto:' && url.hostname === '') return null;
  // `https://trusted.com@evil.com`: an address with a user name or password is never followed.
  if (url.username !== '' || url.password !== '') return null;
  return url.href;
}

/**
 * A followable link: opens in a new tab with no access to this page, and
 * shows its full address under its line on hover and on keyboard focus (also
 * its accessible description). The address is placed against the whole
 * Markdown block (`relative` there), so it never runs past the message.
 */
function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  const hint = useId();
  return (
    <span data-slot="markdown-link-wrap" className="group/link">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        aria-describedby={hint}
        data-slot="markdown-link"
        className="break-words text-foreground underline underline-offset-2"
      >
        {children}
      </a>
      {/* Beside the link, not in it: the address is the link's description, never part of its name. */}
      <span
        id={hint}
        aria-hidden
        data-slot="markdown-link-address"
        className="pointer-events-none absolute left-0 z-10 mt-1 hidden w-max max-w-full rounded-sm border border-border bg-popover px-2 py-1 font-mono text-mono-compact break-all text-popover-foreground group-hover/link:block group-has-focus-visible/link:block"
      >
        {href}
      </span>
    </span>
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
    let opened = 0;
    let closed = 0;
    for (const char of address) {
      if (char === '(') opened++;
      else if (char === ')') closed++;
    }
    while (address.length > 0) {
      const last = address.at(-1)!;
      if (last === ')' ? closed <= opened : !TRAILING.test(last)) break;
      if (last === ')') closed--;
      address = address.slice(0, -1);
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
    // Where bare addresses sit (chat): `_`, `__` or `*` inside one (`pkg/__init__.py`) is part of the address.
    const addresses = linking ? [...segment.matchAll(BARE_URL)].map((found) => [found.index, found.index + found[0].length] as const) : [];
    const insideAddress = (at: number) => addresses.some(([from, to]) => at > from && at < to);
    let last = 0;
    const pattern = new RegExp(INLINE);
    for (let match = pattern.exec(segment); match !== null; match = pattern.exec(segment)) {
      const at = match.index;
      if (match[0][0] !== '[' && match[0][0] !== '!' && insideAddress(at)) {
        pattern.lastIndex = at + 1;
        continue;
      }
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
  // A long line is plain text: nothing to keep.
  if (text.length > MAX_INLINE_LENGTH) return nodes;
  if (context.cache.size >= MAX_CACHED_LINES || context.cachedChars + text.length > MAX_CACHED_CHARS) {
    context.cache.clear();
    context.cachedChars = 0;
  }
  context.cache.set(text, nodes);
  context.cachedChars += text.length;
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
