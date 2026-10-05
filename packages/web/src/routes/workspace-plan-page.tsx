import { PLAN_PAGE_TITLE } from '@ogden-agents/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { BmadSetupGate } from '@/planning/bmad-setup-panel';
import { PlanHome } from '@/planning/plan-home';
import { PlanPieceGate } from '@/planning/plan-piece-gate';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/**
 * `/w/:wsId/plan`: the project's Plan home (story 4.6). With Planning off,
 * the feature-off notice and a link to the settings (story 4.6, AD-22);
 * without `_bmad/`, the setup panel (story 4.3); otherwise "Start from an
 * idea" and the grouped actions. Each start creates a planning session,
 * then opens it in the session view.
 */
export function WorkspacePlanPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const navigate = useNavigate();
  return (
    <>
      <WorkspaceHeader title={PLAN_PAGE_TITLE} wsId={wsId} tab="plan" />
      <PageBody data-testid="workspace-plan-page">
        <PlanPieceGate wsId={wsId} piece="planning">
          <BmadSetupGate wsId={wsId}>
            <PlanHome wsId={wsId} onStarted={(session) => navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: session.id } })} />
          </BmadSetupGate>
        </PlanPieceGate>
      </PageBody>
    </>
  );
}
