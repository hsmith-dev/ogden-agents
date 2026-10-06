/**
 * Orchestration mode, Stop and per-run limits (epic 15, story 15.8), over a real core (database, event log, settings) with a stub
 * chat, a stub manager, fake workers and a fake clock: the mode is the project's, switching to automatic is confirmed once per
 * project and recorded in the event log, in the default mode only the user's approval dispatches, in automatic mode core itself sends
 * the plan's steps one at a time within the run's limits and stops at the first refusal, error or limit with a plain reason and an
 * event, an agent that signs in with the user's account waits for the user, switching the mode back returns the next step to
 * needing approval, Stop never depends on the piece being on, and the activity log reads from the events. Nothing runs a real
 * agent, model, network or keychain.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANAGER_PLAN_VERSION,
  type ManagerPlan,
  type OrchestrationRunView,
  type RunLimits,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { ConfirmationRequiredError, createNewProjectDefaults, NotFoundError, StepNotApprovedError, ValidationError, validatePlanFor, type Core, type ManagerPort, type OrchestrationChat } from '../src/index.js';
import { openDatabase } from '../src/db/database.js';
import { openTestCore, tempDir } from './helpers.js';

const agentOf = (agentId: string, displayName: string, fields: Record<string, unknown> = {}) => ({
  agentId,
  displayName,
  provider: 'Fake',
  signInMethods: [],
  install: { state: 'installed' },
  auth: { state: 'signed_in' },
  terminalResume: false,
  needsProjectTrust: false,
  permissionModes: ['ask'],
  ...fields,
});
const SUBSCRIPTION = { signInMethods: [{ kind: 'subscription', label: 'Sign in with your account' }] };
const API_KEY = { signInMethods: [{ kind: 'api_key', label: 'Use an API key' }] };

/** A chain or a set of steps: `[worker, depends_on]` each, ids s1, s2, ... in order. */
const planOf = (...steps: ReadonlyArray<readonly [worker: string, needs?: readonly string[]]>): ManagerPlan => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Do the work',
  steps: steps.map(([worker, needs], index) => ({ id: `s${index + 1}`, worker, chat: 'new' as const, instruction: `Instruction ${index + 1} for ${worker}.`, mode: 'ask' as const, depends_on: [...(needs ?? [])] })),
});
const CHAIN3 = planOf(['codex'], ['codex', ['s1']], ['codex', ['s2']]);
const CHAIN4 = planOf(['codex'], ['codex', ['s1']], ['codex', ['s2']], ['codex', ['s3']]);
const THREE_INDEPENDENT = planOf(['codex'], ['codex'], ['codex']);

const stubManager = (plan: ManagerPlan): ManagerPort => ({
  async proposePlan(context) {
    return validatePlanFor(context, plan);
  },
  async decideNext() {
    return { ok: false, kind: 'unavailable', reason: 'not used here' };
  },
});

interface KitOptions {
  plan?: ManagerPlan;
  agents?: ReadonlyArray<ReturnType<typeof agentOf>>;
  limits?: RunLimits;
  /** The project's mode before the run starts: automatic is confirmed first, as the user does. */
  mode?: 'approve_each' | 'automatic';
  on?: boolean;
}

const STARTED = Date.parse('2026-10-06T10:00:00.000Z');

