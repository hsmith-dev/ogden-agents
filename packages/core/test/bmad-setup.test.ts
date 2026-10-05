/**
 * BMad Method's setup in core (story 4.3): the guard (Planning or Board on,
 * else `feature_off` and nothing runs), the workspace's stored real path,
 * one setup per workspace at a time, a refusal (`BmadAlreadySetUpError`)
 * for a project with `_bmad/` (detected) or any status but `not_set_up`,
 * and the `bmad.setup_*` events in order on the workspace's stream, with a
 * plain reason on failure; `settled()` waits for every setup in progress.
 * Entry 4.11: the status lists the capabilities the pieces on need and the
 * project lacks (never for `not_set_up`, never one a piece that is off
 * needs), and a start with `upgrade` needs a real `_bmad/` (`bmad_not_set_up`
 * without one, `bmad_upgrade_refused` for a link or a file, nothing run),
 * then runs the catalog's setup in its upgrade mode with the same events.
 * The catalog is an in-test fake, as core may not import the adapters.
 */
import {
  BMAD_SETUP_FAILURE_REASONS,
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_STEPS,
  BMAD_UPGRADE_REFUSED_TEXT,
  type BmadCapability,
  type BmadSetupProgress,
  type BmadSetupStatus,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import {
  BmadAlreadySetUpError,
  BmadNotSetUpError,
  BmadSetupError,
  BmadUpgradeRefusedError,
  createBmadSetup,
  FeatureOffError,
  NotFoundError,
  ScriptsChangedError,
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

/** A setup catalog whose `setup` waits for `release()` (or fails with `fail`), recording every call; it lacks `missing` until a setup ends. */
function fakeCatalog(options: { hasBmad?: boolean; state?: BmadSetupStatus['state']; fail?: Error; missing?: BmadCapability[] } = {}) {
  const calls: Array<[string, string]> = [];
  const asked: BmadCapability[][] = [];
  const setupOptions: unknown[] = [];
  let missing = options.missing ?? [];
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
    setup: async (repoPath, onProgress: (progress: BmadSetupProgress) => void, ...rest) => {
      calls.push(['setup', repoPath]);
      setupOptions.push(...rest);
      for (const step of BMAD_SETUP_STEPS) onProgress({ step, label: BMAD_SETUP_STEP_LABELS[step] });
      await gate;
      if (options.fail !== undefined) throw options.fail;
      missing = [];
      return status('current');
    },
    missingCapabilities: async (repoPath, wanted) => {
      calls.push(['capabilities', repoPath]);
      asked.push([...wanted]);
      return wanted.filter((capability) => missing.includes(capability));
    },
  };
  return { catalog, calls, release, asked, setupOptions };
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
      ['capabilities', workspace.realPath],
    ]);
    expect(setupEvents()).toEqual([
      { type: 'bmad.setup_started', streamId: workspace.id, payload: {} },
      ...BMAD_SETUP_STEPS.map((step) => ({ type: 'bmad.setup_progress', streamId: workspace.id, payload: { step, label: BMAD_SETUP_STEP_LABELS[step] } })),
      { type: 'bmad.setup_completed', streamId: workspace.id, payload: { status: { ...status('current'), missingCapabilities: [] } } },
    ]);
  });

  it("passes the other agents' skills folders to the catalog's setup, with upgrade too, and nothing extra without them (epic 6 entry 8)", async () => {
    const plain = setup(['planning']);
    await plain.bmadSetup.start(plain.workspace.id, { skillFolders: [] });
    plain.release();
    await plain.bmadSetup.settled();
    expect(plain.setupOptions).toEqual([]);
    const agy = setup(['planning']);
    await agy.bmadSetup.start(agy.workspace.id, { skillFolders: ['.agents/skills'] });
    agy.release();
    await agy.bmadSetup.settled();
    expect(agy.setupOptions).toEqual([{ skillFolders: ['.agents/skills'] }]);
    const upgrade = setup(['planning'], { hasBmad: true, state: 'current' });
    await upgrade.bmadSetup.start(upgrade.workspace.id, { upgrade: true, skillFolders: ['.agents/skills'] });
    upgrade.release();
    await upgrade.bmadSetup.settled();
    expect(upgrade.setupOptions).toEqual([{ upgrade: true, skillFolders: ['.agents/skills'] }]);
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
    expect(calls).toEqual([
      ['status', workspace.realPath],
      ['capabilities', workspace.realPath],
    ]);
  });

  it('status lists the missing capabilities of the pieces that are on only, and none for not_set_up (entry 4.11)', async () => {
    const both = setup(['planning', 'board'], { state: 'current', missing: ['plain_labels', 'ticket_tree'] });
    expect((await both.bmadSetup.status(both.workspace.id)).missingCapabilities).toEqual(['plain_labels', 'ticket_tree']);
    expect(both.asked).toEqual([['plain_labels', 'ticket_tree']]);

    // Board off: its capability is never read.
    const planning = setup(['planning'], { state: 'current', missing: ['plain_labels', 'ticket_tree'] });
    expect((await planning.bmadSetup.status(planning.workspace.id)).missingCapabilities).toEqual(['plain_labels']);
    expect(planning.asked).toEqual([['plain_labels']]);

    const fresh = setup(['planning', 'board'], { missing: ['ticket_tree'] });
    expect((await fresh.bmadSetup.status(fresh.workspace.id)).missingCapabilities).toBeUndefined();
    expect(fresh.asked).toEqual([]);
  });

  it('upgrade runs the setup in its upgrade mode in a project with _bmad/, with the same events, and completes with the capabilities now (entry 4.11)', async () => {
    const { workspace, bmadSetup, release, calls, setupOptions, setupEvents } = setup(['planning', 'board'], { hasBmad: true, state: 'current', missing: ['ticket_tree'] });
    const answer = await bmadSetup.start(workspace.id, { upgrade: true });
    expect(answer).toEqual({ started: true, setup: status('current') });
    release();
    await bmadSetup.settled();
    expect(calls.map(([what]) => what)).toEqual(['detect', 'status', 'setup', 'capabilities']);
    expect(setupOptions).toEqual([{ upgrade: true }]);
    expect(setupEvents().map((event) => event.type)).toEqual(['bmad.setup_started', ...BMAD_SETUP_STEPS.map(() => 'bmad.setup_progress'), 'bmad.setup_completed']);
    expect(setupEvents().at(-1)!.payload).toEqual({ status: { ...status('current'), missingCapabilities: [] } });
  });

  it('set up without upgrade passes no options; upgrade without _bmad/ is bmad_not_set_up, with a link or file there bmad_upgrade_refused, running nothing (entry 4.11)', async () => {
    const plain = setup(['planning']);
    await plain.bmadSetup.start(plain.workspace.id);
    plain.release();
    await plain.bmadSetup.settled();
    expect(plain.setupOptions).toEqual([]);

    const none = setup(['planning']);
    await expect(none.bmadSetup.start(none.workspace.id, { upgrade: true })).rejects.toBeInstanceOf(BmadNotSetUpError);
    expect(none.calls.map(([what]) => what)).toEqual(['detect', 'status']);
    expect(none.setupEvents()).toEqual([]);

    const linked = setup(['board'], { state: 'unusable' });
    const refused = await linked.bmadSetup.start(linked.workspace.id, { upgrade: true }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BmadUpgradeRefusedError);
    expect(refused).toMatchObject({ code: 'bmad_upgrade_refused', message: BMAD_UPGRADE_REFUSED_TEXT });
    expect(linked.calls.map(([what]) => what)).toEqual(['detect', 'status']);
    expect(linked.setupEvents()).toEqual([]);

    // Off pieces refuse before anything is read.
    const off = setup([], { hasBmad: true, state: 'current' });
    await expect(off.bmadSetup.start(off.workspace.id, { upgrade: true })).rejects.toBeInstanceOf(FeatureOffError);
    expect(off.calls).toEqual([]);
  });

  it('a refused upgrade in the adapter fails with its plain reason', async () => {
    const { workspace, bmadSetup, release, setupEvents } = setup(['planning'], { hasBmad: true, state: 'current', fail: new BmadSetupError('upgrade_refused') });
    await bmadSetup.start(workspace.id, { upgrade: true });
    release();
    await bmadSetup.settled();
    expect(setupEvents().at(-1)).toMatchObject({ type: 'bmad.setup_failed', payload: { reason: BMAD_UPGRADE_REFUSED_TEXT } });
  });

  it('openCore builds it from the catalog it is given', () => {
    const core = openTestCore(tempDir(), undefined, { bmadCatalog: fakeCatalog().catalog });
    expect(core.bmadSetup).toBeDefined();
    expect(openTestCore(tempDir()).bmadSetup).toBeUndefined();
  });
});

