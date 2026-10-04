import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback } from 'react';
import { TicketSheet } from '@/planning/ticket-sheet';

/** Moves focus to the board's card for `ref`; with no such card on the page, to the page's title. */
function focusCard(ref: string): void {
  const card = document.querySelector<HTMLElement>(`[data-testid="ticket-card"][data-ref="${CSS.escape(ref)}"]`);
  if (card !== null) {
    card.focus();
    return;
  }
  const title = document.querySelector<HTMLElement>('h1');
  if (title === null) return;
  if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
  title.focus();
}

/**
 * `/w/:wsId/board/:ref` (story 4.9): the ticket detail sheet over the board.
 * Esc or Close goes back to `/w/:wsId/board` (replacing the history entry, so
 * Back doesn't reopen it), and focus returns to the card.
 */
export function WorkspaceBoardTicket() {
  const { wsId, ref } = useParams({ strict: false }) as { wsId: string; ref: string };
  const navigate = useNavigate();
  const onClose = useCallback(() => {
    void navigate({ to: '/w/$wsId/board', params: { wsId }, replace: true }).then(() => focusCard(ref));
  }, [navigate, wsId, ref]);
  return <TicketSheet key={ref} wsId={wsId} ticketRef={ref} onClose={onClose} />;
}