function setUp({ plan = CHAIN3, agents = [agentOf('codex', 'Codex', API_KEY), agentOf('claude-code', 'Claude Code', SUBSCRIPTION)], limits, mode = 'automatic', on = true }: KitOptions = {}) {
  const dataDir = tempDir();
  const core: Core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (on) core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  if (mode === 'automatic') core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: true });
  const clock = { now: STARTED };
  const listed = [...agents];
  const created: Array<{ agentId: string | undefined }> = [];
  const sent: Array<{ sessionId: SessionId; text: string; origin: string | undefined }> = [];
  const cancelled: SessionId[] = [];
  const chat: OrchestrationChat = {
    async chatAgents() {
      return { defaultAgentId: 'codex', agents: listed } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
    async createChatSession(workspaceId, options) {
      const session = core.entities.createSession({ workspaceId, kind: 'chat', ...(options?.agentId === undefined ? {} : { agentId: options.agentId }) });
      created.push({ agentId: options?.agentId });
      return session;
    },
    sendMessage(workspaceId, sessionId, text, options) {
      sent.push({ sessionId, text, origin: options?.origin });
      core.sessionEvents.completeMessage(sessionId, { messageId: `msg_${sent.length}`.padEnd(30, '0') as never, role: 'user', content: text, ...(options?.origin === undefined ? {} : { origin: options.origin }) });
      core.entities.setSessionState(sessionId, 'working');
      return { messageId: 'msg', queued: false };
    },
    getSession(workspaceId, sessionId) {
      const session = core.entities.getSession(sessionId);
      if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
      return session;
    },
    listSessions: (workspaceId) => core.entities.listSessions(workspaceId),
    renameSession: (workspaceId, sessionId) => core.entities.getSession(sessionId)!,
    removeQueuedMessage() {},
    cancel(workspaceId, sessionId) {
      cancelled.push(sessionId);
      core.entities.setSessionState(sessionId, 'idle');
    },
  };
  const orchestration = core.createOrchestration({ chat, manager: stubManager(plan), ...(limits === undefined ? {} : { limits: () => limits }), clock: () => clock.now });
  /** The worker finishes its turn: its reply is stored and the chat goes idle (or into an error). */
  const finish = (sessionId: SessionId, reply = 'Done.', state: 'idle' | 'error' = 'idle') => {
    core.sessionEvents.completeMessage(sessionId, { messageId: `msg_reply_${Math.random().toString(36).slice(2)}`.padEnd(30, '0') as never, role: 'agent', content: reply });
    core.entities.setSessionState(sessionId, state);
  };
  const tamper = (sql: string, ...params: string[]) => {
    const db = openDatabase(dataDir);
    try {
      db.sqlite.prepare(sql).run(...params);
    } finally {
      db.close();
    }
  };
  /** The run as the user would read it now. */
  const read = async (runId: string): Promise<OrchestrationRunView> => orchestration.getRun(workspace.id, runId);
  /** Lets every automatic pass that is waiting run. */
  const settle = async () => {
    await orchestration.whenIdle();
  };
  /** The session of a step. */
  const sessionOf = (view: OrchestrationRunView, stepId: string): SessionId => view.steps.find((step) => step.stepId === stepId)!.sessionId!;
  return { core, dataDir, workspace, orchestration, clock, listed, created, sent, cancelled, finish, tamper, read, settle, sessionOf };
}

const typesAfter = (core: Core, after: number) => core.events.readAfter(after).map((event) => event.type);
const orchestrationEvents = (core: Core, after: number) => core.events.readAfter(after).filter((event) => event.type.startsWith('orchestration.'));
const stateOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!.state;

