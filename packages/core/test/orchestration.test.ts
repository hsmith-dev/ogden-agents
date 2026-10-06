/**
 * The Orchestration use-case, tracer bullet (epic 15, story 15.3), over a real
 * core (database, event log, guard) with a stub chat and a stub manager: a goal
 * becomes proposed steps, only the user approves, dispatch is refused in code for
 * a step that was not approved, an approved instruction is sent once into a new
 * worker chat marked as the manager's, and the worker's state and a masked, capped
 * report read back with one `result_read`. Nothing here runs an agent or a model.
 */
import { MANAGER_LIMITS, MANAGER_PLAN_VERSION, type ManagerPlan, type OrchestrationRunView, type SessionId, type WorkspaceId } from '@ogden-agents/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentNotReadyError,
  DispatchRefusedError,
  DriverIsTerminalError,
  SessionNotIdleError,
  ManagerFailedError,
  BadOrderError,
  ManagerUnavailableError,
  NotFoundError,
  RunNotOpenError,
  StepNotChangeableError,
  OrchestrationOffError,
  StepNotApprovedError,
  StepNotProposedError,
  ValidationError,
  validatePlanFor,
  type Core,
  type ManagerContext,
  type ManagerPort,
  type OrchestrationChat,
} from '../src/index.js';
import { openDatabase } from '../src/db/database.js';
import { openTestCore, tempDir } from './helpers.js';

const PLAN: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form',
  steps: [
    { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Now make it pass.', mode: 'ask', depends_on: ['s1'] },
  ],
};

/** Three steps: s1 and s2 need nothing, s3 needs s2. */
const PLAN3: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Add a contact form',
  steps: [
    { id: 's1', worker: 'claude-code', chat: 'new', instruction: 'Write the failing test first.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'claude-code', chat: 'new', instruction: 'Add the form fields.', mode: 'ask', depends_on: [] },
    { id: 's3', worker: 'claude-code', chat: 'new', instruction: 'Wire the form to the page.', mode: 'ask', depends_on: ['s2'] },
  ],
};

/** A manager that answers a scripted plan through the same check a real one passes. */
function stubManager(reply: unknown | (() => unknown) = PLAN): ManagerPort & { goals: string[]; contexts: ManagerContext[] } {
  const goals: string[] = [];
  const contexts: ManagerContext[] = [];
  return {
    goals,
    contexts,
    async proposePlan(context) {
      goals.push(context.goal);
      contexts.push(context);
      return validatePlanFor(context, typeof reply === 'function' ? (reply as () => unknown)() : reply);
    },
    async decideNext() {
      return { ok: false, kind: 'unavailable', reason: 'not used here' };
    },
  };
}

/** A ready agent as the install's agent list reports it; `fields` change any of it. */
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

interface SetUpOptions {
  on?: boolean;
  /** The agents the install lists (default: Claude Code and a broken one). */
  agents?: ReadonlyArray<ReturnType<typeof agentOf>>;
  /** The project's team, as the roster reports its workers. Absent: every agent. */
  workers?: ReadonlyArray<{ agentId: string; ready: boolean }>;
}

