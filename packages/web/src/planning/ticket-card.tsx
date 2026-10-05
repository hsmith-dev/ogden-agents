import { boardCardLabel, boardColumnOf, BUILD_LABEL, buildFailedText, RUN_PHASE_LABELS, type TicketRow } from '@ogden-agents/shared';
import { Hammer, Lock, Prohibit, XCircle } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { memo } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/ui/utils';
import type { CardStatus } from './board-model';
import { TicketStatusMenu, type TicketStatusChoice } from './ticket-status-menu';

export interface TicketCardProps {
  wsId: string;
  row: TicketRow;
  status: CardStatus;
  /** Whether a `ticket.changed` just touched it: its status line highlights for 1.2 s (never announced). */
  highlighted: boolean;
  /** A status chosen in the card's menu (story 4.10); without it the card has no menu. Stable across renders. */
  onChoose?: ((choice: TicketStatusChoice) => void) | undefined;
  /** While this ticket's status change is saved. */
  busy?: boolean;
  /**
   * Build (story 5.2, the tracer): with Unattended builds on, a Ready card
   * (plan `ready-for-dev`) shows Build, which builds this one ticket. Stable
   * across renders.
   */
  onBuild?: ((ref: string) => void) | undefined;
  /** While a build is being started from the board: every Build waits. */
  building?: boolean;
  /** Whether this ticket's build waits in the queue (story 5.8): the card says Queued in place of Build. */
  queued?: boolean;
  /** The failing check of the ticket's latest build, in words (story 11.2); shown under the status. */
  buildFailure?: string | undefined;
}

/**
 * One ticket card (DESIGN.md Ticket card, story 4.9): a link to its detail
 * sheet, with its ref in mono, its title, then one status line: a lock glyph
 * and "Waits for 1.2", the blocked glyph and the reason, or the column's
 * label. In review, a thin signal left rail. State is never color alone. Every
 * field is plain text. Story 4.10: its status menu's button sits at the top
 * right, always visible, beside the link (never inside it). Memoized: a
 * refetch re-renders only the cards whose props changed.
 */
export const TicketCard = memo(function TicketCard({ wsId, row, status, highlighted, onChoose, busy = false, onBuild, building = false, queued = false, buildFailure }: TicketCardProps) {
  const column = boardColumnOf(row);
  const buildable = onBuild !== undefined && row.status === 'ready-for-dev' && !queued;
  return (
    <div className="relative min-w-0">
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
          onChoose !== undefined && 'pr-10',
          (buildable || queued) && 'pb-12',
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
        {buildFailure === undefined ? null : (
          <span className="flex min-w-0 items-center gap-1.5 text-caption text-state-error" data-testid="ticket-build-failure">
            <XCircle aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{buildFailedText(buildFailure)}</span>
          </span>
        )}
      </Link>
      {onChoose === undefined ? null : <TicketStatusMenu row={row} onChoose={onChoose} busy={busy} className="absolute top-1 right-1" />}
      {queued ? (
        <Badge variant="outline" className="absolute right-1 bottom-1" data-testid="ticket-queued">
          {RUN_PHASE_LABELS.queued}
        </Badge>
      ) : null}
      {buildable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute right-1 bottom-1"
          data-testid="ticket-build"
          aria-label={`${BUILD_LABEL} ${row.ref}`}
          aria-disabled={building || undefined}
          onClick={() => {
            if (!building) onBuild(row.ref);
          }}
        >
          <Hammer aria-hidden />
          {BUILD_LABEL}
        </Button>
      ) : null}
    </div>
  );
});
