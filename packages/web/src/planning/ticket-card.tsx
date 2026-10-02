import { boardCardLabel, boardColumnOf, type TicketRow } from '@ogden-agents/shared';
import { Lock, Prohibit } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { cn } from '@/ui/utils';
import type { CardStatus } from './board-model';

export interface TicketCardProps {
  wsId: string;
  row: TicketRow;
  status: CardStatus;
  /** Whether a `ticket.changed` just touched it: its status line highlights for 1.2 s (never announced). */
  highlighted: boolean;
}

/**
 * One ticket card (DESIGN.md Ticket card, story 4.9): a link to its detail
 * sheet, with its ref in mono, its title, then one status line: a lock glyph
 * and "Waits for 1.2", the blocked glyph and the reason, or the column's
 * label. In review, a thin signal left rail. State is never color alone. Every
 * field is plain text. Memoized: a refetch re-renders only the cards whose
 * props changed.
 */
export const TicketCard = memo(function TicketCard({ wsId, row, status, highlighted }: TicketCardProps) {
  const column = boardColumnOf(row);
  return (
    <Link
      to="/w/$wsId/board/$ref"
      params={{ wsId, ref: row.ref }}
      data-testid="ticket-card"
      data-ref={row.ref}
      data-column={column ?? 'dropped'}
      data-highlighted={highlighted ? 'true' : undefined}
      aria-label={boardCardLabel(row.ref, row.title, status.text)}
      className={cn(
        'relative flex min-h-(--control-height) min-w-0 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-card px-3 py-2 text-card-foreground',
        'transition-colors duration-(--motion-fast) ease-standard hover:bg-accent',
        column === 'in_review' && 'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-signal',
      )}
    >
      <span className="font-mono text-mono-compact text-muted-foreground">{row.ref}</span>
      <span className="text-label font-semibold break-words">{row.title}</span>
      <span
        data-testid="ticket-status-line"
        data-kind={status.kind}
        className={cn(
          '-mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 text-caption text-muted-foreground',
          'transition-colors duration-(--motion-slow) ease-standard motion-reduce:transition-none',
          highlighted && 'bg-accent text-foreground',
        )}
      >
        {status.kind === 'waits' ? <Lock aria-hidden className="size-3.5 shrink-0" /> : null}
        {status.kind === 'blocked' ? <Prohibit aria-hidden className="size-3.5 shrink-0 text-state-error" /> : null}
        <span className="min-w-0 truncate">{status.text}</span>
      </span>
    </Link>
  );
});
