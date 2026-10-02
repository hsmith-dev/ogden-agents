import {
  BOARD_EMPTY_TITLE,
  BOARD_EPICS_LABEL,
  BOARD_HIDE_DETAILS_LABEL,
  BOARD_LOADING_TEXT,
  BOARD_SHOW_DETAILS_LABEL,
  BOARD_SHOW_DROPPED_LABEL,
  boardProblemsLine,
  type TicketsResponse,
} from '@ogden-agents/shared';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { isApiError } from '@/api/http';
import { Button } from '@/ui/button';
import { CheckboxOption } from '@/ui/checkbox';
import { Notice } from '@/ui/notice';
import { EmptyState } from '@/ui/page';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { ScriptTrustPrompt } from '@/workspaces/script-trust-prompt';
import { BmadDownloadPrompt } from './bmad-download-prompt';
import { BoardEpic } from './board-epic';
import { cardStatusLine, groupBoard, indexTickets, unmetPrerequisites, type CardStatus } from './board-model';
import { useBoardEvents, useTickets } from './planning-api';

/**
 * The Board page's body (story 4.9; 4.1's bare list before it): the
 * project's tickets grouped by epic in build order, each epic with its
 * status columns, each card with its ref, title and one status line, as BMad
 * Method's files give them (AD-8, AD-10). Read-only: no card menu, no Build.
 * A `ticket.changed` refetches and highlights that card's status line for
 * 1.2 s. What couldn't be read is a one-line notice with Show details;
 * dropped tickets stay hidden until "Show dropped tickets" is on. A project
 * whose BMad Method scripts aren't trusted yet shows the trust prompt (story
 * 4.2); without the pinned BMad Method downloaded, Download BMad Method
 * (story 4.14); each fetches the tickets again once done.
 */
export function BoardTickets({ wsId, sheet }: { wsId: string; /** The ticket sheet's outlet: shown only over a loaded board, never over a prompt or an error. */ sheet?: ReactNode }) {
  const tickets = useTickets(wsId);
  const highlighted = useBoardEvents(wsId);
  if (isApiError(tickets.error, 'scripts_not_trusted')) return <ScriptTrustPrompt wsId={wsId} onTrusted={() => void tickets.refetch()} />;
  if (isApiError(tickets.error, 'bmad_not_downloaded')) return <BmadDownloadPrompt onDownloaded={() => void tickets.refetch()} />;
  if (tickets.data === undefined) {
    if (tickets.error !== null) {
      return (
        <Text variant="caption" role="alert" data-testid="board-error">
          {tickets.error.message}
        </Text>
      );
    }
    return (
      <div className="flex flex-col gap-2 md:max-w-96" data-testid="board-loading">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <span role="status" className="sr-only">
          {BOARD_LOADING_TEXT}
        </span>
      </div>
    );
  }
  return (
    <>
      {/* A failed refetch keeps the board it had, with a quiet line above. */}
      {tickets.error === null ? null : (
        <Notice className="mb-4" data-testid="board-refetch-error">
          {tickets.error.message}
        </Notice>
      )}
      <Board wsId={wsId} data={tickets.data} highlighted={highlighted} />
      {sheet}
    </>
  );
}

function Board({ wsId, data, highlighted }: { wsId: string; data: TicketsResponse; highlighted: ReadonlySet<string> }) {
  const [showDropped, setShowDropped] = useState(false);
  const droppedId = useId();
  const epics = useMemo(() => groupBoard(data, showDropped), [data, showDropped]);
  // One status per card, recomputed only when the tickets change, so a highlight re-renders one card.
  const statuses = useMemo(() => {
    const index = indexTickets(data.tickets, data.epics);
    const map = new Map<string, CardStatus>();
    for (const row of data.tickets) map.set(row.ref, cardStatusLine(row, unmetPrerequisites(row, index)));
    return map;
  }, [data]);
  return (
    <div className="flex max-w-(--space-content-max) min-w-0 flex-col gap-6" data-testid="board">
      <div className="flex flex-col gap-2">
        {data.problems.length === 0 ? null : <BoardProblems problems={data.problems} />}
        <CheckboxOption
          id={droppedId}
          label={BOARD_SHOW_DROPPED_LABEL}
          checked={showDropped}
          onCheckedChange={(checked) => setShowDropped(checked === true)}
          data-testid="board-show-dropped"
          className="self-start"
        />
      </div>
      {epics.length === 0 ? (
        <EmptyState title={BOARD_EMPTY_TITLE} data-testid="board-empty" />
      ) : (
        <ul aria-label={BOARD_EPICS_LABEL} className="m-0 flex list-none flex-col gap-8 p-0">
          {epics.map((epic) => (
            <li key={epic.slug} className="min-w-0">
              <BoardEpic wsId={wsId} epic={epic} statuses={statuses} highlighted={highlighted} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Some ticket files could not be read (2)", with Show details listing each one as plain text. */
function BoardProblems({ problems }: { problems: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Notice
      data-testid="board-problems"
      action={
        <Button variant="outline" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)} data-testid="board-problems-toggle">
          {open ? BOARD_HIDE_DETAILS_LABEL : BOARD_SHOW_DETAILS_LABEL}
        </Button>
      }
    >
      <span className="flex flex-col gap-1">
        <span data-testid="board-problems-line">{boardProblemsLine(problems.length)}</span>
        <ul id={listId} hidden={!open} className={open ? 'm-0 flex list-none flex-col gap-1 p-0' : 'hidden'} data-testid="board-problems-list">
          {problems.map((problem, index) => (
            <li key={index} className="text-caption break-words text-muted-foreground">
              {problem}
            </li>
          ))}
        </ul>
      </span>
    </Notice>
  );
}