describe('switching to automatic is confirmed once per project and recorded in the event log', () => {
  it('refuses without confirm and writes nothing, accepts with confirm and records it, and does not ask again for that project', () => {
    const core = openTestCore(tempDir(), undefined, { orchestrationAvailable: true });
    const first = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const second = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const before = core.events.lastSeq();
    expect(() => core.permissions.updateSettings(first.id, { orchestrationMode: 'automatic' })).toThrow(ConfirmationRequiredError);
    expect(() => core.permissions.updateSettings(first.id, { orchestrationMode: 'automatic', confirm: false })).toThrow(ConfirmationRequiredError);
    expect(core.events.lastSeq()).toBe(before);
    expect(core.permissions.getSettings(first.id).orchestrationAutomaticConfirmed).toBeUndefined();

    const confirmed = core.permissions.updateSettings(first.id, { orchestrationMode: 'automatic', confirm: true });
    expect(confirmed).toMatchObject({ orchestrationMode: 'automatic', orchestrationAutomaticConfirmed: true });
    const marks = core.events.readAfter(before).filter((event) => event.type === 'workspace.settings_changed');
    expect(marks).toEqual([expect.objectContaining({ payload: expect.objectContaining({ orchestrationMode: 'automatic', previousOrchestrationMode: 'approve_each', orchestrationAutomaticConfirmed: true }) })]);

    // Back to Approve each instruction, and to automatic again: no second question, no second confirmation mark.
    const mid = core.events.lastSeq();
    expect(core.permissions.updateSettings(first.id, { orchestrationMode: 'approve_each' })).toMatchObject({ orchestrationAutomaticConfirmed: true });
    expect(core.permissions.getSettings(first.id).orchestrationMode).toBeUndefined();
    expect(core.permissions.updateSettings(first.id, { orchestrationMode: 'automatic' })).toMatchObject({ orchestrationMode: 'automatic', orchestrationAutomaticConfirmed: true });
    const later = core.events.readAfter(mid).filter((event) => event.type === 'workspace.settings_changed');
    expect(later).toHaveLength(2);
    expect(later.some((event) => event.type === 'workspace.settings_changed' && event.payload.orchestrationAutomaticConfirmed === true)).toBe(false);

    // Another project asks for itself.
    expect(() => core.permissions.updateSettings(second.id, { orchestrationMode: 'automatic' })).toThrow(ConfirmationRequiredError);
  });

  it('asks again after the project\'s history is deleted (the record went with it), never the other way', () => {
    const core = openTestCore(tempDir(), undefined, { orchestrationAvailable: true });
    const project = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(project.id, { orchestrationMode: 'automatic', confirm: true });
    core.permissions.updateSettings(project.id, { orchestrationMode: 'approve_each' });
    core.events.deleteWorkspaceHistory(project.id);
    expect(core.permissions.getSettings(project.id).orchestrationAutomaticConfirmed).toBeUndefined();
    expect(() => core.permissions.updateSettings(project.id, { orchestrationMode: 'automatic' })).toThrow(ConfirmationRequiredError);
  });
});

