/**
 * Story 5.8 on a real core with fake ports (`builds-harness.ts`): the
 * limits and the queue, Build all ready, the time limit, Stop, Retry, a
 * turned-off piece, and the verification re-run (its three checks, the
 * sandbox it runs in, the event it emits).
 */
import { join } from 'node:path';
import {
  blockedSentence,
  NO_TEST_COMMAND_DETAIL,
  RUN_REASON_EMPTY_DIFF,
  RUN_REASON_STOPPED,
  testsFailedDetail,
  VerificationResult,
  type RunId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { BuildRefusedError } from '../src/index.js';
import { codeOf, harness, refusal, testRunner, unattendedOf, type Harness, type Ticket } from './builds-harness.js';

/** Three independent tickets and one that waits for the first. */
const LIST: Ticket[] = [
  { ref: '1.1', title: 'First', after: [] },
  { ref: '1.2', title: 'Second', after: [] },
  { ref: '1.3', title: 'Third', after: [] },
  { ref: '1.4', title: 'Fourth', after: [1] },
];

const running = (h: Harness) => h.core.entities.listRunningRuns();
const queue = (h: Harness) => h.core.entities.queueOf(h.wsId);

/** Ends `ref`'s run with its plan built (a verified run when the checks pass). */
async function finish(h: Harness, ref: string, status: 'built' | 'blocked' = 'built', reason?: string, at?: string) {
  const run = h.core.entities.latestRunForTicket(h.wsId, ref)!;
  h.tickets.set(run.worktreePath!, ref, status, reason, at);
  await h.endTurn(run.sessionId);
  return h.core.entities.getRun(run.id)!;
}

describe('limits and the queue (story 5.8)', () => {
  it('starts under the limits with a deadline and its time limit armed; over the project limit a run waits, with no worktree yet', async () => {
    const h = await harness({ ticketList: LIST });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(first.run.deadline).not.toBeNull();
    expect(h.timers.armed).toHaveLength(1);
    expect(h.timers.armed[0]!.ms).toBeGreaterThan(44 * 60_000);
    await h.builds.start(h.wsId, { ref: '1.2' });
    // The project's limit is 2: the third waits.
    const third = await h.builds.start(h.wsId, { ref: '1.3' });
    expect(third.run).toMatchObject({ outcome: 'running', queuePosition: 1, worktreePath: null, branch: null });
    expect(queue(h)).toEqual([{ runId: third.run.id, ticketRef: '1.3', position: 1 }]);
    expect(h.git.calls.filter((call) => call.startsWith('worktree add'))).toHaveLength(2);
    expect(h.sent).toHaveLength(2);
    // Its ticket counts as being built.
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.3' }))).toBe('run_active');
    const types = h.core.events.readAfter(0).map((event) => event.type);
    expect(types.filter((type) => type === 'run.queue_changed')).toHaveLength(1);
  });

  it('a run that ends starts the next queued one: its worktree, its prompt, run.dispatched, the queue emptied', async () => {
    const h = await harness({ ticketList: LIST });
    await h.builds.start(h.wsId, { ref: '1.1' });
    await h.builds.start(h.wsId, { ref: '1.2' });
    const third = await h.builds.start(h.wsId, { ref: '1.3' });
    expect((await finish(h, '1.1')).outcome).toBe('verified');
    await h.builds.settled();
    const started = h.core.entities.getRun(third.run.id)!;
    expect(started).toMatchObject({ outcome: 'running', queuePosition: null });
    expect(started.worktreePath).not.toBeNull();
    expect(started.branch).toMatch(/^ogden\/[a-z2-7]{8}\/1\.3-third$/);
    expect(h.sent.at(-1)).toMatchObject({ sessionId: third.session.id });
    expect(queue(h)).toEqual([]);
    expect(running(h)).toHaveLength(2);
    const types = h.core.events.readAfter(0).map((event) => event.type);
    expect(types).toContain('run.dispatched');
    expect(types.filter((type) => type === 'run.queue_changed')).toHaveLength(2);
    // The deadline counts from the dispatch.
    expect(started.deadline).not.toBeNull();
  });

  it("the install's limit holds across projects, and a changed limit applies to the next dispatch", async () => {
    const h = await harness({ ticketList: LIST });
    h.core.buildSettings.setRunLimits({ maxConcurrentRunsPerInstall: 1 });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    const second = await h.builds.start(h.wsId, { ref: '1.2' });
    expect(second.run.queuePosition).toBe(1);
    // Raised: it applies at the next dispatch (a settings change asks for one).
    h.core.buildSettings.setRunLimits({ maxConcurrentRunsPerInstall: 3 });
    await h.builds.dispatchQueued();
    expect(h.core.entities.getRun(second.run.id)).toMatchObject({ queuePosition: null, outcome: 'running' });
    expect(running(h).map((run) => run.id).sort()).toEqual([first.run.id, second.run.id].sort());
    // Lowered below what runs: nothing is stopped, and nothing more starts.
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    const third = await h.builds.start(h.wsId, { ref: '1.3' });
    expect(third.run.queuePosition).toBe(1);
    expect(running(h)).toHaveLength(2);
    expect(await refusal(Promise.resolve().then(() => h.core.buildSettings.setRunLimits({ maxConcurrentRunsPerInstall: 0 })))).toMatchObject({ name: 'ValidationError' });
  });

  it('Build all ready runs two of three ready tickets and queues one, never a ticket with an unmet prerequisite, and starts the rest as slots free', async () => {
    const h = await harness({ ticketList: LIST });
    const all = await h.builds.startAll(h.wsId, { all: true });
    expect(all.runs.map((run) => run.ticketRef)).toEqual(['1.1', '1.2', '1.3']);
    expect(all.queue).toEqual([{ runId: all.runs[2]!.id, ticketRef: '1.3', position: 1 }]);
    expect(running(h).map((run) => run.ticketRef)).toEqual(['1.1', '1.2']);
    expect(h.core.entities.latestRunForTicket(h.wsId, '1.4')).toBeUndefined();
    await finish(h, '1.1');
    // A prerequisite counts only as the main checkout has it (merged), never on the agent's own word in a worktree.
    await h.builds.dispatchQueued();
    expect(h.core.entities.latestRunForTicket(h.wsId, '1.4')).toBeUndefined();
    h.tickets.set(h.repo, '1.1', 'built');
    await h.builds.dispatchQueued();
    await h.builds.settled();
    expect(h.core.entities.latestRunForTicket(h.wsId, '1.4')).toBeDefined();
    expect(h.core.entities.latestRunForTicket(h.wsId, '1.3')).toMatchObject({ queuePosition: null });
    // Nothing is tried twice: a failed ticket does not start again.
    const failed = await finish(h, '1.2', 'blocked', 'unclear intent');
    expect(failed.outcome).toBe('blocked');
    await h.builds.settled();
    expect(h.core.entities.listRunningRuns().filter((run) => run.ticketRef === '1.2')).toHaveLength(0);
  });

  it('turning builds off lets running runs finish and dispatches nothing more; turning it on again does', async () => {
    const h = await harness({ ticketList: LIST });
    await h.builds.start(h.wsId, { ref: '1.1' });
    await h.builds.start(h.wsId, { ref: '1.2' });
    const third = await h.builds.start(h.wsId, { ref: '1.3' });
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: [] });
    expect((await finish(h, '1.1')).outcome).toBe('verified');
    await h.builds.settled();
    expect(h.core.entities.getRun(third.run.id)).toMatchObject({ queuePosition: 1, worktreePath: null });
    expect(await refusal(h.builds.start(h.wsId, { ref: '1.3' }))).toMatchObject({ name: 'FeatureOffError' });
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: ['board', 'builds'] });
    await h.builds.dispatchQueued();
    expect(h.core.entities.getRun(third.run.id)).toMatchObject({ queuePosition: null });
  });

  it('a queued run whose ticket stopped being ready fails with its plain reason, and the queue goes on', async () => {
    const h = await harness({ ticketList: LIST });
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    await h.builds.start(h.wsId, { ref: '1.1' });
    const waiting = await h.builds.start(h.wsId, { ref: '1.2' });
    const next = await h.builds.start(h.wsId, { ref: '1.3' });
    h.tickets.set(h.repo, '1.2', 'draft');
    await finish(h, '1.1');
    await h.builds.settled();
    expect(h.core.entities.getRun(waiting.run.id)).toMatchObject({ outcome: 'failed', queuePosition: null });
    expect(h.core.entities.getRun(next.run.id)).toMatchObject({ outcome: 'running', queuePosition: null });
  });
});

