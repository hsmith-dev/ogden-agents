import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

/**
 * Transcript messages (DESIGN.md Message): the user's in a `{colors.muted}`
 * `{rounded.lg}` block, right-aligned at most 85% of the chat column; the
 * agent's with no container, body text under the agent's name in caption.
 * A user's text keeps its line breaks; an agent's body is a block (its
 * reply rendered as Markdown by the chat).
 */
export function UserMessage({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="message-user" className={cn('max-w-[85%] self-end rounded-lg bg-muted px-4 py-3', className)} {...props}>
      <p className="m-0 max-w-(--measure) whitespace-pre-wrap text-body text-foreground">{children}</p>
    </div>
  );
}

export function AgentMessage({ name, className, children, ...props }: ComponentProps<'div'> & { name: ReactNode }) {
  return (
    <div data-slot="message-agent" className={cn('flex min-w-0 flex-col gap-1', className)} {...props}>
      <p className="m-0 text-caption text-muted-foreground">{name}</p>
      <div className="max-w-(--measure) min-w-0 text-body text-foreground">{children}</div>
    </div>
  );
}
