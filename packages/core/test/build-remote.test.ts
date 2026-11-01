/**
 * Unattended builds on a single remote machine, with `connection_lost`
 * handling (CAP-24, epic 19 story 19.6): the story's own I/O matrix, on a
 * real core with fake ports (`builds-harness.ts`) and a fake remote-build
 * capability (a fake `RemoteWorktreeSync` + a fake `connect`), never a real
 * SSH transport -- that is `remote-worktree-sync.test.ts`'s (19.4) and
 * `acp-base-remote.test.ts`'s (19.5) own job.
 *
 * `machineId` has no REST field yet (19.7's job): every remote-build test
 * here calls `h.start.startLocked` directly (`builds-harness.ts`'s own
 * CAP-24 seam), exactly as the plan's scope decision describes, never
 * `h.builds.start` (`StartBuildRequest`, which never carries one).
 */
import { newId, RemoteHostError, type BuildRefusedError, type RemoteHostConnection, type RemoteWorktreeSync } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { harness, refusal } from './builds-harness.js';

/** A fake remote-build capability: records every push/pull/remove/connect, and can be told to fail any of them. */
function fakeRemote() {
  const pushes: Array<{ repoPath: string; branch: string; runId: string; machineId: string }> = [];
  const pulls: Array<{ repoPath: string; worktreePath: string; branch: string; base: string; runId: string; machineId: string }> = [];
  const removes: Array<{ runId: string; machineId: string }> = [];
  const connects: string[] = [];
  const closes: number[] = [];
  const state = { pushFails: false, pullFails: false, connectFails: false };
  const sync: RemoteWorktreeSync = {
    async push(input) {
      pushes.push(input);
      if (state.pushFails) throw new RemoteHostError('The remote machine could not set up the run.', {}, 'remote_command_failed');
      return { remotePath: `.ogden-agents/remote-runs/${input.runId}` };
    },
    async pull(input) {
      pulls.push(input);
      if (state.pullFails) throw new RemoteHostError('The connection to the machine was lost.', {}, 'connection_lost');
      return 'imported';
    },
    async remove(input) {
      removes.push(input);
    },
  };
  const connect = async (machineId: string): Promise<RemoteHostConnection> => {
    connects.push(machineId);
    if (state.connectFails) throw new RemoteHostError(`${machineId} is unreachable.`, {}, 'host_unreachable');
    return {
      async exec() {
        throw new Error('not exercised at the build-orchestration level: the chat/agent layer owns exec (story 19.5)');
      },
      async close() {
        closes.push(1);
      },
    };
  };
  return { remote: { sync, connect }, pushes, pulls, removes, connects, closes, state };
}

describe('a remote attended build, full round trip (CAP-24, epic 19 story 19.6)', () => {
  it('pushes the worktree right after creating it, hands the chat layer the connection, pulls back before reading the status, and verifies', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote });
    const machineId = newId('mach');

    const { run, session } = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId);
    expect(run).toMatchObject({ ticketRef: '1.1', outcome: 'running', sandbox: 'attended', machineId });
    expect(fake.pushes).toEqual([{ repoPath: h.repo, branch: run.branch, runId: run.id, machineId }]);
    // `validateStart`'s own usability probe opens and at once closes a connection, before `begin`'s real, long-lived one.
    expect(fake.connects).toEqual([machineId, machineId]);
    expect(fake.closes).toEqual([1]);
    const setup = h.core.buildSessions.get(session.id)!;
    // `cwd` here is the shell's own navigation target (relative to the machine's login directory): the ACP agent
    // is told a different, always-safe `.` once it's actually there (`acp-base/acp-agent.ts`'s own concern).
    expect(setup).toMatchObject({ attended: true, cwd: `.ogden-agents/remote-runs/${run.id}` });
    expect('remote' in setup && setup.remote !== undefined).toBe(true);
    expect(h.sent).toHaveLength(1);

    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(fake.pulls).toEqual([{ repoPath: h.repo, worktreePath: run.worktreePath, branch: run.branch, base: run.baseRevision, runId: run.id, machineId }]);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'verified' });

    // Approve still merges from the controller's own (now pulled-back) checkout, exactly as a local run's (the scope decision).
    const review = await h.builds.approve(h.wsId, '1.1', { revision: 'b'.repeat(40) });
    expect(review.merged).toBe(true);
  });

  it('is byte-identical to the equivalent local-run fixture on outcome and verification, machine-targeted inputs only', async () => {
    const local = await harness();
    const localStarted = await local.builds.start(local.wsId, { ref: '1.1', mode: 'attended' });
    local.tickets.set(localStarted.run.worktreePath!, '1.1', 'built');
    await local.endTurn(localStarted.session.id);
    const localFinal = local.core.entities.getRun(localStarted.run.id)!;

    const fake = fakeRemote();
    const remote = await harness({ remote: fake.remote });
    const machineId = newId('mach');
    const remoteStarted = await remote.start.startLocked(remote.wsId, remote.repo, '1.1', 'claude-code', 'attended', undefined, machineId);
    remote.tickets.set(remoteStarted.run.worktreePath!, '1.1', 'built');
    await remote.endTurn(remoteStarted.session.id);
    const remoteFinal = remote.core.entities.getRun(remoteStarted.run.id)!;

    const strip = ({ id, sessionId, workspaceId, worktreePath, branch, createdAt, updatedAt, deadline, machineId: _machineId, ...rest }: typeof localFinal) => rest;
    expect(strip(remoteFinal)).toEqual(strip(localFinal));
  });
});

