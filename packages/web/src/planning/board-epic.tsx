import { BOARD_COLUMN_LABELS, BOARD_DROPPED_LABEL, type TicketRow } from '@ogden-agents/shared';
import { memo, useId } from 'react';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import type { BoardEpicGroup, CardStatus } from './board-model';
import { TicketCard } from './ticket-card';
import type { TicketStatusChoice } from './ticket-status-menu';

export interface BoardEpicProps {
  wsId: string;
  epic: BoardEpicGroup;
  statuses: ReadonlyMap<string, CardStatus>;
  highlighted: ReadonlySet<string>;
  /** A status chosen in a card's menu (story 4.10); stable across renders. */
  onChoose?: ((choice: TicketStatusChoice) => void) | undefined;
  /** While a status change is saved: every card's menu waits. */
  saving?: boolean;
  /** Build on a Ready card (story 5.2), with Unattended builds on; stable across renders. */
  onBuild?: ((ref: string) => void) | undefined;
  /** The refs of tickets whose build waits in the queue (story 5.8): their card says Queued. */
  queued?: ReadonlySet<string> | undefined;
  /** While a build is being started: every Build waits. */
  building?: boolean;
}

interface CardListProps extends Omit<BoardEpicProps, 'epic'> {
  rows: readonly TicketRow[];
  label: string;
}

function CardList({ wsId, rows, statuses, highlighted, label, onChoose, saving = false, onBuild, building = false, queued }: CardListProps) {
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row) => (
        <li key={row.ref}>
          <TicketCard wsId={wsId} row={row} status={statuses.get(row.ref)!} highlighted={highlighted.has(row.ref)} onChoose={onChoose} busy={saving} onBuild={onBuild} building={building} queued={queued?.has(row.ref) === true} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One epic on the board (story 4.9): its title (with its id in mono when the
 * tree names it), then its seven status columns. At `md` and wider they sit
 * side by side in a horizontally scrollable, focusable, labelled region;
 * below `md` the non-empty ones stack as lists under their headings. With the
 * dropped filter on, its dropped tickets follow.
 */
export const BoardEpic = memo(function BoardEpic({ wsId, epic, statuses, highlighted, onChoose, saving = false, onBuild, building = false, queued }: BoardEpicProps) {
  const headingId = useId();
  return (
    <section data-testid="board-epic" data-epic={epic.slug} className="flex flex-col gap-3">
      <Text as="h2" variant="heading" id={headingId} className="flex items-baseline gap-2">
        {epic.id === null ? null : <span className="font-mono text-mono-compact text-muted-foreground">{epic.id}</span>}
        <span>{epic.title}</span>
      </Text>
      <div
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        data-testid="board-epic-columns"
        className="flex flex-col gap-4 rounded-md md:grid md:grid-cols-[repeat(7,minmax(calc(var(--spacing)*48),1fr))] md:gap-3 md:overflow-x-auto md:p-1"
      >
        {epic.columns.map(({ column, rows }) => (
          <div
            key={column}
            data-testid="board-column"
            data-column={column}
            className={cn('flex min-w-0 flex-col gap-2', rows.length === 0 && 'hidden md:flex')}
          >
            <Text as="h3" variant="label" tone="muted" className="flex items-center gap-1.5">
              <span>{BOARD_COLUMN_LABELS[column]}</span>
              <span className="tabular-nums">{rows.length}</span>
            </Text>
            {rows.length === 0 ? null : (
              <CardList wsId={wsId} rows={rows} statuses={statuses} highlighted={highlighted} onChoose={onChoose} saving={saving} onBuild={onBuild} building={building} queued={queued} label={`${epic.title}, ${BOARD_COLUMN_LABELS[column]}`} />
            )}
          </div>
        ))}
      </div>
      {epic.dropped.length === 0 ? null : (
        <div data-testid="board-dropped" className="flex flex-col gap-2">
          <Text as="h3" variant="label" tone="muted">
            {BOARD_DROPPED_LABEL}
          </Text>
          <div className="md:max-w-96">
            <CardList wsId={wsId} rows={epic.dropped} statuses={statuses} highlighted={highlighted} onChoose={onChoose} saving={saving} label={`${epic.title}, ${BOARD_DROPPED_LABEL}`} />
          </div>
        </div>
      )}
    </section>
  );
});