describe('setup and the trust bound to the scripts (story 4.13)', () => {
  /** A core whose own setup runs on the fake catalog, with the project's scripts as `scripts.value`; setup writes `written`. */
  function bound(before: string) {
    const scripts: { value: string | undefined } = { value: before };
    const fake = fakeCatalog({ hasBmad: true, state: 'current' });
    const catalog: BmadCatalogPort = {
      ...fake.catalog,
      scriptsFingerprint: async () => scripts.value,
      setup: async (repoPath, onProgress, ...rest) => {
        const after = await fake.catalog.setup(repoPath, onProgress, ...rest);
        scripts.value = 'sha256:written-by-setup';
        return after;
      },
    };
    const core: Core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board'], bmadCatalog: catalog });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    return { core, workspace, scripts, release: fake.release };
  }

  it('a trust that matched just before keeps over the scripts the setup wrote', async () => {
    const { core, workspace, release } = bound('sha256:allowed');
    await core.bmadScriptTrust.trustScripts(workspace.id);
    await core.bmadSetup!.start(workspace.id, { upgrade: true });
    release();
    await core.bmadSetup!.settled();
    await expect(core.bmadScriptTrust.requireScriptsUnchanged(workspace.id)).resolves.toBe('sha256:written-by-setup');
  });

  it('scripts changed before the setup stay refused after it: the setup never blesses them', async () => {
    const { core, workspace, scripts, release } = bound('sha256:allowed');
    await core.bmadScriptTrust.trustScripts(workspace.id);
    scripts.value = 'sha256:planted';
    await core.bmadSetup!.start(workspace.id, { upgrade: true });
    release();
    await core.bmadSetup!.settled();
    await expect(core.bmadScriptTrust.requireScriptsUnchanged(workspace.id)).rejects.toBeInstanceOf(ScriptsChangedError);
  });
});
