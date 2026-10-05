import { RUN_PHASE_LABELS, RUN_VIEW_LINK_LABEL, RUNS_EMPTY_TEXT, RUNS_LOAD_FAILED, RUNS_PAGE_TITLE, RUNS_QUEUE_TITLE, REVIEW_LINK_LABEL, runPhase, type Run } from '@ogden-agents/shared';
import { Link, useParams } from '@tanstack/react-router';
import { runSentence } from '@/planning/build-run-panel';
import { useWorkspaceRuns } from '@/planning/builds-api';
import { useTickets } from '@/planning/planning-api';
import { PlanPieceGate } from '@/planning/plan-piece-gate';
import { WorkspaceHeader } from '@/shell/workspace-header';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { PageBody, PageSection } from '@/ui/page';
import { RowList } from '@/ui/row-list';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/typography';

/** One run: its ticket, its state, why it stopped (if it did) and a link to its run view, and to its review once it is ready. */
function RunRow({ wsId, run, title }: { wsId: string; run: Run; title: string | undefined }) {
  const phase = runPhase(run);
  const sentence = run.outcome === 'running' ? null : runSentence(run);
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-card px-3 py-2" data-testid="run-row" data-ref={run.ticketRef} data-phase={phase}>
      <span className="font-mono text-mono-compact text-muted-foreground">{run.ticketRef}</span>
      <span className="min-w-0 flex-1 truncate text-label text-foreground">{title ?? ''}</span>
      <Badge variant="outline" data-testid="run-row-phase">
        {RUN_PHASE_LABELS[phase]}
      </Badge>
      {sentence === null || phase === 'built' || phase === 'approved' || phase === 'rejected' ? null : (
        <span className="basis-full text-caption text-muted-foreground" data-testid="run-row-reason">
          {sentence}
        </span>
      )}
      <span className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: run.sessionId }} data-testid="run-row-open">
            {RUN_VIEW_LINK_LABEL}
          </Link>
        </Button>
        {phase === 'built' ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: run.ticketRef }} data-testid="run-row-review">
              {REVIEW_LINK_LABEL}
            </Link>
          </Button>
        ) : null}
      </span>
    </li>
  );
}

/** The runs and the queue of a project with Unattended builds on. */
function Runs({ wsId }: { wsId: string }) {
  const runs = useWorkspaceRuns(wsId, true);
  const tickets = useTickets(wsId);
  const titles = new Map((tickets.data?.tickets ?? []).map((row) => [row.ref, row.title]));
  if (runs.isError) {
    return (
      <Text variant="caption" role="alert" data-testid="runs-error">
        {RUNS_LOAD_FAILED}
      </Text>
    );
  }
  if (runs.data === undefined) return <Skeleton data-testid="runs-loading" />;
  const { runs: all, queue } = runs.data;
  if (all.length === 0) {
    return (
      <Text variant="caption" data-testid="runs-empty">
        {RUNS_EMPTY_TEXT}
      </Text>
    );
  }
  return (
    <>
      {queue.length === 0 ? null : (
        <PageSection title={RUNS_QUEUE_TITLE} data-testid="runs-queue">
          <RowList>
            {queue.map((entry) => (
              <li key={entry.runId} className="text-label text-foreground" data-testid="runs-queue-entry" data-ref={entry.ticketRef}>
                <span className="font-mono text-mono-compact text-muted-foreground">{entry.ticketRef}</span> {titles.get(entry.ticketRef) ?? ''}
                <span className="text-caption text-muted-foreground"> (number {entry.position})</span>
              </li>
            ))}
          </RowList>
        </PageSection>
      )}
      <ul className="m-0 flex max-w-(--space-chat-column) list-none flex-col gap-2 p-0" aria-label={RUNS_PAGE_TITLE} data-testid="runs-list">
        {all.map((run) => (
          <RunRow key={run.id} wsId={wsId} run={run} title={titles.get(run.ticketRef)} />
        ))}
      </ul>
    </>
  );
}

/** `/w/:wsId/runs`: every build run of the project, newest first, and its queue (story 11.1). With Unattended builds off, the feature-off notice and nothing else (4.6's piece gate). */
export function WorkspaceRunsPage() {
  const { wsId } = useParams({ strict: false }) as { wsId: string };
  return (
    <>
      <WorkspaceHeader title={RUNS_PAGE_TITLE} wsId={wsId} tab="runs" />
      <PageBody data-testid="workspace-runs-page">
        <PlanPieceGate wsId={wsId} piece="builds">
          <Runs wsId={wsId} />
        </PlanPieceGate>
      </PageBody>
    </>
  );
}
