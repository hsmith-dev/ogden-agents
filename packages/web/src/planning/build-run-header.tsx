import { CHECKPOINT_BLOCKED_CODES, REVIEW_LINK_LABEL, RUN_PHASE_LABELS, runPhase, type Run } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useRunAction } from './builds-api';

/** The words on the build header's buttons. */
export const STOP_LABEL = 'Stop';
export const RETRY_LABEL = 'Retry';
export const CONTINUE_LABEL = 'Continue the build';

/**
 * A build session's header items (story 5.2, the tracer; story 5.8): the
 * ticket's ref in mono, the run's state in words, **Stop** while it runs or
 * waits in the queue, its plain reason and **Retry** when it is blocked,
 * failed or stopped (**Continue the build** at a checkpoint pause), and,
 * once it ended, a link to the ticket's review page. Read-only otherwise:
 * the build runs on its own (11.1 builds the full run view).
 */
export function BuildRunHeader({ wsId, run }: { wsId: string; run: Run | undefined }) {
  const stop = useRunAction(wsId, 'stop');
  const retry = useRunAction(wsId, 'retry');
  const [failure, setFailure] = useState<string | undefined>();
  if (run === undefined) return null;
  const phase = runPhase(run);
  const paused = run.blockedCode !== null && CHECKPOINT_BLOCKED_CODES.includes(run.blockedCode);
  const retryable = run.worktreePath !== null && (run.decision ?? null) === null && (run.outcome === 'failed' || run.outcome === 'stopped' || (run.outcome === 'blocked' && run.blockedCode !== 'merge_conflict'));
  const acting = stop.isPending || retry.isPending;
  const act = (action: typeof stop) => {
    if (acting) return;
    setFailure(undefined);
    action.mutateAsync(run.id).catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
  };
  return (
    <span className="flex min-w-0 items-center gap-2" data-testid="build-run-header" data-outcome={run.outcome} data-phase={phase}>
      <span className="font-mono text-mono-compact text-muted-foreground" data-testid="build-run-ref">
        {run.ticketRef}
      </span>
      <Badge variant="outline" data-testid="build-run-outcome">
        {RUN_PHASE_LABELS[phase]}
      </Badge>
      {run.outcome === 'running' ? (
        <Button variant="outline" size="sm" data-testid="build-run-stop" aria-disabled={acting || undefined} onClick={() => act(stop)}>
          {STOP_LABEL}
        </Button>
      ) : null}
      {run.reason !== null && (run.outcome === 'blocked' || run.outcome === 'failed') ? (
        <span className="min-w-0 truncate text-caption text-muted-foreground" title={run.reason} data-testid="build-run-reason">
          {run.reason}
        </span>
      ) : null}
      {failure === undefined ? null : (
        <span role="alert" className="min-w-0 truncate text-caption text-state-error" title={failure} data-testid="build-run-action-error">
          {failure}
        </span>
      )}
      {retryable ? (
        <Button variant="outline" size="sm" data-testid="build-run-retry" aria-disabled={acting || undefined} onClick={() => act(retry)}>
          {paused ? CONTINUE_LABEL : RETRY_LABEL}
        </Button>
      ) : null}
      {run.outcome === 'running' || paused ? null : (
        <Button variant="outline" size="sm" asChild>
          <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: run.ticketRef }} data-testid="build-run-review">
            {REVIEW_LINK_LABEL}
          </Link>
        </Button>
      )}
    </span>
  );
}
