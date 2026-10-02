/**
 * BMad Method's setup in core (story 4.3): the guard (Planning or Board on,
 * else `feature_off` and nothing runs), the workspace's stored real path,
 * one setup per workspace at a time, a refusal (`BmadAlreadySetUpError`)
 * for a project with `_bmad/` (detected) or any status but `not_set_up`,
 * and the `bmad.setup_*` events in order on the workspace's stream, with a
 * plain reason on failure; `settled()` waits for every setup in progress.
 * The catalog is an in-test fake, as core may not import the adapters.
 */
import { BMAD_SETUP_FAILURE_REASONS, BMAD_SETUP_STEP_LABELS, BMAD_SETUP_STEPS, type BmadSetupProgress, type BmadSetupStatus, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  BmadAlreadySetUpError,
  BmadSetupError,
  createBmadSetup,
  FeatureOffError,
  NotFoundError,
  type BmadCatalogPort,
  type Core,
} from '../src/index.js';
import { openTestCore, tempDir, unusedCatalogParts } from './helpers.js';

const status = (state: BmadSetupStatus['state']): BmadSetupStatus => ({
  state,
  outputFolder: state === 'not_set_up' ? null : '_bmad-output',
  bundledVersion: '7.0.0',
  installedVersion: state === 'not_set_up' ? null : '7.0.0',
  problems: [],
});

/** A setup catalog whose `setup` waits for `release()` (or fails with `fail`), recording every call. */
function fakeCatalog(options: { hasBmad?: boolean; state?: BmadSetupStatus['state']; fail?: Error } = {}) {
  const calls: Array<[string, string]> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const catalog: BmadCatalogPort = {
    ...unusedCatalogParts,
    skills: async () => [],
    detect: async (repoPath) => {
      calls.push(['detect', repoPath]);
      return { hasBmad: options.hasBmad === true, hasOutput: false };
    },
    setupStatus: async (repoPath) => {
      calls.push(['status', repoPath]);
      return status(options.state ?? 'not_set_up');
    },
    setup: async (repoPath, onProgress: (progress: BmadSetupProgress) => void) => {
      calls.push(['setup', repoPath]);
      for (const step of BMAD_SETUP_STEPS) onProgress({ step, label: BMAD_SETUP_STEP_LABELS[step] });
      await gate;
      if (options.fail !== undefined) throw options.fail;
      return status('current');
    },
  };
  return { catalog, calls, release };
}

function setup(pieces: ('planning' | 'board')[] = ['planning'], options: Parameters<typeof fakeCatalog>[0] = {}) {
  const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board'] });
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  if (pieces.length > 0) core.permissions.updateSettings(workspace.id, { bmadPieces: pieces });
  const fake = fakeCatalog(options);
  const failures: unknown[] = [];
  const bmadSetup = createBmadSetup({ bmad: core.bmad, entities: core.entities, catalog: fake.catalog, events: core.events, onFailure: (_ws, error) => failures.push(error) });
  const setupEvents = (after = 0) =>
    core.events
      .readAfter(after)
      .filter((event) => event.type.startsWith('bmad.setup_'))
      .map((event) => ({ type: event.type, streamId: event.streamId, payload: event.payload }));
  return { core, workspace, bmadSetup, ...fake, failures, setupEvents };
}

describe('BMad Method setup in core (story 4.3)', () => {
  it('runs one setup and appends started, a progress per step and completed, on the workspace stream', async () => {
    const { workspace, bmadSetup, release, calls, setupEvents } = setup(['board']);
    const answer = await bmadSetup.start(workspace.id);
    expect(answer).toEqual({ started: true, setup: status('not_set_up') });
    release();
    await bmadSetup.settled();
    expect(calls).toEqual([
      ['detect', workspace.realPath],
      ['status', workspace.realPath],
      ['setup', workspace.realPath],
    ]);
    expect(setupEvents()).toEqual([
      { type: 'bmad.setup_started', streamId: workspace.id, payload: {} },
      ...BMAD_SETUP_STEPS.map((step) => ({ type: 'bmad.setup_progress', streamId: workspace.id, payload: { step, label: BMAD_SETUP_STEP_LABELS[step] } })),
      { type: 'bmad.setup_completed', streamId: workspace.id, payload: { status: status('current') } },
    ]);
  });

  it('a second start while one runs starts nothing (started: false)', async () => {
    const { workspace, bmadSetup, release, calls } = setup();
    const [first, second] = await Promise.all([bmadSetup.start(workspace.id), bmadSetup.start(workspace.id)]);
    expect([first.started, second.started]).toEqual([true, false]);
    expect((await bmadSetup.start(workspace.id)).started).toBe(false);
    release();
    await bmadSetup.settled();
    expect(calls.filter(([what]) => what === 'setup')).toHaveLength(1);
  });

  it('refuses a project with _bmad (detected) or any status but not_set_up, running nothing', async () => {
    const detected = setup(['planning'], { hasBmad: true });
    await expect(detected.bmadSetup.start(detected.workspace.id)).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(detected.calls.map(([what]) => what)).toEqual(['detect']);
    expect(detected.setupEvents()).toEqual([]);

    const linked = setup(['planning'], { state: 'unusable' });
    await expect(linked.bmadSetup.start(linked.workspace.id)).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(linked.calls.map(([what]) => what)).toEqual(['detect', 'status']);
    // Refused, so a later start is not "already running".
    await expect(linked.bmadSetup.start(linked.workspace.id)).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(linked.setupEvents()).toEqual([]);
  });

  it('a failure appends setup_failed with the plain reason; an unknown error gets the generic one', async () => {
    const plain = setup(['planning'], { fail: new BmadSetupError('uv_missing') });
    await plain.bmadSetup.start(plain.workspace.id);
    plain.release();
    await plain.bmadSetup.settled();
    expect(plain.setupEvents().at(-1)).toMatchObject({ type: 'bmad.setup_failed', payload: { reason: BMAD_SETUP_FAILURE_REASONS.uv_missing } });

    const odd = setup(['planning'], { fail: new Error('EACCES: /home/me/secret/_bmad') });
    await odd.bmadSetup.start(odd.workspace.id);
    odd.release();
    await odd.bmadSetup.settled();
    expect(odd.setupEvents().at(-1)).toMatchObject({ type: 'bmad.setup_failed', payload: { reason: BMAD_SETUP_FAILURE_REASONS.failed } });
    expect(odd.failures).toHaveLength(1);
    // And a new start may run after a failure.
    expect((await odd.bmadSetup.start(odd.workspace.id)).started).toBe(true);
  });

  it('with Planning and Board off, refuses with feature_off and runs nothing; an unknown workspace is not found', async () => {
    const { workspace, bmadSetup, calls } = setup([]);
    await expect(bmadSetup.status(workspace.id)).rejects.toBeInstanceOf(FeatureOffError);
    await expect(bmadSetup.start(workspace.id)).rejects.toBeInstanceOf(FeatureOffError);
    expect(calls).toEqual([]);
    await expect(bmadSetup.status('ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('status asks the catalog about the stored real path', async () => {
    const { workspace, bmadSetup, calls } = setup(['planning'], { state: 'update_available' });
    expect((await bmadSetup.status(workspace.id)).state).toBe('update_available');
    expect(calls).toEqual([['status', workspace.realPath]]);
  });

  it('openCore builds it from the catalog it is given', () => {
    const core = openTestCore(tempDir(), undefined, { bmadCatalog: fakeCatalog().catalog });
    expect(core.bmadSetup).toBeDefined();
    expect(openTestCore(tempDir()).bmadSetup).toBeUndefined();
  });
});
