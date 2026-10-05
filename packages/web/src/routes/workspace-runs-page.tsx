import { RUNS_PAGE_TITLE } from '@ogden-agents/shared';
import { useParams } from '@tanstack/react-router';
import { PlanPieceGate } from '@/planning/plan-piece-gate';
import { RunsList } from '@/planning/runs-list';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/w/:wsId/runs`: every build run of the project, newest first, and its queue (story 11.1). With Unattended builds off, the feature-off notice and nothing else (4.6's piece gate). */
export function WorkspaceRunsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  return (
    <>
      <WorkspaceHeader title={RUNS_PAGE_TITLE} wsId={wsId} tab="runs" />
      <PageBody data-testid="workspace-runs-page">
        <PlanPieceGate wsId={wsId} piece="builds">
          <RunsList wsId={wsId} />
        </PlanPieceGate>
      </PageBody>
    </>
  );
}
