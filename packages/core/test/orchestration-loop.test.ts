/**
 * The loop (epic 15, story 15.9), over a real core (database, event log, settings) with a stub chat, a scripted manager, fake workers and a
 * fake clock: after each result the manager is asked for the next decision (dispatch, ask the user, done, stop) and the decision is checked in
 * code; a worker waiting on a permission card pauses the run and nothing here answers it; a Deny ends the step and stops the run with the
 * manager told; a refused dispatch in an automatic run tells the manager; and a run is picked up again after a restart from its rows and events
 * (a real core reopened on the same data folder) without sending an instruction twice. Nothing runs a real agent, model, network or keychain.
 */
import {
  MANAGER_DECISION_VERSION,
  MANAGER_PLAN_VERSION,
  type ManagerDecision,
  type ManagerPlan,
  type OrchestrationRunView,
  type RunLimits,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  NoQuestionPendingError,
  NotFoundError,
  RESTARTED_REASON,
  StepNotApprovedError,
  ValidationError,
  validateDecisionFor,
  validatePlanFor,
  type Core,
  type ManagerDecisionContext,
  type ManagerPort,
  type ManagerResult,
  type OrchestrationChat,
} from '../src/index.js';
import { decideInOrder } from './orchestration-fixtures.js';
import { openTestCore, tempDir } from './helpers.js';

const agentOf = (agentId: string, displayName: string, fields: Record<string, unknown> = {}) => ({
  agentId,
  displayName,
  provider: 'Fake',
  signInMethods: [{ kind: 'api_key', label: 'Use an API key' }],
  install: { state: 'installed' },
  auth: { state: 'signed_in' },
  terminalResume: false,
  needsProjectTrust: false,
  permissionModes: ['ask'],
  ...fields,
});

const planOf = (...steps: ReadonlyArray<readonly [worker: string, needs?: readonly string[]]>): ManagerPlan => ({
  version: MANAGER_PLAN_VERSION,
  goal: 'Do the work',
  steps: steps.map(([worker, needs], index) => ({ id: `s${index + 1}`, worker, chat: 'new' as const, instruction: `Instruction ${index + 1} for ${worker}.`, mode: 'ask' as const, depends_on: [...(needs ?? [])] })),
});
const THREE = planOf(['codex'], ['codex'], ['codex']);
const CHAIN3 = planOf(['codex'], ['codex', ['s1']], ['codex', ['s2']]);

const decision = (action: ManagerDecision['action'], extra: Partial<ManagerDecision> = {}): unknown => ({ version: MANAGER_DECISION_VERSION, action, reason: 'Because.', ...extra });

/** A manager that plays scripted decisions (any JSON, checked as a real manager's answer is) and remembers every context it was given. */
function scriptedManager(plan: ManagerPlan, script: Array<unknown | ((context: ManagerDecisionContext) => unknown)> = []) {
  const contexts: ManagerDecisionContext[] = [];
  let at = 0;
  const port: ManagerPort = {
    async proposePlan(context) {
      return validatePlanFor(context, plan);
    },
    async decideNext(context): Promise<ManagerResult<ManagerDecision>> {
      contexts.push(context);
      if (script.length === 0) return decideInOrder(context);
      const reply = script[Math.min(at, script.length - 1)];
      at += 1;
      return validateDecisionFor(context, typeof reply === 'function' ? (reply as (c: ManagerDecisionContext) => unknown)(context) : reply);
    },
  };
  return { port, contexts };
}

const STARTED = Date.parse('2026-10-06T10:00:00.000Z');

interface Shared {
  clock: { now: number };
  listed: Array<ReturnType<typeof agentOf>>;
  created: Array<{ agentId: string | undefined }>;
  sent: Array<{ sessionId: SessionId; text: string; origin: string | undefined }>;
  cancelled: SessionId[];
}

