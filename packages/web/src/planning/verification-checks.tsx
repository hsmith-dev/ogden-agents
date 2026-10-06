import {
  CHECK_AGAIN_LABEL,
  HIDE_DETAILS_LABEL,
  SHOW_DETAILS_LABEL,
  TEST_COMMAND_USED_LABEL,
  TEST_OUTPUT_TITLE,
  VERIFICATION_CHECK_LABELS,
  type Run,
  type VerificationResult,
} from '@ogden-agents/shared';
import { ArrowsClockwise, CheckCircle, MinusCircle, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { useRunAction } from './builds-api';

/** One check: a tick, a cross or a dash, never colour alone, with its detail when it did not pass. */
export function Check({ id, result, detail }: { id: keyof typeof VERIFICATION_CHECK_LABELS; result: 'pass' | 'fail' | 'not_run'; detail: string | null }) {
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
 * A run's verification (story 11.2; story 5.9 showed the checks): the three
 * checks with each one's detail, and, behind **Show details**, the test
 * command the re-run used and the end of its output (masked, bounded by core).
 */
export function VerificationChecks({ verification, idPrefix }: { verification: VerificationResult; idPrefix: string }) {
  const [open, setOpen] = useState(false);
  const hasDetails = verification.testOutputTail !== null || verification.testCommand !== null;
  const detailsId = `${idPrefix}-verification-details`;
  return (
    <div className="flex flex-col gap-2" data-testid="verification-checks">
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="review-checks">
        {verification.checks.map((check) => (
          <Check key={check.id} id={check.id} result={check.result} detail={check.detail} />
        ))}
      </ul>
      {hasDetails ? (
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="sm" className="self-start" data-testid="verification-details-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((current) => !current)}>
            {open ? HIDE_DETAILS_LABEL : SHOW_DETAILS_LABEL}
          </Button>
          {open ? (
            <div id={detailsId} className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-caption" data-testid="verification-details">
              {verification.testCommand === null ? null : (
                <p className="m-0">
                  {TEST_COMMAND_USED_LABEL}: <span className="font-mono text-mono-compact" data-testid="verification-test-command">{verification.testCommand}</span>
                </p>
              )}
              {verification.testOutputTail === null ? null : (
                <>
                  <p className="m-0 text-muted-foreground">{TEST_OUTPUT_TITLE}</p>
                  <pre className="m-0 max-h-72 overflow-auto font-mono text-mono-compact whitespace-pre-wrap" data-testid="verification-test-output">
                    {verification.testOutputTail}
                  </pre>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Whether a run can be checked again: failed or ready for review, not decided. */
export function canCheckAgain(run: Pick<Run, 'outcome' | 'decision' | 'worktreePath'>): boolean {
  return (run.outcome === 'failed' || run.outcome === 'verified') && (run.decision ?? null) === null && run.worktreePath !== null;
}

/** **Check again**: the end checks run once more on the run's worktree; the page follows the run. */
export function CheckAgainButton({ wsId, run, onError }: { wsId: string; run: Run; onError?: (message: string) => void }) {
  const again = useRunAction(wsId, 'check_again');
  if (!canCheckAgain(run)) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="check-again"
      aria-disabled={again.isPending || undefined}
      onClick={() => {
        if (again.isPending) return;
        again.mutateAsync(run.id).catch((error: unknown) => onError?.(error instanceof Error ? error.message : String(error)));
      }}
    >
      <ArrowsClockwise aria-hidden />
      {CHECK_AGAIN_LABEL}
    </Button>
  );
}
