import { buildFailedText, REVIEW_LINK_LABEL, RUN_PHASE_LABELS, RUN_VIEW_LINK_LABEL, runPhase } from '@ogden-agents/shared';
import { Link } from '@tanstack/react-router';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { useWorkspaceRuns } from './builds-api';
import { runSentence } from './build-run-panel';

/** The heading of the detail sheet's build section. */
export const TICKET_BUILD_HEADING = 'Build';

/**
 * The ticket detail sheet's build section (story 11.2; 11.3 lists every run
 * here): the ticket's latest run with its state, why it failed or stopped
 * (a failed check in words), and links to its run view and its review. Only
 * with Unattended builds on, and only for a ticket that has a run.
 */
export function TicketBuildSection({ wsId, ticketRef }: { wsId: string; ticketRef: string }) {
  const settings = useWorkspaceSettings(wsId);
  const on = settings.data?.bmadPieces.includes('builds') === true;
  const runs = useWorkspaceRuns(wsId, on);
  const run = runs.data?.runs.find((each) => each.ticketRef === ticketRef);
  if (!on || run === undefined) return null;
  const phase = runPhase(run);
  const sentence = run.outcome === 'running' ? null : runSentence(run);
  return (
    <section className="flex flex-col gap-1.5" data-testid="ticket-sheet-build" data-phase={phase}>
      <Text as="h3" variant="label" tone="muted">
        {TICKET_BUILD_HEADING}
      </Text>
      <Text variant="label" data-testid="ticket-sheet-build-phase">
        {RUN_PHASE_LABELS[phase]}
      </Text>
      {sentence === null || phase === 'built' || phase === 'approved' || phase === 'rejected' ? null : (
        <Text variant="body" className="break-words" data-testid="ticket-sheet-build-reason">
          {phase === 'failed' ? buildFailedText(sentence) : sentence}
        </Text>
      )}
      <span className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/w/$wsId/s/$sesId" params={{ wsId, sesId: run.sessionId }} data-testid="ticket-sheet-build-open">
            {RUN_VIEW_LINK_LABEL}
          </Link>
        </Button>
        {phase === 'built' || phase === 'failed' ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/w/$wsId/review/$ref" params={{ wsId, ref: ticketRef }} data-testid="ticket-sheet-build-review">
              {REVIEW_LINK_LABEL}
            </Link>
          </Button>
        ) : null}
      </span>
    </section>
  );
}