interface KitOptions {
  plan?: ManagerPlan;
  mode?: 'approve_each' | 'automatic';
  script?: Array<unknown | ((context: ManagerDecisionContext) => unknown)>;
  on?: boolean;
  limits?: RunLimits;
  /** The manager the first start uses (a test's way to have it hang); a restart uses the scripted one. */
  firstManager?: (scripted: ManagerPort) => ManagerPort;
}

function setUp({ plan = THREE, mode = 'automatic', script = [], on = true, limits, firstManager }: KitOptions = {}) {
  const dataDir = tempDir();
  const shared: Shared = { clock: { now: STARTED }, listed: [agentOf('codex', 'Codex'), agentOf('claude-code', 'Claude Code', { signInMethods: [{ kind: 'subscription', label: 'Sign in with your account' }] })], created: [], sent: [], cancelled: [] };
  const scripted = scriptedManager(plan, script);
  let core: Core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (on) core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  if (mode === 'automatic') core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: true });

  const chatFor = (current: () => Core): OrchestrationChat => ({
    async chatAgents() {
      return { defaultAgentId: 'codex', agents: shared.listed } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
    async createChatSession(workspaceId, options) {
      const session = current().entities.createSession({ workspaceId, kind: 'chat', ...(options?.agentId === undefined ? {} : { agentId: options.agentId }) });
      shared.created.push({ agentId: options?.agentId });
      return session;
    },
    sendMessage(workspaceId, sessionId, text, options) {
      shared.sent.push({ sessionId, text, origin: options?.origin });
      current().sessionEvents.completeMessage(sessionId, { messageId: `msg_${shared.sent.length}`.padEnd(30, '0') as never, role: 'user', content: text, ...(options?.origin === undefined ? {} : { origin: options.origin }) });
      current().entities.setSessionState(sessionId, 'working');
      return { messageId: 'msg', queued: false };
    },
    getSession(workspaceId, sessionId) {
      const session = current().entities.getSession(sessionId);
      if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
      return session;
    },
    listSessions: (workspaceId) => current().entities.listSessions(workspaceId),
    renameSession: (workspaceId, sessionId) => current().entities.getSession(sessionId)!,
    removeQueuedMessage() {},
    cancel(workspaceId, sessionId) {
      shared.cancelled.push(sessionId);
      current().entities.setSessionState(sessionId, 'idle');
    },
  });
  const build = (manager: ManagerPort) => core.createOrchestration({ chat: chatFor(() => core), manager, clock: () => shared.clock.now, ...(limits === undefined ? {} : { limits: () => limits }) });
  let orchestration = build(firstManager === undefined ? scripted.port : firstManager(scripted.port));

  const finish = (sessionId: SessionId, reply = 'Done.', state: 'idle' | 'error' = 'idle') => {
    core.sessionEvents.completeMessage(sessionId, { messageId: `msg_reply_${Math.random().toString(36).slice(2)}`.padEnd(30, '0') as never, role: 'agent', content: reply });
    core.entities.setSessionState(sessionId, state);
  };
  /** The worker's agent asks for a permission (the card), and the chat waits. */
  const askCard = (sessionId: SessionId, requestId = 'req_1', title = 'Run npm test') => {
    core.sessionEvents.appendSessionEvent(sessionId, {
      type: 'permission.requested',
      payload: { sessionId, requestId, toolCall: { toolCallId: 'call_1', title, kind: 'execute', command: 'npm test' }, alwaysAllowScope: null, cautionLevel: 'ask_every_time', permissionMode: 'ask' },
    });
    core.entities.setSessionState(sessionId, 'waiting');
  };
  /** The user's answer on the worker's own card (the test plays the user: nothing in core does). */
  const answerCard = (sessionId: SessionId, decisionOf: 'allow_once' | 'deny', requestId = 'req_1', by: 'user' | 'cancelled' = 'user') => {
    core.sessionEvents.appendSessionEvent(sessionId, { type: 'permission.resolved', payload: { sessionId, requestId, decision: decisionOf, by } });
    core.entities.setSessionState(sessionId, 'working');
  };
  const read = async (runId: string): Promise<OrchestrationRunView> => orchestration.getRun(workspace.id, runId);
  const settle = async () => orchestration.whenIdle();
  const sessionOf = (view: OrchestrationRunView, stepId: string): SessionId => view.steps.find((step) => step.stepId === stepId)!.sessionId!;
  /** The app stops and starts again on the same data folder: the stored sessions that were mid turn are settled as the server does at its start. */
  const restart = async (manager: ManagerPort = scripted.port) => {
    core.close();
    core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
    core.entities.settleInterruptedSessions(RESTARTED_REASON);
    orchestration = build(manager);
    const picked = await orchestration.resume();
    await orchestration.whenIdle();
    return picked;
  };
  return {
    dataDir,
    shared,
    contexts: scripted.contexts,
    workspaceId: workspace.id as WorkspaceId,
    get core() {
      return core;
    },
    get orchestration() {
      return orchestration;
    },
    finish,
    askCard,
    answerCard,
    read,
    settle,
    sessionOf,
    restart,
  };
}

