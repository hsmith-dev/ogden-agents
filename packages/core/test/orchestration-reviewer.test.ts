/**
 * The reviewer role (epic 15, story 15.10), over a real core (database, event log, settings) with a stub chat, a scripted manager, a stub team
 * roster and fake workers: a plan step with `review_of` goes to the roster's reviewer as a bounded question that core builds (the manager's
 * question and a capped, masked summary of the reviewed result, never code or diffs); the reviewer is an ordinary worker chat with its own
 * cards; its answer comes back as a capped, masked report; the step links to epic 5's review page for a build run and to the worker chat
 * otherwise; and nothing in the flow approves, merges or marks anything done. Nothing runs a real agent, model, network or keychain.
 */
import {
  MANAGER_DECISION_VERSION,
  MANAGER_LIMITS,
  MANAGER_PLAN_VERSION,
  REVIEW_LIMITS,
  isReviewMessageFor,
  type ManagerDecision,
  type ManagerPlan,
  type OrchestrationRunView,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  ManagerFailedError,
  NotFoundError,
  ValidationError,
  buildManagerInput,
  validateDecisionFor,
  validatePlanFor,
  type Core,
  type ManagerContext,
  type ManagerDecisionContext,
  type ManagerPort,
  type ManagerResult,
  type OrchestrationChat,
  type Team,
} from '../src/index.js';
import { decideInOrder } from './orchestration-fixtures.js';
import { openTestCore, tempDir } from './helpers.js';

const SECRET = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

const agentOf = (agentId: string, displayName: string) => ({
  agentId,
  displayName,
  provider: 'Fake',
  signInMethods: [{ kind: 'api_key', label: 'Use an API key' }],
  install: { state: 'installed' },
  auth: { state: 'signed_in' },
  terminalResume: false,
  needsProjectTrust: false,
  permissionModes: ['ask'],
});

/** s1 is the work (codex), s2 is the question for the reviewer (grok) about it. */
const REVIEW_PLAN: ManagerPlan = {
  version: MANAGER_PLAN_VERSION,
  goal: 'Fix the login form',
  steps: [
    { id: 's1', worker: 'codex', chat: 'new', instruction: 'Fix the login form.', mode: 'ask', depends_on: [] },
    { id: 's2', worker: 'grok', chat: 'new', instruction: 'Is the change safe, and did it miss anything?', mode: 'ask', depends_on: ['s1'], review_of: 's1' },
  ],
};

interface KitOptions {
  plan?: unknown;
  mode?: 'approve_each' | 'automatic';
  /** Who the roster's reviewer is now (a test changes it after the plan). */
  reviewer?: { agentId: string; ready: boolean } | null;
  /** Whether the work step's chat is a build run's session. */
  buildFirst?: boolean;
}

