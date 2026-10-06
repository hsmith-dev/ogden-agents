/**
 * The mode, limits, defaults and activity contracts (epic 15, story 15.8): the bounds a limit may be set within, how deep a step
 * is, the stop reasons and their plain words, the request that changes the install's defaults, the activity entry, and the two
 * new events. Every sentence has no dash.
 */
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  BoundedRunLimits,
  CoreEvent,
  NewCoreEvent,
  NewProjectDefaults,
  ORCHESTRATION_ACTIVITY_PAGE,
  ORCHESTRATION_AUTOMATIC_CONFIRM_BUTTON,
  ORCHESTRATION_AUTOMATIC_CONFIRM_TITLE,
  ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS,
  ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE,
  ORCHESTRATION_LIMIT_BOUNDS,
  ORCHESTRATION_MANAGER_AUTO_MARK,
  ORCHESTRATION_NEEDS_YOUR_APPROVAL,
  ORCHESTRATION_STOP_REASONS,
  OrchestrationActivityEntry,
  OrchestrationDefaultsResponse,
  RUN_LIMITS,
  RunLimits,
  UpdateOrchestrationDefaultsRequest,
  WorkspaceSettings,
  orchestrationStopWords,
  stepDepths,
} from '../src/index.js';

const NO_DASH = /—|–| - /;
const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const RUN = 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const base = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 1, at: '2026-10-06T10:00:00.000Z', workspaceId: WS, streamId: WS };

describe('the limits a run may be set to', () => {
  it('start at 20 instructions, depth 3 and 30 minutes and stay within sane bounds', () => {
    expect(RUN_LIMITS).toEqual({ maxInstructions: 20, maxDepth: 3, maxMinutes: 30 });
    expect(BoundedRunLimits.safeParse(RUN_LIMITS).success).toBe(true);
    expect(ORCHESTRATION_LIMIT_BOUNDS).toEqual({ maxInstructions: { min: 1, max: 20 }, maxDepth: { min: 1, max: 5 }, maxMinutes: { min: 1, max: 120 } });
    for (const [field, bound] of Object.entries(ORCHESTRATION_LIMIT_BOUNDS)) {
      const ok = (value: number) => BoundedRunLimits.safeParse({ ...RUN_LIMITS, [field]: value }).success;
      expect(ok(bound.min)).toBe(true);
      expect(ok(bound.max)).toBe(true);
      expect(ok(bound.min - 1)).toBe(false);
      expect(ok(bound.max + 1)).toBe(false);
      expect(ok(bound.min + 0.5)).toBe(false);
    }
    // A run stored with a wider limit still reads (the stored shape is wider than what a user may save).
    expect(RunLimits.safeParse({ maxInstructions: 20, maxDepth: 10, maxMinutes: 240 }).success).toBe(true);
  });

  it('says in plain words which bound was broken', () => {
    const refused = BoundedRunLimits.safeParse({ ...RUN_LIMITS, maxMinutes: 500 });
    expect(refused.success ? '' : refused.error.issues[0]!.message).toBe('The time limit can be at most 120.');
  });
});

describe('how deep a step is', () => {
  it('is 1 for a step that needs nothing and one more than the deepest step it needs, so a run\'s depth is its longest chain', () => {
    const depths = stepDepths([
      { stepId: 'a', dependsOn: [] },
      { stepId: 'b', dependsOn: ['a'] },
      { stepId: 'c', dependsOn: ['a', 'b'] },
      { stepId: 'd', dependsOn: [] },
      { stepId: 'e', dependsOn: ['c', 'd'] },
    ]);
    expect([...depths.entries()]).toEqual([['a', 1], ['b', 2], ['c', 3], ['d', 1], ['e', 4]]);
  });

  it('ignores a prerequisite that is not in the list and keeps a loop finite', () => {
    expect(stepDepths([{ stepId: 'a', dependsOn: ['ghost'] }]).get('a')).toBe(1);
    const loop = stepDepths([{ stepId: 'a', dependsOn: ['b'] }, { stepId: 'b', dependsOn: ['a'] }]);
    expect(loop.get('a')).toBeGreaterThan(20);
  });
});

describe('the stop reasons', () => {
  it('include a refused dispatch, and every reason has plain words with no dash and its limit named', () => {
    expect(ORCHESTRATION_STOP_REASONS).toContain('dispatch_refused');
    for (const reason of ORCHESTRATION_STOP_REASONS) {
      const words = orchestrationStopWords(reason, { maxInstructions: 7, maxDepth: 2, maxMinutes: 15 });
      expect(words.length, reason).toBeGreaterThan(10);
      expect(words, reason).not.toMatch(NO_DASH);
    }
    expect(orchestrationStopWords('instruction_limit', { maxInstructions: 7, maxDepth: 2, maxMinutes: 15 })).toContain('7 instructions');
    expect(orchestrationStopWords('depth_limit', { maxInstructions: 7, maxDepth: 2, maxMinutes: 15 })).toContain('more than 2 steps deep');
    expect(orchestrationStopWords('time_limit', { maxInstructions: 7, maxDepth: 2, maxMinutes: 15 })).toContain('15 minutes');
  });

  it('keeps every sentence of the mode screens free of dashes', () => {
    for (const text of [
      ORCHESTRATION_AUTOMATIC_CONFIRM_TITLE,
      ORCHESTRATION_AUTOMATIC_CONFIRM_WORDS,
      ORCHESTRATION_AUTOMATIC_CONFIRM_BUTTON,
      ORCHESTRATION_DEFAULT_AUTOMATIC_NOTE,
      ORCHESTRATION_NEEDS_YOUR_APPROVAL,
      ORCHESTRATION_MANAGER_AUTO_MARK,
    ]) {
      expect(text).not.toMatch(NO_DASH);
    }
  });
});

