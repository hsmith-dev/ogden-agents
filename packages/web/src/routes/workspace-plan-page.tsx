import { PLAN_PAGE_TITLE } from '@ogden-agents/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { PlanSkills } from '@/planning/plan-skills';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/**
 * `/w/:wsId/plan`: the project's Plan page (story 4.1, bare). Start on a
 * skill creates a planning session, then opens it in the session view.
 */
export function WorkspacePlanPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  const navigate = useNavigate();
  return (
    <>
      <WorkspaceHeader title={PLAN_PAGE_TITLE} wsId={wsId} tab="plan" />
      <PageBody data-testid="workspace-plan-page">
        <PlanSkills wsId={wsId} onStarted={(session) => navigate({ to: '/w/$wsId/s/$sesId', params: { wsId, sesId: session.id } })} />
      </PageBody>
    </>
  );
}