describe('the time limit, Stop and Retry (story 5.8)', () => {
  it('a run past its time limit is stopped and blocked, its worktree kept, and Retry resumes it', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.timers.fire();
    await h.builds.settled();
    await new Promise((done) => setTimeout(done, 20));
    const blocked = h.core.entities.getRun(run.id)!;
    expect(blocked).toMatchObject({ outcome: 'blocked', blockedCode: 'time_limit', reason: blockedSentence('time_limit', { minutes: 45 }) });
    expect(h.released).toContain(session.id);
    expect(blocked.worktreePath).not.toBeNull();
    const again = await h.builds.retry(h.wsId, run.id, {});
    expect(again).toMatchObject({ outcome: 'running', blockedCode: null });
    expect(h.sent.at(-1)!.text).toContain('1.1');
  });

  it('a turn that ended first has no time limit to hit', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(h.timers.armed.every((timer) => timer.cancelled)).toBe(true);
    h.timers.fire();
    expect(h.core.entities.getRun(run.id)?.outcome).toBe('verified');
  });

  it('Stop stops a running run (agent released, worktree kept) and takes a queued one out of the queue; Reject then discards', async () => {
    const h = await harness({ ticketList: LIST });
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    const waiting = await h.builds.start(h.wsId, { ref: '1.2' });
    const queued = await h.builds.stop(h.wsId, waiting.run.id);
    expect(queued).toMatchObject({ outcome: 'stopped', queuePosition: null, reason: RUN_REASON_STOPPED });
    expect(queue(h)).toEqual([]);
    const stopped = await h.builds.stop(h.wsId, first.run.id);
    expect(stopped).toMatchObject({ outcome: 'stopped', reason: RUN_REASON_STOPPED });
    expect(h.released).toContain(first.session.id);
    expect(h.core.buildSessions.get(first.session.id)).toBeUndefined();
    expect(h.timers.armed.every((timer) => timer.cancelled)).toBe(true);
    expect(await codeOf(h.builds.stop(h.wsId, first.run.id))).toBe('run_not_active');
    // A stopped run's worktree is still there to Retry or Reject.
    expect(h.git.state.worktrees.size).toBe(1);
    await h.builds.reject(h.wsId, '1.1');
    expect(h.git.calls.some((call) => call.startsWith('worktree remove'))).toBe(true);
  });

  it("Stop frees the slot: the next queued run starts", async () => {
    const h = await harness({ ticketList: LIST });
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    const waiting = await h.builds.start(h.wsId, { ref: '1.2' });
    await h.builds.stop(h.wsId, first.run.id);
    await h.builds.settled();
    expect(h.core.entities.getRun(waiting.run.id)).toMatchObject({ queuePosition: null, outcome: 'running' });
  });

  it("Retry of a blocked plan marks its resume status (blocked_at) in the run's ticket, then runs it again in the same worktree and session", async () => {
    const h = await harness({ runner: { ...testRunner, invocation: (ref, options) => `/build ${ref}${options?.note === undefined ? '' : ` ${options.note}`}` } });
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(h.repo, '1.1', 'blocked', 'implementation verification failed', 'in-progress');
    const blocked = await finish(h, '1.1', 'blocked', 'implementation verification failed', 'in-progress');
    expect(blocked).toMatchObject({ outcome: 'blocked', reason: expect.stringContaining('implementation verification failed') });
    const sentBefore = h.sent.length;
    const retried = await h.builds.retry(h.wsId, run.id, { note: 'Try the other way.' });
    expect(h.tickets.calls).toContainEqual(['mark', h.repo, '1.1', 'in-progress', false]);
    expect(retried).toMatchObject({ id: run.id, outcome: 'running', blockedCode: null, reason: null, worktreePath: run.worktreePath, sessionId: session.id });
    expect(h.sent).toHaveLength(sentBefore + 1);
    expect(h.sent.at(-1)!.text).toContain('Try the other way.');
    expect(h.timers.armed.filter((timer) => !timer.cancelled)).toHaveLength(1);
    // A blocked plan with no blocked_at resumes as ready for dev.
    const other = await harness();
    const second = await other.builds.start(other.wsId, { ref: '1.1' });
    other.tickets.set(other.repo, '1.1', 'blocked', 'unclear intent');
    await finish(other, '1.1', 'blocked', 'unclear intent');
    await other.builds.retry(other.wsId, second.run.id, {});
    expect(other.tickets.calls).toContainEqual(['mark', other.repo, '1.1', 'ready-for-dev', false]);
  });

  it('Retry of a failed or stopped run resumes from its own status without a mark; one over the limit waits in the queue; a run not retryable is refused', async () => {
    const h = await harness({ ticketList: LIST });
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    const first = await h.builds.start(h.wsId, { ref: '1.1' });
    const stopped = await h.builds.stop(h.wsId, first.run.id);
    const second = await h.builds.start(h.wsId, { ref: '1.2' });
    expect(second.run.queuePosition).toBeNull();
    expect(((await refusal(h.builds.retry(h.wsId, stopped.id, { mode: 'apply_fix' }))) as Error).name).toBe('NotImplementedError');
    const retried = await h.builds.retry(h.wsId, stopped.id, {});
    expect(retried).toMatchObject({ outcome: 'running', queuePosition: 1, worktreePath: stopped.worktreePath });
    expect(h.tickets.calls.filter((call) => call[0] === 'mark')).toEqual([]);
    // The slot frees: the retried run starts again in its own worktree.
    await finish(h, '1.2');
    await h.builds.settled();
    expect(h.core.entities.getRun(stopped.id)).toMatchObject({ outcome: 'running', queuePosition: null, worktreePath: stopped.worktreePath });
    expect(await codeOf(h.builds.retry(h.wsId, stopped.id, {}))).toBe('run_not_active');
    expect(await codeOf(h.builds.retry(h.wsId, second.run.id, {}))).toBe('run_not_active');
  });

  it('Retry needs a sandbox (fail closed) and the run\'s worktree', async () => {
    const h = await harness();
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    const stopped = await h.builds.stop(h.wsId, run.id);
    h.sandbox.available = false;
    expect(await codeOf(h.builds.retry(h.wsId, stopped.id, {}))).toBe('sandbox_unavailable');
    h.sandbox.available = true;
    h.git.state.worktrees.clear();
    expect(await codeOf(h.builds.retry(h.wsId, stopped.id, {}))).toBe('run_not_active');
    expect(h.core.entities.getRun(stopped.id)?.outcome).toBe('stopped');
  });

  it('a refused prompt puts a retried run back as it was', async () => {
    const h = await harness();
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    const stopped = await h.builds.stop(h.wsId, run.id);
    h.sendFails.value = true;
    expect(((await refusal(h.builds.retry(h.wsId, stopped.id, {}))) as Error).message).toBe('the chat refused it');
    expect(h.core.entities.getRun(stopped.id)).toMatchObject({ outcome: 'stopped', reason: RUN_REASON_STOPPED });
  });
});

