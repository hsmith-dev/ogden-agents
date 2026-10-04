import { useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { CodeBlock } from './code-block';
import { inline, type InlineContext, type MarkdownVariant } from './markdown-inline';
import { parseBlocks, withoutFrontmatter, type Align, type Block } from './markdown-parse';
import { cn } from './utils';

export { splitCodeSpans, withoutFrontmatter } from './markdown-parse';
export { safeHref, type MarkdownVariant } from './markdown-inline';

/**
 * Markdown, read-only and safe: the one renderer for the document sheet
 * (story 4.7) and an agent's replies in the chat (the chat-Markdown story).
 * A subset rendered as React elements, never as HTML: headings, paragraphs,
 * bullet, numbered and task lists, tables, fenced code (with its language
 * and Copy) and inline code, emphasis and strong, block quotes and rules.
 * Raw HTML shows as the text it is, an image is never loaded, and a leading
 * YAML frontmatter block is hidden. Links follow the variant (see
 * `markdown-inline.tsx`): text only in a document; in the chat, http, https
 * and mailto addresses open in a new tab and any other is text.
 * No dependency: everything else stays plain text.
 */

/**
 * A text longer than this renders its first part as Markdown and the rest
 * as plain text, so a huge reply can't hold the tab.
 */
export const MAX_MARKDOWN_LENGTH = 200_000;

/** While a reply streams, it is parsed again at most this often. */
export const STREAMING_RENDER_MS = 100;

/** A heading's tag: the document's levels start under the sheet's own title (`h2`), each level its own element as far as `h6` allows. */
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;
const HEADING_CLASSES = ['text-title', 'text-heading', 'text-label', 'text-label', 'text-label', 'text-label'] as const;
const ALIGN_CLASSES = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

const alignClass = (align: Align) => (align === undefined ? 'text-left' : ALIGN_CLASSES[align]);

function renderBlocks(blocks: readonly Block[], context: InlineContext, tight = false): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case 'heading': {
        const Tag = HEADING_TAGS[block.level - 1]!;
        return (
          <Tag key={index} className={cn('m-0 break-words text-foreground', HEADING_CLASSES[block.level - 1])}>
            {inline(block.text, context)}
          </Tag>
        );
      }
      case 'paragraph':
        return tight ? (
          <span key={index} className="block break-words">
            {inline(block.text, context)}
          </span>
        ) : (
          <p key={index} className="m-0 break-words">
            {inline(block.text, context)}
          </p>
        );
      case 'code':
        return <CodeBlock key={index} text={block.text} language={block.language} />;
      case 'rule':
        return <hr key={index} className="m-0 border-0 border-t border-border" />;
      case 'quote':
        return (
          <blockquote key={index} className="m-0 flex flex-col gap-2 border-l-2 border-border pl-3 text-muted-foreground">
            {renderBlocks(block.blocks, context)}
          </blockquote>
        );
      case 'table':
        return (
          // Focusable so a keyboard can scroll a wide table.
          <div key={index} tabIndex={0} role="group" aria-label="Table" data-slot="markdown-table" className="max-w-full overflow-x-auto">
            <table className="border-collapse text-body">
              <thead>
                <tr>
                  {block.head.map((cell, column) => (
                    <th key={column} scope="col" className={cn('border border-border bg-muted px-3 py-1.5 align-top font-semibold', alignClass(block.align[column]))}>
                      {inline(cell, context)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, position) => (
                  <tr key={position}>
                    {row.map((cell, column) => (
                      <td key={column} className={cn('border border-border px-3 py-1.5 align-top', alignClass(block.align[column]))}>
                        {inline(cell, context)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const tasks = block.items.some((item) => item.task !== undefined);
        const items = block.items.map((item, position) => (
          <li key={position} className={cn('break-words', item.task !== undefined && 'list-none')}>
            <div className={cn('flex gap-2', item.task === undefined && 'flex-col gap-1')}>
              {item.task !== undefined ? (
                <input
                  type="checkbox"
                  checked={item.task === 'done'}
                  disabled
                  readOnly
                  data-slot="markdown-task"
                  className="mt-1 size-3.5 shrink-0 accent-foreground"
                />
              ) : null}
              <div className="flex min-w-0 flex-col gap-1">{renderBlocks(item.blocks, context, true)}</div>
            </div>
          </li>
        ));
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start} className={cn('m-0 flex list-decimal flex-col gap-1', tasks ? 'pl-1' : 'pl-6')}>
            {items}
          </ol>
        ) : (
          <ul key={index} className={cn('m-0 flex list-disc flex-col gap-1', tasks ? 'pl-1' : 'pl-6')}>
            {items}
          </ul>
        );
      }
    }
  });
}

/**
 * `source` while it is final; while `streaming`, its latest value at most
 * every {@link STREAMING_RENDER_MS}, the last one always shown.
 */
function useStreamedSource(source: string, streaming: boolean): string {
  const [shown, setShown] = useState(source);
  const lastShown = useRef(0);
  useEffect(() => {
    if (!streaming) return;
    const wait = STREAMING_RENDER_MS - (Date.now() - lastShown.current);
    const show = () => {
      lastShown.current = Date.now();
      setShown(source);
    };
    if (wait <= 0) {
      show();
      return;
    }
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
  }, [source, streaming]);
  return streaming ? shown : source;
}

export interface MarkdownProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The Markdown text. */
  source: string;
  /** `document` (default): the document sheet's rules; `chat`: an agent's reply (followable safe links, line breaks kept). */
  variant?: MarkdownVariant;
  /** The text is still arriving: it is parsed again at most every {@link STREAMING_RENDER_MS}. */
  streaming?: boolean;
}

/** Renders `source` as the safe subset this file describes. */
export function Markdown({ source, variant = 'document', streaming = false, className, ...props }: MarkdownProps) {
  // While streaming, parsed at most every 100 ms, and at low priority so typing stays quick.
  const text = useDeferredValue(useStreamedSource(source, streaming));
  // One cache per message: an unchanged line keeps its elements as more text arrives.
  const context = useMemo<InlineContext>(() => ({ variant, cache: new Map() }), [variant]);
  const head = text.length > MAX_MARKDOWN_LENGTH ? text.slice(0, MAX_MARKDOWN_LENGTH) : text;
  const rest = text.length > MAX_MARKDOWN_LENGTH ? text.slice(MAX_MARKDOWN_LENGTH) : '';
  // Parsed once per text: the session view re-renders on every event.
  const blocks = useMemo(() => parseBlocks(withoutFrontmatter(head).split(/\r?\n/)), [head]);
  const rendered = useMemo(() => renderBlocks(blocks, context), [blocks, context]);
  return (
    <div data-slot="markdown" data-variant={variant} className={cn('flex min-w-0 flex-col gap-3 text-body text-foreground', className)} {...props}>
      {rendered}
      {rest === '' ? null : (
        <p data-slot="markdown-rest" className="m-0 break-words whitespace-pre-wrap">
          {rest}
        </p>
      )}
    </div>
  );
}
