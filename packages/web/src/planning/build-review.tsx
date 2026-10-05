import {
  APPROVE_LABEL,
  REJECT_AND_RETRY_LABEL,
  REJECT_NOTE_LABEL,
  REVIEW_CHECKS_TITLE,
  REVIEW_FINDINGS_TITLE,
  REVIEW_MERGED_TEXT,
  REVIEW_NO_CHANGES_TEXT,
  REVIEW_NO_FINDINGS_TEXT,
  REVIEW_SHOW_CHANGES_LABEL,
  RUN_PHASE_LABELS,
  runPhase,
  UPDATE_AND_RETRY_LABEL,
  VERIFICATION_CHECK_LABELS,
  type ReviewResponse,
} from '@ogden-agents/shared';
import { ArrowsClockwise, CheckCircle, MinusCircle, XCircle } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useReview, useReviewAction } from './builds-api';

/**
 * Whether Approve and merge is offered enabled (story 5.9): a verified,
 * unmerged run whose every check passed. A build the user watched had no
 * sandbox, so its tests check is not run and does not hold approve back.
 */
export function canApproveReview(review: Pick<ReviewResponse, 'outcome' | 'merged' | 'headRevision' | 'verification'>): boolean {
  if (review.outcome !== 'verified' || review.merged || review.headRevision === null) return false;
  const checks = review.verification?.checks;
  if (checks === undefined) return true;
  return checks.every((check) => check.result === 'pass' || (review.verification?.attended === true && check.id === 'tests_pass' && check.result === 'not_run'));
}

