import { BUILD_THIS_STORY_LABEL, buildFailedText, REVIEW_LINK_LABEL, RUN_PHASE_LABELS, RUN_VIEW_LINK_LABEL, runPhase, type Run } from '@ogden-agents/shared';
import { Hammer } from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/ui/button';
import { Text } from '@/ui/typography';
import { useWorkspaceSettings } from '@/workspaces/workspace-settings-api';
import { useBoardBuildActions } from './board-build-context';
import { useWorkspaceRuns } from './builds-api';
import { runSentence } from './build-run-panel';

/** The heading of the detail sheet's build section. */
export const TICKET_BUILD_HEADING = 'Build';

/** One run of the ticket: its state, why it did not finish (a failed check in words), and links to its run view and its review. */
function TicketRun({ wsId, ticketRef, run }: { wsId: string; ticketRef: string; run: Run }) {
  const phase = runPhase(run);
  const sentence = run.outcome === 'running' ? null : runSentence(run);
  return (
    <li className="flex flex-col gap-1" data-testid="ticket-sheet-run" data-phase={phase} data-run={run.id}>
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
    </li>
  );
}

/**
 * The ticket detail sheet's build section (stories 11.2 and 11.3): **Build
 * this story** for a Ready ticket whose prerequisites are met (never one that
 * waits, never one already queued or being built; a refused build opens the
 * board's Build dialog), and every run of the ticket, newest first, each with
 * its state, why it failed (a failed check in words) and links to its run view
 * and its review. Only with Unattended builds on, and only when there is
 * something to show.
 */
export function TicketBuildSection({ wsId, ticketRef, ready, waits }: { wsId: string; ticketRef: string; ready: boolean; waits: boolean }) {
  const settings = useWorkspaceSettings(wsId);
  const on = settings.data?.bmadPieces.includes('builds') === true;
  const runs = useWorkspaceRuns(wsId, on);
  const actions = useBoardBuildActions();
  if (!on) return null;
  const own = (runs.data?.runs ?? []).filter((each) => each.ticketRef === ticketRef);
  const queued = (runs.data?.queue ?? []).some((entry) => entry.ticketRef === ticketRef);
  const buildable = actions !== undefined && ready && !waits && !queued && own[0]?.outcome !== 'running';
  if (own.length === 0 && !buildable) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="ticket-sheet-build" data-phase={own[0] === undefined ? undefined : runPhase(own[0])}>
      <Text as="h3" variant="label" tone="muted">
        {TICKET_BUILD_HEADING}
      </Text>
      {actions?.failure === undefined ? null : (
        <Text variant="caption" role="alert" className="text-state-error" data-testid="ticket-sheet-build-error">
          {actions.failure}
        </Text>
      )}
      {buildable ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          data-testid="ticket-sheet-build-start"
          aria-label={`${BUILD_THIS_STORY_LABEL} ${ticketRef}`}
          aria-disabled={actions.building || undefined}
          onClick={() => {
            if (!actions.building) actions.onBuild(ticketRef);
          }}
        >
          <Hammer aria-hidden />
          {BUILD_THIS_STORY_LABEL}
        </Button>
      ) : null}
      {own.length === 0 ? null : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="ticket-sheet-runs">
          {own.map((run) => (
            <TicketRun key={run.id} wsId={wsId} ticketRef={ticketRef} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}
