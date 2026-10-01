import type { ReactNode } from 'react';

/**
 * The session view's main pane while the terminal drives (story 3.6;
 * EXPERIENCE.md Terminal panel): the terminal panel takes it, with the
 * read-only conversation beside it at `xl` when the peek is open. While the
 * chat drives, the wrapper adds no box of its own.
 */
export function TerminalPane({ driving, children }: { driving: boolean; children: ReactNode }) {
  return (
    <div className={driving ? 'flex min-h-0 flex-1 gap-2 px-(--panel-padding) py-2' : 'contents'} data-testid="session-main">
      {children}
    </div>
  );
}

/**
 * Where the conversation (the page body) goes: as usual while the chat
 * drives; hidden while the terminal drives, except at `xl` with the peek open,
 * where it sits beside the terminal, read-only.
 */
export function conversationClassName(driving: boolean, peekOpen: boolean): string | undefined {
  if (!driving) return undefined;
  return peekOpen ? 'hidden rounded-lg border border-border xl:block xl:w-96 xl:flex-none' : 'hidden';
}
