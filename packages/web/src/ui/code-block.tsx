import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Button } from './button';

/** How long "Copied" or "Couldn't copy" shows before Copy comes back. */
const COPY_FEEDBACK_MS = 2_000;

/**
 * A fenced code block in {@link Markdown} (DESIGN.md Message, agent: `mono`
 * code blocks on `{colors.muted}`): its language when given, a Copy button,
 * and the code, which scrolls sideways and is reachable by keyboard so it
 * can be scrolled. No highlighting: the text is shown exactly as written.
 */
export function CodeBlock({ text, language }: { text: string; language: string | undefined }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copy === 'idle') return;
    const timer = setTimeout(() => setCopy('idle'), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copy]);
  const onCopy = () => {
    try {
      navigator.clipboard.writeText(text).then(
        () => setCopy('copied'),
        () => setCopy('failed'),
      );
    } catch {
      setCopy('failed');
    }
  };
  const name = language === undefined ? 'Code' : `${language} code`;
  return (
    <div data-slot="code-block" className="flex min-w-0 flex-col rounded-md bg-muted">
      <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
        <span data-slot="code-language" className="truncate font-mono text-mono-compact text-muted-foreground">
          {language ?? ''}
        </span>
        <Button variant="ghost" size="sm" onClick={onCopy} aria-label={`Copy ${name.toLowerCase()}`} data-slot="code-copy">
          {copy === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
          <span aria-hidden>{copy === 'copied' ? 'Copied' : copy === 'failed' ? "Couldn't copy" : 'Copy'}</span>
        </Button>
        <span role="status" className="sr-only">
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? "Couldn't copy" : ''}
        </span>
      </div>
      {/* Focusable so a keyboard can scroll a long line (WCAG 2.1.1). */}
      <pre tabIndex={0} aria-label={name} className="m-0 overflow-x-auto p-3 font-mono text-mono-compact">
        <code>{text}</code>
      </pre>
    </div>
  );
}
