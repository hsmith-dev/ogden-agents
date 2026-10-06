/**
 * Builds the manager proposes (epic 15, story 15.11), over a real core (database, event log, settings, runs) with a stub chat, a scripted
 * manager, a stub team roster and a stub list of the board's ready tickets: a plan may hold a build step (a ticket and a short reason, no
 * worker, no chat); it is a proposal only. No orchestration path approves, sends or starts it, in either mode: an automatic run waits for
 * the person, who starts the build in the Build dialog (here: a build run made by the test, as `POST /builds` would) and tells the plan which
 * run it was; the step then follows that run, and the manager reads a capped, masked summary of it. Nothing runs a real agent, model,
 * network or keychain.
 */
import {
  MANAGER_PLAN_VERSION,
  type ManagerDecision,
  type OrchestrationRunView,
  type RunId,
  type SessionId,
  type VerificationResult,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  NotFoundError,
  buildManagerInput,
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
const NO_DASH = /( - |–|—)/;

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

const work = (id: string, extra: Record<string, unknown> = {}) => ({ id, worker: 'codex', chat: 'new', instruction: `Do ${id}.`, mode: 'ask', depends_on: [] as string[], ...extra });
const build = (id: string, ticket = '1.1', extra: Record<string, unknown> = {}) => ({ id, build: { ticket }, reason: 'It is ready and the tests exist.', depends_on: [] as string[], ...extra });
const planOf = (...steps: unknown[]) => ({ version: MANAGER_PLAN_VERSION, goal: 'Ship the login form', steps });

interface KitOptions {
  plan?: unknown;
  mode?: 'approve_each' | 'automatic';
  /** The tickets the board says are ready; absent: 1.1 and 1.2. */
  buildable?: Array<{ ref: string; title: string }>;
  /** Moves the orchestration run's clock ahead, so a build made now came before the plan. */
  clockAhead?: number;
  decisions?: Array<(context: ManagerDecisionContext) => ManagerResult<ManagerDecision>>;
}

function setUp({ plan = planOf(build('b1')), mode = 'approve_each', buildable = [{ ref: '1.1', title: 'Build the login form' }, { ref: '1.2', title: 'Build the sign up form' }], clockAhead = 0, decisions = [] }: KitOptions = {}) {
  const dataDir = tempDir();
  const shared = { created: [] as Array<{ agentId: string | undefined; sessionId: SessionId }>, sent: [] as Array<{ sessionId: SessionId; text: string; origin: string | undefined }>, plans: [] as ManagerContext[], contexts: [] as ManagerDecisionContext[] };
  const core: Core = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
  core.permissions.updateSettings(other.id, { orchestrationEnabled: true });
  if (mode === 'automatic') core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: true });

  let decided = 0;
  const manager: ManagerPort = {
    async proposePlan(context) {
      shared.plans.push(context);
      return validatePlanFor(context, plan);
    },
    async decideNext(context): Promise<ManagerResult<ManagerDecision>> {
      shared.contexts.push(context);
      const scripted = decisions[decided];
      decided += 1;
      return scripted === undefined ? decideInOrder(context) : scripted(context);
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
      return { agentId: 'grok', ready: true };
    },
  } as unknown as Team;
  const chat: OrchestrationChat = {
    async chatAgents() {
      return { defaultAgentId: 'codex', agents: [agentOf('codex', 'Codex'), agentOf('grok', 'Grok'), agentOf('claude-code', 'Claude Code')] } as unknown as Awaited<ReturnType<OrchestrationChat['chatAgents']>>;
    },
    async createChatSession(workspaceId, options) {
      const session = core.entities.createSession({ workspaceId, kind: 'chat', ...(options?.agentId === undefined ? {} : { agentId: options.agentId }) });
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
  const orchestration = core.createOrchestration({ chat, manager, team, buildable: async () => buildable, builder: 'claude-code', ...(clockAhead === 0 ? {} : { clock: () => Date.now() + clockAhead }) });

  /** What `POST /builds` leaves when the person starts a build in the Build dialog: a build session and its running run. */
  const startBuild = (ticketRef: string, workspaceId: WorkspaceId = workspace.id as WorkspaceId) => {
    const session = core.entities.createSession({ workspaceId, kind: 'build', agentId: 'claude-code' });
    return core.entities.createRun({ sessionId: session.id, ticketRef });
  };
  const verification = (run: { id: RunId; sessionId: SessionId }, results: Array<'pass' | 'fail' | 'not_run'>) => {
    const checks = (['plan_built', 'tests_pass', 'code_changed'] as const).map((id, index) => ({ id, result: results[index]!, detail: null }));
    const value: VerificationResult = { outcome: results.every((result) => result === 'pass') ? 'verified' : 'failed', checks, testCommand: null, testOutputTail: null, attended: false, checkedAt: new Date().toISOString() };
    core.events.append({ type: 'run.verification_completed', workspaceId: workspace.id, streamId: run.sessionId, payload: { runId: run.id, verification: value } });
  };
  const finish = (sessionId: SessionId, reply: string) => {
    core.sessionEvents.completeMessage(sessionId, { messageId: `msg_reply_${Math.random().toString(36).slice(2)}`.padEnd(30, '0') as never, role: 'agent', content: reply });
    core.entities.setSessionState(sessionId, 'idle');
  };
  const sessionOf = (view: OrchestrationRunView, stepId: string): SessionId => view.steps.find((step) => step.stepId === stepId)!.sessionId!;
  const types = () => core.events.readAfter(0).map((event) => event.type);
  return { core, orchestration, workspaceId: workspace.id as WorkspaceId, otherWorkspaceId: other.id as WorkspaceId, shared, startBuild, verification, finish, sessionOf, types };
}
type Kit = ReturnType<typeof setUp>;

const start = (kit: Kit) => kit.orchestration.startRun(kit.workspaceId, { goal: 'Ship the login form' });

describe('a build step in a plan', () => {
  it('is stored as a proposal for the ticket, with no worker chat, and the manager was told which tickets are ready', async () => {
    const kit = setUp({ plan: planOf(work('s1'), build('b1', '1.1', { depends_on: ['s1'] })) });
    const view = await start(kit);
    expect(view.run.state).toBe('awaiting_user');
    const step = view.steps[1]!;
    expect(step).toMatchObject({ stepId: 'b1', state: 'proposed', approvedBy: null, sessionId: null, chat: 'new', worker: 'claude-code', instruction: 'It is ready and the tests exist.', build: { ticketRef: '1.1', runId: null } });
    expect(view.steps[0]!.build).toBeNull();
    expect(kit.shared.plans[0]!.buildable).toEqual([
      { ref: '1.1', title: 'Build the login form' },
      { ref: '1.2', title: 'Build the sign up form' },
    ]);
    // Nothing started: no chat, no message, no build run.
    expect(kit.shared.created).toHaveLength(0);
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(0);
    const planned = kit.core.events.readAfter(0).find((event) => event.type === 'orchestration.plan_proposed');
    expect(planned?.type === 'orchestration.plan_proposed' && planned.payload.plan.steps[1]).toMatchObject({ id: 'b1', build: { ticket: '1.1' } });
  });

  it('tells the manager the ready tickets as data and that only the user starts a build, and lists a build step in the plan so far', async () => {
    const kit = setUp({ buildable: [{ ref: '1.1', title: `Login form ${SECRET}` }] });
    await start(kit);
    const input = buildManagerInput('plan', kit.shared.plans[0]!, 100_000, 0);
    expect(input.ok && input.input.prompt).toContain('Tickets on the board that are ready to build');
    expect(input.ok && input.input.prompt).toContain('- 1.1: Login form');
    expect(input.ok && input.input.prompt).toContain('Only the user starts a build, in the Build dialog');
    expect(input.ok && input.input.prompt).not.toContain('sk-ant');
    const kit2 = setUp();
    const view = await start(kit2);
    await kit2.orchestration.skipStep(kit2.workspaceId, view.run.id, 'b1').catch(() => undefined);
    const decision = kit2.shared.contexts[0];
    expect(decision).toBeUndefined();
    const context = { ...kit2.shared.plans[0]!, plan: planOf(build('b1')) as never, stepStates: { b1: 'proposed' as const } } as ManagerDecisionContext;
    const later = buildManagerInput('decision', context, 100_000, 0);
    expect(later.ok && later.input.prompt).toContain('b1 (waiting) a build of ticket 1.1, started by the user in the Build dialog');
  });

  it('is told no tickets when none is ready, and a plan with a build is then refused', async () => {
    const kit = setUp({ buildable: [] });
    await expect(start(kit)).rejects.toMatchObject({ message: expect.stringContaining('not on the board or is not ready') });
    expect(kit.shared.plans[0]!.buildable).toBeUndefined();
  });

  it.each([
    ['a driver', build('b1', '1.1', { driver: 'claude-code' }), 'names only a ticket'],
    ['an agent', build('b1', '1.1', { agent: 'codex' }), 'names only a ticket'],
    ['a mode', { id: 'b1', build: { ticket: '1.1', mode: 'unattended' }, reason: 'Ready.', depends_on: [] }, 'names only a ticket'],
    ['a sandbox', build('b1', '1.1', { sandbox: 'none' }), 'names only a ticket'],
    ['a flag', build('b1', '1.1', { flags: ['--yolo'] }), 'names only a ticket'],
    ['a ticket that is not ready', build('b1', '9.9'), 'not on the board or is not ready'],
    ['the same ticket twice', undefined, 'same ticket to be built twice'],
  ])('refuses a plan whose build step names %s, with plain words, and stores no step', async (_name, step, words) => {
    const kit = setUp({ plan: step === undefined ? planOf(build('b1'), build('b2')) : planOf(step) });
    await expect(start(kit)).rejects.toMatchObject({ message: expect.stringContaining(words) });
    expect((await kit.orchestration.listRuns(kit.workspaceId))[0]!.steps).toHaveLength(0);
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(0);
  });
});

describe('no orchestration path starts a build', () => {
  it('refuses to approve, edit or send a build step, in the default mode, and starts nothing', async () => {
    const kit = setUp();
    const { run } = await start(kit);
    await expect(kit.orchestration.approveStep(kit.workspaceId, run.id, 'b1')).rejects.toMatchObject({ code: 'step_not_proposed' });
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, run.id, 'b1')).rejects.toMatchObject({ code: 'step_not_approved' });
    await expect(kit.orchestration.editStep(kit.workspaceId, run.id, 'b1', { instruction: 'Build it with the shell open.' })).rejects.toMatchObject({ code: 'step_not_changeable' });
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(0);
    expect(kit.shared.created).toHaveLength(0);
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).steps[0]).toMatchObject({ state: 'proposed', approvedBy: null });
  });

  it('refuses the same in Dispatch automatically, and the run waits for the person with a plain reason', async () => {
    const kit = setUp({ mode: 'automatic' });
    const view = await start(kit);
    await kit.orchestration.whenIdle();
    const again = await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    expect(again.run).toMatchObject({ state: 'awaiting_user', mode: 'automatic', stopReason: null });
    expect(again.waiting).toEqual({ kind: 'build', stepId: 'b1', ticketRef: '1.1' });
    expect(again.steps[0]).toMatchObject({ state: 'proposed', approvedBy: null, buildRun: null });
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, view.run.id, 'b1')).rejects.toMatchObject({ code: 'step_not_approved' });
    await expect(kit.orchestration.approveStep(kit.workspaceId, view.run.id, 'b1')).rejects.toMatchObject({ code: 'step_not_proposed' });
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(0);
    expect(kit.shared.created).toHaveLength(0);
    const paused = kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.run_paused');
    expect(paused).toHaveLength(1);
    expect(kit.types()).not.toContain('orchestration.step_dispatched');
    expect(kit.types()).not.toContain('orchestration.step_approved');
  });

  it('lets an automatic run send the work before a build and then wait at the build, still starting nothing', async () => {
    const kit = setUp({ mode: 'automatic', plan: planOf(work('s1'), build('b1', '1.1', { depends_on: ['s1'] })) });
    const view = await start(kit);
    await kit.orchestration.whenIdle();
    const sent = await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    expect(sent.steps[0]).toMatchObject({ state: 'dispatched', approvedBy: 'mode' });
    kit.finish(kit.sessionOf(sent, 's1'), 'Wrote the tests.');
    await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    await kit.orchestration.whenIdle();
    const after = await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    expect(after.steps[1]).toMatchObject({ state: 'proposed', approvedBy: null });
    expect(after.waiting).toEqual({ kind: 'build', stepId: 'b1', ticketRef: '1.1' });
    expect(after.run.state).toBe('awaiting_user');
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(0);
    expect(kit.shared.created).toHaveLength(1);
  });

  it('keeps a build the manager suggests as a suggestion: the manager chose it and an automatic run still waits', async () => {
    const choose = (stepId: string) => (): ManagerResult<ManagerDecision> => ({ ok: true, value: { version: 'ogden.manager.decision.v1', action: 'dispatch', reason: 'Build it.', step_id: stepId } });
    const kit = setUp({ mode: 'automatic', plan: planOf(work('s1'), build('b1')), decisions: [choose('b1')] });
    const view = await start(kit);
    await kit.orchestration.whenIdle();
    const sent = await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    kit.finish(kit.sessionOf(sent, 's1'), 'Done.');
    await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    await kit.orchestration.whenIdle();
    const after = await kit.orchestration.getRun(kit.workspaceId, view.run.id);
    expect(after.decision).toMatchObject({ action: 'dispatch', stepId: 'b1' });
    expect(after.waiting).toEqual({ kind: 'build', stepId: 'b1', ticketRef: '1.1' });
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(0);
  });

  it('lets the person skip a build step, and the run is then finished', async () => {
    const kit = setUp();
    const { run } = await start(kit);
    const skipped = await kit.orchestration.skipStep(kit.workspaceId, run.id, 'b1');
    expect(skipped.steps[0]!.state).toBe('skipped');
    expect(skipped.run.state).toBe('finished');
  });
});

