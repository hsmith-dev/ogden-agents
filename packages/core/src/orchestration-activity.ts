/**
 * The activity log of a project (epic 15, stories 15.8 and 15.13): every instruction sent or refused, newest first, read from the events and
 * the steps they point at. No money, only what was sent. Read only.
 */
import { ORCHESTRATION_ACTIVITY_PAGE, OrchestrationActivityEntry, redactSecrets, type WorkspaceId } from '@ogden-agents/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { events as eventsTable, orchestrationRuns, orchestrationSteps } from './db/schema.js';
import type { Base } from './orchestration-kernel.js';
import type { ManagerIoApi } from './orchestration-manager-io.js';
import { oneLine } from './orchestration-transcript.js';

export function createActivity({ orm, feature, labels }: Base & ManagerIoApi) {
  /** The activity log: every instruction sent or refused, newest first, read from the events and the steps they point at. */
  const activity = async (workspaceId: WorkspaceId): Promise<OrchestrationActivityEntry[]> => {
    feature.requireOrchestration(workspaceId);
    const rows = orm
      .select()
      .from(eventsTable)
      .where(and(eq(eventsTable.streamId, workspaceId), inArray(eventsTable.type, ['orchestration.step_approved', 'orchestration.step_dispatched', 'orchestration.dispatch_refused'])))
      .orderBy(desc(eventsTable.seq))
      .limit(ORCHESTRATION_ACTIVITY_PAGE * 4)
      .all()
      .reverse();
    const names = await labels(workspaceId);
    const approvers = new Map<string, 'user' | 'mode'>();
    const entries: OrchestrationActivityEntry[] = [];
    for (const row of rows) {
      const payload = row.payload as { runId?: string; stepId?: string; worker?: string; sessionId?: string; by?: 'user' | 'mode'; message?: string };
      if (payload.runId === undefined || payload.stepId === undefined) continue;
      const key = `${payload.runId}:${payload.stepId}`;
      if (row.type === 'orchestration.step_approved') {
        if (payload.by !== undefined) approvers.set(key, payload.by);
        continue;
      }
      const step = orm.select().from(orchestrationSteps).where(and(eq(orchestrationSteps.runId, payload.runId), eq(orchestrationSteps.stepId, payload.stepId))).get();
      const run = step === undefined ? undefined : orm.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, payload.runId)).get();
      if (step === undefined || run === undefined || run.workspaceId !== workspaceId) continue;
      const worker = payload.worker ?? step.worker;
      const refused = row.type === 'orchestration.dispatch_refused';
      let result: OrchestrationActivityEntry['result'] = 'refused';
      if (!refused) {
        if (step.state === 'done') result = 'finished';
        else if (step.state === 'failed') result = run.stopReason === 'permission_denied' ? 'denied' : run.stopReason !== null && run.stopReason !== 'worker_error' ? 'stopped' : 'failed';
        else result = 'working';
      }
      const parsed = OrchestrationActivityEntry.safeParse({
        at: row.at,
        runId: payload.runId,
        stepId: payload.stepId,
        kind: refused ? 'refused' : 'sent',
        worker,
        workerLabel: names.get(worker) ?? worker,
        sessionId: refused ? null : (payload.sessionId ?? null),
        chat: step.chat === 'new' ? 'new' : 'existing',
        approvedBy: refused ? null : (approvers.get(key) ?? null),
        instruction: oneLine(step.instruction, 200),
        result,
        note: refused ? redactSecrets(payload.message ?? '').slice(0, 300) : '',
      });
      if (parsed.success) entries.push(parsed.data);
    }
    return entries.reverse().slice(0, ORCHESTRATION_ACTIVITY_PAGE);
  };
  return { activity };
}