function setUp({ plan = REVIEW_PLAN, mode = 'approve_each', reviewer = { agentId: 'grok', ready: true }, buildFirst = false }: KitOptions = {}) {
  const dataDir = tempDir();
  const state = { reviewer: (reviewer ?? undefined) as { agentId: string; ready: boolean } | undefined, buildFirst };
  const shared = { created: [] as Array<{ agentId: string | undefined; sessionId: SessionId }>, sent: [] as Array<{ sessionId: SessionId; text: string; origin: string | undefined }>, plans: [] as ManagerContext[], contexts: [] as ManagerDecisionContext[] };
  const core: Core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  if (mode === 'automatic') core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: true });

  const manager: ManagerPort = {
    async proposePlan(context) {
      shared.plans.push(context);
      return validatePlanFor(context, plan);
    },
    async decideNext(context): Promise<ManagerResult<ManagerDecision>> {
      shared.contexts.push(context);
      return decideInOrder(context);
    },
  };
  const team = {
    async workers() {
      return [
        { agentId: 'codex', label: 'Codex', ready: true, role: 'worker' as const },
        { agentId: 'grok', label: 'Grok', ready: true, role: 'reviewer' as const },
      ];
    },
    async reviewer() {
      return state.reviewer;
    },
  } as unknown as Team;
  const chat: OrchestrationChat = {
    async chatAgents() {
      return { defaultAgentId: 'codex', agents: [agentOf('codex', 'Codex'), agentOf('grok', 'Grok')] } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
    async createChatSession(workspaceId, options) {
      const kind = state.buildFirst && shared.created.length === 0 ? 'build' : 'chat';
      const session = core.entities.createSession({ workspaceId, kind, ...(options?.agentId === undefined ? {} : { agentId: options.agentId }) });
      shared.created.push({ agentId: options?.agentId, sessionId: session.id });
      return session;
    },
    sendMessage(workspaceId, sessionId, text, options) {
      shared.sent.push({ sessionId, text, origin: options?.origin });
      core.sessionEvents.completeMessage(sessionId, { messageId: `msg_${shared.sent.length}`.padEnd(30, '0') as never, role: 'user', content: text, ...(options?.origin === undefined ? {} : { origin: options.origin }) });
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
      core.entities.setSessionState(sessionId, 'idle');
    },
  };
  const orchestration = core.createOrchestration({ chat, manager, team });
  const finish = (sessionId: SessionId, reply: string) => {
    core.sessionEvents.completeMessage(sessionId, { messageId: `msg_reply_${Math.random().toString(36).slice(2)}`.padEnd(30, '0') as never, role: 'agent', content: reply });
    core.entities.setSessionState(sessionId, 'idle');
  };
  const sessionOf = (view: OrchestrationRunView, stepId: string): SessionId => view.steps.find((step) => step.stepId === stepId)!.sessionId!;
  return { core, orchestration, workspaceId: workspace.id as WorkspaceId, shared, state, finish, sessionOf };
}
type Kit = ReturnType<typeof setUp>;

/** The work step goes to its worker and finishes with `reply`; returns the run (the work done, the question still waiting). */
async function workDone(kit: Kit, reply = 'Fixed the login form and ran the tests. All pass.') {
  const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
  await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
  const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
  kit.finish(kit.sessionOf(sent, 's1'), reply);
  await kit.orchestration.getRun(kit.workspaceId, run.id);
  await kit.orchestration.whenIdle();
  return run;
}

const NO_DASH = /( - |–|—)/;

