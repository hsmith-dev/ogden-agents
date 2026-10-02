import { BOARD_PAGE_TITLE } from '@ogden-agents/shared';
import { useParams } from '@tanstack/react-router';
import { BoardTickets } from '@/planning/board-tickets';
import { BmadSetupGate } from '@/planning/bmad-setup-panel';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/w/:wsId/board`: the project's Board page (story 4.1, bare): its tickets, as a flat list; the setup panel instead in a project without `_bmad/` (story 4.3). */
export function WorkspaceBoardPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  return (
    <>
      <WorkspaceHeader title={BOARD_PAGE_TITLE} wsId={wsId} tab="board" />
      <PageBody data-testid="workspace-board-page">
        <BmadSetupGate wsId={wsId}>
          <BoardTickets wsId={wsId} />
        </BmadSetupGate>
      </PageBody>
    </>
  );
}
