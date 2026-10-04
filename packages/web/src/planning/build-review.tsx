import { APPROVE_LABEL, REJECT_LABEL, REVIEW_MERGED_TEXT, REVIEW_NO_CHANGES_TEXT, RUN_OUTCOME_LABELS } from '@ogden-agents/shared';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useReview, useReviewAction } from './builds-api';

/**
 * A ticket's build review (story 5.2, the tracer's bare review page): the
 * ticket's latest run, its outcome and plain reason, the files it changed
 * and its diff, read-only, with **Approve and merge** (only for a `verified`,
 * unmerged run: a local merge with the ticket's `done` mark in the merge
 * commit) and **Reject** (its worktree goes, its branch stays). 5.9 gives it
 * the full layout (the three checks, the findings, the sticky bar).
 */
export function BuildReview({ wsId, ticketRef }: { wsId: string; ticketRef: string }) {
  const review = useReview(wsId, ticketRef);
  const approve = useReviewAction(wsId, ticketRef, 'approve');
  const reject = useReviewAction(wsId, ticketRef, 'reject');
  const [failure, setFailure] = useState<string | undefined>();
  const acting = approve.isPending || reject.isPending;
  if (review.data === undefined) {
    if (review.error !== null) {
      return (
        <Text variant="caption" role="alert" data-testid="review-error">
          {review.error.message}
        </Text>
      );
    }
    return <Skeleton className="h-20 max-w-(--space-chat-column) rounded-lg" />;
  }
  const { run, outcome, reason, diff, truncated, files, merged } = review.data;
  const canApprove = outcome === 'verified' && !merged;
  const canReject = outcome !== 'running' && !(outcome === 'verified' && merged);
  const act = (action: typeof approve) => {
    if (acting) return;
    setFailure(undefined);
    action.mutateAsync().catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  };
  return (
    <div className="flex max-w-(--space-content-max) min-w-0 flex-col gap-4" data-testid="review" data-outcome={outcome} data-merged={merged ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-mono-compact text-muted-foreground">{run.ticketRef}</span>
        <Badge variant="outline" data-testid="review-outcome">
          {RUN_OUTCOME_LABELS[outcome]}
        </Badge>
        {run.branch === null ? null : <span className="font-mono text-mono-compact text-muted-foreground">{run.branch}</span>}
        <Button variant="link" size="sm" asChild>
          <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: run.sessionId }} data-testid="review-session">
            Open the build session
          </Link>
        </Button>
      </div>
      {merged ? (
        <Notice data-testid="review-merged">{REVIEW_MERGED_TEXT}</Notice>
      ) : reason === null ? null : (
        <Notice variant={outcome === 'verified' ? undefined : 'blocked'} data-testid="review-reason">
          {reason}
        </Notice>
      )}
      {failure === undefined ? null : (
        <Notice variant="blocked" role="alert" data-testid="review-action-error">
          {failure}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <Button data-testid="review-approve" aria-disabled={acting || undefined} onClick={() => act(approve)}>
            <CheckCircle aria-hidden />
            {APPROVE_LABEL}
          </Button>
        ) : null}
        {canReject ? (
          <Button variant="outline" data-testid="review-reject" aria-disabled={acting || undefined} onClick={() => act(reject)}>
            <XCircle aria-hidden />
            {REJECT_LABEL}
          </Button>
        ) : null}
      </div>
      <section aria-label="Changed files" className="flex flex-col gap-2">
        <Text as="h2" variant="heading">
          Changed files ({files.length})
        </Text>
        {files.length === 0 ? (
          <Text variant="caption">{REVIEW_NO_CHANGES_TEXT}</Text>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="review-files">
            {files.map((file) => (
              <li key={file} className="font-mono text-mono-compact">
                {file}
              </li>
            ))}
          </ul>
        )}
      </section>
      {diff === '' ? null : (
        <pre data-testid="review-diff" className="max-h-96 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-mono-compact whitespace-pre">
          {diff}
          {truncated ? '\n…' : ''}
        </pre>
      )}
    </div>
  );
}