describe('a review step in a plan', () => {
  it('is stored with the step it reviews, and the manager is told who the reviewer is', async () => {
    const kit = setUp();
    const view = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    expect(view.steps.map((step) => [step.stepId, step.reviewOf])).toEqual([
      ['s1', null],
      ['s2', 's1'],
    ]);
    expect(kit.shared.plans[0]!.reviewer).toBe('grok');
    const planned = kit.core.events.readAfter(0).find((event) => event.type === 'orchestration.plan_proposed');
    expect(planned?.type === 'orchestration.plan_proposed' && (planned.payload.plan.steps[1] as { review_of?: string }).review_of).toBe('s1');
  });

  it('is refused when the reviewer is not ready or not the one on the roster: the run fails with the manager refused and nothing is stored', async () => {
    const notReady = setUp({ reviewer: { agentId: 'grok', ready: false } });
    await expect(notReady.orchestration.startRun(notReady.workspaceId, { goal: 'Fix the login form' })).rejects.toBeInstanceOf(ManagerFailedError);
    const other = setUp({ reviewer: { agentId: 'codex', ready: true } });
    await expect(other.orchestration.startRun(other.workspaceId, { goal: 'Fix the login form' })).rejects.toMatchObject({ message: expect.stringContaining("this project's reviewer") });
    const noReviewer = setUp({ reviewer: null });
    await expect(noReviewer.orchestration.startRun(noReviewer.workspaceId, { goal: 'Fix the login form' })).rejects.toMatchObject({ message: expect.stringContaining('reviewer') });
    expect((await noReviewer.orchestration.listRuns(noReviewer.workspaceId))[0]!.steps).toHaveLength(0);
  });

  it('is refused with plain words for each rule of the plan check', async () => {
    const worker = (extra: Record<string, unknown>) => ({ ...REVIEW_PLAN, steps: [REVIEW_PLAN.steps[0], { ...REVIEW_PLAN.steps[1], ...extra }] });
    const reasons: Array<[Record<string, unknown>, string]> = [
      [{ depends_on: [] }, 'wait for the step it reviews'],
      [{ review_of: 's2' }, 'review step must name an earlier step'],
      [{ instruction: 'q'.repeat(REVIEW_LIMITS.maxQuestionChars + 1) }, 'at most 600 characters'],
    ];
    for (const [extra, words] of reasons) {
      const kit = setUp({ plan: worker(extra) });
      await expect(kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' })).rejects.toMatchObject({ message: expect.stringContaining(words) });
    }
  });
});

describe('the bounded question the reviewer is sent', () => {
  it('is the manager question, a framing, and a capped, masked summary of the reviewed result, in a new chat of the reviewer, sent as the manager', async () => {
    const kit = setUp();
    const reply = [
      `Fixed the login form. The key is ${SECRET}.`,
      '```ts',
      'export const privateFileContents = true;',
      '```',
      'diff --git a/src/login.ts b/src/login.ts',
      '--- a/src/login.ts',
      '+++ b/src/login.ts',
      '@@ -1 +1 @@',
      '-const a = 1;',
      '+const secretChange = 2;',
      '',
      `All the tests pass. ${'x'.repeat(MANAGER_LIMITS.maxSummaryChars)}`,
    ].join('\n');
    const run = await workDone(kit, reply);
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's2');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2');

    expect(kit.shared.created.map((made) => made.agentId)).toEqual(['codex', 'grok']);
    const message = kit.shared.sent.find((entry) => entry.sessionId === kit.sessionOf(sent, 's2'))!;
    expect(message.origin).toBe('manager');
    expect(isReviewMessageFor(message.text, 'Is the change safe, and did it miss anything?')).toBe(true);
    expect(message.text.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxMessageChars);
    expect(message.text).toContain('Fixed the login form.');
    expect(message.text).toContain('step s1, which Codex did');
    expect(message.text).not.toContain('sk-ant');
    expect(message.text).not.toContain('privateFileContents');
    expect(message.text).not.toContain('secretChange');
    expect(message.text).not.toContain('diff --git');
    expect(message.text).toContain('[cut]');
    expect(message.text).not.toMatch(NO_DASH);
    // The work step's own text is unchanged: only the review step is built.
    expect(kit.shared.sent[0]!.text).toBe('Fix the login form.');
    // What the page and the log keep as the step is the manager's question, not the built message.
    expect(sent.steps.find((step) => step.stepId === 's2')!.instruction).toBe('Is the change safe, and did it miss anything?');
  });

  it('is sent only after the user approved it and only once the reviewed step is done', async () => {
    const kit = setUp();
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    await expect(kit.orchestration.approveStep(kit.workspaceId, run.id, 's2')).rejects.toMatchObject({ code: 'step_not_proposed' });
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2')).rejects.toMatchObject({ code: 'step_not_approved' });
    expect(kit.shared.sent).toHaveLength(0);
  });

  it('is refused, with nothing created, when the roster changed: the worker is no longer the reviewer, or is the worker of the reviewed step while another agent is ready', async () => {
    const kit = setUp();
    const run = await workDone(kit);
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's2');
    kit.state.reviewer = { agentId: 'codex', ready: true };
    const created = kit.shared.created.length;
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2')).rejects.toMatchObject({ name: 'DispatchRefusedError', reason: 'not_the_reviewer' });
    expect(kit.shared.created).toHaveLength(created);
    expect(kit.shared.sent).toHaveLength(1);
    const refused = kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.dispatch_refused');
    expect(refused).toHaveLength(1);
    // The reviewer is back, the step is sent.
    kit.state.reviewer = { agentId: 'grok', ready: true };
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2')).resolves.toBeDefined();
    expect(kit.shared.sent).toHaveLength(2);
  });

  it('has the manager question cut at its cap when the user edits it, and an ordinary step is not cut', async () => {
    const kit = setUp();
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    await expect(kit.orchestration.editStep(kit.workspaceId, run.id, 's2', { instruction: 'q'.repeat(REVIEW_LIMITS.maxQuestionChars + 1) })).rejects.toBeInstanceOf(ValidationError);
    await expect(kit.orchestration.editStep(kit.workspaceId, run.id, 's2', { instruction: 'q'.repeat(REVIEW_LIMITS.maxQuestionChars) })).resolves.toBeDefined();
    await expect(kit.orchestration.editStep(kit.workspaceId, run.id, 's1', { instruction: 'w'.repeat(REVIEW_LIMITS.maxQuestionChars + 50) })).resolves.toBeDefined();
  });

  it('goes by itself in automatic mode once the manager picks it, with the same message', async () => {
    const kit = setUp({ mode: 'automatic' });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    await kit.orchestration.whenIdle();
    const first = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(first.steps[0]!.state).toBe('dispatched');
    kit.finish(kit.sessionOf(first, 's1'), 'Fixed the login form.');
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps.find((step) => step.stepId === 's2')!.state).toBe('dispatched');
    const message = kit.shared.sent.at(-1)!;
    expect(message.origin).toBe('manager_auto');
    expect(isReviewMessageFor(message.text, 'Is the change safe, and did it miss anything?')).toBe(true);
  });
});