/** One check: a tick, a cross or a dash, never colour alone, with its detail when it did not pass. */
function Check({ id, result, detail }: { id: keyof typeof VERIFICATION_CHECK_LABELS; result: 'pass' | 'fail' | 'not_run'; detail: string | null }) {
  const Icon = result === 'pass' ? CheckCircle : result === 'fail' ? XCircle : MinusCircle;
  return (
    <li className="flex min-w-0 items-start gap-2" data-testid="review-check" data-check={id} data-result={result}>
      <Icon aria-hidden className={result === 'pass' ? 'mt-0.5 shrink-0 text-state-success' : result === 'fail' ? 'mt-0.5 shrink-0 text-state-error' : 'mt-0.5 shrink-0 text-muted-foreground'} />
      <span className="min-w-0">
        <span className="text-label">{VERIFICATION_CHECK_LABELS[id]}</span>
        <span className="sr-only">{result === 'pass' ? ': passed' : result === 'fail' ? ': failed' : ': not run'}</span>
        {detail === null ? null : (
          <span className="block text-caption text-muted-foreground" data-testid="review-check-detail">
            {detail}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * A ticket's build review (story 5.2's bare page, designed by story 5.9;
 * EXPERIENCE.md Review): a plain summary, the three checks (a failing one a
 * cross with its detail), the review findings the plan recorded, the diff
 * behind **Show the code changes (N files)**, and a sticky bar: **Approve
 * and merge** (a local merge with the ticket's `done` mark in the merge
 * commit; disabled until every check passes), **Update and retry** for a
 * conflicting merge, and **Reject and retry** with an optional note.
 */
export function BuildReview({ wsId, ticketRef }: { wsId: string; ticketRef: string }) {
  const review = useReview(wsId, ticketRef);
  const approve = useReviewAction(wsId, ticketRef, 'approve');
  const reject = useReviewAction(wsId, ticketRef, 'reject');
  const update = useReviewAction(wsId, ticketRef, 'update');
  const [failure, setFailure] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const acting = approve.isPending || reject.isPending || update.isPending;
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
  const { run, outcome, reason, diff, truncated, files, merged, headRevision, summary, verification, findings } = review.data;
  const canApprove = canApproveReview(review.data);
  const approveShown = outcome === 'verified' && !merged;
  const canReject = outcome !== 'running' && !(outcome === 'verified' && merged);
  const conflicted = outcome === 'blocked' && run.blockedCode === 'merge_conflict' && (run.decision ?? null) === null;
  const act = (start: () => Promise<unknown>) => {
    if (acting) return;
    setFailure(undefined);
    start().then(
      () => {
        setAsking(false);
        setNote('');
      },
      (error: unknown) => setFailure(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <div className="flex max-w-(--space-content-max) min-w-0 flex-col gap-4 pb-24" data-testid="review" data-outcome={outcome} data-merged={merged ? 'true' : 'false'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-mono-compact text-muted-foreground">{run.ticketRef}</span>
        <Badge variant="outline" data-testid="review-outcome">
          {RUN_PHASE_LABELS[runPhase(run)]}
        </Badge>
        <Button variant="link" size="sm" asChild>
          <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: run.sessionId }} data-testid="review-session">
            Open the build session
          </Link>
        </Button>
      </div>
      {summary === null ? null : (
        <Text data-testid="review-summary">{summary}</Text>
      )}
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
      {verification === null ? null : (
        <section aria-label={REVIEW_CHECKS_TITLE} className="flex flex-col gap-2">
          <Text as="h2" variant="heading">
            {REVIEW_CHECKS_TITLE}
          </Text>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="review-checks">
            {verification.checks.map((check) => (
              <Check key={check.id} id={check.id} result={check.result} detail={check.detail} />
            ))}
          </ul>
        </section>
      )}
      <section aria-label={REVIEW_FINDINGS_TITLE} className="flex flex-col gap-2">
        <Text as="h2" variant="heading">
          {REVIEW_FINDINGS_TITLE}
        </Text>
        <Text variant="caption">Written by the agent in its plan, not checked by Ogden Agents.</Text>
        {findings.length === 0 ? (
          <Text variant="caption" data-testid="review-no-findings">
            {REVIEW_NO_FINDINGS_TEXT}
          </Text>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="review-findings">
            {findings.map((finding, index) => (
              <li key={index} className="flex min-w-0 items-start gap-2 text-body" data-testid="review-finding" data-kind={finding.kind}>
                {finding.severity === null ? null : <Badge variant="outline">{finding.severity}</Badge>}
                {finding.kind === 'deferred' ? <Badge variant="outline">deferred</Badge> : null}
                <span className="min-w-0 break-words">{finding.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="flex flex-col gap-2" data-testid="review-changes">
        <summary className="cursor-pointer text-label">{REVIEW_SHOW_CHANGES_LABEL(files.length)}</summary>
        {files.length === 0 ? (
          <Text variant="caption">{REVIEW_NO_CHANGES_TEXT}</Text>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" data-testid="review-files">
            {files.map((file) => (
              <li key={file} className="font-mono text-mono-compact">
                {file}
              </li>
            ))}
          </ul>
        )}
        {diff === '' ? null : (
          <pre data-testid="review-diff" className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-mono-compact whitespace-pre">
            {diff}
            {truncated ? '\n…' : ''}
          </pre>
        )}
      </details>
      {asking ? (
        <div className="flex flex-col gap-2" data-testid="review-reject-form">
          <label className="text-label" htmlFor="review-note">
            {REJECT_NOTE_LABEL}
          </label>
          <textarea
            id="review-note"
            data-testid="review-note"
            className="min-h-20 w-full rounded-md border border-input bg-card p-2 text-body text-foreground"
            maxLength={4000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      ) : null}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-background px-1 py-3" data-testid="review-bar">
        {approveShown ? (
          <Button data-testid="review-approve" disabled={!canApprove || acting} onClick={() => act(() => approve.mutateAsync({ revision: headRevision }))}>
            <CheckCircle aria-hidden />
            {APPROVE_LABEL}
          </Button>
        ) : null}
        {conflicted ? (
          <Button data-testid="review-update" disabled={acting} onClick={() => act(() => update.mutateAsync({ runId: run.id }))}>
            <ArrowsClockwise aria-hidden />
            {UPDATE_AND_RETRY_LABEL}
          </Button>
        ) : null}
        {canReject ? (
          asking ? (
            <>
              <Button variant="outline" data-testid="review-reject-confirm" disabled={acting} onClick={() => act(() => reject.mutateAsync({ note }))}>
                <XCircle aria-hidden />
                {REJECT_AND_RETRY_LABEL}
              </Button>
              <Button variant="ghost" data-testid="review-reject-cancel" disabled={acting} onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" data-testid="review-reject" disabled={acting} onClick={() => setAsking(true)}>
              <XCircle aria-hidden />
              {REJECT_AND_RETRY_LABEL}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
