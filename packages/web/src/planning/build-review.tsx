import {
  APPROVE_LABEL,
  MAX_RUN_NOTE_LENGTH,
  REJECT_AND_RETRY_LABEL,
  REJECT_NOTE_LABEL,
  REVIEW_CHECKS_TITLE,
  REVIEW_FINDINGS_TITLE,
  REVIEW_MERGED_TEXT,
  REVIEW_NO_CHANGES_TEXT,
  REVIEW_NO_FINDINGS_TEXT,
  REVIEW_SHOW_CHANGES_LABEL,
  reviewCommentsGoWithText,
  reviewCommentsText,
  RUN_PHASE_LABELS,
  runPhase,
  UPDATE_AND_RETRY_LABEL,
  type ReviewResponse,
} from '@ogden-agents/shared';
import { ArrowsClockwise, CheckCircle, XCircle } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { lineCommentsKey, useLineComments, type LineCommentsState } from '@/workbench/line-comments';
import { CommentsBar, useLineCommentSlots } from '@/workbench/line-comments-ui';
import { withOpenInEditor } from '@/workbench/open-in-editor';
import { appendDraft } from '@/workbench/problems-api';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { parseUnifiedDiff } from '@/ui/diff/parse-unified';
import { DiffFileList, DiffViewer, type DiffViewerHandle } from '@/ui/diff-viewer';
import { Notice } from '@/ui/notice';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';
import { useReview, useReviewAction } from './builds-api';
import { CheckAgainButton, VerificationChecks } from './verification-checks';

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

/** Under the cut diff's last file: the text stops partway. */
export const REVIEW_DIFF_CUT_TEXT = 'Only the start of these changes is shown.';

/**
 * The diff behind Show the code changes (story 8.3): the file list (each
 * file the diff holds a button that opens and scrolls to its section), then
 * the shared diff viewer, without hunk actions (the build's branch is not
 * edited from Review). Text that isn't a unified diff shows as it was, in a
 * wrapped block that never scrolls sideways.
 *
 * Story 8.6: line comments, collected in a bar with no send: they go with
 * Reject and retry, as its note.
 */
