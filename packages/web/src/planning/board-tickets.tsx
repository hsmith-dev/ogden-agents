import { BOARD_EMPTY_TITLE, BOARD_LOADING_TEXT, BOARD_PROBLEMS_TITLE, BOARD_TICKETS_LABEL } from '@ogden-agents/shared';
import { isApiError } from '@/api/http';
import { Badge } from '@/ui/badge';
import { Notice } from '@/ui/notice';
import { EmptyState } from '@/ui/page';
import { Row, RowList, RowMeta } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { ScriptTrustPrompt } from '@/workspaces/script-trust-prompt';
import { BmadDownloadPrompt } from './bmad-download-prompt';
import { useTickets } from './planning-api';

/**
 * The Board page's body (story 4.1, bare): the project's tickets as a flat
 * list in build order, each with its ref, title and state (and its status
 * when a build has set one), as BMad Method reports them (AD-8, AD-10: the
 * UI works out nothing from them). What couldn't be read is listed under a
 * notice. Loading, error and empty states. A project whose BMad Method
 * scripts aren't trusted yet (`scripts_not_trusted`, story 4.2) shows the
 * trust prompt instead, and its Allow fetches the tickets again. Without the
 * pinned BMad Method downloaded (`bmad_not_downloaded`, story 4.14) it
 * offers Download BMad Method, which fetches the tickets again once done.
 */
export function BoardTickets({ wsId }: { wsId: string }) {
  const tickets = useTickets(wsId);
  if (isApiError(tickets.error, 'scripts_not_trusted')) return <ScriptTrustPrompt wsId={wsId} onTrusted={() => void tickets.refetch()} />;
  if (isApiError(tickets.error, 'bmad_not_downloaded')) return <BmadDownloadPrompt onDownloaded={() => void tickets.refetch()} />;
  if (tickets.error !== null) {
    return (
      <Text variant="caption" role="alert" data-testid="board-error">
        {tickets.error.message}
      </Text>
    );
  }
  if (tickets.data === undefined) {
    return (
      <div className="flex flex-col gap-2" data-testid="board-loading">
        <Skeleton />
        <Skeleton />
        <span role="status" className="sr-only">
          {BOARD_LOADING_TEXT}
        </span>
      </div>
    );
  }
  const { tickets: rows, problems } = tickets.data;
  return (
    <div className="flex max-w-(--space-chat-column) flex-col gap-4">
      {problems.length === 0 ? null : (
        <Notice data-testid="board-problems">
          <span className="flex flex-col gap-1">
            <span>{BOARD_PROBLEMS_TITLE}</span>
            {problems.map((problem) => (
              <span key={problem} className="text-caption text-muted-foreground">
                {problem}
              </span>
            ))}
          </span>
        </Notice>
      )}
      {rows.length === 0 ? (
        <EmptyState title={BOARD_EMPTY_TITLE} data-testid="board-empty" />
      ) : (
        <RowList aria-label={BOARD_TICKETS_LABEL} data-testid="ticket-list">
          {rows.map((ticket) => (
            <li key={ticket.ref}>
              <Row asChild>
                <div data-testid="ticket-row" data-ref={ticket.ref}>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{ticket.ref}</span>
                  <span className="min-w-0 flex-1 truncate" title={ticket.title}>
                    {ticket.title}
                  </span>
                  <Badge data-testid="ticket-state">{ticket.state}</Badge>
                  {ticket.status === null || ticket.status === '' ? null : <RowMeta data-testid="ticket-status">{ticket.status}</RowMeta>}
                </div>
              </Row>
            </li>
          ))}
        </RowList>
      )}
    </div>
  );
}