describe('unattended + remote is refused, not supported yet (CAP-24, epic 19 story 19.6, the scope decision)', () => {
  it('rejects before any worktree or branch exists, with a plain reason', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote });
    const machineId = newId('mach');

    const error = (await refusal(h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'unattended', undefined, machineId))) as BuildRefusedError;
    expect(error.name).toBe('BuildRefusedError');
    expect(error.code).toBe('sandbox_unavailable');
    expect(error.message.length).toBeGreaterThan(0);
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
    expect(h.git.calls).toEqual([]);
    expect(fake.pushes).toEqual([]);
    expect(fake.connects).toEqual([]);
  });
});

describe('no remote capability wired (CAP-24, epic 19 story 19.6)', () => {
  it('refuses the same way as an unavailable machine, fail closed, never running locally instead', async () => {
    const h = await harness(); // no `remote` given: absent, exactly as every install without CAP-24 wired.
    const machineId = newId('mach');

    const error = (await refusal(h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId))) as BuildRefusedError;
    expect(error.code).toBe('sandbox_unavailable');
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
  });

  it('refuses the same way when the machine itself cannot be reached or used right now', async () => {
    const fake = fakeRemote();
    fake.state.connectFails = true;
    const h = await harness({ remote: fake.remote });
    const machineId = newId('mach');

    const error = (await refusal(h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId))) as BuildRefusedError;
    expect(error.code).toBe('sandbox_unavailable');
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
    // The probe connection opened by `validateStart` closed itself; nothing was pushed.
    expect(fake.pushes).toEqual([]);
  });
});

describe('the connection drops (CAP-24, epic 19 story 19.6)', () => {
  it('mid-run: blocks connection_lost, never verified, and never attempts the pull-back', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote });
    const machineId = newId('mach');
    const { run, session } = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId);

    // The agent's own session reports one fatal `connection_lost` error (acp-agent.ts's `reportGone`/`fail`'s own path).
    h.core.entities.setSessionState(session.id, 'working');
    h.core.entities.setSessionState(session.id, 'error', { reason: 'The connection to the remote machine was lost. Retry to carry on.', errorCode: 'connection_lost' });
    await h.builds.settled();

    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'connection_lost' });
    expect(fake.pulls).toEqual([]);
  });

  it('between finish and pull-back: blocks connection_lost, the local worktree left untouched (the ticket status is never read)', async () => {
    const fake = fakeRemote();
    fake.state.pullFails = true;
    const h = await harness({ remote: fake.remote });
    const machineId = newId('mach');
    const { run, session } = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId);

    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);

    expect(fake.pulls).toHaveLength(1);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'connection_lost' });
    // `decideOutcome` returned on the failed pull, before `trust.requireScriptsMatch`/`tickets.find` ever ran in the worktree.
    expect(h.tickets.calls.some((call) => call[0] === 'find' && call[1] === run.worktreePath)).toBe(false);
  });
});

