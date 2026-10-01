import type { ComponentProps, ReactNode } from 'react';

/** The read-only conversation's accessible name while the terminal drives (3.6 review F2). */
export const READ_ONLY_CONVERSATION = 'Conversation (read-only)';

/**
 * The session view's main pane while the terminal drives (story 3.6;
 * EXPERIENCE.md Terminal panel): the terminal panel takes it, and the
 * read-only conversation can open over it (below `xl`, as a sheet on the
 * right) or beside it (`xl`). While the chat drives, the wrapper adds no box
 * of its own.
 */
export function TerminalPane({ driving, children }: { driving: boolean; children: ReactNode }) {
  return (
    <div className={driving ? 'relative flex min-h-0 flex-1 gap-2 px-(--panel-padding) py-2' : 'contents'} data-testid="session-main">
      {children}
    </div>
  );
}

/**
 * The page body's props for the conversation: as usual while the chat
 * drives. While the terminal drives it is hidden unless the peek is open
 * (user decisions 2026-10-01: closed by default; a sheet over the terminal
 * below `xl`, beside it at `xl`), and always read-only: `inert` (nothing in
 * it can be focused or pressed) under its own name. `className` goes on the
 * scrolling box, the rest on the content inside it, so it still scrolls.
 */
export function conversationProps(driving: boolean, peekOpen: boolean): Pick<ComponentProps<'div'>, 'className' | 'inert' | 'role' | 'aria-label'> {
  if (!driving) return {};
  return {
    className: peekOpen
      ? 'absolute inset-y-2 right-(--panel-padding) z-10 w-(--sidebar-width) max-w-[calc(100%-var(--space-12))] rounded-lg border border-border bg-background shadow-float xl:static xl:z-auto xl:w-96 xl:max-w-none xl:flex-none xl:shadow-none'
      : 'hidden',
    inert: true,
    role: 'region',
    'aria-label': READ_ONLY_CONVERSATION,
  };
}
