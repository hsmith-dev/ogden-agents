/**
 * The reviewer role of the orchestration use-case (epic 15, stories 15.10 and 15.13): where the person looks at the result a review step is
 * about, and the message a review step sends. Core builds the message from the manager's question and the reviewed step's own result, never
 * the manager. Read only: this decides nothing on a run.
 */
import { buildReviewMessage, buildSummaryText, dispatchRefusalWords, type OrchestrationReviewTarget, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { and, eq } from 'drizzle-orm';
import { orchestrationSteps, runs as runsTable } from './db/schema.js';
import { DispatchRefusedError, StepNotApprovedError } from './errors.js';
import { cleanForManager } from './manager-input.js';
import type { Base, RunRow, StepRow } from './orchestration-kernel.js';
import type { BuildReadApi } from './orchestration-build-read.js';
import type { ManagerIoApi } from './orchestration-manager-io.js';
import type { RowsApi } from './orchestration-rows.js';
import { stepOf } from './orchestration-rows.js';
import type { TranscriptApi } from './orchestration-transcript.js';

export function createReview({ orm, team, stepsOf, labels, buildRunOf, lastReply }: Base & RowsApi & ManagerIoApi & BuildReadApi & TranscriptApi) {
  /**
   * Where the person looks at the result a review step is about (15.10): epic 5's review page when the reviewed step's chat is a build run
   * (the ticket's review, where they approve and merge), else the worker chat that did it; `null` while the reviewed step was not sent.
   * Read only: this never decides anything on a run.
   */
  const reviewTargetOf = (runId: string, reviewedStepId: string): OrchestrationReviewTarget | null => {
    const reviewed = orm.select().from(orchestrationSteps).where(and(eq(orchestrationSteps.runId, runId), eq(orchestrationSteps.stepId, reviewedStepId))).get();
    // A build step (15.11) is looked at on the review page of its ticket, once the build was started; it has no worker chat.
    if (reviewed !== undefined && reviewed.buildRef !== null) return reviewed.buildRunId === null ? null : { kind: 'build_review', ticketRef: reviewed.buildRef };
    if (reviewed === undefined || reviewed.sessionId === null) return null;
    const build = orm.select({ ticketRef: runsTable.ticketRef }).from(runsTable).where(eq(runsTable.sessionId, reviewed.sessionId)).get();
    return build === undefined ? { kind: 'worker_chat', sessionId: reviewed.sessionId as SessionId } : { kind: 'build_review', ticketRef: build.ticketRef };
  };

  /**
   * The message a review step sends (15.10), built here from the manager's question and the reviewed step's result, never by the manager:
   * checked first that the worker is still the project's reviewer and, where another agent is ready, a different agent from the one that did
   * the reviewed work ({@link DispatchRefusedError} `not_the_reviewer`, before anything is created). The summary is the reviewed step's own
   * capped, masked report with paths scrubbed and code and diff hunks left out ({@link buildReviewMessage}); nothing else of it goes.
   */
  const reviewMessageFor = async (workspaceId: WorkspaceId, run: RunRow, row: StepRow, label: string): Promise<string> => {
    const refuse = (): never => {
      throw new DispatchRefusedError('not_the_reviewer', dispatchRefusalWords('not_the_reviewer', label));
    };
    const reviewer = team === undefined ? undefined : await team.reviewer(workspaceId);
    if (team === undefined || reviewer?.agentId !== row.worker) return refuse();
    const reviewed = stepsOf(run.id).find((other) => other.stepId === row.reviewOf);
    const reviewedBuild = reviewed !== undefined && reviewed.buildRef !== null;
    if (reviewed === undefined || reviewed.state !== 'done' || (reviewed.sessionId === null && !reviewedBuild)) throw new StepNotApprovedError();
    // The plan check's rules again, so a row written another way is never built into a message.
    if (row.chat !== 'new' || reviewed.reviewOf !== null || !stepOf(row).dependsOn.includes(reviewed.stepId)) return refuse();
    if (reviewed.worker === row.worker && (await team.workers(workspaceId)).some((worker) => worker.ready && worker.agentId !== row.worker)) return refuse();
    const names = await labels(workspaceId);
    // The reviewed step's own words, not yet cut: code and diffs are left out first, so they cannot fill the room the prose needs.
    // A build step's result is Ogden's own summary of the run (outcome and check counts), never the agent's output, files or the diff.
    const found = reviewedBuild && reviewed.buildRunId !== null ? buildRunOf(workspaceId, reviewed.buildRef!, reviewed.buildRunId) : undefined;
    if (reviewedBuild && found === undefined) throw new StepNotApprovedError();
    const text = found !== undefined ? buildSummaryText({ ticketRef: reviewed.buildRef!, outcome: found.view.outcome, decision: found.view.decision, checks: found.view.checks, reason: found.reason }) : lastReply(workspaceId, reviewed.sessionId as SessionId, reviewed.instruction, reviewed.chat !== 'new', reviewed.reviewOf !== null);
    return buildReviewMessage({ question: row.instruction, reviewedStep: reviewed.stepId, reviewedBy: cleanForManager(names.get(reviewed.worker) ?? reviewed.worker).slice(0, 60), resultText: cleanForManager(text) });
  };

  return { reviewTargetOf, reviewMessageFor };
}

export type ReviewApi = ReturnType<typeof createReview>;