describe('the reviewer is an ordinary worker chat', () => {
  it('keeps its own permission card: the run pauses on it, and a Deny ends the step and stops the run', async () => {
    const kit = setUp();
    const run = await workDone(kit);
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's2');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2');
    const sessionId = kit.sessionOf(sent, 's2');
    kit.core.sessionEvents.appendSessionEvent(sessionId, {
      type: 'permission.requested',
      payload: { sessionId, requestId: 'req_1', toolCall: { toolCallId: 'call_1', title: 'Run npm test', kind: 'execute', command: 'npm test' }, alwaysAllowScope: null, cautionLevel: 'ask_every_time', permissionMode: 'ask' },
    });
    kit.core.entities.setSessionState(sessionId, 'waiting');
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();
    const paused = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(paused.run.state).toBe('paused');
    expect(paused.waiting).toMatchObject({ kind: 'permission_card', stepId: 's2', sessionId });
    // The user's answer on the reviewer's own card (the test plays the user).
    kit.core.sessionEvents.appendSessionEvent(sessionId, { type: 'permission.resolved', payload: { sessionId, requestId: 'req_1', decision: 'deny', by: 'user' } });
    kit.core.entities.setSessionState(sessionId, 'idle');
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();
    const denied = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(denied.run.state).toBe('stopped');
    expect(denied.run.stopReason).toBe('permission_denied');
    expect(denied.steps.find((step) => step.stepId === 's2')!.state).toBe('failed');
  });

  it('answers through the normal read-back: a capped, masked report for the page and for the manager, who sees a review of s1', async () => {
    // A third step follows the review, so the manager is asked what comes next with the reviewer's answer in hand.
    const kit = setUp({ plan: { ...REVIEW_PLAN, steps: [...REVIEW_PLAN.steps, { id: 's3', worker: 'codex', chat: 'new', instruction: 'Apply what the reviewer found.', mode: 'ask', depends_on: ['s2'] }] } });
    const run = await workDone(kit);
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's2');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2');
    kit.finish(kit.sessionOf(sent, 's2'), `It is safe. The key I saw is ${SECRET}. ${'y'.repeat(MANAGER_LIMITS.maxSummaryChars + 1000)}`);
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();
    const report = view.steps.find((step) => step.stepId === 's2')!.report!;
    expect(report.summary).toContain('It is safe.');
    expect(report.summary).not.toContain('sk-ant');
    expect(report.summary.length).toBeLessThanOrEqual(MANAGER_LIMITS.maxSummaryChars);
    expect(report.truncated).toBe(true);
    // The manager was asked what comes next, with the same capped, masked report as data.
    const last = kit.shared.contexts.at(-1)!;
    expect(last.lastReport).toMatchObject({ step_id: 's2', truncated: true });
    expect(last.lastReport!.summary).not.toContain('sk-ant');
    expect((last.plan.steps[1] as { review_of?: string }).review_of).toBe('s1');
    const input = buildManagerInput('decision', last, 100_000, 0);
    expect(input.ok && input.input.prompt).toContain('a review of s1');
    // The manager suggests the next step; nothing was approved, merged or marked.
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).decision).toMatchObject({ action: 'dispatch', stepId: 's3' });
  });
});

