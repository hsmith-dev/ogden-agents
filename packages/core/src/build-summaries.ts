/**
 * What a look-back is told of an epic's build runs (CAP-13, E7-R2; epic 7
 * story 7.4, user decision 2026-10-02): a short summary per run of the
 * epic's tickets from Ogden's own run records, never a transcript. The shape
 * is {@link EpicBuildSummary}: outcome, verification result, blocked reason,
 * duration and the user's decision. A run still going is left out; at most
 * {@link MAX_EPIC_BUILD_SUMMARIES} of the newest runs, oldest first.
 */
import { blockedSentence, MAX_EPIC_BUILD_SUMMARIES, type EpicBuildSummary, type Run, type VerificationResult, type WorkspaceId } from '@ogden-agents/shared';
import type { Entities } from './entities.js';

export interface BuildSummaries {
  /** The summaries of the runs of the tickets named by `refs` (ticket refs such as `1.2`), oldest first. */
  forTickets(workspaceId: WorkspaceId, refs: ReadonlySet<string>): EpicBuildSummary[];
}

export interface BuildSummariesDeps {
  entities: Pick<Entities, 'listRuns' | 'listSessionEvents'>;
}

const verificationOf = (entities: BuildSummariesDeps['entities'], run: Run): EpicBuildSummary['verification'] => {
  const event = entities.listSessionEvents(run.sessionId, ['run.verification_completed']).at(-1);
  if (event?.type !== 'run.verification_completed') return 'not_checked';
  const verification: VerificationResult = event.payload.verification;
  return verification.outcome === 'verified' ? 'passed' : 'failed';
};

export function createBuildSummaries({ entities }: BuildSummariesDeps): BuildSummaries {
  return {
    forTickets(workspaceId, refs) {
      // Newest first from the records, so the cap keeps the newest; shown oldest first.
      const mine = entities.listRuns(workspaceId).filter((run) => refs.has(run.ticketRef) && run.outcome !== 'running');
      return mine
        .slice(0, MAX_EPIC_BUILD_SUMMARIES)
        .reverse()
        .map((run) => {
          const outcome = run.outcome === 'running' ? 'stopped' : run.outcome;
          const seconds = Math.max(0, Math.round((Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000));
          return {
            ticketRef: run.ticketRef,
            outcome,
            verification: verificationOf(entities, run),
            blockedReason: run.outcome === 'blocked' && run.blockedCode !== null ? blockedSentence(run.blockedCode) : null,
            durationSeconds: Number.isFinite(seconds) ? seconds : 0,
            decision: run.decision,
          } satisfies EpicBuildSummary;
        });
    },
  };
}

/** One summary as a plain line of the look-back's first message: facts only, one line, bounded. */
export function summaryLine(summary: EpicBuildSummary): string {
  const verification = summary.verification === 'passed' ? 'checks passed' : summary.verification === 'failed' ? 'checks failed' : 'not checked';
  const minutes = summary.durationSeconds < 60 ? `${summary.durationSeconds} s` : `${Math.round(summary.durationSeconds / 60)} min`;
  const parts = [summary.ticketRef + ':', `${summary.outcome},`, `${verification},`, minutes];
  if (summary.blockedReason !== null) parts.push(`, blocked: ${summary.blockedReason}`);
  if (summary.decision !== null) parts.push(`, ${summary.decision}`);
  // Plain single-line text: control characters and runs of space gone, at most 300 characters.
  return `- ${parts.join(' ').replace(/ ,/g, ',').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()}`.slice(0, 300);
}