function setUp(manager: ManagerPort | null | 'default' = 'default', { on = true, agents, workers }: SetUpOptions = {}) {
  const dataDir = tempDir();
  const core: Core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (on) core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  const created: Array<{ agentId: string | undefined; permissionMode: string | undefined }> = [];
  const sent: Array<{ sessionId: SessionId; text: string; origin: string | undefined }> = [];
  const cancelled: SessionId[] = [];
  const renamed: Array<{ sessionId: SessionId; title: string | null }> = [];
  const removed: string[] = [];
  /** What the next send does instead of sending (a refusal or a failure the chat would throw), and whether it queues. */
  const sendBehaviour: { throws?: Error; queued?: boolean } = {};
  const listed = agents ?? [agentOf('claude-code', 'Claude Code'), agentOf('broken', 'Broken Agent', { unavailable: { code: 'agent_not_installed', message: 'Not installed.', action: 'install' } })];
  const chat: OrchestrationChat = {
    async chatAgents() {
      return { defaultAgentId: 'claude-code', agents: listed } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
    async createChatSession(workspaceId, options) {
      // The worker's own default: the use-case passes no mode, so the session starts in Ask.
      const session = core.entities.createSession({ workspaceId, kind: 'chat', ...(options?.agentId === undefined ? {} : { agentId: options.agentId }) });
      created.push({ agentId: options?.agentId, permissionMode: session.permissionMode });
      return session;
    },
    sendMessage(workspaceId, sessionId, text, options) {
      if (sendBehaviour.throws !== undefined) throw sendBehaviour.throws;
      sent.push({ sessionId, text, origin: options?.origin });
      if (sendBehaviour.queued === true) return { messageId: 'queued_msg', queued: true };
      core.sessionEvents.completeMessage(sessionId, { messageId: `msg_${sent.length}`.padEnd(30, '0') as never, role: 'user', content: text, ...(options?.origin === undefined ? {} : { origin: options.origin }) });
      core.entities.setSessionState(sessionId, 'working');
      return { messageId: 'msg', queued: false };
    },
    getSession(workspaceId, sessionId) {
      // As the chat does: a session of another project is not found.
      const session = core.entities.getSession(sessionId);
      if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
      return session;
    },
    listSessions: (workspaceId) => core.entities.listSessions(workspaceId),
    renameSession(workspaceId, sessionId, title) {
      renamed.push({ sessionId, title });
      return core.entities.getSession(sessionId)!;
    },
    removeQueuedMessage(workspaceId, sessionId, messageId) {
      removed.push(messageId);
    },
    cancel(workspaceId, sessionId) {
      cancelled.push(sessionId);
      core.entities.setSessionState(sessionId, 'idle');
    },
  };
  const team = workers === undefined ? undefined : { workers: async () => workers.map((worker) => ({ ...worker, label: worker.agentId, role: 'worker' as const })) };
  const orchestration = core.createOrchestration({ chat, manager: manager === 'default' ? stubManager() : (manager ?? undefined), ...(team === undefined ? {} : { team: team as never }) });
  /** The worker finishes: its reply is stored and the chat goes idle. */
  const finish = (sessionId: SessionId, reply: string, state: 'idle' | 'error' = 'idle') => {
    core.sessionEvents.completeMessage(sessionId, { messageId: `msg_reply_${Math.random().toString(36).slice(2)}`.padEnd(30, '0') as never, role: 'agent', content: reply });
    core.entities.setSessionState(sessionId, state);
  };
  /** Writes to the database directly, as a bug or a damaged row would. */
  const tamper = (sql: string, ...params: string[]) => {
    const db = openDatabase(dataDir);
    try {
      db.sqlite.prepare(sql).run(...params);
    } finally {
      db.close();
    }
  };
  return { core, workspace, orchestration, created, sent, cancelled, renamed, removed, sendBehaviour, finish, tamper };
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
    expect(orchestration.managerStatus(workspace.id).state).toBe('ready');
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
    expect(orchestration.managerStatus(workspace.id)).toMatchObject({ state: 'not_chosen' });
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

describe('plan review (15.6): edit', () => {
  it('replaces the text of a waiting step, still waiting, with step_edited', async () => {
    const { core, workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    const edited = await orchestration.editStep(workspace.id, run.id, 's1', { instruction: '  Write a failing test\r\nfor the form.  ' });
    expect(stepOf(edited, 's1')).toMatchObject({ state: 'proposed', approvedBy: null, instruction: 'Write a failing test\nfor the form.' });
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'orchestration.step_edited', payload: { runId: run.id, stepId: 's1', instruction: 'Write a failing test\nfor the form.' } })]);
    // The same text is no change and no event.
    const again = core.events.lastSeq();
    await orchestration.editStep(workspace.id, run.id, 's1', { instruction: 'Write a failing test\nfor the form.' });
    expect(core.events.lastSeq()).toBe(again);
  });

  it('puts an approved step back to waiting, so the old approval cannot send the new text', async () => {
    const { workspace, orchestration, created, sent } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const edited = await orchestration.editStep(workspace.id, run.id, 's1', { instruction: 'Something else entirely.' });
    expect(stepOf(edited, 's1')).toMatchObject({ state: 'proposed', approvedBy: null });
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(created).toEqual([]);
    // A fresh approval sends the edited text.
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const sentView = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    expect(sent.map((one) => one.text)).toEqual(['Something else entirely.']);
    expect(stepOf(sentView, 's1').state).toBe('dispatched');
  });

  it('holds the user\'s text to the manager\'s text rules, and refuses a secret', async () => {
    const { core, workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    for (const instruction of ['', '   ', 'x'.repeat(MANAGER_LIMITS.maxInstructionChars + 1), 'bad\u0000text', 'hidden\u202Etext', 42]) {
      await expect(orchestration.editStep(workspace.id, run.id, 's1', { instruction })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(orchestration.editStep(workspace.id, run.id, 's1', { instruction: 'Use the key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 to log in.' })).rejects.toMatchObject({ message: expect.stringContaining('key or a secret') });
    await expect(orchestration.editStep(workspace.id, run.id, 's1', null)).rejects.toBeInstanceOf(ValidationError);
    expect(core.events.lastSeq()).toBe(before);
    expect(stepOf(await orchestration.getRun(workspace.id, run.id), 's1').instruction).toBe('Write the failing test first.');
  });

  it('refuses a step that was sent, skipped, or in a run that ended, and an unknown step', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    await orchestration.dispatchStep(workspace.id, run.id, 's1');
    await expect(orchestration.editStep(workspace.id, run.id, 's1', { instruction: 'Late change.' })).rejects.toBeInstanceOf(StepNotChangeableError);
    await orchestration.skipStep(workspace.id, run.id, 's2');
    await expect(orchestration.editStep(workspace.id, run.id, 's2', { instruction: 'Late change.' })).rejects.toBeInstanceOf(StepNotChangeableError);
    await expect(orchestration.editStep(workspace.id, run.id, 'nope', { instruction: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await orchestration.stopRun(workspace.id, run.id);
    await expect(orchestration.editStep(workspace.id, run.id, 's3', { instruction: 'Late change.' })).rejects.toBeInstanceOf(StepNotChangeableError);
  });

  it('is behind the guard', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3), { on: false });
    await expect(orchestration.editStep(workspace.id, 'orc_x', 's1', { instruction: 'x' })).rejects.toBeInstanceOf(OrchestrationOffError);
    await expect(orchestration.skipStep(workspace.id, 'orc_x', 's1')).rejects.toBeInstanceOf(OrchestrationOffError);
    await expect(orchestration.reorderSteps(workspace.id, 'orc_x', { order: ['s1'] })).rejects.toBeInstanceOf(OrchestrationOffError);
    await expect(orchestration.stopRun(workspace.id, 'orc_x')).rejects.toBeInstanceOf(OrchestrationOffError);
  });
});

describe('plan review (15.6): skip', () => {
  it('never sends a skipped step, and the steps that need it wait', async () => {
    const { core, workspace, orchestration, created } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    const skipped = await orchestration.skipStep(workspace.id, run.id, 's2');
    expect(stepOf(skipped, 's2').state).toBe('skipped');
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'orchestration.step_skipped', payload: { runId: run.id, stepId: 's2' } })]);
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotApprovedError);
    await expect(orchestration.approveStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotProposedError);
    // s3 needs s2: it cannot be approved or sent while s2 is skipped, and the run is still open.
    await expect(orchestration.approveStep(workspace.id, run.id, 's3')).rejects.toBeInstanceOf(StepNotProposedError);
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's3')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(skipped.run.state).toBe('awaiting_user');
    expect(created).toEqual([]);
  });

  it('skips an approved step too, and refuses one already sent or skipped', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    expect(stepOf(await orchestration.skipStep(workspace.id, run.id, 's1'), 's1').state).toBe('skipped');
    await expect(orchestration.skipStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotChangeableError);
    await orchestration.approveStep(workspace.id, run.id, 's2');
    await orchestration.dispatchStep(workspace.id, run.id, 's2');
    await expect(orchestration.skipStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotChangeableError);
  });

  it('finishes the run when nothing is left to do', async () => {
    const { core, workspace, orchestration } = setUp();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    await orchestration.skipStep(workspace.id, run.id, 's1');
    const last = await orchestration.skipStep(workspace.id, run.id, 's2');
    expect(last.run.state).toBe('finished');
    expect(eventTypes(core, before)).toEqual(['orchestration.step_skipped', 'orchestration.step_skipped', 'orchestration.run_finished']);
  });
});

