import { BOARD_PAGE_TITLE } from '@ogden-agents/shared';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { BoardTickets } from '@/planning/board-tickets';
import { BmadSetupGate } from '@/planning/bmad-setup-panel';
import { PlanPieceGate } from '@/planning/plan-piece-gate';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';

/** `/w/:wsId/board`: the project's Board page (story 4.9): its tickets by epic and status column, with the ticket sheet's route inside; the setup panel instead in a project without `_bmad/` (story 4.3); with Board off, the feature-off notice and nothing else (4.6's piece gate). */
export function WorkspaceBoardPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const navigate = useNavigate();
  // Build on Ready cards (story 5.2) only with Unattended builds on; a started build opens its session.
  const buildsOn = useWorkspaceSettings(wsId).data?.bmadPieces.includes('builds') === true;
  const builds = useMemo(
    () => (buildsOn ? { onStarted: (sesId: string) => void navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId } }) } : undefined),
    [buildsOn, navigate, wsId],
  );
  return (
    <>
      <WorkspaceHeader title={BOARD_PAGE_TITLE} wsId={wsId} tab="board" />
      <PageBody data-testid="workspace-board-page">
        <PlanPieceGate wsId={wsId} piece="board">
          <BmadSetupGate wsId={wsId}>
            {/* The ticket detail sheet, `/w/:wsId/board/:ref` (story 4.9): only over a loaded board, never over its prompts. */}
            <BoardTickets wsId={wsId} sheet={<Outlet />} builds={builds} />
          </BmadSetupGate>
        </PlanPieceGate>
      </PageBody>
    </>
  );
}