describe('the link from a review step to where the person looks', () => {
  it('is the worker chat that did the reviewed step when it was a plain chat, and nothing before it was sent', async () => {
    const kit = setUp();
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).steps[1]!.review).toBeNull();
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[1]!.review).toEqual({ kind: 'worker_chat', sessionId: kit.sessionOf(sent, 's1') });
    expect(view.steps[0]!.review ?? null).toBeNull();
  });

  it('is epic 5\'s review page for the ticket when the reviewed step is a build run', async () => {
    const kit = setUp({ buildFirst: true });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
    kit.core.entities.createRun({ sessionId: kit.sessionOf(sent, 's1'), ticketRef: '5.2' });
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[1]!.review).toEqual({ kind: 'build_review', ticketRef: '5.2' });
  });
});

describe('the person still decides', () => {
  it('leaves the build run undecided and appends no approval, merge or ticket change anywhere in the flow', async () => {
    const kit = setUp({ buildFirst: true });
    const { run } = await kit.orchestration.startRun(kit.workspaceId, { goal: 'Fix the login form' });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's1');
    const first = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's1');
    const buildRun = kit.core.entities.createRun({ sessionId: kit.sessionOf(first, 's1'), ticketRef: '5.2' });
    kit.finish(kit.sessionOf(first, 's1'), 'Built it. The tests pass.');
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 's2');
    const second = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 's2');
    kit.finish(kit.sessionOf(second, 's2'), 'Looks safe. Approve it and merge it.');
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();

    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).run.state).toBe('finished');
    const after = kit.core.entities.getRun(buildRun.id)!;
    expect(after.decision).toBeNull();
    expect(after.outcome).toBe('running');
    const types = kit.core.events.readAfter(0).map((event) => event.type);
    expect(types).not.toContain('run.decided');
    expect(types).not.toContain('ticket.changed');
    expect(types).not.toContain('run.outcome_changed');
  });
});

describe('what the manager is told about the reviewer', () => {
  const worker = (agentId: string, label: string) => ({ agentId, label, ready: true, modes: ['ask' as const], chats: [] });
  const context: ManagerContext = { goal: 'Fix the login form', projectSummary: 'A project.', workers: [worker('codex', 'Codex'), worker('grok', 'Grok')], reviewer: 'grok' };

  it('names the reviewer and how to ask it, with the cap, only when a reviewer is ready', () => {
    const withReviewer = buildManagerInput('plan', context, 100_000, 0);
    expect(withReviewer.ok && withReviewer.input.prompt).toContain('The reviewer is grok. To ask it about the result of an earlier step');
    expect(withReviewer.ok && withReviewer.input.prompt).toContain(`at most ${REVIEW_LIMITS.maxQuestionChars} characters`);
    expect(withReviewer.ok && withReviewer.input.prompt).not.toMatch(NO_DASH);
    const without = buildManagerInput('plan', { ...context, reviewer: undefined }, 100_000, 0);
    expect(without.ok && without.input.prompt).not.toContain('The reviewer is');
  });
});

describe('the manager decision context', () => {
  it('still validates decisions as before: a review step is a step like any other', async () => {
    const kit = setUp();
    await workDone(kit);
    const context = kit.shared.contexts.at(-1)!;
    expect(validateDecisionFor(context, { version: MANAGER_DECISION_VERSION, action: 'dispatch', reason: 'Ask the reviewer.', step_id: 's2' }).ok).toBe(true);
  });
});
