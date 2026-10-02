import { BOARD_PAGE_TITLE } from '@ogden-agents/shared';
import { Outlet, useParams } from '@tanstack/react-router';
import { BoardTickets } from '@/planning/board-tickets';
import { BmadSetupGate } from '@/planning/bmad-setup-panel';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/w/:wsId/board`: the project's Board page (story 4.9): its tickets by epic and status column, with the ticket sheet's route inside; the setup panel instead in a project without `_bmad/` (story 4.3). */
export function WorkspaceBoardPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  return (
    <>
      <WorkspaceHeader title={BOARD_PAGE_TITLE} wsId={wsId} tab="board" />
      <PageBody data-testid="workspace-board-page">
        <BmadSetupGate wsId={wsId}>
          {/* The ticket detail sheet, `/w/:wsId/board/:ref` (story 4.9): only over a loaded board, never over its prompts. */}
          <BoardTickets wsId={wsId} sheet={<Outlet />} />
        </BmadSetupGate>
      </PageBody>
    </>
  );
}