describe('in the default mode a dispatch without the user\'s approval is refused in code', () => {
  it('refuses a step nobody approved and a step the mode approved, creating and sending nothing', async () => {
    const kit = setUp({ mode: 'approve_each', plan: THREE_INDEPENDENT });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    expect(run.mode).toBe('approve_each');
    await expect(kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    // As a bug or a damaged row would leave it: approved by the mode.
    kit.tamper("UPDATE orchestration_steps SET state = 'approved', approved_by = 'mode' WHERE run_id = ? AND step_id = 's1'", run.id);
    await expect(kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(kit.created).toEqual([]);
    expect(kit.sent).toEqual([]);
    // The step is the user's again.
    expect(stateOf(await kit.read(run.id), 's1')).toBe('proposed');
    await kit.settle();
    expect(kit.sent).toEqual([]);
  });
});

describe('an automatic run', () => {
  it('sends each step in turn when the one before has finished, approves for the mode (never the user), marks the instruction as automatic and finishes', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const before = kit.core.events.lastSeq();
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    expect(run).toMatchObject({ mode: 'automatic', state: 'running', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } });
    let view = await kit.read(run.id);
    expect(view.steps.map((step) => [step.stepId, step.state, step.approvedBy])).toEqual([['s1', 'dispatched', 'mode'], ['s2', 'proposed', null], ['s3', 'proposed', null]]);
    expect(kit.sent).toEqual([{ sessionId: kit.sessionOf(view, 's1'), text: 'Instruction 1 for codex.', origin: 'manager_auto' }]);

    for (const id of ['s1', 's2', 's3']) {
      view = await kit.read(run.id);
      kit.finish(kit.sessionOf(view, id), `Reply ${id}.`);
      await kit.settle();
    }
    view = await kit.read(run.id);
    expect(view.run.state).toBe('finished');
    expect(view.steps.map((step) => step.state)).toEqual(['done', 'done', 'done']);
    expect(kit.sent.map((entry) => [entry.text, entry.origin])).toEqual([
      ['Instruction 1 for codex.', 'manager_auto'],
      ['Instruction 2 for codex.', 'manager_auto'],
      ['Instruction 3 for codex.', 'manager_auto'],
    ]);
    // Every step was approved by the mode and sent once; nobody approved for the user.
    const log = orchestrationEvents(kit.core, before);
    expect(log.filter((event) => event.type === 'orchestration.step_approved').map((event) => (event.type === 'orchestration.step_approved' ? event.payload.by : ''))).toEqual(['mode', 'mode', 'mode']);
    expect(log.filter((event) => event.type === 'orchestration.step_dispatched')).toHaveLength(3);
    expect(log.filter((event) => event.type === 'orchestration.run_finished')).toHaveLength(1);
    // The worker's own mode is never touched.
    expect(typesAfter(kit.core, before)).not.toContain('session.permission_mode_changed');
  });

  it('stops at the instruction limit with its plain reason and event, sending nothing more', async () => {
    const kit = setUp({ plan: THREE_INDEPENDENT, limits: { maxInstructions: 2, maxDepth: 3, maxMinutes: 30 } });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    for (const id of ['s1', 's2']) {
      kit.finish(kit.sessionOf(await kit.read(run.id), id));
      await kit.settle();
    }
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'instruction_limit' });
    expect(stateOf(view, 's3')).toBe('proposed');
    expect(kit.sent).toHaveLength(2);
    expect(orchestrationEvents(kit.core, 0).filter((event) => event.type === 'orchestration.run_stopped').map((event) => (event.type === 'orchestration.run_stopped' ? event.payload.reason : ''))).toEqual(['instruction_limit']);
  });

  it('stops before a step deeper than the depth limit: depth is the longest chain of prerequisites', async () => {
    const kit = setUp({ plan: CHAIN4 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    for (const id of ['s1', 's2', 's3']) {
      kit.finish(kit.sessionOf(await kit.read(run.id), id));
      await kit.settle();
    }
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'depth_limit' });
    expect(view.steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'proposed']);
    expect(kit.sent).toHaveLength(3);
  });

  it('counts steps with no prerequisites as depth 1, so a wide plan is not stopped by the depth limit', async () => {
    const kit = setUp({ plan: THREE_INDEPENDENT, limits: { maxInstructions: 20, maxDepth: 1, maxMinutes: 30 } });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    for (const id of ['s1', 's2', 's3']) {
      kit.finish(kit.sessionOf(await kit.read(run.id), id));
      await kit.settle();
    }
    expect((await kit.read(run.id)).run.state).toBe('finished');
  });

  it('stops at the time limit on the fake clock before the next step, and asks a worker still going to stop', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    // 29 minutes in: the next step still goes.
    kit.clock.now = STARTED + 29 * 60_000;
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    expect(stateOf(await kit.read(run.id), 's2')).toBe('dispatched');
    // 31 minutes in, the worker still busy: it is asked to stop when the run next looks, and the run ends on its time limit.
    kit.clock.now = STARTED + 31 * 60_000;
    const busy = kit.sessionOf(await kit.read(run.id), 's2');
    kit.core.entities.setSessionState(busy, 'waiting');
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'time_limit' });
    expect(kit.cancelled).toEqual([busy]);
    expect(stateOf(view, 's2')).toBe('failed');
    expect(stateOf(view, 's3')).toBe('proposed');
    expect(kit.sent).toHaveLength(2);
  });

  it('stops at the time limit between steps without sending the next one', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.clock.now = STARTED + 30 * 60_000;
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    expect((await kit.read(run.id)).run).toMatchObject({ state: 'stopped', stopReason: 'time_limit' });
    expect(kit.sent).toHaveLength(1);
  });

  it('stops at the first refusal, recording it as an event with its plain words, and sends nothing more', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    // The worker signs out after the first step.
    kit.listed[0] = agentOf('codex', 'Codex', { ...API_KEY, unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } });
    const before = kit.core.events.lastSeq();
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'dispatch_refused' });
    expect(kit.sent).toHaveLength(1);
    const refusals = orchestrationEvents(kit.core, before).filter((event) => event.type === 'orchestration.dispatch_refused');
    expect(refusals).toEqual([expect.objectContaining({ payload: expect.objectContaining({ runId: run.id, stepId: 's2', worker: 'codex', reason: 'worker_signed_out' }) })]);
    expect(JSON.stringify(refusals)).not.toMatch(/ - |–|—/);
  });

  it('stops at the first worker error: the run fails and nothing more is sent', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'), 'It broke.', 'error');
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'failed', stopReason: 'worker_error' });
    expect(stateOf(view, 's2')).toBe('proposed');
    expect(kit.sent).toHaveLength(1);
  });

  it('waits for the user at a step whose agent signs in with the user\'s account, then goes on after the user approves and sends it', async () => {
    const kit = setUp({ plan: planOf(['codex'], ['claude-code', ['s1']], ['codex', ['s2']]) });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    let view = await kit.read(run.id);
    // Not sent by the mode: the step waits for the user, and the run says so.
    expect(view.run.state).toBe('awaiting_user');
    expect(stateOf(view, 's2')).toBe('proposed');
    expect(kit.created.map((entry) => entry.agentId)).toEqual(['codex']);
    expect(orchestrationEvents(kit.core, 0).filter((event) => event.type === 'orchestration.run_paused')).toHaveLength(1);
    // Another pass does not ask again or send.
    await kit.read(run.id);
    await kit.settle();
    expect(kit.sent).toHaveLength(1);

    // The user's own approval is what the vendor's terms allow.
    await kit.orchestration.approveStep(kit.workspace.id, run.id, 's2');
    view = await kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's2');
    expect(stateOf(view, 's2')).toBe('dispatched');
    expect(kit.sent[1]).toMatchObject({ text: 'Instruction 2 for claude-code.', origin: 'manager' });
    // And the run goes on by itself afterwards.
    kit.finish(kit.sessionOf(view, 's2'));
    await kit.settle();
    expect(stateOf(await kit.read(run.id), 's3')).toBe('dispatched');
  });

  it('goes back to needing approval when the mode is switched back mid-run: the next step waits for the user', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    const before = kit.core.events.lastSeq();
    kit.core.permissions.updateSettings(kit.workspace.id, { orchestrationMode: 'approve_each' });
    await kit.settle();
    expect((await kit.read(run.id)).run.mode).toBe('approve_each');
    expect(orchestrationEvents(kit.core, before).filter((event) => event.type === 'orchestration.mode_changed')).toEqual([expect.objectContaining({ payload: { runId: run.id, mode: 'approve_each', previous: 'automatic' } })]);
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    expect(stateOf(view, 's2')).toBe('proposed');
    expect(view.run.state).toBe('awaiting_user');
    expect(kit.sent).toHaveLength(1);
    await expect(kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotApprovedError);
    // The user approves, as in the default mode.
    await kit.orchestration.approveStep(kit.workspace.id, run.id, 's2');
    expect(stateOf(await kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's2'), 's2')).toBe('dispatched');
  });

  it('takes a step the mode approved but did not send back to the user when the mode is switched back', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.tamper("UPDATE orchestration_steps SET state = 'approved', approved_by = 'mode' WHERE run_id = ? AND step_id = 's2'", run.id);
    kit.core.permissions.updateSettings(kit.workspace.id, { orchestrationMode: 'approve_each' });
    const view = await kit.read(run.id);
    expect(view.steps.find((step) => step.stepId === 's2')).toMatchObject({ state: 'proposed', approvedBy: null });
  });

  it('starts dispatching a run that began under approve each when the project is switched to automatic', async () => {
    const kit = setUp({ plan: THREE_INDEPENDENT, mode: 'approve_each' });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    expect(kit.sent).toEqual([]);
    kit.core.permissions.updateSettings(kit.workspace.id, { orchestrationMode: 'automatic', confirm: true });
    await kit.settle();
    expect(kit.sent).toHaveLength(1);
    expect((await kit.read(run.id)).run.mode).toBe('automatic');
  });

  it('sends nothing on its own with the piece switched off, and Stop still ends the run and cancels the worker\'s turn', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    const working = kit.sessionOf(await kit.read(run.id), 's1');
    kit.core.permissions.updateSettings(kit.workspace.id, { orchestrationEnabled: false });
    // The worker stops for a card, but nothing goes on by itself with the piece off.
    kit.core.entities.setSessionState(working, 'waiting');
    await kit.settle();
    expect(kit.sent).toHaveLength(1);
    const stopped = await kit.orchestration.stopRun(kit.workspace.id, run.id);
    expect(stopped.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
    expect(kit.cancelled).toEqual([working]);
    // Other calls are still behind the guard, and an unknown project or run is not found.
    await expect(kit.orchestration.getRun(kit.workspace.id, run.id)).rejects.toThrow();
    await expect(kit.orchestration.stopRun('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId, run.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(kit.orchestration.stopRun(kit.workspace.id, 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('Stop ends an automatic run for good: nothing is sent after it, even when the worker finishes', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    const working = kit.sessionOf(await kit.read(run.id), 's1');
    await kit.orchestration.stopRun(kit.workspace.id, run.id);
    kit.finish(working);
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
    expect(kit.sent).toHaveLength(1);
  });
});

