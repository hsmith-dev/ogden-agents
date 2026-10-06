/**
 * Where a run's loop stands, read from its events (epic 15, stories 15.9 and 15.13): the events are the log, so this is the same after a
 * restart. After a step's result a decision is owed (carrying the capped report and, after a question, the user's answer); a decision
 * made clears it. Read only.
 */
import { ManagerStatusReport as ManagerStatusReportSchema, OrchestrationDecisionView, type ManagerStatusReport, type WorkspaceId } from '@ogden-agents/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { events as eventsTable } from './db/schema.js';
import type { Base } from './orchestration-kernel.js';

export interface LoopState {
  owed: { after: string | null; report: ManagerStatusReport | null; answer: string | null } | null;
  /** The latest decision since the latest result (or what the manager said when only told), as the page shows it. */
  decision: OrchestrationDecisionView | null;
  /** The step the latest result was about, and its report. */
  lastAfter: string | null;
  lastReport: ManagerStatusReport | null;
}

export function createLoopState({ orm }: Pick<Base, 'orm'>) {
  const loopOf = (workspaceId: WorkspaceId, runId: string): LoopState => {
    const rows = orm
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.streamId, workspaceId), inArray(eventsTable.type, ['orchestration.result_read', 'orchestration.decision_made', 'orchestration.question_answered']), sql`json_extract(${eventsTable.payload}, '$.runId') = ${runId}`))
      .orderBy(asc(eventsTable.seq))
      .all();
    const state: LoopState = { owed: null, decision: null, lastAfter: null, lastReport: null };
    let askedAfter: string | null = null;
    for (const row of rows) {
      if (row.type === 'orchestration.result_read') {
        const report = ManagerStatusReportSchema.safeParse((row.payload as { report?: unknown }).report);
        // Only a step that finished asks for a decision; a failed or denied one ended the run.
        if (!report.success || (report.data.state !== 'idle' && report.data.state !== 'done')) continue;
        state.lastAfter = report.data.step_id;
        state.lastReport = report.data;
        state.owed = { after: report.data.step_id, report: report.data, answer: null };
        state.decision = null;
      } else if (row.type === 'orchestration.decision_made') {
        const payload = row.payload as { after?: string | null; action?: string; reason?: string; stepId?: string; question?: string; told?: 'denied' | 'refused' };
        const view = OrchestrationDecisionView.safeParse({ action: payload.action, reason: payload.reason, stepId: payload.stepId, question: payload.question, told: payload.told, at: row.at });
        if (!view.success) continue;
        state.decision = view.data;
        // What the manager said when only told does not answer what is owed (the run had ended).
        if (payload.told === undefined) {
          state.owed = null;
          askedAfter = payload.after ?? null;
        }
      } else if (row.type === 'orchestration.question_answered') {
        if (state.owed === null && state.decision?.action === 'ask_user') {
          state.owed = { after: askedAfter, report: state.lastReport, answer: (row.payload as { answer?: string }).answer ?? '' };
          state.decision = null;
        }
      }
    }
    return state;
  };
  return { loopOf };
}

export type LoopStateApi = ReturnType<typeof createLoopState>;