describe('verification: the plan, the tests re-run in the sandbox, the diff (story 5.8)', () => {
  const verificationOf = (h: Harness, runId: RunId) => {
    const run = h.core.entities.getRun(runId)!;
    const event = h.core.entities.listSessionEvents(run.sessionId, ['run.verification_completed']).at(-1);
    return event?.type === 'run.verification_completed' ? VerificationResult.parse(event.payload.verification) : undefined;
  };

  it('all three pass: the run is verified, the tests ran in the run\'s sandbox in its worktree with no key, and run.verification_completed says so', async () => {
    const h = await harness();
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    const ended = await finish(h, '1.1');
    expect(ended).toMatchObject({ outcome: 'verified', reason: null });
    expect(h.rerun.runs).toHaveLength(1);
    const asked = h.rerun.runs[0]!;
    expect(asked).toMatchObject({ command: 'run-tests', cwd: run.worktreePath, timeoutMs: 600000 });
    expect(asked.sandbox.kind).toBe('test');
    expect(asked.sandbox.writableRoots).toContain(run.worktreePath);
    expect(asked.env).toMatchObject({ PATH: '/bin' });
    expect(Object.keys(asked.env).some((name) => /KEY|TOKEN|SECRET/i.test(name))).toBe(false);
    expect(verificationOf(h, run.id)).toMatchObject({ outcome: 'verified', attended: false, testCommand: 'run-tests', checks: [{ id: 'plan_built', result: 'pass' }, { id: 'tests_pass', result: 'pass' }, { id: 'code_changed', result: 'pass' }] });
  });

  it('a run that marks its plan built but whose tests fail when re-run ends failed with the count, and cannot be approved', async () => {
    const h = await harness();
    h.rerun.result = { exitCode: 1, timedOut: false, output: 'Tests: 3 failed, 2 passed, 5 total\n' };
    const { run } = await h.builds.start(h.wsId, { ref: '1.1' });
    const ended = await finish(h, '1.1');
    expect(ended).toMatchObject({ outcome: 'failed', reason: testsFailedDetail(3) });
    expect(verificationOf(h, run.id)).toMatchObject({ outcome: 'failed', testOutputTail: 'Tests: 3 failed, 2 passed, 5 total\n' });
    expect(await codeOf(h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) }))).toBe('checks_failed');
  });

  it('no test command, a timeout, a sandbox that cannot run it, an empty diff and a plan not built each fail their own check', async () => {
    const none = await harness();
    none.core.buildSettings.setWorkspaceSettings(none.wsId, { testCommand: null });
    const a = await none.builds.start(none.wsId, { ref: '1.1' });
    expect(await finish(none, '1.1')).toMatchObject({ outcome: 'failed', reason: NO_TEST_COMMAND_DETAIL });
    expect(none.rerun.runs).toEqual([]);
    expect(verificationOf(none, a.run.id)?.checks[1]).toMatchObject({ id: 'tests_pass', result: 'fail' });

    const slow = await harness();
    slow.rerun.result = { exitCode: null, timedOut: true, output: '' };
    await slow.builds.start(slow.wsId, { ref: '1.1' });
    expect((await finish(slow, '1.1')).reason).toBe('The tests took too long when re-run');

    const cannot = await harness();
    cannot.rerun.result = undefined;
    await cannot.builds.start(cannot.wsId, { ref: '1.1' });
    expect((await finish(cannot, '1.1')).reason).toContain("couldn't be re-run");

    const empty = await harness();
    empty.git.state.files = [];
    const e = await empty.builds.start(empty.wsId, { ref: '1.1' });
    expect(await finish(empty, '1.1')).toMatchObject({ outcome: 'failed', reason: RUN_REASON_EMPTY_DIFF });
    // Nothing to run the tests on: the check says not run, and the agent's code never ran.
    expect(empty.rerun.runs).toEqual([]);
    expect(verificationOf(empty, e.run.id)?.checks.map((check) => check.result)).toEqual(['pass', 'not_run', 'fail']);

    const notBuilt = await harness();
    const n = await notBuilt.builds.start(notBuilt.wsId, { ref: '1.1' });
    const ended = await finish(notBuilt, '1.1', 'built');
    expect(ended.outcome).toBe('verified');
    expect(verificationOf(notBuilt, n.run.id)?.checks[0]).toMatchObject({ id: 'plan_built', result: 'pass' });
  });

  it('a build the user watched has no sandbox: its tests are not re-run, and it can still be verified', async () => {
    const h = await harness();
    h.sandbox.available = false;
    const { run } = await h.builds.start(h.wsId, { ref: '1.1', mode: 'attended' });
    const ended = await finish(h, '1.1');
    expect(ended.outcome).toBe('verified');
    expect(h.rerun.runs).toEqual([]);
    expect(verificationOf(h, run.id)).toMatchObject({ attended: true, outcome: 'verified', checks: [{ result: 'pass' }, { id: 'tests_pass', result: 'not_run' }, { result: 'pass' }] });
  });

  it('a sandboxed run whose setup is gone never has its tests run unsandboxed', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    unattendedOf(h.core.buildSessions.get(session.id));
    h.core.buildSessions.delete(session.id);
    const ended = await finish(h, '1.1');
    expect(ended.outcome).toBe('failed');
    expect(h.rerun.runs).toEqual([]);
    expect(verificationOf(h, run.id)?.checks[1]).toMatchObject({ result: 'fail' });
    void join;
  });
});