describe('telling the plan which build the person started', () => {
  it('links the run the Build dialog started: the step is sent as the person, follows the run, and the plan says so', async () => {
    const kit = setUp();
    const { run } = await start(kit);
    const built = kit.startBuild('1.1');
    const linked = await kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: built.id });
    expect(linked.steps[0]).toMatchObject({ state: 'dispatched', approvedBy: 'user', sessionId: null, build: { ticketRef: '1.1', runId: built.id }, buildRun: { runId: built.id, outcome: 'running', decision: null } });
    expect(linked.run.state).toBe('running');
    expect(linked.steps[0]!.report).toMatchObject({ state: 'working' });
    const events = kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.build_linked');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ payload: { runId: run.id, stepId: 'b1', ticketRef: '1.1', buildRunId: built.id } });
    // Only the one run, the person's: linking made no chat, no message and no second build.
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(1);
    expect(kit.shared.created).toHaveLength(0);
    expect(kit.types()).not.toContain('orchestration.step_dispatched');
  });

  it.each(['another ticket', 'another project', 'a build from before the plan', 'a run that does not exist', 'a malformed run id'])('refuses %s, and nothing changes', async (what) => {
    const kit = setUp(what === 'a build from before the plan' ? { clockAhead: 60_000 } : {});
    const { run } = await start(kit);
    const request =
      what === 'another ticket'
        ? { runId: kit.startBuild('1.2').id }
        : what === 'another project'
          ? { runId: kit.startBuild('1.1', kit.otherWorkspaceId).id }
          : what === 'a build from before the plan'
            ? { runId: kit.startBuild('1.1').id }
            : what === 'a run that does not exist'
              ? { runId: 'run_01J00000000000000000000000' }
              : { runId: 'nope' };
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', request)).rejects.toMatchObject({ name: 'ValidationError', message: expect.stringContaining('not a build of this ticket') });
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[0]).toMatchObject({ state: 'proposed', build: { runId: null } });
    expect(kit.types()).not.toContain('orchestration.build_linked');
  });

  it('refuses a run another step already follows, a step that is not a build, a step already linked, and an ended run', async () => {
    const kit = setUp({ plan: planOf(work('s1'), build('b1', '1.1'), build('b2', '1.2')) });
    const { run } = await start(kit);
    const first = kit.startBuild('1.1');
    await kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: first.id });
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: first.id })).rejects.toMatchObject({ code: 'step_not_proposed' });
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 's1', { runId: kit.startBuild('1.1').id })).rejects.toMatchObject({ code: 'step_not_proposed' });
    // The same run for the other step (its ticket differs, and it is taken).
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b2', { runId: first.id })).rejects.toMatchObject({ name: 'ValidationError' });
    await kit.orchestration.stopRun(kit.workspaceId, run.id);
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b2', { runId: kit.startBuild('1.2').id })).rejects.toMatchObject({ code: 'run_not_open' });
  });

  it('refuses a build whose prerequisite step is not done, and another project\'s plan', async () => {
    const kit = setUp({ plan: planOf(work('s1'), build('b1', '1.1', { depends_on: ['s1'] })) });
    const { run } = await start(kit);
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: kit.startBuild('1.1').id })).rejects.toMatchObject({ code: 'step_not_proposed' });
    await expect(kit.orchestration.linkBuild(kit.otherWorkspaceId, run.id, 'b1', { runId: kit.startBuild('1.1').id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('is refused with the piece off', async () => {
    const kit = setUp();
    const { run } = await start(kit);
    kit.core.permissions.updateSettings(kit.workspaceId, { orchestrationEnabled: false });
    await expect(kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: kit.startBuild('1.1').id })).rejects.toMatchObject({ name: 'OrchestrationOffError' });
  });
});

