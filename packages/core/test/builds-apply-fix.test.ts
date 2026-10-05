/**
 * Story 11.1 on a real core with fake ports: Apply the saved fix and retry
 * (an intent gap's patch applied in the run's worktree, its plan marked
 * in-review, the agent started again).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { APPLY_FIX_REFUSED_MESSAGE, NO_SAVED_FIX_MESSAGE } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { codeOf, harness, PLAN, refusal, testRunner, type Harness } from './builds-harness.js';

const runner = { ...testRunner, blockedCode: (condition: string) => (condition.startsWith('intent gap') ? ('intent_gap' as const) : ('other' as const)) };
const PATCH = PLAN.replace(/\.md$/, '.patch');

/** A run blocked on an intent gap, with its patch beside the plan in the worktree unless `savePatch` is false. */
async function gapped(savePatch = true): Promise<{ h: Harness; runId: string }> {
  const h = await harness({ runner });
  const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
  if (savePatch) {
    const file = join(run.worktreePath!, ...PATCH.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'diff --git a/src/fix.txt b/src/fix.txt\n');
  }
  h.tickets.set(run.worktreePath!, '1.1', 'blocked', 'intent gap: what should it say?', 'in-progress');
  await h.endTurn(session.id);
  expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'blocked', blockedCode: 'intent_gap' });
  return { h, runId: run.id };
}

describe('Apply the saved fix and retry (story 11.1)', () => {
  it('applies the patch in the worktree, marks the plan in-review and starts the agent again in the same run', async () => {
    const { h, runId } = await gapped();
    const before = h.sent.length;
    const resumed = await h.builds.retry(h.wsId, runId as never, { mode: 'apply_fix' });
    expect(resumed).toMatchObject({ id: runId, outcome: 'running', blockedCode: null });
    expect(h.git.calls.some((call) => call.startsWith('applyPatch ') && call.endsWith(PATCH.split('/').join(process.platform === 'win32' ? '\\' : '/')))).toBe(true);
    // The harness's store is not run-aware: the mark lands where the dispatcher asked (production reads and writes the run's worktree, 5.8).
    expect(h.tickets.calls).toContainEqual(['mark', h.repo, '1.1', 'in-review', false]);
    expect(h.sent).toHaveLength(before + 1);
    // The protected files a build may not change are refused to the patch; the others are not.
    expect(h.git.state.refused).toEqual([true, true, true, false]);
  });

  it('a patch that does not apply changes nothing, and says so', async () => {
    const { h, runId } = await gapped();
    h.git.state.applyPatch = 'refused';
    const refused = await h.builds.retry(h.wsId, runId as never, { mode: 'apply_fix' }).catch((error: Error) => error);
    expect((refused as Error).message).toBe(APPLY_FIX_REFUSED_MESSAGE);
    expect(h.core.entities.getRun(runId as never)).toMatchObject({ outcome: 'blocked', blockedCode: 'intent_gap' });
    expect(h.tickets.calls.filter((call) => call[0] === 'mark')).toEqual([]);
  });

  it('a run with no saved patch is refused with its sentence; a run that is not an intent gap is refused', async () => {
    const { h, runId } = await gapped(false);
    const refused = await h.builds.retry(h.wsId, runId as never, { mode: 'apply_fix' }).catch((error: Error) => error);
    expect((refused as Error).message).toBe(NO_SAVED_FIX_MESSAGE);
    expect(h.git.calls.some((call) => call.startsWith('applyPatch'))).toBe(false);
    const plain = await harness();
    const started = await plain.builds.start(plain.wsId, { ref: '1.1' });
    // Still running.
    expect(await codeOf(plain.builds.retry(plain.wsId, started.run.id, { mode: 'apply_fix' }))).toBe('run_not_active');
    const stopped = await plain.builds.stop(plain.wsId, started.run.id);
    expect(await codeOf(plain.builds.retry(plain.wsId, stopped.id, { mode: 'apply_fix' }))).toBe('run_not_active');
  });

  it('is behind the builds piece like every builds use-case', async () => {
    const { h, runId } = await gapped();
    h.core.permissions.updateSettings(h.wsId, { bmadPieces: [] });
    expect(await refusal(h.builds.retry(h.wsId, runId as never, { mode: 'apply_fix' }))).toMatchObject({ name: 'FeatureOffError' });
    expect(h.git.calls.some((call) => call.startsWith('applyPatch'))).toBe(false);
  });
});
