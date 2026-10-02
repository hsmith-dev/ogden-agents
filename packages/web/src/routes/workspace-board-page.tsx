import { BOARD_PAGE_TITLE } from '@ogden-agents/shared';
import { useParams } from '@tanstack/react-router';
import { BoardTickets } from '@/planning/board-tickets';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/w/:wsId/board`: the project's Board page (story 4.1, bare): its tickets, as a flat list. */
export function WorkspaceBoardPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  return (
    <>
      <WorkspaceHeader title={BOARD_PAGE_TITLE} wsId={wsId} tab="board" />
      <PageBody data-testid="workspace-board-page">
        <BoardTickets wsId={wsId} />
      </PageBody>
    </>
  );
}
