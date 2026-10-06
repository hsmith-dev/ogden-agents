import {
  BOARD_COLUMN_LABELS,
  BOARD_DROPPED_LABEL,
  boardColumnOf,
  boardMarkFailedText,
  boardMovedText,
  boardStatusPlaceText,
  TICKET_LOADING_TEXT,
  TICKET_NO_PLAN_TEXT,
  TICKET_NO_PREREQUISITES_TEXT,
  TICKET_NOT_FOUND,
  TICKET_NOTES_HEADING,
  TICKET_PREREQUISITE_MET_TEXT,
  TICKET_PREREQUISITE_WAITING_TEXT,
  TICKET_PREREQUISITES_HEADING,
  TICKET_REFERENCES_HEADING,
  TICKET_SAVING_TEXT,
  TICKET_STATUS_HEADING,
  TICKET_SUMMARY_HEADING,
  TICKET_UNKNOWN_HEADING,
  TICKET_VERIFY_HEADING,
  type TicketDetail,
} from '@ogden-agents/shared';
import { Check, Lock, Prohibit } from '@phosphor-icons/react';
import { useMemo, useState, type ReactNode } from 'react';
import { ChatApiError } from '@/api/http';
import { useAppearance } from '@/appearance/appearance-provider';
import { Notice } from '@/ui/notice';
import { Sheet, SheetContent } from '@/ui/sheet';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { indexTickets, prerequisitesOf, type Prerequisite } from './board-model';
import { useMarkTicket, useTicket, useTickets } from './planning-api';
import { TicketBuildSection } from './ticket-build-section';
import { TicketStatusMenu, type TicketStatusChoice } from './ticket-status-menu';

export interface TicketSheetProps {
  wsId: string;
  ticketRef: string;
  /** Esc or Close: the caller goes back to the board. */
  onClose: () => void;
}

/**
 * The ticket detail side sheet (story 4.9, `/w/:wsId/board/:ref`): the
 * ticket's title with its ref in mono, its status, plan summary, how it is
 * checked, prerequisites (met or waiting, against the board's cached
 * tickets), notes, open question and references. Each section shows only
 * when it has something, every field is plain text (references in mono,
 * never links). In Developer mode the raw plan `status` and `state` show
 * too. Loading, 404 ("No ticket 1.2 in this project.") and error states.
 * Story 4.10: the Status section has the card's status menu (never Done),
 * its result announced once and a failure shown inline. No Build here.
 */
export function TicketSheet({ wsId, ticketRef, onClose }: TicketSheetProps) {
  const ticket = useTicket(wsId, ticketRef);
  const detail = ticket.data?.ticket;
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        title={detail?.title ?? ticketRef}
        data-testid="ticket-sheet"
        data-ref={ticketRef}
        // Focus goes back to the card when the route has changed (the caller does it).
        onCloseAutoFocus={(event) => event.preventDefault()}
        // The body scrolls; the title and Close stay put.
        className="w-112 [&>h2]:break-words [&>h2]:pt-(--panel-padding) [&>h2]:pr-12 [&>h2]:pl-(--panel-padding)"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-(--panel-padding)" data-testid="ticket-sheet-body">
          {detail === undefined ? (
            ticket.error !== null ? (
              <Text variant="caption" role="alert" data-testid="ticket-sheet-error">
                {ticket.error instanceof ChatApiError && ticket.error.status === 404 ? TICKET_NOT_FOUND(ticketRef) : ticket.error.message}
              </Text>
            ) : (
              <div className="flex flex-col gap-2" data-testid="ticket-sheet-loading">
                <Skeleton />
                <Skeleton />
                <span role="status" className="sr-only">
                  {TICKET_LOADING_TEXT}
                </span>
              </div>
            )
          ) : (
            <>
              {/* A failed refetch keeps the detail it had, with a quiet line above. */}
              {ticket.error === null ? null : <Notice data-testid="ticket-sheet-refetch-error">{ticket.error.message}</Notice>}
              <TicketBody wsId={wsId} detail={detail} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ heading, children, testId }: { heading: string; children: ReactNode; testId: string }) {
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      <Text as="h3" variant="label" tone="muted">
        {heading}
      </Text>
      {children}
    </section>
  );
}

