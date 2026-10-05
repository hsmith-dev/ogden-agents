import { REVIEW_PAGE_TITLE } from '@ogden-agents/shared';
import { useParams } from '@tanstack/react-router';
import { BuildReview } from '@/planning/build-review';
import { PlanPieceGate } from '@/planning/plan-piece-gate';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { PageBody } from '@/ui/page';

/** `/w/:wsId/review/:ref` (story 5.2): a ticket's build review, with Unattended builds on (else the feature-off notice). */
export function WorkspaceReviewPage() {
  const { wsId, ref } = useParams({ strict: false }) as { wsId: string; ref: string };
  return (
    <>
      <WorkspaceHeader title={REVIEW_PAGE_TITLE} wsId={wsId} tab="board" />
      <PageBody data-testid="workspace-review-page">
        <PlanPieceGate wsId={wsId} piece="builds">
          <BuildReview wsId={wsId} ticketRef={ref} />
        </PlanPieceGate>
      </PageBody>
    </>
  );
}