describe('plan review (15.6): reorder', () => {
  const order = (view: OrchestrationRunView) => view.steps.map((step) => step.stepId);

  it('puts the steps in a new order that keeps each step after its prerequisites', async () => {
    const { core, workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    const moved = await orchestration.reorderSteps(workspace.id, run.id, { order: ['s2', 's1', 's3'] });
    expect(order(moved)).toEqual(['s2', 's1', 's3']);
    expect(order(await orchestration.getRun(workspace.id, run.id))).toEqual(['s2', 's1', 's3']);
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'orchestration.steps_reordered', payload: { runId: run.id, order: ['s2', 's1', 's3'] } })]);
    // The same order is no change and no event.
    const again = core.events.lastSeq();
    await orchestration.reorderSteps(workspace.id, run.id, { order: ['s2', 's1', 's3'] });
    expect(core.events.lastSeq()).toBe(again);
  });

  it('refuses an order that breaks a prerequisite, naming the steps, and changes nothing', async () => {
    const { core, workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    const before = core.events.lastSeq();
    await expect(orchestration.reorderSteps(workspace.id, run.id, { order: ['s3', 's1', 's2'] })).rejects.toMatchObject({ message: 'Step s3 needs step s2 first, so it cannot come before it.' });
    await expect(orchestration.reorderSteps(workspace.id, run.id, { order: ['s3', 's1', 's2'] })).rejects.toBeInstanceOf(BadOrderError);
    expect(order(await orchestration.getRun(workspace.id, run.id))).toEqual(['s1', 's2', 's3']);
    expect(core.events.lastSeq()).toBe(before);
  });

  it('refuses a list that is not every step once, or not a list of step ids', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    for (const bad of [['s1', 's2'], ['s1', 's2', 's3', 's3'], ['s1', 's1', 's2'], ['s1', 's2', 'nope'], [], 'x', null]) {
      await expect(orchestration.reorderSteps(workspace.id, run.id, { order: bad })).rejects.toBeInstanceOf(BadOrderError);
    }
    await expect(orchestration.reorderSteps(workspace.id, run.id, null)).rejects.toBeInstanceOf(BadOrderError);
  });

  it('keeps a sent step where it is, and refuses an ended run', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    await orchestration.dispatchStep(workspace.id, run.id, 's1');
    await expect(orchestration.reorderSteps(workspace.id, run.id, { order: ['s2', 's1', 's3'] })).rejects.toMatchObject({ message: 'A step that was already sent cannot move.' });
    // The steps that were not sent can still trade places among themselves.
    expect(order(await orchestration.reorderSteps(workspace.id, run.id, { order: ['s1', 's2', 's3'] }))).toEqual(['s1', 's2', 's3']);
    await orchestration.stopRun(workspace.id, run.id);
    await expect(orchestration.reorderSteps(workspace.id, run.id, { order: ['s1', 's2', 's3'] })).rejects.toBeInstanceOf(RunNotOpenError);
  });
});

describe('plan review (15.6): stop', () => {
  it('ends the run as stopped by the user, and nothing more is approved, edited, skipped, reordered or sent', async () => {
    const { core, workspace, orchestration, created } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const before = core.events.lastSeq();
    const stopped = await orchestration.stopRun(workspace.id, run.id);
    expect(stopped.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
    expect(core.events.readAfter(before)).toEqual([expect.objectContaining({ type: 'orchestration.run_stopped', payload: { runId: run.id, reason: 'user' } })]);
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    await expect(orchestration.approveStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotProposedError);
    await expect(orchestration.skipStep(workspace.id, run.id, 's2')).rejects.toBeInstanceOf(StepNotChangeableError);
    await expect(orchestration.stopRun(workspace.id, run.id)).rejects.toBeInstanceOf(RunNotOpenError);
    expect(created).toEqual([]);
  });

  it('cancels a worker turn in flight, fails that step, and the step settling later does not move the stopped run', async () => {
    const { core, workspace, orchestration, cancelled, finish } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const sent = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    const sessionId = stepOf(sent, 's1').sessionId!;
    const stopped = await orchestration.stopRun(workspace.id, run.id);
    expect(cancelled).toEqual([sessionId]);
    expect(stepOf(stopped, 's1').state).toBe('failed');
    expect(stopped.run.state).toBe('stopped');
    const before = core.events.lastSeq();
    finish(sessionId, 'late reply');
    const later = await orchestration.getRun(workspace.id, run.id);
    expect(later.run).toMatchObject({ state: 'stopped', stopReason: 'user' });
    expect(eventTypes(core, before).filter((type) => type.startsWith('orchestration.'))).toEqual([]);
  });

  it('does not cancel a worker that already finished, and settles its step as done', async () => {
    const { workspace, orchestration, cancelled, finish } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const sent = await orchestration.dispatchStep(workspace.id, run.id, 's1');
    finish(stepOf(sent, 's1').sessionId!, 'done already');
    const stopped = await orchestration.stopRun(workspace.id, run.id);
    expect(cancelled).toEqual([]);
    expect(stepOf(stopped, 's1').state).toBe('done');
    expect(stopped.run.state).toBe('stopped');
  });

  it('abandons a manager call in flight: the stopped run keeps no step', async () => {
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const slow: ManagerPort = {
      async proposePlan(context, abort) {
        signal = abort;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return validatePlanFor(context, PLAN3);
      },
      async decideNext() {
        return { ok: false, kind: 'unavailable', reason: 'not used here' };
      },
    };
    const { core, workspace, orchestration } = setUp(slow);
    const starting = orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const listed = await orchestration.listRuns(workspace.id);
    expect(listed[0]!.run.state).toBe('planning');
    const stopped = await orchestration.stopRun(workspace.id, listed[0]!.run.id);
    expect(stopped.run.state).toBe('stopped');
    expect(signal?.aborted).toBe(true);
    release();
    const final = await starting;
    expect(final.run.state).toBe('stopped');
    expect(final.steps).toEqual([]);
    expect(eventTypes(core, 0)).not.toContain('orchestration.plan_proposed');
  });
});

describe('plan review (15.6): approval is the user\'s, in code', () => {
  it('refuses a send in the default mode when the approver is not the user, even for an approved step', async () => {
    const { workspace, orchestration, created, tamper } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    // A damaged row, as a bug or a direct write would leave: approved by the mode in a run that asks for each approval.
    tamper("UPDATE orchestration_steps SET approved_by = 'mode' WHERE run_id = ? AND step_id = 's1'", run.id);
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(created).toEqual([]);
  });

  it('refuses a send when a step it needs is not done, even if its row says approved', async () => {
    const { workspace, orchestration, created, tamper } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    tamper("UPDATE orchestration_steps SET state = 'approved', approved_by = 'user' WHERE run_id = ? AND step_id = 's3'", run.id);
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's3')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(created).toEqual([]);
  });
});