function TicketBody({ wsId, detail }: { wsId: string; detail: TicketDetail }) {
  const { appearance } = useAppearance();
  // The board's own query: the sheet resolves prerequisites against the same rows (fetched once if opened from its URL).
  const tickets = useTickets(wsId);
  const index = useMemo(() => (tickets.data === undefined ? undefined : indexTickets(tickets.data.tickets, tickets.data.epics)), [tickets.data]);
  // Resolved only against loaded tickets; without them the links show as written, with no met or waiting word.
  const prerequisites: ReadonlyArray<Prerequisite & { known: boolean }> =
    index === undefined ? detail.after.map((link) => ({ label: String(link), met: false, known: false })) : prerequisitesOf(detail, index).map((each) => ({ ...each, known: true }));
  const column = boardColumnOf(detail);
  const blocked = column === 'blocked';
  const reason = detail.blocked_reason?.trim() ?? '';
  return (
    <>
      <Text variant="mono-compact" data-testid="ticket-sheet-ref">
        {detail.ref}
      </Text>
      <Section heading={TICKET_STATUS_HEADING} testId="ticket-sheet-status">
        <Text variant="label" className="flex items-center gap-1.5">
          {blocked ? <Prohibit aria-hidden className="size-3.5 shrink-0 text-state-error" /> : null}
          <span>{column === null ? BOARD_DROPPED_LABEL : BOARD_COLUMN_LABELS[column]}</span>
        </Text>
        {blocked && reason !== '' ? (
          <Text variant="body" className="break-words whitespace-pre-wrap" data-testid="ticket-sheet-blocked-reason">
            {reason}
          </Text>
        ) : null}
        <SheetStatusChange wsId={wsId} detail={detail} />
        {appearance.developerMode ? (
          <Text variant="mono-compact" data-testid="ticket-sheet-raw-status">
            {`status: ${detail.status ?? ''}  state: ${detail.state}`}
          </Text>
        ) : null}
      </Section>
      <TicketBuildSection wsId={wsId} ticketRef={detail.ref} ready={detail.status === 'ready-for-dev'} waits={prerequisites.some((each) => !each.known || !each.met)} />
      <Section heading={TICKET_SUMMARY_HEADING} testId="ticket-sheet-summary">
        <Text variant="body" className="break-words whitespace-pre-wrap" tone={detail.description === '' ? 'muted' : 'default'}>
          {detail.description === '' ? TICKET_NO_PLAN_TEXT : detail.description}
        </Text>
      </Section>
      {detail.verify === '' ? null : (
        <Section heading={TICKET_VERIFY_HEADING} testId="ticket-sheet-verify">
          <Text variant="body" className="break-words whitespace-pre-wrap">
            {detail.verify}
          </Text>
        </Section>
      )}
      <Section heading={TICKET_PREREQUISITES_HEADING} testId="ticket-sheet-prerequisites">
        {prerequisites.length === 0 ? (
          <Text variant="caption">{TICKET_NO_PREREQUISITES_TEXT}</Text>
        ) : index === undefined && tickets.error === null ? (
          <Skeleton className="h-(--control-height)" data-testid="ticket-sheet-prerequisites-loading" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {prerequisites.map((prerequisite, position) => (
              <li
                key={position}
                className="flex items-center gap-2 text-label"
                data-testid="ticket-sheet-prerequisite"
                data-met={prerequisite.known ? (prerequisite.met ? 'true' : 'false') : undefined}
              >
                {!prerequisite.known ? null : prerequisite.met ? <Check aria-hidden className="size-3.5 shrink-0" /> : <Lock aria-hidden className="size-3.5 shrink-0" />}
                <span className="font-mono text-mono-compact">{prerequisite.label}</span>
                {prerequisite.known ? <span className="text-muted-foreground">{prerequisite.met ? TICKET_PREREQUISITE_MET_TEXT : TICKET_PREREQUISITE_WAITING_TEXT}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {detail.notes.length === 0 ? null : (
        <Section heading={TICKET_NOTES_HEADING} testId="ticket-sheet-notes">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
            {detail.notes.map((note, index) => (
              <li key={index} className="text-body break-words whitespace-pre-wrap">
                {note}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {detail.unknown === '' ? null : (
        <Section heading={TICKET_UNKNOWN_HEADING} testId="ticket-sheet-unknown">
          <Text variant="body" className="break-words whitespace-pre-wrap">
            {detail.unknown}
          </Text>
        </Section>
      )}
      {detail.references.length === 0 ? null : (
        <Section heading={TICKET_REFERENCES_HEADING} testId="ticket-sheet-references">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {detail.references.map((reference, index) => (
              <li key={index} className="font-mono text-mono-compact break-all">
                {reference}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/**
 * The sheet's status menu (story 4.10): the change is sent once, the menu
 * waits while it saves, then the sheet's ticket and the board refetch (no
 * optimistic status). The result is announced once in a polite region; a
 * failure shows its plain message as an alert under the menu.
 */
function SheetStatusChange({ wsId, detail }: { wsId: string; detail: TicketDetail }) {
  const mark = useMarkTicket(wsId);
  const [announcement, setAnnouncement] = useState('');
  const onChoose = (choice: TicketStatusChoice) => {
    if (mark.isPending) return;
    setAnnouncement(TICKET_SAVING_TEXT);
    mark.mutate(
      { ref: choice.ref, ...choice.request },
      {
        onSuccess: (result) => setAnnouncement(boardMovedText(result.ref, boardStatusPlaceText(result.status))),
        onError: () => setAnnouncement(''),
      },
    );
  };
  return (
    <div className="flex flex-col gap-2">
      {/* The menu's button, then (Blocked) its reason form inline: the sheet is the one modal. */}
      <TicketStatusMenu row={detail} onChoose={onChoose} busy={mark.isPending} variant="sheet" />
      {mark.isPending ? (
        <Text variant="caption" tone="muted" aria-hidden data-testid="ticket-sheet-saving">
          {TICKET_SAVING_TEXT}
        </Text>
      ) : null}
      <span role="status" className="sr-only" data-testid="ticket-sheet-announcement">
        {announcement}
      </span>
      {mark.error === null ? null : (
        <Text variant="caption" role="alert" data-testid="ticket-sheet-mark-error">
          {boardMarkFailedText(detail.ref, mark.error.message)}
        </Text>
      )}
    </div>
  );
}
