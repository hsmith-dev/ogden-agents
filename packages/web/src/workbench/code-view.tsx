import { Check, Copy } from '@phosphor-icons/react';
import { WORKSPACE_FILE_COPIED_TEXT, WORKSPACE_FILE_COPY_FAILED_TEXT, WORKSPACE_FILE_COPY_PATH_LABEL } from '@ogden-agents/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';

/** How long "Copied" or "Couldn't copy" shows before Copy path comes back. */
const COPY_FEEDBACK_MS = 2_000;

/** A line's content as shown: the hook a highlighter (8.3) fills; absent, the text exactly as sent. */
export type RenderLine = (line: string, index: number) => ReactNode;

/** A file's text as lines: a last line ending (of any kind) ends the last line; it doesn't start another. */
export const linesOf = (text: string): string[] => text.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);

/**
 * The Files panel's viewer (AD-36): the file's path over its text, read-only,
 * one row per line with its number. Long lines wrap rather than scroll
 * sideways, so the page fits a phone. No colour of its own: `renderLine` is
 * where a highlighter goes. `line` (a `file:line` link, 8.7) is scrolled into
 * view and highlighted until the next click; past the end, nothing is.
 */
export function CodeView({
  path,
  text,
  notice,
  line,
  actions,
  renderLine,
}: {
  path: string;
  text: string;
  notice?: ReactNode;
  line?: number | undefined;
  /** Beside Copy path in the header (Show source). */
  actions?: ReactNode;
  renderLine?: RenderLine | undefined;
}) {
  const lines = linesOf(text);
  const target = line !== undefined && line >= 1 && line <= lines.length ? line : undefined;
  const [highlighted, setHighlighted] = useState(target);
  const targetRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setHighlighted(target);
    if (target === undefined) return;
    targetRow.current?.scrollIntoView?.({ block: 'center' });
    // Until the next click anywhere.
    const clear = () => setHighlighted(undefined);
    document.addEventListener('pointerdown', clear, { once: true });
    return () => document.removeEventListener('pointerdown', clear);
  }, [target]);
  return (
    <section aria-label={path} data-testid="code-view" className="flex min-w-0 flex-col rounded-md border border-border bg-card">
      <ViewerHeader path={path} actions={actions} />
      {notice === undefined ? null : <div className="border-b border-border px-3 py-2">{notice}</div>}
      {/* Focusable so a keyboard can scroll a long file (WCAG 2.1.1). */}
      <Text as="div" variant="mono-compact" tabIndex={0} role="group" aria-label={`Contents of ${path}`} data-testid="code-lines" className="min-w-0 py-2 text-foreground">
        {lines.map((each, index) => {
          const number = index + 1;
          const current = highlighted === number;
          return (
            <div
              key={index}
              ref={number === target ? targetRow : undefined}
              className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3', current && 'bg-signal-subtle')}
              data-testid="code-line"
              data-line={number}
              data-highlighted={current ? 'true' : undefined}
              aria-current={current ? 'location' : undefined}
            >
              <span aria-hidden className="text-right text-muted-foreground tabular-nums select-none" data-testid="code-line-number">
                {number}
              </span>
              <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{renderLine === undefined ? each : renderLine(each, index)}</span>
            </div>
          );
        })}
      </Text>
    </section>
  );
}

/** Copy path: the workspace-relative path, never a real one, with "Copied" for a moment. */
export function CopyPathButton({ path }: { path: string }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copy === 'idle') return;
    const timer = setTimeout(() => setCopy('idle'), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copy]);
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(path).then(
        () => setCopy('copied'),
        () => setCopy('failed'),
      );
    } catch {
      setCopy('failed');
    }
  };
  const words = copy === 'copied' ? WORKSPACE_FILE_COPIED_TEXT : copy === 'failed' ? WORKSPACE_FILE_COPY_FAILED_TEXT : '';
  return (
    <>
      <Button variant="ghost" size="sm" onClick={onCopy} aria-label={WORKSPACE_FILE_COPY_PATH_LABEL} data-testid="copy-path">
        {copy === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
        {/* The word in place of the label for a moment, as Copy does on a code block. */}
        <span aria-hidden>{words === '' ? WORKSPACE_FILE_COPY_PATH_LABEL : words}</span>
      </Button>
      <span role="status" className="sr-only" data-testid="copy-path-status">
        {words}
      </span>
    </>
  );
}

/** The viewer's path line with Copy path (and any `actions`), alone over a state (protected, binary, too large, an error). */
export function ViewerHeader({ path, actions }: { path: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
      {/* The file's heading under the page's own: a rendered markdown file's headings come after it. */}
      <Text as="h2" variant="mono-compact" className="m-0 min-w-0 break-all" data-testid="code-view-path">
        {path}
      </Text>
      <div className="flex flex-wrap items-center gap-1">
        {actions}
        <CopyPathButton path={path} />
      </div>
    </div>
  );
}

/** The viewer framing a one-sentence state instead of text, with an optional detail under it (a file's size). */
export function ViewerState({ path, children, testId, detail }: { path: string | undefined; children: ReactNode; testId: string; detail?: ReactNode }) {
  return (
    <section aria-label={path ?? 'File'} className="flex min-w-0 flex-col rounded-md border border-border bg-card">
      {path === undefined ? null : <ViewerHeader path={path} />}
      <div className="flex flex-col gap-1 p-3">
        <Text variant="body" tone="muted" data-testid={testId} role="status">
          {children}
        </Text>
        {detail === undefined ? null : (
          <Text variant="caption" data-testid="file-size">
            {detail}
          </Text>
        )}
      </div>
    </section>
  );
}