describe('build settings (story 5.8)', () => {
  it('limits default to 2, 3 and 45, change within bounds only, append their events, and keep a project\'s test command', async () => {
    const h = await harness();
    // The harness sets a test command for the project; its limit is still the default.
    expect(h.core.buildSettings.runLimits()).toEqual({ maxConcurrentRunsPerInstall: 3, maxRunMinutes: 45 });
    expect(h.core.buildSettings.workspaceSettings(h.wsId)).toEqual({ maxConcurrentRuns: 2, testCommand: 'run-tests' });
    expect(h.core.buildSettings.setRunLimits({ maxRunMinutes: 60 })).toEqual({ maxConcurrentRunsPerInstall: 3, maxRunMinutes: 60 });
    expect(h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 4 })).toEqual({ maxConcurrentRuns: 4, testCommand: 'run-tests' });
    const types = h.core.events.readAfter(0).map((event) => event.type);
    expect(types).toContain('settings.run_limits_changed');
    expect(types.filter((type) => type === 'workspace.build_settings_changed')).toHaveLength(2);
    // The same value again appends nothing.
    const before = h.core.events.lastSeq();
    h.core.buildSettings.setRunLimits({ maxRunMinutes: 60 });
    expect(h.core.events.lastSeq()).toBe(before);
    for (const bad of [{ maxRunMinutes: 4 }, { maxRunMinutes: 481 }, { maxConcurrentRunsPerInstall: 21 }, {}, { other: 1 }]) {
      expect(() => h.core.buildSettings.setRunLimits(bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => h.core.buildSettings.setWorkspaceSettings(h.wsId, { testCommand: 'a\nb' })).toThrow();
    expect(() => h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 11 })).toThrow();
  });
});

void BuildRefusedError;