describe('the install\'s orchestration defaults', () => {
  it('takes a mode and/or limits within bounds, and refuses an empty change, an unknown field or a limit out of bounds', () => {
    const ok = (value: unknown) => UpdateOrchestrationDefaultsRequest.safeParse(value).success;
    expect(ok({ mode: 'approve_each' })).toBe(true);
    expect(ok({ mode: 'automatic', confirm: true })).toBe(true);
    expect(ok({ limits: { maxDepth: 2 } })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ limits: {} })).toBe(false);
    expect(ok({ confirm: true })).toBe(false);
    expect(ok({ mode: 'sometimes' })).toBe(false);
    expect(ok({ limits: { maxInstructions: 0 } })).toBe(false);
    expect(ok({ limits: { maxInstructions: 21 } })).toBe(false);
    expect(ok({ mode: 'approve_each', extra: 1 })).toBe(false);
  });

  it('is answered as a mode and the limits, has a route, and rides in the new project defaults as optional fields', () => {
    expect(OrchestrationDefaultsResponse.safeParse({ defaults: { mode: 'approve_each', limits: RUN_LIMITS } }).success).toBe(true);
    expect(API_ROUTES.orchestrationDefaults).toBe('/api/v1/settings/orchestration');
    expect(API_ROUTES.workspaceOrchestrationActivity).toBe('/api/v1/workspaces/:wsId/orchestration/activity');
    expect(NewProjectDefaults.safeParse({ bmadPieces: [] }).success).toBe(true);
    expect(NewProjectDefaults.safeParse({ bmadPieces: [], orchestrationMode: 'automatic', orchestrationLimits: RUN_LIMITS }).success).toBe(true);
    expect(WorkspaceSettings.safeParse({ cautionLevel: 'ask_every_time', bmadPieces: [], orchestrationAutomaticConfirmed: true }).success).toBe(true);
    expect(WorkspaceSettings.safeParse({ cautionLevel: 'ask_every_time', bmadPieces: [], orchestrationAutomaticConfirmed: false }).success).toBe(false);
  });
});

describe('the activity log entry and the new events', () => {
  const entry = { at: '2026-10-06T10:00:00.000Z', runId: RUN, stepId: 's1', kind: 'sent', worker: 'agent-a', workerLabel: 'Agent A', sessionId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', chat: 'new', approvedBy: 'mode', instruction: 'Do it.', result: 'working', note: '' };

  it('parses a sent entry and a refused one, and keeps the text short', () => {
    expect(OrchestrationActivityEntry.safeParse(entry).success).toBe(true);
    expect(OrchestrationActivityEntry.safeParse({ ...entry, kind: 'refused', sessionId: null, approvedBy: null, result: 'refused', note: 'Agent A is not ready.' }).success).toBe(true);
    expect(OrchestrationActivityEntry.safeParse({ ...entry, instruction: 'x'.repeat(201) }).success).toBe(false);
    expect(OrchestrationActivityEntry.safeParse({ ...entry, approvedBy: 'manager' }).success).toBe(false);
    expect(OrchestrationActivityEntry.safeParse({ ...entry, result: 'cost' }).success).toBe(false);
    expect(ORCHESTRATION_ACTIVITY_PAGE).toBe(100);
    // No money anywhere: an entry has no cost field.
    expect(Object.keys(OrchestrationActivityEntry.shape).some((key) => /cost|price|token|dollar|money/i.test(key))).toBe(false);
  });

  it('parses the refused dispatch and the defaults changed events as inputs and stored events, and refuses an unknown reason', () => {
    const refused = { type: 'orchestration.dispatch_refused', workspaceId: WS, streamId: WS, payload: { runId: RUN, stepId: 's1', worker: 'agent-a', reason: 'chat_busy', message: 'The chat is busy.' } };
    expect(NewCoreEvent.safeParse(refused).success).toBe(true);
    expect(CoreEvent.safeParse({ ...base, ...refused }).success).toBe(true);
    expect(NewCoreEvent.safeParse({ ...refused, payload: { ...refused.payload, reason: 'because' } }).success).toBe(false);
    const changed = { type: 'settings.orchestration_defaults_changed', workspaceId: null, streamId: 'settings', payload: { mode: 'automatic', previousMode: 'approve_each', limits: RUN_LIMITS, previousLimits: RUN_LIMITS, automaticConfirmed: true } };
    expect(NewCoreEvent.safeParse(changed).success).toBe(true);
    expect(CoreEvent.safeParse({ ...base, ...changed, workspaceId: null, streamId: 'settings' }).success).toBe(true);
    expect(NewCoreEvent.safeParse({ ...changed, payload: { ...changed.payload, automaticConfirmed: false } }).success).toBe(false);
    expect(NewCoreEvent.safeParse({ ...changed, payload: { ...changed.payload, mode: 'sometimes' } }).success).toBe(false);
  });

  it('lets a run stop for a refused dispatch and a message be marked as sent automatically', () => {
    expect(NewCoreEvent.safeParse({ type: 'orchestration.run_stopped', workspaceId: WS, streamId: WS, payload: { runId: RUN, reason: 'dispatch_refused' } }).success).toBe(true);
    const completed = { type: 'session.message_completed', workspaceId: WS, streamId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', payload: { sessionId: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3', messageId: 'msg_01J9Z3K4M5N6P7Q8R9S0T1V2W3', role: 'user', content: 'Do it.', origin: 'manager_auto' } };
    expect(NewCoreEvent.safeParse(completed).success).toBe(true);
    expect(NewCoreEvent.safeParse({ ...completed, payload: { ...completed.payload, origin: 'someone' } }).success).toBe(false);
  });
});