const eventsOf = (core: Core, type: string, after = 0) => core.events.readAfter(after).filter((event) => event.type === type);
const stateOf = (view: OrchestrationRunView, id: string) => view.steps.find((step) => step.stepId === id)!.state;
const NO_DASH = /( - |–|—)/;

describe('the next decision after a result', () => {
  it('asks the manager after a step finishes, with the capped, masked report as data, and records its dispatch decision as a suggestion the user still approves', async () => {
    const kit = setUp({ mode: 'approve_each', plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    kit.finish(kit.sessionOf(sent, 's1'), `All done. The key is ${secret}.`);
    await kit.read(run.id);
    await kit.settle();

    expect(kit.contexts).toHaveLength(1);
    const context = kit.contexts[0]!;
    expect(context.lastReport).toMatchObject({ step_id: 's1', worker: 'codex', state: 'idle' });
    expect(context.lastReport?.summary).toContain('All done.');
    expect(JSON.stringify(context)).not.toContain(secret);
    expect(context.stepStates).toEqual({ s1: 'done', s2: 'proposed', s3: 'proposed' });

    const view = await kit.read(run.id);
    expect(view.decision).toMatchObject({ action: 'dispatch', stepId: 's2', reason: 'It is the next step.' });
    expect(view.run.state).toBe('awaiting_user');
    // Only a suggestion: nothing was approved or sent for the user.
    expect(stateOf(view, 's2')).toBe('proposed');
    expect(kit.shared.sent).toHaveLength(1);
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2')).rejects.toBeInstanceOf(StepNotApprovedError);
    expect(eventsOf(kit.core, 'orchestration.decision_made')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ runId: run.id, after: 's1', action: 'dispatch', stepId: 's2' }) })]);
  });

  it('asks for no decision when no step is left, and finishes the run', async () => {
    const kit = setUp({ mode: 'approve_each', plan: planOf(['codex']) });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
    kit.finish(kit.sessionOf(sent, 's1'));
    await kit.read(run.id);
    await kit.settle();
    expect(kit.contexts).toHaveLength(0);
    expect((await kit.read(run.id)).run.state).toBe('finished');
  });

  it('refuses a decision that names a step that is not in the plan, or is not waiting, or whose needs are not done, as no usable decision', async () => {
    for (const bad of [decision('dispatch', { step_id: 's9' }), decision('dispatch', { step_id: 's1' }), decision('dispatch', { step_id: 's3' })]) {
      const kit = setUp({ mode: 'approve_each', plan: CHAIN3, script: [bad] });
      const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
      await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
      kit.finish(kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1'));
      await kit.read(run.id);
      await kit.settle();
      const view = await kit.read(run.id);
      // In the default mode the user picks the next step; the page says the manager could not suggest one.
      expect(view.decision).toMatchObject({ action: 'unavailable' });
      expect(view.decision?.reason).not.toMatch(NO_DASH);
      expect(view.run.state).toBe('awaiting_user');
      expect(stateOf(view, 's2')).toBe('proposed');
      expect(kit.shared.sent).toHaveLength(1);
    }
  });

  it('does not ask when nothing is left the manager could choose: every step left waits on a skipped step, so the run waits for the user', async () => {
    for (const mode of ['approve_each', 'automatic'] as const) {
      const kit = setUp({ plan: CHAIN3, mode });
      const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
      if (mode === 'approve_each') await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
      const sent = mode === 'approve_each' ? await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1') : await kit.read(run.id);
      await kit.orchestration.skipStep(kit.workspaceId, run.id, 's2');
      kit.finish(kit.sessionOf(sent, 's1'));
      await kit.read(run.id);
      await kit.settle();
      const view = await kit.read(run.id);
      expect(kit.contexts).toHaveLength(0);
      expect(view.run.state).toBe('awaiting_user');
      expect(view.steps.map((step) => step.state)).toEqual(['done', 'skipped', 'proposed']);
      expect(kit.shared.sent).toHaveLength(1);
    }
  });

  it('stops an automatic run when the manager gives no usable decision, and sends nothing more', async () => {
    const kit = setUp({ plan: CHAIN3, script: [decision('dispatch', { step_id: 's9' })] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'manager_refused' });
    expect(kit.shared.sent).toHaveLength(1);
  });

  it('in automatic mode sends the step the manager chose, within the usual rules and limits', async () => {
    const kit = setUp({ plan: THREE, script: [decision('dispatch', { step_id: 's3' }), decision('dispatch', { step_id: 's2' })] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    let view = await kit.read(run.id);
    expect(stateOf(view, 's3')).toBe('dispatched');
    expect(stateOf(view, 's2')).toBe('proposed');
    kit.finish(kit.sessionOf(view, 's3'));
    await kit.settle();
    view = await kit.read(run.id);
    expect(stateOf(view, 's2')).toBe('dispatched');
    kit.finish(kit.sessionOf(view, 's2'));
    await kit.settle();
    expect((await kit.read(run.id)).run.state).toBe('finished');
    expect(kit.shared.sent.map((entry) => [entry.text, entry.origin])).toEqual([
      ['Instruction 1 for codex.', 'manager_auto'],
      ['Instruction 3 for codex.', 'manager_auto'],
      ['Instruction 2 for codex.', 'manager_auto'],
    ]);
  });

  it('stops an automatic run at the instruction limit without asking the manager again', async () => {
    const kit = setUp({ plan: THREE, limits: { maxInstructions: 1, maxDepth: 3, maxMinutes: 30 } });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'instruction_limit' });
    expect(kit.shared.sent).toHaveLength(1);
    expect(kit.contexts).toHaveLength(0);
  });

  it('finishes the run on done with the manager\'s reason, leaving steps never sent unsent', async () => {
    const kit = setUp({ plan: THREE, script: [decision('done', { reason: 'The first step was enough.' })] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run.state).toBe('finished');
    expect(view.decision).toMatchObject({ action: 'done', reason: 'The first step was enough.' });
    expect(view.steps.map((step) => step.state)).toEqual(['done', 'proposed', 'proposed']);
    expect(kit.shared.sent).toHaveLength(1);
    expect(eventsOf(kit.core, 'orchestration.run_finished')).toEqual([expect.objectContaining({ payload: { runId: run.id, reason: 'The first step was enough.' } })]);
  });

  it('stops the run on stop with the reason manager_stopped, and sends nothing more', async () => {
    const kit = setUp({ plan: THREE, script: [decision('stop', { reason: 'This will not work.' })] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'manager_stopped' });
    expect(view.decision).toMatchObject({ action: 'stop', reason: 'This will not work.' });
    expect(kit.shared.sent).toHaveLength(1);
  });

  it('masks a secret in the manager\'s reason before it is stored or shown', async () => {
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const kit = setUp({ plan: THREE, mode: 'approve_each', script: [{ version: MANAGER_DECISION_VERSION, action: 'done', reason: 'ok' }] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    kit.finish(kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1'));
    await kit.read(run.id);
    await kit.settle();
    expect(JSON.stringify(kit.core.events.readAfter(0))).not.toContain(secret);
  });
});

describe('the user acts while the manager thinks', () => {
  it('keeps a decision that lands after the user sent another step as a log entry only: a done does not finish the run under a working worker', async () => {
    let release: (value: ManagerResult<ManagerDecision>) => void = () => undefined;
    const slow = (scripted: ManagerPort): ManagerPort => ({
      proposePlan: scripted.proposePlan,
      decideNext: (context) => new Promise((resolve) => (release = (value) => resolve(value) as never)).then(() => validateDecisionFor(context, decision('done'))),
    });
    const kit = setUp({ plan: THREE, mode: 'approve_each', firstManager: slow });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    kit.finish(kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1'));
    await kit.read(run.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await kit.read(run.id)).thinking).toBe(true);
    // The user does not wait: they approve and send the second step.
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's2');
    await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2');
    release({ ok: true, value: decision('done') as ManagerDecision });
    await kit.settle();
    const after = await kit.read(run.id);
    expect(after.run.state).not.toBe('finished');
    expect(stateOf(after, 's2')).toBe('dispatched');
    expect(eventsOf(kit.core, 'orchestration.decision_made')).toHaveLength(0);
  });
});

describe('the manager asks the user a question', () => {
  const ASK = decision('ask_user', { question: 'Which database should it use?' });

  it('shows the question and waits, in either mode, and sends nothing while it waits', async () => {
    for (const mode of ['approve_each', 'automatic'] as const) {
      const kit = setUp({ plan: THREE, mode, script: [ASK] });
      const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
      if (mode === 'approve_each') await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
      const first = mode === 'approve_each' ? await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1') : await kit.read(run.id);
      kit.finish(kit.sessionOf(first, 's1'));
      await kit.read(run.id);
      await kit.settle();
      const view = await kit.read(run.id);
      expect(view.run.state).toBe('awaiting_user');
      expect(view.waiting).toEqual({ kind: 'question', question: 'Which database should it use?' });
      expect(view.decision).toMatchObject({ action: 'ask_user' });
      expect(kit.shared.sent).toHaveLength(1);
      expect(eventsOf(kit.core, 'orchestration.run_paused')).toEqual(expect.arrayContaining([expect.objectContaining({ payload: { runId: run.id, reason: 'awaiting_user' } })]));
    }
  });

  it('takes the answer as data for the next decision, and then goes on', async () => {
    const kit = setUp({ plan: THREE, script: [ASK, decision('dispatch', { step_id: 's2' })] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const answered = await kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: '  Use\nSQLite please.  ' });
    expect(answered.run.state).toBe('awaiting_user');
    await kit.settle();
    // The manager got the answer, folded to one line, as data in its context.
    expect(kit.contexts).toHaveLength(2);
    expect(kit.contexts[1]!.userAnswer).toBe('Use SQLite please.');
    expect(kit.contexts[1]!.lastReport).toMatchObject({ step_id: 's1' });
    const view = await kit.read(run.id);
    expect(stateOf(view, 's2')).toBe('dispatched');
    expect(view.waiting).toBeNull();
    expect(eventsOf(kit.core, 'orchestration.question_answered')).toEqual([expect.objectContaining({ payload: { runId: run.id, answer: 'Use SQLite please.' } })]);
  });

  it('refuses an answer when nothing was asked, an answer twice, a secret and empty text', async () => {
    const kit = setUp({ plan: THREE, mode: 'approve_each', script: [ASK, decision('stop')] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await expect(kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: 'Hello' })).rejects.toBeInstanceOf(NoQuestionPendingError);
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    kit.finish(kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1'));
    await kit.read(run.id);
    await kit.settle();
    await expect(kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' })).rejects.toBeInstanceOf(ValidationError);
    await expect(kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: 'SQLite' });
    await expect(kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: 'SQLite again' })).rejects.toBeInstanceOf(NoQuestionPendingError);
    await kit.settle();
    expect((await kit.read(run.id)).run).toMatchObject({ state: 'stopped', stopReason: 'manager_stopped' });
    await expect(kit.orchestration.answerQuestion(kit.workspaceId, run.id, { answer: 'Late' })).rejects.toThrow();
  });
});

describe('a worker waiting on a permission card', () => {
  it('pauses the run, shows which chat holds the card, and goes on once the user has answered it there', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    const session = kit.sessionOf(await kit.read(run.id), 's1');
    kit.askCard(session);
    await kit.settle();
    let view = await kit.read(run.id);
    expect(view.run.state).toBe('paused');
    expect(view.waiting).toEqual({ kind: 'permission_card', stepId: 's1', sessionId: session });
    expect(stateOf(view, 's1')).toBe('dispatched');
    expect(eventsOf(kit.core, 'orchestration.run_paused').filter((event) => event.type === 'orchestration.run_paused' && event.payload.reason === 'permission_card')).toHaveLength(1);
    // Looking again does not say it twice, and nothing is sent or cancelled while the card waits.
    await kit.read(run.id);
    await kit.settle();
    expect(eventsOf(kit.core, 'orchestration.run_paused').filter((event) => event.type === 'orchestration.run_paused' && event.payload.reason === 'permission_card')).toHaveLength(1);
    expect(kit.shared.sent).toHaveLength(1);
    expect(kit.shared.cancelled).toEqual([]);

    // The user allows it on the worker's own card; the worker finishes; the run goes on by itself.
    kit.answerCard(session, 'allow_once');
    await kit.settle();
    view = await kit.read(run.id);
    expect(view.run.state).toBe('running');
    expect(eventsOf(kit.core, 'orchestration.run_resumed')).toEqual([expect.objectContaining({ payload: { runId: run.id, reason: 'card_answered' } })]);
    kit.finish(session);
    await kit.settle();
    expect(stateOf(await kit.read(run.id), 's2')).toBe('dispatched');
  });

  it('pauses a default mode run too, and its time limit does not apply there', async () => {
    const kit = setUp({ plan: CHAIN3, mode: 'approve_each' });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const session = kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1');
    kit.askCard(session);
    await kit.settle();
    kit.shared.clock.now = STARTED + 5 * 60 * 60_000;
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run.state).toBe('paused');
    expect(view.waiting).toMatchObject({ kind: 'permission_card' });
  });
});

