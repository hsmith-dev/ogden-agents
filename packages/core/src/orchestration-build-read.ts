/**
 * Builds the manager proposed, as the plan reads them (epic 15, stories 15.11 and 15.13): read only. A build is started only by the user, in the
 * Build dialog; this reads a build run as the page and the manager see it, and says how a build step follows it.
 */
import { CHECKPOINT_BLOCKED_CODES, blockedSentence, type OrchestrationBuildRunView, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { runs as runsTable } from './db/schema.js';
import type { Base } from './orchestration-kernel.js';
import type { TranscriptApi } from './orchestration-transcript.js';

/** How a step follows its build run: still going, done (the build ended verified), or failed (failed, stopped, or blocked for another reason). */
export type BuildEnd = 'running' | 'done' | 'failed';

/**
 * How a step follows its build run: still going (running, or paused at the plan's own checkpoint, which only the user continues), done
 * (the build ended verified, waiting for the user's review: nothing is merged), or failed (failed, stopped, or blocked for another reason).
 */
export const buildEndOf = (outcome: OrchestrationBuildRunView['outcome'], blockedCode: string | null): BuildEnd => {
  if (outcome === 'running') return 'running';
  if (outcome === 'verified') return 'done';
  if (outcome === 'blocked' && blockedCode !== null && (CHECKPOINT_BLOCKED_CODES as readonly string[]).includes(blockedCode)) return 'running';
  return 'failed';
};

export function createBuildRead({ orm, checksOf }: Base & TranscriptApi) {
  /** A build run as the page and the manager read it, or `undefined` when it is not a run of this ticket in this project. */
  const buildRunOf = (workspaceId: WorkspaceId, ticketRef: string, buildRunId: string): { view: OrchestrationBuildRunView; blockedCode: string | null; reason: string | null } | undefined => {
    const row = orm.select().from(runsTable).where(eq(runsTable.id, buildRunId)).get();
    if (row === undefined || row.workspaceId !== workspaceId || row.ticketRef !== ticketRef) return undefined;
    // Only Ogden's own sentence for a blocked build: a stored reason may hold the build agent's words, which the manager never reads.
    const reason = row.outcome === 'blocked' && row.blockedCode !== null ? blockedSentence(row.blockedCode) : null;
    return {
      view: { runId: row.id as OrchestrationBuildRunView['runId'], outcome: row.outcome, decision: row.decision, checks: checksOf(workspaceId, row.sessionId as SessionId) },
      blockedCode: row.blockedCode,
      reason,
    };
  };
  return { buildRunOf };
}

export type BuildReadApi = ReturnType<typeof createBuildRead>;