describe('a build step follows its build run', () => {
  async function linked(kit: Kit) {
    const { run } = await start(kit);
    const built = kit.startBuild('1.1');
    await kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: built.id });
    return { run, built };
  }

  it('is running while the build runs, and built when it is verified: the manager reads the outcome and the check counts, never a diff', async () => {
    const kit = setUp({ plan: planOf(build('b1'), work('s2', { depends_on: ['b1'] })) });
    const { run, built } = await linked(kit);
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).steps[0]).toMatchObject({ state: 'dispatched' });
    kit.verification(built, ['pass', 'pass', 'pass']);
    kit.core.entities.setRunOutcome(built.id, 'verified');
    await kit.orchestration.whenIdle();
    const done = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(done.steps[0]).toMatchObject({ state: 'done', buildRun: { outcome: 'verified', decision: null, checks: { passed: 3, failed: 0, notRun: 0 } } });
    expect(done.steps[0]!.report).toMatchObject({ state: 'done', worker: 'claude-code' });
    expect(done.steps[0]!.report!.summary).toContain('ended built and verified');
    expect(done.steps[0]!.report!.summary).toContain('3 passed, 0 failed, 0 not run');
    expect(done.steps[0]!.report!.summary).not.toMatch(NO_DASH);
    // The run read the result once and asked the manager what comes next, with that summary.
    const reads = kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.result_read');
    expect(reads).toHaveLength(1);
    expect(kit.shared.contexts.at(-1)!.lastReport).toMatchObject({ step_id: 'b1', state: 'done' });
    expect(done.run.state).toBe('awaiting_user');
    expect(done.decision).toMatchObject({ action: 'dispatch', stepId: 's2' });
    // Reading again changes nothing.
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.result_read')).toHaveLength(1);
  });

  it('settles from the run\'s own change, with nobody reading the page', async () => {
    const kit = setUp();
    const { run, built } = await linked(kit);
    kit.core.entities.setRunOutcome(built.id, 'verified');
    await kit.orchestration.whenIdle();
    await kit.orchestration.whenIdle();
    expect(kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.result_read')).toHaveLength(1);
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).run.state).toBe('finished');
  });

  it('is failed when the build failed, with the reason masked and capped, and the run stops as a worker error does', async () => {
    const kit = setUp();
    const { run, built } = await linked(kit);
    kit.verification(built, ['pass', 'fail', 'pass']);
    kit.core.entities.setRunOutcome(built.id, 'failed', `3 tests failed when re-run. ${SECRET} ${'x'.repeat(2000)}`);
    await kit.orchestration.whenIdle();
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[0]).toMatchObject({ state: 'failed', buildRun: { outcome: 'failed', checks: { passed: 2, failed: 1, notRun: 0 } } });
    expect(view.steps[0]!.report).toMatchObject({ state: 'error' });
    expect(view.steps[0]!.report!.summary).toContain('3 tests failed');
    expect(view.steps[0]!.report!.summary).not.toContain('sk-ant');
    expect(view.steps[0]!.report!.summary.length).toBeLessThan(1_300);
    expect(view.run).toMatchObject({ state: 'failed', stopReason: 'worker_error' });
  });

  it.each([
    ['stopped', 'failed'],
    ['blocked', 'failed'],
  ] as const)('is failed when the build is %s', async (outcome, state) => {
    const kit = setUp();
    const { run, built } = await linked(kit);
    kit.core.entities.setRunOutcome(built.id, outcome, 'It stopped.', outcome === 'blocked' ? { blockedCode: 'time_limit' } : {});
    await kit.orchestration.whenIdle();
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).steps[0]!.state).toBe(state);
  });

  it('keeps waiting while the build is paused at the ticket\'s own checkpoint, which only the person continues', async () => {
    const kit = setUp();
    const { run, built } = await linked(kit);
    kit.core.entities.setRunOutcome(built.id, 'blocked', 'Waiting for you.', { blockedCode: 'checkpoint_plan' });
    await kit.orchestration.whenIdle();
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[0]!.state).toBe('dispatched');
    expect(view.run.state).toBe('running');
  });

  it('shows the person\'s decision on the review page once made, and never decides anything itself', async () => {
    const kit = setUp({ plan: planOf(build('b1'), work('s2', { depends_on: ['b1'] })) });
    const { run } = await start(kit);
    const built = kit.startBuild('1.1');
    await kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: built.id });
    kit.verification(built, ['pass', 'pass', 'pass']);
    kit.core.entities.setRunOutcome(built.id, 'verified');
    await kit.orchestration.whenIdle();
    expect(kit.core.entities.getRun(built.id)!.decision).toBeNull();
    kit.core.entities.setRunDecision(built.id, 'approved');
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[0]!.buildRun).toMatchObject({ outcome: 'verified', decision: 'approved' });
    // The orchestration appended no decision, merge or ticket change of its own: the only one is the person's.
    expect(kit.types().filter((type) => type === 'run.decided')).toHaveLength(1);
    expect(kit.types()).not.toContain('ticket.changed');
  });

  it('survives a restart: a build linked before it is read from the run, and the step is not linked again', async () => {
    const kit = setUp();
    const { run, built } = await linked(kit);
    kit.core.entities.setRunOutcome(built.id, 'verified');
    expect(await kit.orchestration.resume()).toBe(1);
    await kit.orchestration.whenIdle();
    const view = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(view.steps[0]).toMatchObject({ state: 'done', build: { runId: built.id } });
    expect(kit.core.events.readAfter(0).filter((event) => event.type === 'orchestration.build_linked')).toHaveLength(1);
  });

  it('is not stopped with the run: Stop ends the plan and leaves the person\'s build as it is', async () => {
    const kit = setUp();
    const { run, built } = await linked(kit);
    await kit.orchestration.stopRun(kit.workspaceId, run.id);
    expect(kit.core.entities.getRun(built.id)!.outcome).toBe('running');
  });
});

