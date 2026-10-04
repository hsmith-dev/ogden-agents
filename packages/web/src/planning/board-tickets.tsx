import {
  BMAD_CAPABILITY_REDUCED_TEXT,
  BOARD_EMPTY_TITLE,
  BOARD_EPICS_LABEL,
  BOARD_HIDE_DETAILS_LABEL,
  BOARD_LOADING_TEXT,
  BOARD_SHOW_DETAILS_LABEL,
  BOARD_SHOW_DROPPED_LABEL,
  boardDroppedHiddenText,
  boardMarkFailedText,
  boardMovedText,
  boardProblemsLine,
  boardStatusPlaceText,
  TICKET_SAVING_TEXT,
  type TicketsResponse,
} from '@ogden-agents/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { startBuild } from './builds-api';
import { cardStatusLine, groupBoard, indexTickets, unmetPrerequisites, type CardStatus } from './board-model';
import { useBoardEvents, useMarkTicket, useTickets } from './planning-api';
import { ReducedModeNotice } from './reduced-mode-notice';
import type { TicketStatusChoice } from './ticket-status-menu';

/**
 * The Board page's body (story 4.9; 4.1's bare list before it): the
 * project's tickets grouped by epic in build order, each epic with its
 * status columns, each card with its ref, title and one status line, as BMad
 * Method's files give them (AD-8, AD-10). Story 4.10: each card's status
 * menu changes its status through the server (never `done`, no optimistic
 * move: the card moves once the refetched files say so), announced once in
 * a polite status region, a failure in an alert, focus back on the moved
 * card. Story 5.2: with Unattended builds on, a Ready card has Build.
 * A `ticket.changed` refetches and highlights that card's status line for
 * 1.2 s. What couldn't be read is a one-line notice with Show details;
 * dropped tickets stay hidden until "Show dropped tickets" is on. A project
 * whose BMad Method scripts aren't trusted yet shows the trust prompt (story
 * 4.2); without the pinned BMad Method downloaded, Download BMad Method
 * (story 4.14); each fetches the tickets again once done. A project whose
 * BMad Method lacks the ticket tree (`reduced_mode`, entry 4.11) shows the
 * reduced-mode notice with Upgrade this project instead of the board (so no
 * card menu); a completed upgrade fetches the tickets again.
 */
export function BoardTickets({
  wsId,
  sheet,
  builds,
}: {
  wsId: string;
  /** The ticket sheet's outlet: shown only over a loaded board, never over a prompt or an error. */ sheet?: ReactNode;
  /** Build on Ready cards (story 5.2): only with Unattended builds on. */
  builds?: BoardBuilds | undefined;
}) {
  const tickets = useTickets(wsId);
  const reduced = tickets.data === undefined && isApiError(tickets.error, 'reduced_mode');
  // Once shown, the reduced-mode notice stays mounted in the same place (empty once the board loads), so an
  // upgrade it ran keeps its progress and done line above the board (entry 4.11).
  const shownReduced = useRef(false);
  if (reduced) shownReduced.current = true;
  return (
    <>
      {shownReduced.current ? <ReducedModeNotice wsId={wsId} texts={reduced ? [BMAD_CAPABILITY_REDUCED_TEXT.ticket_tree] : []} className="mb-4 flex max-w-(--space-chat-column) flex-col gap-3" /> : null}
      {reduced ? null : <BoardTicketsBody wsId={wsId} sheet={sheet} tickets={tickets} builds={builds} />}
    </>
  );
}

function BoardTicketsBody({ wsId, sheet, tickets, builds }: { wsId: string; sheet?: ReactNode; tickets: ReturnType<typeof useTickets>; builds?: BoardBuilds | undefined }) {
  const highlighted = useBoardEvents(wsId);
  if (isApiError(tickets.error, 'scripts_not_trusted')) return <ScriptTrustPrompt wsId={wsId} onTrusted={() => void tickets.refetch()} />;
  // Story 4.13: the scripts changed since the user allowed them; Allow allows them as they are now.
  if (isApiError(tickets.error, 'scripts_changed')) return <ScriptTrustPrompt wsId={wsId} changed onTrusted={() => void tickets.refetch()} />;
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
      <Board wsId={wsId} data={tickets.data} updatedAt={tickets.dataUpdatedAt} highlighted={highlighted} builds={builds} />
      {sheet}
    </>
  );
}

/**
 * The board's status changes (story 4.10): one at a time (every card's menu
 * waits while one saves, and the status region says so), the result
 * announced once ("1.2 moved to Ready") or the failure named with its
 * ticket. Once the refetched tickets have rendered, focus that fell to the
 * page (the menu's button went with the old card) goes to the card wherever
 * it now is, or, for a dropped card hidden by the filter, to "Show dropped
 * tickets".
 */