describe('a Deny of a worker\'s permission card', () => {
  it('ends the step, stops the run permission_denied, asks the worker\'s turn to stop and tells the manager', async () => {
    for (const mode of ['automatic', 'approve_each'] as const) {
      const kit = setUp({ plan: CHAIN3, mode, script: [decision('stop', { reason: 'It was denied, so I stop.' })] });
      const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
      let started = await kit.read(run.id);
      if (mode === 'approve_each') {
        await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
        started = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
      }
      const session = kit.sessionOf(started, 's1');
      kit.askCard(session, 'req_1', 'Run rm -rf build');
      kit.answerCard(session, 'deny');
      await kit.settle();
      const view = await kit.read(run.id);
      await kit.settle();
      expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'permission_denied' });
      expect(stateOf(view, 's1')).toBe('failed');
      expect(stateOf(view, 's2')).toBe('proposed');
      expect(kit.shared.sent).toHaveLength(1);
      expect(kit.shared.cancelled).toEqual([session]);
      // The manager was told it was denied, as the step's result, and its reply is kept in the log and shown.
      expect(kit.contexts).toHaveLength(1);
      expect(kit.contexts[0]!.lastReport).toMatchObject({ step_id: 's1', state: 'error' });
      expect(kit.contexts[0]!.lastReport?.summary).toContain('denied a permission request');
      expect(kit.contexts[0]!.lastReport?.summary).toContain('Run rm -rf build');
      expect(eventsOf(kit.core, 'orchestration.decision_made')).toEqual([expect.objectContaining({ payload: expect.objectContaining({ after: 's1', action: 'stop', told: 'denied' }) })]);
      expect((await kit.read(run.id)).decision).toMatchObject({ action: 'stop', told: 'denied' });
      // The told answer changed nothing: the run is as it was stopped.
      expect(eventsOf(kit.core, 'orchestration.run_stopped').map((event) => (event.type === 'orchestration.run_stopped' ? event.payload.reason : ''))).toEqual(['permission_denied']);
    }
  });

  it('does not read a cancelled card (a Stop) as a Deny', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    const session = kit.sessionOf(await kit.read(run.id), 's1');
    kit.askCard(session);
    kit.answerCard(session, 'deny', 'req_1', 'cancelled');
    kit.finish(session);
    await kit.settle();
    const view = await kit.read(run.id);
    expect(view.run.state).not.toBe('stopped');
    expect(stateOf(view, 's1')).toBe('done');
  });

  it('takes a Deny that the worker ended its turn after, and one read late, the same way', async () => {
    const kit = setUp({ plan: CHAIN3, mode: 'approve_each' });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const session = kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1');
    kit.askCard(session);
    kit.answerCard(session, 'deny');
    kit.finish(session, 'I could not run it.');
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'permission_denied' });
    expect(stateOf(view, 's1')).toBe('failed');
    await kit.settle();
  });
});