describe('the activity log', () => {
  it('lists every instruction that was sent or refused, newest first, from the events: when, which worker and chat, who approved, and how it stands', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    kit.finish(kit.sessionOf(await kit.read(run.id), 's2'));
    kit.listed[0] = agentOf('codex', 'Codex', { ...API_KEY, unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } });
    await kit.settle();
    const entries = await kit.orchestration.activity(kit.workspace.id);
    expect(entries.map((entry) => [entry.stepId, entry.kind, entry.result, entry.approvedBy, entry.workerLabel, entry.chat])).toEqual([
      ['s3', 'refused', 'refused', null, 'Codex', 'new'],
      ['s2', 'sent', 'finished', 'mode', 'Codex', 'new'],
      ['s1', 'sent', 'finished', 'mode', 'Codex', 'new'],
    ]);
    expect(entries[0]!.note).toMatch(/signed out/);
    expect(entries[1]).toMatchObject({ instruction: 'Instruction 2 for codex.', sessionId: kit.sessionOf(await kit.read(run.id), 's2') });
    expect(entries.every((entry) => entry.runId === run.id && !Number.isNaN(Date.parse(entry.at)))).toBe(true);
  });

  it('records a refusal in the default mode too, and shows an instruction the user approved as the user\'s', async () => {
    const kit = setUp({ plan: planOf(['codex'], ['codex']), mode: 'approve_each' });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspace.id, run.id, 's1');
    await kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's1');
    kit.listed[0] = agentOf('codex', 'Codex', { ...API_KEY, interactiveOnly: 'Only a person may drive it.' });
    await kit.orchestration.approveStep(kit.workspace.id, run.id, 's2');
    await expect(kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's2')).rejects.toThrow(/never given instructions/);
    const entries = await kit.orchestration.activity(kit.workspace.id);
    expect(entries.map((entry) => [entry.stepId, entry.kind, entry.approvedBy, entry.result])).toEqual([
      ['s2', 'refused', null, 'refused'],
      ['s1', 'sent', 'user', 'working'],
    ]);
  });

  it('is empty with nothing sent, is behind the guard, and shows a project only its own instructions', async () => {
    const kit = setUp({ plan: CHAIN3 });
    expect(await kit.orchestration.activity(kit.workspace.id)).toEqual([]);
    await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    const other = kit.core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    kit.core.permissions.updateSettings(other.id, { orchestrationEnabled: true });
    expect(await kit.orchestration.activity(other.id)).toEqual([]);
    expect(await kit.orchestration.activity(kit.workspace.id)).toHaveLength(1);
    kit.core.permissions.updateSettings(kit.workspace.id, { orchestrationEnabled: false });
    await expect(kit.orchestration.activity(kit.workspace.id)).rejects.toThrow();
  });
});