describe('plan review (15.6): review fixes', () => {
  it('approves only the text the user saw when the page says which', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.editStep(workspace.id, run.id, 's1', { instruction: 'Edited elsewhere.' });
    await expect(orchestration.approveStep(workspace.id, run.id, 's1', 'Write the failing test first.')).rejects.toBeInstanceOf(StepNotProposedError);
    expect(stepOf(await orchestration.approveStep(workspace.id, run.id, 's1', 'Edited elsewhere.'), 's1').state).toBe('approved');
  });

  it('does not log a finish for a paused run that skipping cannot finish', async () => {
    const { core, workspace, orchestration, tamper } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.skipStep(workspace.id, run.id, 's1');
    await orchestration.skipStep(workspace.id, run.id, 's2');
    tamper("UPDATE orchestration_runs SET state = 'paused' WHERE id = ?", run.id);
    const view = await orchestration.skipStep(workspace.id, run.id, 's3');
    expect(view.run.state).toBe('paused');
    expect(eventTypes(core, 0)).not.toContain('orchestration.run_finished');
  });

  it('sends nothing when the step is edited while its chat is being made', async () => {
    const { core, workspace, orchestration, sent } = setUp(stubManager(PLAN3));
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Add a form' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const original = core.entities.createSession.bind(core.entities);
    let edited: Promise<unknown> | undefined;
    core.entities.createSession = ((input: Parameters<typeof original>[0]) => {
      edited = orchestration.editStep(workspace.id, run.id, 's1', { instruction: 'Changed mid send.' });
      return original(input);
    }) as typeof core.entities.createSession;
    await expect(orchestration.dispatchStep(workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    await edited;
    expect(sent).toEqual([]);
    expect(stepOf(await orchestration.getRun(workspace.id, run.id), 's1')).toMatchObject({ state: 'proposed', instruction: 'Changed mid send.' });
  });

  it('answers an unknown run with not found before it looks at the request', async () => {
    const { workspace, orchestration } = setUp(stubManager(PLAN3));
    await expect(orchestration.editStep(workspace.id, 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 's1', { instruction: '' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(orchestration.reorderSteps(workspace.id, 'orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---- dispatch and read-back across workers (15.7) ----

const WORKERS = [
  agentOf('claude-code', 'Claude Code', SUBSCRIPTION),
  agentOf('antigravity', 'Antigravity', SUBSCRIPTION),
  agentOf('codex', 'Codex', API_KEY),
  agentOf('grok', 'Grok', API_KEY),
];
/** A plan of independent steps, one per entry: `[worker, chat]`. */
const planOf = (...steps: ReadonlyArray<readonly [worker: string, chat?: string]>): ManagerPlan => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Do the work',
  steps: steps.map(([worker, chat], index) => ({ id: `s${index + 1}`, worker, chat: (chat ?? 'new') as 'new', instruction: `Instruction ${index + 1} for ${worker}.`, mode: 'ask' as const, depends_on: [] })),
});
/** Every chat of the project as a stranger would see it: nothing about it may change on a refusal. */
const chatsOf = (core: Core, workspaceId: WorkspaceId) => JSON.stringify(core.entities.listSessions(workspaceId));
/** Approves `stepId` and tries to send it; returns what the send did. */
async function trySend(orchestration: ReturnType<typeof setUp>['orchestration'], workspaceId: WorkspaceId, runId: string, stepId: string) {
  await orchestration.approveStep(workspaceId, runId, stepId);
  return orchestration.dispatchStep(workspaceId, runId, stepId).then(
    (view) => ({ view, error: undefined }),
    (error: unknown) => ({ view: undefined, error }),
  );
}

describe('dispatch to every kind of worker (15.7)', () => {
  it('sends an approved instruction to a Claude Code, Antigravity, Codex and Grok worker, each in a new chat of its own agent, as the manager\'s, in its own mode', async () => {
    const { core, workspace, orchestration, created, sent } = setUp(stubManager(planOf(['claude-code'], ['antigravity'], ['codex'], ['grok'])), { agents: WORKERS });
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    for (const id of ['s1', 's2', 's3', 's4']) {
      const result = await trySend(orchestration, workspace.id, run.id, id);
      expect(result.error).toBeUndefined();
    }
    expect(created.map((entry) => [entry.agentId, entry.permissionMode])).toEqual([['claude-code', 'ask'], ['antigravity', 'ask'], ['codex', 'ask'], ['grok', 'ask']]);
    expect(sent.map((entry) => [entry.text, entry.origin])).toEqual([
      ['Instruction 1 for claude-code.', 'manager'],
      ['Instruction 2 for antigravity.', 'manager'],
      ['Instruction 3 for codex.', 'manager'],
      ['Instruction 4 for grok.', 'manager'],
    ]);
    // The transcript of each chat shows who sent the instruction, and no mode was changed.
    const view = await orchestration.getRun(workspace.id, run.id);
    for (const step of view.steps) {
      expect(step.state).toBe('dispatched');
      const messages = core.events.readAfter(0).filter((event) => event.type === 'session.message_completed' && event.streamId === step.sessionId);
      expect(messages.map((event) => (event.type === 'session.message_completed' ? event.payload.origin : ''))).toEqual(['manager']);
      expect(core.entities.getSession(step.sessionId!)!.permissionMode).toBe('ask');
    }
    expect(core.events.readAfter(0).some((event) => event.type === 'session.permission_mode_changed')).toBe(false);
  });
});

/** A worker's tool call, as the chat records it. */
const toolCall = (core: Core, sessionId: SessionId, toolCallId: string, title: string, kind: 'read' | 'edit' | 'execute', status: 'in_progress' | 'completed') =>
  core.sessionEvents.appendSessionEvent(sessionId, { type: status === 'in_progress' ? 'session.tool_call' : 'session.tool_call_updated', payload: { sessionId, toolCallId, title, kind, status } });

/** A project with a worker and a chat of its own, and a manager that plans one step into that chat. */
function withOwnChat(fields: { agentId?: string; kind?: 'chat' | 'build' | 'planning'; state?: 'idle' | 'working' | 'waiting' | 'error' | 'done'; driver?: 'ui' | 'terminal'; mode?: 'ask' | 'auto' } = {}, options: SetUpOptions = {}) {
  let chatId = 'none';
  const manager = stubManager(() => planOf(['codex', chatId]));
  const kit = setUp(manager, { agents: WORKERS, ...options });
  const own = kit.core.entities.createSession({ workspaceId: kit.workspace.id, kind: fields.kind ?? 'chat', agentId: (fields.agentId ?? 'codex') as never, ...(fields.driver === undefined ? {} : { driver: fields.driver }), ...(fields.state === undefined ? {} : { state: fields.state }) });
  if (fields.mode !== undefined) kit.core.entities.setSessionPermissionMode(own.id, fields.mode, 'user');
  chatId = own.id;
  return { ...kit, manager, own };
}

describe('dispatch into a chat the step names (15.7)', () => {
  it('offers the manager only the worker\'s own idle chats, and continues the one it names: no new chat, the chat\'s own mode, the instruction marked as the manager\'s', async () => {
    const { core, workspace, orchestration, manager, own, created, sent } = withOwnChat({ mode: 'auto' });
    // Not offered to codex: another agent's chat, a chat that works, a chat the terminal drives, a build.
    const grokChat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: 'grok' as never });
    core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: 'codex' as never, state: 'working' });
    core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', agentId: 'codex' as never, driver: 'terminal' });
    core.entities.createSession({ workspaceId: workspace.id, kind: 'build', agentId: 'codex' as never });
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    const offered = manager.contexts[0]!.workers.map((worker) => [worker.agentId, worker.chats.map((entry) => entry.sessionId)]);
    expect(offered).toEqual([['claude-code', []], ['antigravity', []], ['codex', [own.id]], ['grok', [grokChat.id]]]);

    const result = await trySend(orchestration, workspace.id, run.id, 's1');
    expect(result.error).toBeUndefined();
    expect(created).toEqual([]);
    expect(sent).toEqual([{ sessionId: own.id, text: 'Instruction 1 for codex.', origin: 'manager' }]);
    expect(result.view!.steps[0]).toMatchObject({ state: 'dispatched', sessionId: own.id });
    // The worker keeps its own mode: the instruction never changes it.
    expect(core.entities.getSession(own.id)!.permissionMode).toBe('auto');
    expect(core.events.readAfter(0).filter((event) => event.type === 'session.permission_mode_changed')).toHaveLength(1);
  });

  it('refuses a chat that is busy, finished, driven by the terminal, another agent\'s, not a plain chat or gone, in plain words, changing no chat and sending nothing', async () => {
    const cases: Array<[string, Parameters<typeof withOwnChat>[0], string]> = [
      ['busy', { state: 'working' }, 'chat_busy'],
      ['waiting for an answer', { state: 'waiting' }, 'chat_busy'],
      ['in an error', { state: 'error' }, 'chat_busy'],
      ['finished', { state: 'done' }, 'chat_busy'],
      ['driven by the terminal', { driver: 'terminal' }, 'driver_is_terminal'],
    ];
    for (const [name, fields, reason] of cases) {
      const { core, workspace, orchestration, own, created, sent, tamper } = withOwnChat();
      const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
      // The chat changed after the plan was made.
      if (fields?.state !== undefined) core.entities.setSessionState(own.id, fields.state);
      if (fields?.driver !== undefined) core.entities.setSessionDriver(own.id, fields.driver, 'user');
      await orchestration.approveStep(workspace.id, run.id, 's1');
      const before = { chats: chatsOf(core, workspace.id), seq: core.events.lastSeq() };
      const error = await orchestration.dispatchStep(workspace.id, run.id, 's1').catch((failure: unknown) => failure);
      expect(error, name).toBeInstanceOf(DispatchRefusedError);
      expect((error as DispatchRefusedError).reason, name).toBe(reason);
      expect((error as DispatchRefusedError).message, name).not.toMatch(/ - |–|—/);
      expect(created, name).toEqual([]);
      expect(sent, name).toEqual([]);
      expect(chatsOf(core, workspace.id), name).toBe(before.chats);
      expect(core.events.lastSeq(), name).toBe(before.seq);
      // The step is still approved: the user can send it when the chat is free.
      expect(stepOf(await orchestration.getRun(workspace.id, run.id), 's1').state, name).toBe('approved');
      void tamper;
    }
    for (const [fields, reason] of [
      [{ agentId: 'grok' }, 'chat_other_agent'],
      [{ kind: 'planning' as const }, 'chat_not_a_chat'],
    ] as const) {
      const { core, workspace, orchestration, created, sent, manager } = withOwnChat(fields);
      // The manager is only offered the worker's own chats, so the plan check refuses these before a step exists.
      const failure = await orchestration.startRun(workspace.id, { goal: 'Do the work' }).catch((error: unknown) => error);
      expect(failure, reason).toBeInstanceOf(ManagerFailedError);
      expect(created).toEqual([]);
      expect(sent).toEqual([]);
      expect(manager.contexts).toHaveLength(1);
      void core;
    }
  });

  it('refuses a chat that was deleted, changed agent or stopped being a plain chat after the plan, as the worker\'s own check, not the manager\'s', async () => {
    const { core, workspace, orchestration, own, created, sent, tamper } = withOwnChat();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    await orchestration.approveStep(workspace.id, run.id, 's1');
    const before = chatsOf(core, workspace.id);
    tamper("UPDATE sessions SET agent_id = 'grok' WHERE id = ?", own.id);
    const other = await orchestration.dispatchStep(workspace.id, run.id, 's1').catch((error: unknown) => error);
    expect((other as DispatchRefusedError).reason).toBe('chat_other_agent');
    tamper("UPDATE sessions SET agent_id = 'codex', kind = 'planning' WHERE id = ?", own.id);
    const kind = await orchestration.dispatchStep(workspace.id, run.id, 's1').catch((error: unknown) => error);
    expect((kind as DispatchRefusedError).reason).toBe('chat_not_a_chat');
    tamper("UPDATE sessions SET kind = 'chat' WHERE id = ?", own.id);
    // Another project's chat id is not found from this project.
    const elsewhere = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const foreign = core.entities.createSession({ workspaceId: elsewhere.id, kind: 'chat', agentId: 'codex' as never });
    tamper("UPDATE orchestration_steps SET chat = ? WHERE run_id = ?", foreign.id, run.id);
    const gone = await orchestration.dispatchStep(workspace.id, run.id, 's1').catch((error: unknown) => error);
    expect((gone as DispatchRefusedError).reason).toBe('chat_gone');
    expect(created).toEqual([]);
    expect(sent).toEqual([]);
    tamper("UPDATE orchestration_steps SET chat = ? WHERE run_id = ?", own.id, run.id);
    tamper("UPDATE sessions SET agent_id = 'codex' WHERE id = ?", own.id);
    expect(chatsOf(core, workspace.id)).toBe(before);
  });

  it('takes back an instruction the chat queued behind a turn that was ending, and refuses', async () => {
    const { workspace, orchestration, sendBehaviour, removed, sent } = withOwnChat();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    sendBehaviour.queued = true;
    const result = await trySend(orchestration, workspace.id, run.id, 's1');
    expect((result.error as DispatchRefusedError).reason).toBe('chat_busy');
    expect(removed).toEqual(['queued_msg']);
    expect(sent).toHaveLength(1);
    expect(stepOf(await orchestration.getRun(workspace.id, run.id), 's1').state).toBe('approved');
  });

  it('turns the chat\'s own refusals into plain results, and leaves the step approved for another try', async () => {
    const { workspace, orchestration, sendBehaviour } = withOwnChat();
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    sendBehaviour.throws = new DriverIsTerminalError('The terminal is driving this chat.');
    expect(((await trySend(orchestration, workspace.id, run.id, 's1')).error as DispatchRefusedError).reason).toBe('driver_is_terminal');
    sendBehaviour.throws = new SessionNotIdleError('It is switching.');
    const again = await orchestration.dispatchStep(workspace.id, run.id, 's1').catch((error: unknown) => error);
    expect((again as DispatchRefusedError).reason).toBe('chat_busy');
    expect(stepOf(await orchestration.getRun(workspace.id, run.id), 's1').state).toBe('approved');
    sendBehaviour.throws = undefined;
    expect((await orchestration.dispatchStep(workspace.id, run.id, 's1')).steps[0]!.state).toBe('dispatched');
  });
});

describe('review fixes (15.7)', () => {
  it('maps a chat that cannot be made to a plain refusal, with nothing created and the step still approved', async () => {
    const kit = setUp(stubManager(planOf(['codex'])), { agents: WORKERS });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspace.id, run.id, 's1');
    // The use-case over a chat whose agent turned signed out between the check and the start.
    const own: OrchestrationChat = {
      chatAgents: async () => ({ defaultAgentId: 'codex', agents: WORKERS }) as never,
      createChatSession: () => Promise.reject(new AgentNotReadyError('agent_signed_out', 'Signed out.', 'codex' as never, 'sign_in')),
      sendMessage: () => {
        throw new Error('must not be reached');
      },
      getSession: (workspaceId, sessionId) => kit.core.entities.getSession(sessionId)!,
      listSessions: () => [],
      renameSession: () => {
        throw new Error('must not be reached');
      },
      removeQueuedMessage: () => undefined,
      cancel: () => undefined,
    };
    const use = kit.core.createOrchestration({ chat: own, manager: stubManager() });
    const error = await use.dispatchStep(kit.workspace.id, run.id, 's1').catch((failure: unknown) => failure);
    expect((error as DispatchRefusedError).reason).toBe('worker_signed_out');
    expect(stepOf(await use.getRun(kit.workspace.id, run.id), 's1').state).toBe('approved');
    expect(kit.core.entities.listSessions(kit.workspace.id)).toEqual([]);
  });

  it('leaves a named chat and its step untouched when the chat fails to take the instruction, and counts a message that was sent meanwhile as sent', async () => {
    const kit = withOwnChat();
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.sendBehaviour.throws = new Error('Ogden Agents is stopping.');
    const failed = await trySend(kit.orchestration, kit.workspace.id, run.id, 's1');
    expect((failed.error as Error).message).toBe('Ogden Agents is stopping.');
    expect(stepOf(await kit.orchestration.getRun(kit.workspace.id, run.id), 's1')).toMatchObject({ state: 'approved', sessionId: null });
    expect(kit.renamed).toEqual([]);
  });

  it('shows nothing of a reused chat\'s own history when the instruction is not among its newest events', async () => {
    const { core, workspace, orchestration, own, finish, tamper } = withOwnChat();
    finish(own.id, 'The user\'s own earlier conversation.');
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    await trySend(orchestration, workspace.id, run.id, 's1');
    tamper("UPDATE orchestration_steps SET instruction = 'Another text.' WHERE run_id = ?", run.id);
    finish(own.id, 'Newer output.');
    expect(stepOf(await orchestration.getRun(workspace.id, run.id), 's1').report?.summary).toBe('');
    void core;
  });
});

describe('the worker is checked again at dispatch, and the vendor terms are applied in code (15.7)', () => {
  const refusals: Array<[string, SetUpOptions, string, RegExp]> = [
    ['it left the team', { workers: [{ agentId: 'grok', ready: true }] }, 'worker_not_on_team', /not on this project's team any more/],
    ['it is no longer ready on the team', { workers: [{ agentId: 'codex', ready: false }] }, 'worker_not_ready', /not ready/],
    ['it was signed out', { agents: [agentOf('codex', 'Codex', { ...API_KEY, unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } })] }, 'worker_signed_out', /signed out/],
    ['the project is not trusted for it', { agents: [agentOf('codex', 'Codex', { ...API_KEY, needsProjectTrust: true, unavailable: { code: 'project_not_trusted', reason: 'Not trusted.', action: 'trust_project' } })] }, 'trust_not_given', /not trusted/],
    ['it is not installed', { agents: [agentOf('codex', 'Codex', { ...API_KEY, unavailable: { code: 'agent_not_installed', message: 'x', reason: 'Not installed.', action: 'install' } })] }, 'worker_not_ready', /not ready/],
    ['it left the install', { agents: [agentOf('grok', 'Grok', API_KEY)] }, 'worker_not_on_team', /not on this project's team any more/],
    ['its vendor allows only a person', { agents: [agentOf('codex', 'Codex', { ...API_KEY, interactiveOnly: 'Its terms allow only a person at the keyboard.' })] }, 'interactive_only', /never given instructions by a manager/],
  ];
  for (const [name, options, reason, words] of refusals) {
    it(`refuses an approved step when ${name}: nothing is created or sent, no chat changes, and the manager is told why`, async () => {
      // The plan was made while the worker was fine; the change came after.
      const kit = setUp(stubManager(planOf(['codex'])), { agents: WORKERS });
      const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
      await kit.orchestration.approveStep(kit.workspace.id, run.id, 's1');
      const changed = setUpLike(kit, options);
      const before = { chats: chatsOf(kit.core, kit.workspace.id), seq: kit.core.events.lastSeq() };
      const error = await changed.dispatchStep(kit.workspace.id, run.id, 's1').catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(DispatchRefusedError);
      expect((error as DispatchRefusedError).reason).toBe(reason);
      expect((error as DispatchRefusedError).message).toMatch(words);
      expect((error as DispatchRefusedError).message).not.toMatch(/ - |–|—/);
      expect(kit.created).toEqual([]);
      expect(kit.sent).toEqual([]);
      expect(chatsOf(kit.core, kit.workspace.id)).toBe(before.chats);
      expect(kit.core.events.lastSeq()).toBe(before.seq);
    });
  }

  it('applies the subscription rule at dispatch: Claude Code and Antigravity take only the user\'s own approval, in a run that dispatches automatically they are refused, and the API key workers go on', async () => {
    const kit = setUp(stubManager(planOf(['claude-code'], ['antigravity'], ['codex'], ['grok'])), { agents: WORKERS });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    for (const id of ['s1', 's2', 's3', 's4']) await kit.orchestration.approveStep(kit.workspace.id, run.id, id);
    // The run is under the automatic mode, which approved each step itself (set directly: the mode story 15.8 does it through its own routes).
    kit.tamper("UPDATE orchestration_runs SET mode = 'automatic' WHERE id = ?", run.id);
    kit.tamper("UPDATE orchestration_steps SET approved_by = 'mode' WHERE run_id = ?", run.id);
    const before = chatsOf(kit.core, kit.workspace.id);
    for (const id of ['s1', 's2']) {
      const error = await kit.orchestration.dispatchStep(kit.workspace.id, run.id, id).catch((failure: unknown) => failure);
      expect((error as DispatchRefusedError).reason).toBe('approve_each_only');
      expect((error as DispatchRefusedError).message).toMatch(/signs in with your account/);
    }
    expect(kit.created).toEqual([]);
    expect(chatsOf(kit.core, kit.workspace.id)).toBe(before);
    for (const id of ['s3', 's4']) expect((await kit.orchestration.dispatchStep(kit.workspace.id, run.id, id)).steps.find((step) => step.stepId === id)!.state).toBe('dispatched');
    expect(kit.created.map((entry) => entry.agentId)).toEqual(['codex', 'grok']);
  });

  it('never moves a worker\'s mode: the dispatch code names no way to set a mode, hand off or switch a driver', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'orchestration.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/setPermissionMode|handOff|handoffPreview|switchDriver|setModel/);
  });
});

/** The same project with the install's agents or team changed since the plan, as another use-case over the same core and chat. */
function setUpLike(kit: ReturnType<typeof setUp>, options: SetUpOptions) {
  const chat: OrchestrationChat = {
    async chatAgents() {
      return { defaultAgentId: 'claude-code', agents: options.agents ?? WORKERS } as never;
    },
    createChatSession: () => Promise.reject(new Error('must not be reached')),
    sendMessage: () => {
      throw new Error('must not be reached');
    },
    getSession: (workspaceId, sessionId) => kit.core.entities.getSession(sessionId)!,
    listSessions: (workspaceId) => kit.core.entities.listSessions(workspaceId),
    renameSession: () => {
      throw new Error('must not be reached');
    },
    removeQueuedMessage: () => undefined,
    cancel: () => undefined,
  };
  const team = options.workers === undefined ? undefined : { workers: async () => options.workers!.map((worker) => ({ ...worker, label: worker.agentId, role: 'worker' as const })) };
  return kit.core.createOrchestration({ chat, manager: stubManager(), ...(team === undefined ? {} : { team: team as never }) });
}

describe('a send that fails leaves no empty chat unmarked (15.7)', () => {
  it('fails the step, names the chat it made as not sent, and never makes a second one on a retry', async () => {
    const kit = setUp(stubManager(planOf(['codex'])), { agents: WORKERS });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    kit.sendBehaviour.throws = new Error('The agent would not start.');
    const result = await trySend(kit.orchestration, kit.workspace.id, run.id, 's1');
    expect((result.error as Error).message).toBe('The agent would not start.');
    expect(kit.created).toHaveLength(1);
    const step = stepOf(await kit.orchestration.getRun(kit.workspace.id, run.id), 's1');
    expect(step).toMatchObject({ state: 'failed', sessionId: kit.renamed[0]!.sessionId });
    expect(kit.renamed).toEqual([{ sessionId: step.sessionId, title: 'Not sent: step s1' }]);
    // A failed send is final for the run, and the empty chat is never offered back to the manager.
    expect((await kit.orchestration.getRun(kit.workspace.id, run.id)).run).toMatchObject({ state: 'failed', stopReason: 'worker_error' });
    kit.sendBehaviour.throws = undefined;
    await expect(kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(kit.created).toHaveLength(1);
  });

  it('makes no chat at all when the worker cannot start one, and a run stopped while the chat was made leaves that chat named, with nothing sent', async () => {
    const kit = setUp(stubManager(planOf(['codex'])), { agents: WORKERS });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspace.id, run.id, 's1');
    const original = kit.core.entities.createSession.bind(kit.core.entities);
    let stopped: Promise<unknown> | undefined;
    kit.core.entities.createSession = ((input: Parameters<typeof original>[0]) => {
      stopped = kit.orchestration.stopRun(kit.workspace.id, run.id);
      return original(input);
    }) as typeof kit.core.entities.createSession;
    await expect(kit.orchestration.dispatchStep(kit.workspace.id, run.id, 's1')).rejects.toBeInstanceOf(StepNotApprovedError);
    await stopped;
    expect(kit.sent).toEqual([]);
    expect(kit.renamed).toHaveLength(1);
    expect(kit.renamed[0]!.title).toBe('Not sent: step s1');
  });
});

describe('read-back across workers (15.7)', () => {
  it('gives the manager the state and a masked, capped summary of the last output and the tool calls, for each kind of worker', async () => {
    const kit = setUp(stubManager(planOf(['claude-code'], ['antigravity'], ['codex'], ['grok'])), { agents: WORKERS });
    const { run } = await kit.orchestration.startRun(kit.workspace.id, { goal: 'Do the work' });
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const ids: Record<string, SessionId> = {};
    for (const id of ['s1', 's2', 's3', 's4']) {
      const result = await trySend(kit.orchestration, kit.workspace.id, run.id, id);
      ids[id] = result.view!.steps.find((step) => step.stepId === id)!.sessionId!;
    }
    // Tool calls, one of them with a secret in its title, one finished after it started.
    toolCall(kit.core, ids.s1!, 'a', `Run cat .env ${secret}`, 'execute', 'in_progress');
    toolCall(kit.core, ids.s1!, 'a', `Run cat .env ${secret}`, 'execute', 'completed');
    toolCall(kit.core, ids.s1!, 'b', 'Edit src/form.ts', 'edit', 'completed');
    kit.finish(ids.s1!, `Done. Token ${secret}.`);
    kit.finish(ids.s2!, `Plain answer. ${'y'.repeat(MANAGER_LIMITS.maxSummaryChars + 1000)}`);
    kit.finish(ids.s3!, 'Codex is done.');
    kit.finish(ids.s4!, 'Grok is done.', 'error');
    const view = await kit.orchestration.getRun(kit.workspace.id, run.id);
    const report = (id: string) => view.steps.find((step) => step.stepId === id)!.report!;
    expect(report('s1').summary).toContain('Tool calls: ');
    expect(report('s1').summary).toContain('Edit src/form.ts (completed)');
    expect(report('s1').summary).toContain('(completed)');
    expect(report('s1').summary).not.toContain('(in_progress)');
    expect(report('s1').summary).toContain('Done. Token');
    expect(report('s1').summary).not.toContain(secret);
    expect(report('s1')).toMatchObject({ worker: 'claude-code', state: 'idle', truncated: false });
    expect(report('s2').truncated).toBe(true);
    expect(report('s2').summary.length).toBeLessThanOrEqual(MANAGER_LIMITS.maxSummaryChars);
    expect(report('s3')).toMatchObject({ worker: 'codex', summary: 'Codex is done.', state: 'idle' });
    expect(report('s4')).toMatchObject({ worker: 'grok', state: 'error' });
    expect(JSON.stringify(kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.result_read'))).not.toContain(secret);
  });

  it('shows only what came after the instruction when the chat was used before, and caps a long tool list to the newest few', async () => {
    const { core, workspace, orchestration, own, finish } = withOwnChat();
    finish(own.id, 'An older answer from before the instruction.');
    const { run } = await orchestration.startRun(workspace.id, { goal: 'Do the work' });
    const sent = await trySend(orchestration, workspace.id, run.id, 's1');
    expect(sent.view!.steps[0]!.report?.summary).toBe('');
    for (let n = 0; n < 15; n++) toolCall(core, own.id, `t${n}`, `Step ${n}`, 'read', 'completed');
    finish(own.id, 'The new answer.');
    const report = stepOf(await orchestration.getRun(workspace.id, run.id), 's1').report!;
    expect(report.summary).toContain('(the last 10 of 15)');
    expect(report.summary).toContain('Step 14 (completed)');
    expect(report.summary).not.toContain('Step 4 (completed)');
    expect(report.summary.endsWith('The new answer.')).toBe(true);
    expect(report.summary).not.toContain('older answer');
  });
});