function useBoardMarks(wsId: string, updatedAt: number, showDropped: boolean, droppedId: string) {
  const queryClient = useQueryClient();
  const mark = useMarkTicket(wsId);
  const send = useRef(mark.mutateAsync);
  send.current = mark.mutateAsync;
  const pending = useRef(false);
  const shownDropped = useRef(showDropped);
  shownDropped.current = showDropped;
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [failure, setFailure] = useState<string | undefined>();
  /** The moved ticket, and when the cache's tickets were last updated once its change settled (the refetch it waits to see rendered). */
  const [moved, setMoved] = useState<{ ref: string; at: number } | undefined>();

  const onChoose = useCallback(
    (choice: TicketStatusChoice) => {
      if (pending.current) return;
      pending.current = true;
      setSaving(true);
      setFailure(undefined);
      setAnnouncement(TICKET_SAVING_TEXT);
      setMoved(undefined);
      void send
        .current({ ref: choice.ref, ...choice.request })
        .then(
          (result) => {
            const hidden = result.status === 'dropped' && !shownDropped.current;
            setAnnouncement(hidden ? boardDroppedHiddenText(result.ref) : boardMovedText(result.ref, boardStatusPlaceText(result.status)));
            // `mutateAsync` resolves once the refetch landed in the cache.
            setMoved({ ref: result.ref, at: queryClient.getQueryState(['tickets', wsId])?.dataUpdatedAt ?? 0 });
          },
          (error: unknown) => {
            setAnnouncement('');
            setFailure(boardMarkFailedText(choice.ref, error instanceof Error ? error.message : String(error)));
          },
        )
        .finally(() => {
          pending.current = false;
          setSaving(false);
        });
    },
    [queryClient, wsId],
  );

  useEffect(() => {
    // Wait until the tickets the change settled with (or newer ones) are rendered.
    if (moved === undefined || updatedAt < moved.at) return;
    setMoved(undefined);
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const card = document.querySelector<HTMLElement>(`[data-testid="ticket-card"][data-ref="${CSS.escape(moved.ref)}"]`);
    if (card !== null) card.focus();
    else document.getElementById(droppedId)?.focus();
  }, [moved, updatedAt, droppedId]);

  return { onChoose, saving, announcement, failure };
}

/**
 * Build on a Ready card (story 5.2, the tracer), offered only with
 * Unattended builds on: starts the ticket's build and opens its read-only
 * session; a refusal (`not_ready`, `sandbox_unavailable`, …) says why in an alert.
 */
function useBoardBuild(wsId: string, builds: BoardBuilds | undefined) {
  const [building, setBuilding] = useState(false);
  const [buildFailure, setBuildFailure] = useState<string | undefined>();
  const pending = useRef(false);
  const started = useRef(builds?.onStarted);
  started.current = builds?.onStarted;
  const build = useCallback(
    (ref: string) => {
      if (pending.current) return;
      pending.current = true;
      setBuilding(true);
      setBuildFailure(undefined);
      startBuild(wsId, ref)
        .then(
          ({ session }) => started.current?.(session.id),
          (error: unknown) => setBuildFailure(error instanceof Error ? error.message : String(error)),
        )
        .finally(() => {
          pending.current = false;
          setBuilding(false);
        });
    },
    [wsId],
  );
  return { onBuild: builds === undefined ? undefined : build, building, buildFailure };
}

/** Build on the board (story 5.2): given only with Unattended builds on; `onStarted` opens the new build session. */
export interface BoardBuilds {
  onStarted: (sessionId: string) => void;
}

function Board({
  wsId,
  data,
  updatedAt,
  highlighted,
  builds,
}: {
  wsId: string;
  data: TicketsResponse;
  /** When `data` was fetched. */ updatedAt: number;
  highlighted: ReadonlySet<string>;
  builds?: BoardBuilds | undefined;
}) {
  const [showDropped, setShowDropped] = useState(false);
  const droppedId = useId();
  const { onChoose, saving, announcement, failure } = useBoardMarks(wsId, updatedAt, showDropped, droppedId);
  const { onBuild, building, buildFailure } = useBoardBuild(wsId, builds);
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
      <span role="status" className="sr-only" data-testid="board-announcement">
        {announcement}
      </span>
      {failure === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="board-mark-error">
          {failure}
        </Notice>
      )}
      {buildFailure === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="board-build-error">
          {buildFailure}
        </Notice>
      )}
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
              <BoardEpic wsId={wsId} epic={epic} statuses={statuses} highlighted={highlighted} onChoose={onChoose} saving={saving} onBuild={onBuild} building={building} />
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
