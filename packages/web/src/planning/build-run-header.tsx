import { REVIEW_LINK_LABEL, RUN_OUTCOME_LABELS, type Run } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';

/**
 * A build session's header items (story 5.2, the tracer): the ticket's ref
 * in mono, the run's outcome in words, and, once it ended, a link to the
 * ticket's review page. Read-only: the build runs on its own.
 */
export function BuildRunHeader({ wsId, run }: { wsId: string; run: Run | undefined }) {
  if (run === undefined) return null;
  return (
    <span className="flex min-w-0 items-center gap-2" data-testid="build-run-header" data-outcome={run.outcome}>
      <span className="font-mono text-mono-compact text-muted-foreground" data-testid="build-run-ref">
        {run.ticketRef}
      </span>
      <Badge variant="outline" data-testid="build-run-outcome">
        {RUN_OUTCOME_LABELS[run.outcome]}
      </Badge>
      {run.outcome === 'running' ? null : (
        <Button variant="outline" size="sm" asChild>
          <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: run.ticketRef }} data-testid="build-run-review">
            {REVIEW_LINK_LABEL}
          </Link>
        </Button>
      )}
    </span>
  );
}