function ReviewChanges({ wsId, files, diff, truncated, comments }: Pick<ReviewResponse, 'files' | 'diff' | 'truncated'> & { wsId: string; comments: LineCommentsState }) {
  const parsed = useMemo(() => parseUnifiedDiff(diff, truncated), [diff, truncated]);
  const viewer = useRef<DiffViewerHandle>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const commentSlots = useLineCommentSlots({ comments, data: parsed?.files ?? [], onNotice: setNotice });
  const items = useMemo(() => {
    const byPath = new Map((parsed?.files ?? []).map(({ file }) => [file.path, file]));
    return files.map((path) => {
      const file = byPath.get(path);
      return file === undefined ? { path, jumpable: false } : { path, change: file.change, additions: file.additions, deletions: file.deletions, jumpable: true };
    });
  }, [files, parsed]);
  if (files.length === 0) return <Text variant="caption">{REVIEW_NO_CHANGES_TEXT}</Text>;
  return (
    <div className="mt-2 flex min-w-0 flex-col gap-3">
      <DiffFileList items={items} onSelect={(path) => viewer.current?.jumpTo(path)} data-testid="review-files" />
      {diff === '' ? null : parsed === null ? (
        <pre data-testid="review-diff" className="m-0 rounded-md border border-border bg-card p-3 font-mono text-mono-compact whitespace-pre-wrap [overflow-wrap:anywhere]">
          {diff}
          {truncated ? '\n...' : ''}
        </pre>
      ) : (
        <div data-testid="review-diff" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-col" onFocus={commentSlots.onFocus} onKeyDownCapture={commentSlots.onKeyDownCapture}>
            {/* Open in editor opens the project's copy of a file (a build's worktree is not a Workbench root). */}
            <DiffViewer ref={viewer} files={parsed.files} label="The build's changes" fileActions={withOpenInEditor(wsId, undefined, parsed.files)} {...commentSlots.slots} />
          </div>
          {parsed.cut ? (
            <Text variant="caption" data-testid="review-diff-cut">
              {REVIEW_DIFF_CUT_TEXT}
            </Text>
          ) : null}
        </div>
      )}
      <CommentsBar
        comments={comments}
        outdated={commentSlots.outdated}
        notice={notice}
        onNotice={setNotice}
        caption={
          <Text variant="caption" data-testid="review-comments-go-with">
            {reviewCommentsGoWithText(comments.comments.length)}
          </Text>
        }
      />
    </div>
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
  const comments = useLineComments(review.data === undefined ? undefined : lineCommentsKey(wsId, `review:${review.data.run.id}`));
  // The comments put in the note, and the text they became (opening Reject and retry again with other comments replaces it).
  const [seeded, setSeeded] = useState<{ ids: string[]; text: string } | undefined>(undefined);
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
  const askReject = () => {
    const ids = comments.comments.map((comment) => comment.id);
    const same = seeded !== undefined && seeded.ids.length === ids.length && seeded.ids.every((id, index) => id === ids[index]);
    if (!same) {
      // The earlier comments' text, still in the note as it was put there, is replaced; else the new text is added.
      const previous = seeded !== undefined && note.includes(seeded.text) ? seeded.text : undefined;
      const rest = previous !== undefined ? note.length - previous.length : note.trim() === '' ? 0 : note.replace(/\s+$/, '').length + 2;
      const composed = ids.length === 0 ? '' : reviewCommentsText(comments.comments, MAX_RUN_NOTE_LENGTH - rest);
      if (previous !== undefined) setNote(composed === '' ? note.replace(previous, '').replace(/\s+$/, '') : note.replace(previous, () => composed));
      else if (composed !== '') setNote(appendDraft(note, composed));
      // Nothing fitted: nothing went with the note, so nothing is cleared after the reject.
      setSeeded(composed === '' ? undefined : { ids, text: composed });
    }
    setAsking(true);
  };
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
      {verification === null || outcome === 'running' ? null : (
        <section aria-label={REVIEW_CHECKS_TITLE} className="flex flex-col gap-2">
          <Text as="h2" variant="heading">
            {REVIEW_CHECKS_TITLE}
          </Text>
          <VerificationChecks verification={verification} idPrefix="review" />
        </section>
      )}
      <section aria-label={REVIEW_FINDINGS_TITLE} className="flex flex-col gap-2">
        <Text as="h2" variant="heading">
          {REVIEW_FINDINGS_TITLE}
        </Text>
        <Text variant="caption">Written by the agent in its plan, not checked by Ogden Agents.</Text>
        {findings.length === 0 && run.worktreePath === null ? (
          <Text variant="caption">The plan's findings are only read while the build's folder exists.</Text>
        ) : findings.length === 0 ? (
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
      <details className="flex min-w-0 flex-col gap-2" data-testid="review-changes">
        <summary className="cursor-pointer text-label">{REVIEW_SHOW_CHANGES_LABEL(files.length)}</summary>
        <ReviewChanges wsId={wsId} files={files} diff={diff} truncated={truncated} comments={comments} />
      </details>
      {asking ? (
        <div className="flex flex-col gap-2" data-testid="review-reject-form">
          <label className="text-label" htmlFor="review-note">
            {REJECT_NOTE_LABEL}
          </label>
          {seeded !== undefined ? (
            <Text variant="caption" data-testid="review-note-comments">
              {reviewCommentsGoWithText(seeded.ids.length)}
            </Text>
          ) : null}
          <textarea
            id="review-note"
            data-testid="review-note"
            className="min-h-20 w-full rounded-md border border-input bg-card p-2 text-body text-foreground"
            maxLength={MAX_RUN_NOTE_LENGTH}
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
        <CheckAgainButton wsId={wsId} run={run} onError={setFailure} />
        {conflicted ? (
          <Button data-testid="review-update" disabled={acting} onClick={() => act(() => update.mutateAsync({ runId: run.id }))}>
            <ArrowsClockwise aria-hidden />
            {UPDATE_AND_RETRY_LABEL}
          </Button>
        ) : null}
        {canReject ? (
          asking ? (
            <>
              <Button
                variant="outline"
                data-testid="review-reject-confirm"
                disabled={acting}
                onClick={() =>
                  act(() =>
                    reject.mutateAsync({ note }).then(() => {
                      // Only once the reject succeeded: the comments that went with it.
                      for (const id of seeded?.ids ?? []) comments.remove(id);
                      setSeeded(undefined);
                    }),
                  )
                }
              >
                <XCircle aria-hidden />
                {REJECT_AND_RETRY_LABEL}
              </Button>
              <Button variant="ghost" data-testid="review-reject-cancel" disabled={acting} onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" data-testid="review-reject" disabled={acting} onClick={askReject}>
              <XCircle aria-hidden />
              {REJECT_AND_RETRY_LABEL}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