describe('Retry after a connection_lost drop (CAP-24, epic 19 story 19.6)', () => {
  it('pushes a fresh remote directory and opens a fresh connection, then completes exactly as a first attempt', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote });
    const machineId = newId('mach');
    const { run, session } = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId);

    h.core.entities.setSessionState(session.id, 'working');
    h.core.entities.setSessionState(session.id, 'error', { reason: 'dropped', errorCode: 'connection_lost' });
    await h.builds.settled();
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'connection_lost' });

    // Only the retry's own push/connect matter here; the first attempt's are already asserted above.
    fake.pushes.length = 0;
    fake.connects.length = 0;
    const retried = await h.builds.retry(h.wsId, run.id, {});
    expect(retried.outcome).toBe('running');
    // The same `runId` (the run is never re-created), wiped and reseeded on the remote, never hot-patched.
    expect(fake.pushes).toEqual([{ repoPath: h.repo, branch: run.branch, runId: run.id, machineId }]);
    expect(fake.connects).toEqual([machineId]);
    expect(h.sent).toHaveLength(2);

    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'verified' });
  });
});

describe('an agent tied to this computer never builds on a machine (27.9; 27.5 review 5 and 6)', () => {
  const LOCAL_ONLY = 'The Local model runs on this computer only.';

  it('refuses an attended remote build in its own words before any connection opens or the repo is pushed', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote, localOnly: { local: LOCAL_ONLY } });
    const machineId = newId('mach');

    const error = (await refusal(h.start.startLocked(h.wsId, h.repo, '1.1', 'local', 'attended', undefined, machineId))) as BuildRefusedError;
    expect(error).toMatchObject({ name: 'BuildRefusedError', code: 'sandbox_unavailable', message: LOCAL_ONLY });
    expect(fake.connects).toEqual([]);
    expect(fake.pushes).toEqual([]);
    expect(h.git.calls).toEqual([]);
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
  });

  it('refuses a Retry once the build session went to such an agent, before any connection or push', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote, localOnly: { local: LOCAL_ONLY } });
    const machineId = newId('mach');
    const { run, session } = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId);
    h.core.entities.setSessionState(session.id, 'working');
    h.core.entities.setSessionState(session.id, 'error', { reason: 'dropped', errorCode: 'connection_lost' });
    await h.builds.settled();
    // Continue with another agent handed the build session to the Local model meanwhile.
    h.core.entities.setSessionAgent(session.id, { agentId: 'local', previous: 'claude-code', brief: '', resumes: false, refs: {} });

    fake.pushes.length = 0;
    fake.connects.length = 0;
    const error = (await refusal(h.builds.retry(h.wsId, run.id, {}))) as BuildRefusedError;
    expect(error).toMatchObject({ code: 'sandbox_unavailable', message: LOCAL_ONLY });
    expect(fake.connects).toEqual([]);
    expect(fake.pushes).toEqual([]);
  });

  it("refuses a queued remote run's dispatch once its session went to such an agent, before any connection or push", async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote, localOnly: { local: LOCAL_ONLY }, ticketList: [{ ref: '1.1', title: 'First', after: [] }, { ref: '1.2', title: 'Second', after: [] }] });
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { maxConcurrentRuns: 1 });
    const machineId = newId('mach');
    const first = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, machineId);
    const queued = await h.start.startLocked(h.wsId, h.repo, '1.2', 'claude-code', 'attended', undefined, machineId);
    expect(queued.run.queuePosition).toBe(1);
    // Continue with another agent handed the queued run's session to the Local model meanwhile.
    h.core.entities.setSessionAgent(queued.session.id, { agentId: 'local', previous: 'claude-code', brief: '', resumes: false, refs: {} });

    fake.pushes.length = 0;
    fake.connects.length = 0;
    h.tickets.set(first.run.worktreePath!, '1.1', 'built');
    await h.endTurn(first.session.id);
    await h.builds.settled();
    // 1.1's own pull-back is all that reached the machine: 1.2 never connected, pushed or got a worktree.
    expect(fake.connects).toEqual([]);
    expect(fake.pushes).toEqual([]);
    expect(h.core.entities.getRun(queued.run.id)).toMatchObject({ worktreePath: null, queuePosition: null, outcome: 'failed' });
  });

  it('still starts a remote build with any other agent', async () => {
    const fake = fakeRemote();
    const h = await harness({ remote: fake.remote, localOnly: { local: LOCAL_ONLY } });
    const { run } = await h.start.startLocked(h.wsId, h.repo, '1.1', 'claude-code', 'attended', undefined, newId('mach'));
    expect(run.outcome).toBe('running');
  });
});
