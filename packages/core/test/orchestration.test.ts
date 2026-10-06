/**
 * The Orchestration use-case, tracer bullet (epic 15, story 15.3), over a real
 * core (database, event log, guard) with a stub chat and a stub manager: a goal
 * becomes proposed steps, only the user approves, dispatch is refused in code for
 * a step that was not approved, an approved instruction is sent once into a new
 * worker chat marked as the manager's, and the worker's state and a masked, capped
 * report read back with one `result_read`. Nothing here runs an agent or a model.
 */
import { MANAGER_LIMITS, MANAGER_PLAN_VERSION, type ManagerPlan, type OrchestrationRunView, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  ManagerFailedError,
  ManagerUnavailableError,
  NotFoundError,
  OrchestrationOffError,
  StepNotApprovedError,
  StepNotProposedError,
  ValidationError,
  validatePlanFor,
  type Core,
  type ManagerPort,
  type OrchestrationChat,
} from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const PLAN: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form',
  steps: [
    { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Now make it pass.', mode: 'ask', depends_on: ['s1'] },
  ],
};

/** A manager that answers a scripted plan through the same check a real one passes. */
function stubManager(reply: unknown = PLAN): ManagerPort & { goals: string[] } {
  const goals: string[] = [];
  return {
    goals,
    async proposePlan(context) {
      goals.push(context.goal);
      return validatePlanFor(context, reply);
    },
    async decideNext() {
      return { ok: false, kind: 'unavailable', reason: 'not used here' };
    },
  };
}