describe('a refused dispatch in an automatic run', () => {
  it('stops the run and tells the manager as a result', async () => {
    const kit = setUp({ plan: CHAIN3, script: [decision('dispatch', { step_id: 's2' }), decision('stop', { reason: 'It could not be sent.' })] });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.shared.listed[0] = agentOf('codex', 'Codex', { unavailable: { code: 'agent_signed_out', reason: 'Signed out.', action: 'sign_in' } });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.settle();
    const view = await kit.read(run.id);
    await kit.settle();
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'dispatch_refused' });
    expect(kit.contexts).toHaveLength(2);
    const told = kit.contexts[1]!;
    expect(told.lastReport).toMatchObject({ step_id: 's2', worker: 'codex', state: 'error' });
    expect(told.lastReport?.summary).toContain('the instruction was not sent');
    expect(told.lastReport?.summary).toContain('Codex is signed out');
    expect(eventsOf(kit.core, 'orchestration.decision_made').filter((event) => event.type === 'orchestration.decision_made' && event.payload.told === 'refused')).toHaveLength(1);
    expect(JSON.stringify(told.lastReport)).not.toMatch(NO_DASH);
  });
});

describe('after a restart', () => {
  /** A manager that never answers its first decision, as when the app stops while it thinks. */
  const hangs = (scripted: ManagerPort): ManagerPort => ({ proposePlan: scripted.proposePlan, decideNext: () => new Promise(() => undefined) });

  it('picks up a run between steps: the decision that was owed is asked for once, and the next step is sent exactly once', async () => {
    const kit = setUp({ plan: CHAIN3, firstManager: hangs });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    // The result is read and the manager is thinking when the app stops.
    await kit.read(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(kit.shared.sent).toHaveLength(1);
    expect(eventsOf(kit.core, 'orchestration.decision_made')).toHaveLength(0);

    const picked = await kit.restart();
    expect(picked).toBe(1);
    const view = await kit.read(run.id);
    expect(stateOf(view, 's2')).toBe('dispatched');
    expect(kit.shared.sent.map((entry) => entry.text)).toEqual(['Instruction 1 for codex.', 'Instruction 2 for codex.']);
    expect(kit.contexts).toHaveLength(1);
    expect(eventsOf(kit.core, 'orchestration.run_resumed')).toEqual([expect.objectContaining({ payload: { runId: run.id, reason: 'restart' } })]);

    // Another restart sends nothing again (the worker of s2 was cut off in its turn, so the run waits for the user), and it still finishes.
    await kit.restart();
    expect(kit.shared.sent).toHaveLength(2);
    expect((await kit.read(run.id)).waiting).toMatchObject({ kind: 'interrupted', stepId: 's2' });
    const second = kit.sessionOf(await kit.read(run.id), 's2');
    kit.core.entities.setSessionState(second, 'working');
    kit.finish(second);
    await kit.settle();
    expect(stateOf(await kit.read(run.id), 's3')).toBe('dispatched');
    expect(kit.shared.sent).toHaveLength(3);
  });

  it('does not send a step again when the worker was cut off mid turn: the run waits for the user, and goes on once the worker has finished its turn', async () => {
    const kit = setUp({ plan: CHAIN3 });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    const session = kit.sessionOf(await kit.read(run.id), 's1');
    expect(kit.shared.sent).toHaveLength(1);
    await kit.restart();
    let view = await kit.read(run.id);
    expect(kit.shared.sent).toHaveLength(1);
    expect(stateOf(view, 's1')).toBe('dispatched');
    expect(view.run.state).toBe('awaiting_user');
    expect(view.waiting).toEqual({ kind: 'interrupted', stepId: 's1', sessionId: session });
    expect(kit.core.entities.getSession(session)?.state).toBe('idle');
    await kit.restart();
    expect(kit.shared.sent).toHaveLength(1);

    // The user lets the worker continue in its own chat; when it finishes, the step settles and the run goes on.
    kit.core.entities.setSessionState(session, 'working');
    kit.finish(session, 'Finished after the restart.');
    await kit.settle();
    view = await kit.read(run.id);
    expect(view.steps.find((step) => step.stepId === 's1')?.report?.summary).toContain('Finished after the restart.');
    expect(stateOf(view, 's2')).toBe('dispatched');
    expect(kit.shared.sent).toHaveLength(2);
  });

  it('keeps a run in default mode waiting for the user, and takes the decision it was owed', async () => {
    const kit = setUp({ plan: CHAIN3, mode: 'approve_each', firstManager: hangs });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    kit.finish(kit.sessionOf(await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1'), 's1'));
    await kit.read(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await kit.restart();
    const view = await kit.read(run.id);
    expect(view.run.state).toBe('awaiting_user');
    expect(view.decision).toMatchObject({ action: 'dispatch', stepId: 's2' });
    expect(stateOf(view, 's2')).toBe('proposed');
    expect(kit.shared.sent).toHaveLength(1);
  });

  it('counts the time limit from the run\'s start across a restart', async () => {
    const kit = setUp({ plan: CHAIN3, firstManager: hangs });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.read(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    kit.shared.clock.now = STARTED + 31 * 60_000;
    await kit.restart();
    const view = await kit.read(run.id);
    expect(view.run).toMatchObject({ state: 'stopped', stopReason: 'time_limit' });
    expect(kit.shared.sent).toHaveLength(1);
  });

  it('ends a run that was still making its plan, plainly, and leaves finished and stopped runs alone', async () => {
    const kit = setUp({ plan: CHAIN3, firstManager: (scripted) => ({ proposePlan: () => new Promise(() => undefined), decideNext: scripted.decideNext }) });
    void kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const picked = await kit.restart();
    expect(picked).toBe(0);
    const [view] = await kit.orchestration.listRuns(kit.workspaceId);
    expect(view!.run).toMatchObject({ state: 'failed', stopReason: 'restarted' });
    expect(view!.steps).toEqual([]);
    expect(kit.shared.created).toEqual([]);
    expect(await kit.restart()).toBe(0);
  });

  it('does nothing for a project whose Orchestration is off, and picks the run up when it is turned on again', async () => {
    const kit = setUp({ plan: CHAIN3, firstManager: hangs });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Do the work' });
    kit.finish(kit.sessionOf(await kit.read(run.id), 's1'));
    await kit.read(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    kit.core.permissions.updateSettings(kit.workspaceId, { orchestrationEnabled: false });
    expect(await kit.restart()).toBe(0);
    expect(kit.shared.sent).toHaveLength(1);
    kit.core.permissions.updateSettings(kit.workspaceId, { orchestrationEnabled: true });
    await kit.settle();
    expect(stateOf(await kit.read(run.id), 's2')).toBe('dispatched');
    expect(kit.shared.sent).toHaveLength(2);
  });
});
