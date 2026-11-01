import type { ReactNode } from 'react';
import { Text } from '@/ui/typography';

/**
 * The Files panel's viewer (AD-36): the file's path over its text, read-only,
 * one row per line with its number. Long lines wrap rather than scroll
 * sideways, so the page fits a phone. No colour, no Markdown rendering: the
 * text is shown exactly as the server sent it.
 */
export function CodeView({ path, text, notice }: { path: string; text: string; notice?: ReactNode }) {
  // A last line ending (of any kind) ends the last line; it doesn't start another.
  const lines = text.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);
  return (
    <section aria-label={path} data-testid="code-view" className="flex min-w-0 flex-col rounded-md border border-border bg-card">
      <ViewerHeader path={path} />
      {notice === undefined ? null : <div className="border-b border-border px-3 py-2">{notice}</div>}
      {/* Focusable so a keyboard can scroll a long file (WCAG 2.1.1). */}
      <Text as="div" variant="mono-compact" tabIndex={0} role="group" aria-label={`Contents of ${path}`} data-testid="code-lines" className="min-w-0 py-2 text-foreground">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-3" data-testid="code-line">
            <span aria-hidden className="text-right text-muted-foreground tabular-nums select-none" data-testid="code-line-number">
              {index + 1}
            </span>
            <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{line}</span>
          </div>
        ))}
      </Text>
    </section>
  );
}

/** The viewer's path line, alone over a state (protected, binary, too large, an error). */
export function ViewerHeader({ path }: { path: string }) {
  return (
    <div className="border-b border-border px-3 py-2">
      <Text variant="mono-compact" className="break-all" data-testid="code-view-path">
        {path}
      </Text>
    </div>
  );
}

/** The viewer framing a one-sentence state instead of text. */
export function ViewerState({ path, children, testId }: { path: string | undefined; children: ReactNode; testId: string }) {
  return (
    <section aria-label={path ?? 'File'} className="flex min-w-0 flex-col rounded-md border border-border bg-card">
      {path === undefined ? null : <ViewerHeader path={path} />}
      <Text variant="body" tone="muted" className="p-3" data-testid={testId} role="status">
        {children}
      </Text>
    </section>
  );
}