function setUp(manager: ManagerPort | null | 'default' = 'default', { on = true }: { on?: boolean } = {}) {
  const core: Core = openTestCore(tempDir(), undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (on) core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  const created: Array<{ agentId: string | undefined; permissionMode: string | undefined }> = [];
  const sent: Array<{ sessionId: SessionId; text: string; origin: string | undefined }> = [];
  const chat: OrchestrationChat = {
    async chatAgents() {
      return {
        defaultAgentId: 'claude-code',
        agents: [
          { agentId: 'claude-code', displayName: 'Claude Code', provider: 'Fake', signInMethods: [], install: { state: 'installed' }, auth: { state: 'signed_in' }, terminalResume: false, needsProjectTrust: false, permissionModes: ['ask'] },
          { agentId: 'broken', displayName: 'Broken Agent', provider: 'Fake', signInMethods: [], install: { state: 'installed' }, auth: { state: 'signed_in' }, terminalResume: false, needsProjectTrust: false, permissionModes: ['ask'], unavailable: { code: 'agent_not_installed', message: 'Not installed.', action: 'install' } },
        ],
      } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
    async createChatSession(workspaceId, options) {
      // The worker's own default: the use-case passes no mode, so the session starts in Ask.
      const session = core.entities.createSession({ workspaceId, kind: 'chat', ...(options?.agentId === undefined ? {} : { agentId: options.agentId }) });
      created.push({ agentId: options?.agentId, permissionMode: session.permissionMode });
      return session;
    },
    sendMessage(workspaceId, sessionId, text, options) {
      sent.push({ sessionId, text, origin: options?.origin });
      core.sessionEvents.completeMessage(sessionId, { messageId: `msg_${sent.length}`.padEnd(30, '0') as never, role: 'user', content: text, ...(options?.origin === undefined ? {} : { origin: options.origin }) });
      core.entities.setSessionState(sessionId, 'working');
      return { messageId: 'msg', queued: false };
    },
    getSession: (workspaceId, sessionId) => core.entities.getSession(sessionId)!,
  };
  const orchestration = core.createOrchestration({ chat, manager: manager === 'default' ? stubManager() : (manager ?? undefined) });
  /** The worker finishes: its reply is stored and the chat goes idle. */
  const finish = (sessionId: SessionId, reply: string, state: 'idle' | 'error' = 'idle') => {
    core.sessionEvents.completeMessage(sessionId, { messageId: `msg_reply_${Math.random().toString(36).slice(2)}`.padEnd(30, '0') as never, role: 'agent', content: reply });
    core.entities.setSessionState(sessionId, state);
  };
  return { core, workspace, orchestration, created, sent, finish };
}

const eventTypes = (core: Core, after: number) => core.events.readAfter(after).map((event) => event.type);
const stepOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!;

describe('start a run', () => {
  it('turns a goal into proposed steps, with the events of the run', async () => {
    const { core, workspace, orchestration } = setUp();
    const before = core.events.lastSeq();
    const view = await orchestration.startRun(workspace.id, { goal: 'Add a contact form' });
    expect(view.run).toMatchObject({ workspaceId: workspace.id, goal: 'Add a contact form', state: 'awaiting_user', mode: 'approve_each', stopReason: null });
    expect(view.steps.map((step) => [step.stepId, step.state, step.approvedBy, step.sessionId, step.workerLabel])).toEqual([
      ['s1', 'proposed', null, null, 'Claude Code'],
      ['s2', 'proposed', null, null, 'Claude Code'],
    ]);
    expect(eventTypes(core, before)).toEqual(['orchestration.run_started', 'orchestration.plan_proposed', 'orchestration.step_proposed', 'orchestration.step_proposed']);
    expect(orchestration.managerReady()).toBe(true);
  });

  it('folds the goal to one line, masks a secret in it before the manager or the store sees it, and refuses a goal that is empty or too long', async () => {
    const manager = stubManager();
    const { workspace, orchestration } = setUp(manager);
    const view = await orchestration.startRun(workspace.id, { goal: '  Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\n and add a form ' });
    expect(view.run.goal).not.toContain('sk-ant');
    expect(view.run.goal).not.toContain('\n');
    expect(manager.goals[0]).toBe(view.run.goal);
    await expect(orchestration.startRun(workspace.id, { goal: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(orchestration.startRun(workspace.id, { goal: 'x'.repeat(MANAGER_LIMITS.maxGoalChars + 1) })).rejects.toBeInstanceOf(ValidationError);
    await expect(orchestration.startRun(workspace.id, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it('answers plain "no manager yet" with nothing stored when there is no manager', async () => {
    const { core, workspace, orchestration } = setUp(null);
    const before = core.events.lastSeq();
    expect(orchestration.managerReady()).toBe(false);
    await expect(orchestration.startRun(workspace.id, { goal: 'Add a form' })).rejects.toBeInstanceOf(ManagerUnavailableError);
    expect(core.events.lastSeq()).toBe(before);
    expect(await orchestration.listRuns(workspace.id)).toEqual([]);
  });

  it('keeps a failed run, with no step, and the manager\'s plain reason, when the manager gives no usable plan', async () => {
    const offRoster = { ...PLAN, steps: [{ ...PLAN.steps[0]!, worker: 'broken' }] };
    const { core, workspace, orchestration } = setUp(stubManager(offRoster));
    const before = core.events.lastSeq();
    await expect(orchestration.startRun(workspace.id, { goal: 'Add a form' })).rejects.toBeInstanceOf(ManagerFailedError);
    const [run] = await orchestration.listRuns(workspace.id);
    expect(run!.run).toMatchObject({ state: 'failed', stopReason: 'manager_refused' });
    expect(run!.steps).toEqual([]);
    expect(eventTypes(core, before)).toEqual(['orchestration.run_started', 'orchestration.run_stopped']);
  });

  it('is behind the guard: with the piece off nothing runs and nothing is stored', async () => {
    const { core, workspace, orchestration } = setUp('default', { on: false });
    const before = core.events.lastSeq();
    await expect(orchestration.startRun(workspace.id, { goal: 'Add a form' })).rejects.toBeInstanceOf(OrchestrationOffError);
    await expect(orchestration.listRuns(workspace.id)).rejects.toBeInstanceOf(OrchestrationOffError);
    await expect(orchestration.getRun(workspace.id, 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3')).rejects.toBeInstanceOf(OrchestrationOffError);
    expect(core.events.lastSeq()).toBe(before);
    await expect(orchestration.startRun('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId, { goal: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('approve and dispatch', () => {
  it('refuses to dispatch a step the user has not approved, creating and sending nothing', async () => {
    const { core, workspace, orchestration, created, sent } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(created).toEqual([]);
    expect(sent).toEqual([]);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('approves for the user only, in order: a step that needs another waits, and a step cannot be approved twice', async () => {
    const { core, workspace, orchestration } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await expect(orchestration.approveStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotProposedError);
    const before = core.events.lastSeq();
    const approved = await orchestration.approveStep(workspace.id, run.id, 's1');
    expect(stepOf(approved, 's1')).toMatchObject({ state: 'approved', approvedBy: 'user' });
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'orchestration.step_approved', payload: { runId: run.id, stepId: 's1', by: 'user' } })]);
    await expect(orchestration.approveStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotProposedError);
    await expect(orchestration.approveStep(workspace.id, run.id, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sends an approved instruction once, into a new chat of the worker in its own default mode, marked as the manager\'s', async () => {
    const { core, workspace, orchestration, created, sent } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const before = core.events.lastSeq();
    const dispatched = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    expect(created).toEqual([{ agentId: 'claude-code', permissionMode: 'ask' }]);
    expect(sent).toEqual([{ sessionId: stepOf(dispatched, 's1').sessionId, text: 'Write the failing test first.', origin: 'manager' }]);
    expect(stepOf(dispatched, 's1')).toMatchObject({ state: 'dispatched', sessionState: 'working' });
    expect(dispatched.run.state).toBe('running');
    // A second dispatch of the same step is refused: it was sent.
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(created).toHaveLength(1);
    expect(eventTypes(core, before).filter((type) => type.startsWith('orchestration.'))).toEqual(['orchestration.step_dispatched']);
  });

  it('does not let two sends of one step race into two chats', async () => {
    const { workspace, orchestration, created } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const results = await Promise.allSettled([orchestration.dispatchStep(workspace.id, run.id, 's1'), orchestration.dispatchStep(workspace.id, run.id, 's1')]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(created).toHaveLength(1);
  });

  it('keeps another project\'s run out of reach', async () => {
    const { core, workspace, orchestration } = setUp();
    const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(other.id, { orchestrationEnabled: true });
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await expect(orchestration.getRun(other.id, run.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(orchestration.approveStep(other.id, run.id, 's1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(orchestration.dispatchStep(other.id, run.id, 's1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('delete history', () => {
  it('takes the project\'s orchestration runs and steps with it, and no other project\'s', async () => {
    const { core, workspace, orchestration } = setUp();
    const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(other.id, { orchestrationEnabled: true });
    await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.startRun(other.id, { goal: 'Add a page' });
    core.events.deleteWorkspaceHistory(workspace.id);
    expect(await orchestration.listRuns(workspace.id)).toEqual([]);
    expect((await orchestration.listRuns(other.id)).map((view) => view.run.goal)).toEqual(['Add a page']);
  });
});

describe('read back', () => {
  it('reads the worker\'s state while it works, then settles the step once with one result_read, masked and capped', async () => {
    const { core, workspace, orchestration, finish } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const sent = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    const sessionId = stepOf(sent, 's1').sessionId!;

    // While it works: the state, a report with nothing yet, no settling.
    const working = await orchestration.getRun(workspace.id, run.id);
    expect(stepOf(working, 's1')).toMatchObject({ state: 'dispatched', sessionState: 'working', report: { state: 'working', summary: '' } });

    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    finish(sessionId, `Done. The key is ${secret}. ${'x'.repeat(MANAGER_LIMITS.maxSummaryChars + 500)}`);
    const before = core.events.lastSeq();
    const done = await orchestration.getRun(workspace.id, run.id);
    const step = stepOf(done, 's1');
    expect(step).toMatchObject({ state: 'done', sessionState: 'idle' });
    expect(step.report?.truncated).toBe(true);
    expect(step.report?.summary.length).toBeLessThanOrEqual(MANAGER_LIMITS.maxSummaryChars);
    expect(step.report?.summary).not.toContain(secret);
    expect(step.report?.summary.startsWith('Done. The key is ')).toBe(true);
    expect(done.run.state).toBe('awaiting_user');
    expect(eventTypes(core, before)).toEqual(['orchestration.result_read']);
    // The event holds the same masked report, never the key.
    expect(JSON.stringify(core.events.readAfter(before))).not.toContain(secret);

    // Reading again changes nothing and appends nothing.
    const again = core.events.lastSeq();
    await orchestration.getRun(workspace.id, run.id);
    expect(core.events.lastSeq()).toBe(again);

    // The next step may now be approved.
    expect(stepOf(await orchestration.approveStep(workspace.id, run.id, 's2'), 's2').state).toBe('approved');
  });

  it('marks a step failed when its worker chat ends in an error', async () => {
    const { workspace, orchestration, finish } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const sent = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    finish(stepOf(sent, 's1').sessionId!, 'It broke.', 'error');
    const after = await orchestration.getRun(workspace.id, run.id);
    expect(stepOf(after, 's1')).toMatchObject({ state: 'failed', sessionState: 'error' });
    await expect(orchestration.approveStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotProposedError);
    // A failed step ends the run, plainly, rather than leaving it working.
    expect(after.run).toMatchObject({ state: 'failed', stopReason: 'worker_error' });
  });

  it('finishes the run when every step is done', async () => {
    const { workspace, orchestration, finish } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    for (const id of ['s1', 's2']) {
      await orchestration.approveStep(workspace.id, run.id, id);
      const sent = await orchestration.dispatchStep(workspace.id, run.id, id);
      finish(stepOf(sent, id).sessionId!, `done ${id}`);
      await orchestration.getRun(workspace.id, run.id);
    }
    expect((await orchestration.getRun(workspace.id, run.id)).run.state).toBe('finished');
  });

  it('refuses to send an approved step once its run is over', async () => {
    const { workspace, orchestration, finish, created } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const sent = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    finish(stepOf(sent, 's1').sessionId!, 'x', 'error');
    await orchestration.getRun(workspace.id, run.id);
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(created).toHaveLength(1);
  });
});
