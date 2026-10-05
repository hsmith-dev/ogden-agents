import {
  BOARD_COLUMN_LABELS,
  BOARD_DROPPED_LABEL,
  LOOK_BACK_OFFER_ACCEPT_LABEL,
  LOOK_BACK_OFFER_DISMISS_LABEL,
  LOOK_BACK_OFFER_TEXT,
  LOOK_BACK_UNFINISHED_NOTE,
  RETROSPECTIVE_VERDICT_LABELS,
  type TicketRow,
} from '@ogden-agents/shared';
import { memo, useId } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import type { EpicLookBackControls } from './board-look-back';
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
  /** Look back on this epic (epic 7), with Retrospectives on and a look-back action in the catalog; stable across renders. */
  lookBack?: EpicLookBackControls | undefined;
}

interface CardListProps extends Omit<BoardEpicProps, 'epic' | 'lookBack'> {
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
 * dropped filter on, its dropped tickets follow. Story 7.1: with Retrospectives
 * on, its header has **Look back on this epic**.
 */
export const BoardEpic = memo(function BoardEpic({ wsId, epic, statuses, highlighted, onChoose, saving = false, onBuild, building = false, queued, lookBack: lookBackGiven }: BoardEpicProps) {
  // Tickets in no epic have no folder to look back on.
  const lookBack = epic.slug === '' ? undefined : lookBackGiven;
  const headingId = useId();
  const retrospective = epic.retrospective;
  return (
    <section data-testid="board-epic" data-epic={epic.slug} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Text as="h2" variant="heading" id={headingId} className="flex items-baseline gap-2">
          {epic.id === null ? null : <span className="font-mono text-mono-compact text-muted-foreground">{epic.id}</span>}
          <span>{epic.title}</span>
        </Text>
        <div className="flex flex-wrap items-center gap-2">
          {retrospective?.verdict == null ? null : (
            <Badge variant="outline" data-testid="board-retrospective-verdict" data-verdict={retrospective.verdict}>
              {RETROSPECTIVE_VERDICT_LABELS[retrospective.verdict]}
              {retrospective.date === null ? '' : `, ${retrospective.date.slice(0, 10)}`}
            </Badge>
          )}
          {lookBack === undefined ? null : (
            <Button variant="outline" size="sm" aria-disabled={lookBack.busy || undefined} aria-busy={lookBack.busy || undefined} data-testid="board-look-back" onClick={() => (lookBack.busy ? undefined : lookBack.start(epic.slug))}>
              {lookBack.label}
            </Button>
          )}
        </div>
      </div>
      {retrospective !== null && retrospective.verdict === null && retrospective.problem !== null ? (
        <Text variant="caption" tone="muted" data-testid="board-retrospective-problem">
          {retrospective.problem}
        </Text>
      ) : null}
      {lookBack === undefined || epic.finished || retrospective !== null ? null : (
        <Text variant="caption" tone="muted" data-testid="board-look-back-note">
          {LOOK_BACK_UNFINISHED_NOTE}
        </Text>
      )}
      {lookBack === undefined || !epic.finished || retrospective !== null || lookBack.dismissed === undefined || lookBack.dismissed.has(epic.slug) ? null : (
        <Notice
          data-testid="board-look-back-offer"
          action={
            <span className="flex gap-2">
              <Button size="sm" aria-disabled={lookBack.busy || undefined} data-testid="board-look-back-accept" onClick={() => (lookBack.busy ? undefined : lookBack.start(epic.slug))}>
                {LOOK_BACK_OFFER_ACCEPT_LABEL}
              </Button>
              <Button size="sm" variant="outline" data-testid="board-look-back-dismiss" onClick={() => lookBack.dismiss(epic.slug)}>
                {LOOK_BACK_OFFER_DISMISS_LABEL}
              </Button>
            </span>
          }
        >
          {LOOK_BACK_OFFER_TEXT}
        </Notice>
      )}
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
