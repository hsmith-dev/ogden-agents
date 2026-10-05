/**
 * Story 5.6: the attended build mode, the run's own git object store, and the
 * sandbox status. Core with fake ports (the harness): no real sandbox, agent,
 * git or network.
 */
import { existsSync, readdirSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { OBJECTS_NOT_IMPORTED_MESSAGE } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createObjectStore, FeatureOffError, ObjectStoreError, objectStoreEnv, objectStoreOf } from '../src/index.js';
import { codeOf, harness, refusal, unattendedOf } from './builds-harness.js';
import { tempDir } from './helpers.js';

const OTHER_REVISION = 'b'.repeat(40);

describe('attended builds (story 5.6)', () => {
  it('starts only when the user asks for it, with no sandbox, and its session has no policy (every tool call is a card)', async () => {
    const h = await harness();
    h.sandbox.available = false;
    // The default is unattended: with no sandbox, nothing starts and nothing is left behind.
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1' }))).toBe('sandbox_unavailable');
    expect(await codeOf(h.builds.start(h.wsId, { ref: '1.1', mode: 'unattended' }))).toBe('sandbox_unavailable');
    expect(existsSync(join(h.dataDir, 'w'))).toBe(false);
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
    expect(h.git.calls).toEqual([]);

    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1', mode: 'attended' });
    expect(run).toMatchObject({ ticketRef: '1.1', outcome: 'running', sandbox: 'attended' });
    expect(session.kind).toBe('build');
    const setup = h.core.buildSessions.get(session.id)!;
    expect(setup).toEqual({ attended: true, cwd: run.worktreePath });
    expect('decide' in setup).toBe(false);
    expect(h.sent).toHaveLength(1);
    // No sandbox, so no object store: the user answers every card.
    expect(existsSync(objectStoreOf(h.dataDir, run.branch!.split('/')[1]!))).toBe(false);
  });

  it('refuses a mode that is not one of the two', async () => {
    const h = await harness();
    expect(((await refusal(h.builds.start(h.wsId, { ref: '1.1', mode: 'yolo' }))) as Error).name).toBe('ValidationError');
    expect(h.core.entities.listSessions(h.wsId)).toEqual([]);
  });

  it('an attended run paused at a checkpoint resumes attended, even with no sandbox, and an unattended one still needs one', async () => {
    const h = await harness();
    h.tickets.checkpoint('1.1', { plan: true });
    h.sandbox.available = false;
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1', mode: 'attended' });
    h.core.buildSessions.delete(session.id);
    await h.builds.resume(h.wsId, run.id);
    expect(h.core.buildSessions.get(session.id)).toEqual({ attended: true, cwd: run.worktreePath });
    expect(h.sent).toHaveLength(1);
  });

  it('an attended run is reviewed, approved and cleaned up like any other', async () => {
    const h = await harness();
    h.sandbox.available = false;
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1', mode: 'attended' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'verified', sandbox: 'attended' });
    const review = await h.builds.approve(h.wsId, '1.1', { revision: OTHER_REVISION });
    expect(review.merged).toBe(true);
  });
});

describe("a run's own git object store (story 5.6)", () => {
  it('is made for a sandboxed run, outside the repo and the worktree, and the repo objects are read-only to it', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    const short = run.branch!.split('/')[1]!;
    const store = objectStoreOf(h.dataDir, short);
    expect(statSync(store).isDirectory()).toBe(true);
    if (process.platform !== 'win32') expect(statSync(store).mode & 0o777).toBe(0o700);
    const setup = unattendedOf(h.core.buildSessions.get(session.id));
    expect(setup.env?.GIT_OBJECT_DIRECTORY).toBe(realpathSync.native(store));
    expect(setup.sandbox.writableRoots).toContain(realpathSync.native(store));
    expect(setup.sandbox.writableRoots.some((root) => root.endsWith(join('.git', 'objects')))).toBe(false);
  });

  it('is removed with a discard, and a run that failed to start leaves none', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    const store = objectStoreOf(h.dataDir, run.branch!.split('/')[1]!);
    expect(existsSync(store)).toBe(true);
    await h.builds.reject(h.wsId, '1.1');
    expect(existsSync(store)).toBe(false);

    // Starting fails after the store is made (the prompt is refused): nothing is left under the run folders.
    const failing = await harness();
    failing.sendFails.value = true;
    await refusal(failing.builds.start(failing.wsId, { ref: '1.1' }));
    const runs = join(failing.dataDir, 'r');
    expect(existsSync(runs) ? readdirSync(runs).filter((name) => existsSync(join(runs, name, 'objects'))) : []).toEqual([]);
  });

  it('approve imports the run objects before it merges, and merges nothing when git refuses them', async () => {
    const h = await harness();
    const { run, session } = await h.builds.start(h.wsId, { ref: '1.1' });
    h.tickets.set(run.worktreePath!, '1.1', 'built');
    await h.endTurn(session.id);
    h.git.calls.length = 0;
    h.git.state.importResult = 'refused';
    const refused = await refusal(h.builds.approve(h.wsId, '1.1', { revision: OTHER_REVISION }));
    expect([(refused as { code: string }).code, (refused as Error).message]).toEqual(['checks_failed', OBJECTS_NOT_IMPORTED_MESSAGE]);
    expect(h.git.calls.some((call) => call.startsWith('merge'))).toBe(false);
    expect(h.core.entities.getRun(run.id)).toMatchObject({ outcome: 'verified', decision: null });
    h.git.state.importResult = 'imported';
    await h.builds.approve(h.wsId, '1.1', { revision: OTHER_REVISION });
    expect(h.git.state.imports.at(-1)).toEqual([run.branch, run.baseRevision]);
    expect(h.git.calls[0]).toMatch(/^merge /);
  });

  it('createObjectStore refuses a run folder or store that is a link, and objectStoreEnv a path that holds the list separator', () => {
    const data = tempDir('ogden-agents-store-');
    const short = 'abcdefgh';
    const store = createObjectStore(data, short);
    expect(store).toBe(realpathSync.native(objectStoreOf(data, short)));
    expect(() => objectStoreOf(data, '../x')).toThrow();
    if (process.platform !== 'win32') {
      const elsewhere = tempDir('ogden-agents-elsewhere-');
      const folder = join(data, 'r', 'bbbbbbbb');
      symlinkSync(elsewhere, folder, 'dir');
      expect(() => createObjectStore(data, 'bbbbbbbb')).toThrow(ObjectStoreError);
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(() => objectStoreEnv('/a:b/objects', '/repo/.git/objects')).toThrow(ObjectStoreError);
    }
    expect(objectStoreEnv(store, join(data, 'repo', 'objects'))).toEqual({ GIT_OBJECT_DIRECTORY: store, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(data, 'repo', 'objects') });
  });
});

describe('the sandbox status (story 5.6)', () => {
  it("answers the port's status behind the builds piece, and is off with it off", async () => {
    const h = await harness();
    h.sandbox.available = false;
    expect(await h.builds.sandboxStatus(h.wsId)).toMatchObject({ available: false, summary: 'none' });
    h.sandbox.available = true;
    expect(await h.builds.sandboxStatus(h.wsId)).toMatchObject({ available: true, kind: 'test' });
    const off = await harness({ pieces: ['board'] as never });
    expect(await refusal(off.builds.sandboxStatus(off.wsId))).toBeInstanceOf(FeatureOffError);
  });
});
