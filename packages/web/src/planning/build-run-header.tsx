import { REVIEW_LINK_LABEL, RUN_PHASE_LABELS, runPhase, type Run } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useRunAction } from './builds-api';

/** The word on the build header's Stop button. */
export const STOP_LABEL = 'Stop';

/**
 * A build session's header items (story 5.2, the tracer; stories 5.8 and
 * 11.1): the ticket's ref in mono, the run's state in words, **Stop** while it
 * runs or waits in the queue, and, once it ended, a link to the ticket's review
 * page. The rest of the run view (agent, sandbox, time left, the blocked
 * notice with Retry) is {@link BuildRunPanel}, below the header.
 */
export function BuildRunHeader({ wsId, run }: { wsId: string; run: Run | undefined }) {
  const stop = useRunAction(wsId, 'stop');
  const [failure, setFailure] = useState<string | undefined>();
  if (run === undefined) return null;
  const phase = runPhase(run);
  const paused = phase === 'checkpoint';
  const act = () => {
    if (stop.isPending) return;
    setFailure(undefined);
    stop.mutateAsync(run.id).catch((error: unknown) => setFailure(error instanceof Error ? error.message : String(error)));
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
        <Button variant="outline" size="sm" data-testid="build-run-stop" aria-disabled={stop.isPending || undefined} onClick={act}>
          {STOP_LABEL}
        </Button>
      ) : null}
      {failure === undefined ? null : (
        <span role="alert" className="min-w-0 truncate text-caption text-state-error" title={failure} data-testid="build-run-action-error">
          {failure}
        </span>
      )}
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
