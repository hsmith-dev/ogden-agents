/**
 * Story 11.2 on a real core with fake ports: Check again re-runs the end
 * checks on a failed or ready run's worktree, with the project's own test
 * command when one is set; never for a decided or superseded run.
 */
import { testsFailedDetail } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { codeOf, harness, refusal, type Harness } from './builds-harness.js';

async function failedRun(): Promise<{ h: Harness; runId: string }> {
  const h = await harness();
  h.rerun.result = { exitCode: 1, timedOut: false, output: 'Tests: 3 failed, 2 passed, 5 total\n' };
  const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
  h.tickets.set(run.worktreePath!, '1.1', 'built');
  await h.endTurn(session.id);
  expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'failed', reason: testsFailedDetail(3) });
  return { h, runId: run.id };
}

describe('Check again (story 11.2)', () => {
  it('re-runs the tests: a fixed run turns verified, the same fault stays failed, and the agent does not run', async () => {
    const { h, runId } = await failedRun();
    const sent = h.sent.length;
    const stillFailing = await h.builds.checkAgain(h.wsId, runId);
    expect(stillFailing.outcome).toBe('running');
    await h.builds.settled();
    expect(h.core.entities.getRun(runId as never)).toMatchObject({ outcome: 'failed', reason: testsFailedDetail(3) });
    expect(h.rerun.runs).toHaveLength(2);
    h.rerun.result = { exitCode: 0, timedOut: false, output: 'Tests: 5 passed, 5 total\n' };
    await h.builds.checkAgain(h.wsId, runId);
    await h.builds.settled();
    expect(h.core.entities.getRun(runId as never)).toMatchObject({ outcome: 'verified', reason: null });
    expect(h.rerun.runs).toHaveLength(3);
    expect(h.sent).toHaveLength(sent);
  });

  it("uses the project's own test command as it is now", async () => {
    const { h, runId } = await failedRun();
    h.core.buildSettings.setWorkspaceSettings(h.wsId, { testCommand: 'my-tests --fast' });
    h.rerun.result = { exitCode: 0, timedOut: false, output: '' };
    await h.builds.checkAgain(h.wsId, runId);
    await h.builds.settled();
    expect(h.rerun.runs.at(-1)).toMatchObject({ command: 'my-tests --fast' });
    expect(h.core.entities.getRun(runId as never)).toMatchObject({ outcome: 'verified' });
  });

  it('is refused for a running, stopped or decided run and with builds off', async () => {
    const h = await harness();
    const started = await h.builds.start(h.wsId, { ref: '1.1' });
    expect(await codeOf(h.builds.checkAgain(h.wsId, started.run.id))).toBe('run_not_active');
    const stopped = await h.builds.stop(h.wsId, started.run.id);
    expect(await codeOf(h.builds.checkAgain(h.wsId, stopped.id))).toBe('run_not_active');
    const { h: g, runId } = await failedRun();
    await g.builds.reject(g.wsId, '1.1', {});
    expect(await codeOf(g.builds.checkAgain(g.wsId, runId))).toBe('run_not_active');
    const { h: off, runId: offRun } = await failedRun();
    off.core.permissions.updateSettings(off.wsId, { bmadPieces: [] });
    expect(await refusal(off.builds.checkAgain(off.wsId, offRun))).toMatchObject({ name: 'FeatureOffError' });
  });
});