describe('the install\'s orchestration defaults', () => {
  it('keeps the default mode and the limits, within bounds, with one event, and never copies automatic into a project', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
    const store = createNewProjectDefaults({ dataDir, bmad: core.bmad });
    const defaults = core.createOrchestrationDefaults({ defaults: store });
    expect(defaults.get()).toEqual({ mode: 'approve_each', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } });

    const before = core.events.lastSeq();
    expect(() => defaults.set({ mode: 'automatic' })).toThrow(ConfirmationRequiredError);
    expect(() => defaults.set({ limits: { maxInstructions: 0 } })).toThrow(ValidationError);
    expect(() => defaults.set({ limits: { maxInstructions: 21 } })).toThrow(ValidationError);
    expect(() => defaults.set({ limits: { maxDepth: 9 } })).toThrow(ValidationError);
    expect(() => defaults.set({ limits: { maxMinutes: 500 } })).toThrow(ValidationError);
    expect(() => defaults.set({ limits: { maxMinutes: 1.5 } })).toThrow(ValidationError);
    expect(() => defaults.set({})).toThrow(ValidationError);
    expect(() => defaults.set({ mode: 'sometimes' })).toThrow(ValidationError);
    expect(core.events.lastSeq()).toBe(before);

    const saved = defaults.set({ mode: 'automatic', confirm: true, limits: { maxInstructions: 5, maxMinutes: 10 } });
    expect(saved).toEqual({ mode: 'automatic', limits: { maxInstructions: 5, maxDepth: 3, maxMinutes: 10 } });
    expect(core.events.readAfter(before)).toEqual([
      expect.objectContaining({
        type: 'settings.orchestration_defaults_changed',
        workspaceId: null,
        payload: { mode: 'automatic', previousMode: 'approve_each', limits: saved.limits, previousLimits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 }, automaticConfirmed: true },
      }),
    ]);
    // The same again changes nothing and appends nothing.
    const mid = core.events.lastSeq();
    expect(defaults.set({ limits: { maxInstructions: 5 } })).toEqual(saved);
    expect(core.events.lastSeq()).toBe(mid);
    // It survives a new store over the same folder, and saving the roster keeps it.
    store.setRoster({ manager: null, planner: null, worker: { kind: 'agent', agentId: 'codex' }, reviewer: null });
    expect(createNewProjectDefaults({ dataDir, bmad: core.bmad }).get()).toMatchObject({ orchestrationMode: 'automatic', orchestrationLimits: saved.limits });
    expect(core.createOrchestrationDefaults({ defaults: createNewProjectDefaults({ dataDir, bmad: core.bmad }) }).get()).toEqual(saved);

    // A project added now starts on Approve each instruction, not on the default, and asks for its own confirmation.
    const project = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.permissions.getSettings(project.id).orchestrationMode).toBeUndefined();
    expect(() => core.permissions.updateSettings(project.id, { orchestrationMode: 'automatic' })).toThrow(ConfirmationRequiredError);
  });

  it('reads a stored limit outside the bounds (a hand edited file) as the defaults', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
    writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ newProjects: { bmadPieces: [], orchestrationMode: 'automatic', orchestrationLimits: { maxInstructions: 9999, maxDepth: 3, maxMinutes: 30 } } }));
    const defaults = core.createOrchestrationDefaults({ defaults: createNewProjectDefaults({ dataDir, bmad: core.bmad }) });
    expect(defaults.get()).toEqual({ mode: 'automatic', limits: { maxInstructions: 20, maxDepth: 3, maxMinutes: 30 } });
  });
});

describe('review fixes (15.8)', () => {
  it('goes on by itself after the user skips the step the run was waiting at', async () => {
    const kit = setUp({ plan: planOf(['claude-code'], ['codex']) });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    expect((await kit.read(run.id)).run.state).toBe('awaiting_user');
    await kit.orchestration.skipStep(kit.workspace.id, run.id, 's1');
    await kit.settle();
    expect(stateOf(await kit.read(run.id), 's2')).toBe('dispatched');
  });

  it('never sends by the mode when the confirmation is not on record (history deleted), and waits at a chat that runs without asking', async () => {
    const kit = setUp({ plan: THREE_INDEPENDENT });
    kit.core.events.deleteWorkspaceHistory(kit.workspace.id);
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    expect(run.mode).toBe('approve_each');
    expect(kit.sent).toEqual([]);

    const auto = setUp({ plan: THREE_INDEPENDENT });
    auto.core.permissions.updateSettings(auto.workspace.id, { defaultPermissionMode: 'auto' });
    const started = await auto.orchestration.startRun(auto.workspace.id, { goal: 'Do the work' });
    await auto.settle();
    expect(auto.sent).toEqual([]);
    expect((await auto.read(started.run.id)).run.state).toBe('awaiting_user');
  });
});