describe('a review of a build step', () => {
  const reviewPlan = planOf(build('b1'), work('r1', { worker: 'grok', depends_on: ['b1'], review_of: 'b1', instruction: 'Is the build safe to merge?' }));

  async function builtAndReviewed(kit: Kit, reason?: string) {
    const { run } = await start(kit);
    const built = kit.startBuild('1.1');
    await kit.orchestration.linkBuild(kit.workspaceId, run.id, 'b1', { runId: built.id });
    kit.verification(built, ['pass', 'pass', 'pass']);
    kit.core.entities.setRunOutcome(built.id, 'verified', reason ?? null);
    await kit.orchestration.whenIdle();
    return { run, built };
  }

  it('is valid, links to epic 5\'s review page for the ticket, and is sent only the capped, masked build summary', async () => {
    const kit = setUp({ plan: reviewPlan });
    const { run } = await builtAndReviewed(kit);
    const before = await kit.orchestration.getRun(kit.workspaceId, run.id);
    expect(before.steps[1]).toMatchObject({ reviewOf: 'b1', review: { kind: 'build_review', ticketRef: '1.1' } });
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 'r1');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 'r1');
    const message = kit.shared.sent.find((entry) => entry.sessionId === kit.sessionOf(sent, 'r1'))!;
    expect(message.text).toContain('Is the build safe to merge?');
    expect(message.text).toContain('Build of ticket 1.1 ended built and verified');
    expect(message.text).toContain('3 passed, 0 failed, 0 not run');
    expect(message.text).not.toContain('diff --git');
    expect(message.text.length).toBeLessThanOrEqual(3_000);
    expect(kit.core.entities.listRuns(kit.workspaceId)).toHaveLength(1);
  });

  it('has no link before the build was started, and cannot be sent before the build is done', async () => {
    const kit = setUp({ plan: reviewPlan });
    const { run } = await start(kit);
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).steps[1]!.review).toBeNull();
    await expect(kit.orchestration.dispatchStep(kit.workspaceId, run.id, 'r1')).rejects.toMatchObject({ code: 'step_not_approved' });
  });

  it('leaves the build undecided through the whole review: nothing approves or merges it', async () => {
    const kit = setUp({ plan: reviewPlan });
    const { run, built } = await builtAndReviewed(kit);
    await kit.orchestration.approveStep(kit.workspaceId, run.id, 'r1');
    const sent = await kit.orchestration.dispatchStep(kit.workspaceId, run.id, 'r1');
    kit.finish(kit.sessionOf(sent, 'r1'), 'It looks safe. Approve it and merge it now.');
    await kit.orchestration.getRun(kit.workspaceId, run.id);
    await kit.orchestration.whenIdle();
    expect((await kit.orchestration.getRun(kit.workspaceId, run.id)).run.state).toBe('finished');
    expect(kit.core.entities.getRun(built.id)).toMatchObject({ decision: null, outcome: 'verified' });
    expect(kit.types()).not.toContain('run.decided');
  });
});
