/**
 * The `catalog-memory` stub of `BmadCatalogPort.detect` (story 10.2): it
 * answers what it was told, async, records each call, and reports a path it
 * doesn't know as having neither folder, as the real adapter does for a
 * missing repo.
 */
import { BmadAlreadySetUpError } from '@ogden-agents/core';
import { BMAD_SETUP_STEPS, Catalog, type BmadSetupProgress } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createBmadCatalog, createMemoryBmadCatalog, MEMORY_BUNDLED_BMAD_VERSION } from '../src/index.js';

describe('catalog-memory', () => {
  it('detects _bmad only, both, and an unknown path as neither, recording every call', async () => {
    const catalog = createMemoryBmadCatalog({ '/repos/only-bmad': { hasBmad: true }, '/repos/both': { hasBmad: true, hasOutput: true } });
    const pending = catalog.detect('/repos/only-bmad');
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual({ hasBmad: true, hasOutput: false });
    expect(await catalog.detect('/repos/both')).toEqual({ hasBmad: true, hasOutput: true });
    expect(await catalog.detect('/repos/unknown')).toEqual({ hasBmad: false, hasOutput: false });
    expect(catalog.calls).toEqual(['/repos/only-bmad', '/repos/both', '/repos/unknown']);
  });

  it('hands out copies: changing an answer changes nothing the stub keeps', async () => {
    const catalog = createMemoryBmadCatalog({ '/repo': { hasBmad: true } });
    const first = await catalog.detect('/repo');
    first.hasBmad = false;
    expect(await catalog.detect('/repo')).toEqual({ hasBmad: true, hasOutput: false });
    expect(await createMemoryBmadCatalog().detect('/repo')).toEqual({ hasBmad: false, hasOutput: false });
  });
});

describe('catalog-memory: the catalog and setup (story 4.2)', () => {
  it('answers each repo’s catalog with its skills (metadata null) and the rest it was told, recording every call', async () => {
    const catalog = createMemoryBmadCatalog(
      {},
      { '/repo': [{ name: 'bmad-ticket', description: 'Tickets.' }, { name: 'bmad-spec', description: 'Spec.' }] },
      { catalogs: { '/repo': { entryAction: 'bmad-spec', capabilities: { plain_labels: true, ticket_tree: true } } } },
    );
    const answer = Catalog.parse(await catalog.catalog('/repo'));
    expect(answer.skills.map((skill) => skill.name)).toEqual(['bmad-spec', 'bmad-ticket']);
    expect(answer.skills[0]).toEqual({ name: 'bmad-spec', description: 'Spec.', label: null, group: null, module: null, installedAt: null, next: null });
    expect(answer.entryAction).toBe('bmad-spec');
    expect(answer.capabilities).toEqual({ plain_labels: true, ticket_tree: true });
    expect(await catalog.catalog('/other')).toEqual({ modules: [], skills: [], agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: false } });
    expect(catalog.catalogCalls).toEqual(['/repo', '/other']);
  });

  it('reports each shared setup step, then the repo is current and has _bmad', async () => {
    const catalog = createMemoryBmadCatalog();
    expect((await catalog.setupStatus('/repo')).state).toBe('not_set_up');
    const progress: BmadSetupProgress[] = [];
    const after = await catalog.setup('/repo', (step) => progress.push(step));
    expect(progress.map((step) => step.step)).toEqual([...BMAD_SETUP_STEPS]);
    expect(after).toEqual({ state: 'current', outputFolder: '_bmad-output', bundledVersion: MEMORY_BUNDLED_BMAD_VERSION, installedVersion: MEMORY_BUNDLED_BMAD_VERSION, problems: [] });
    expect(await catalog.setupStatus('/repo')).toEqual(after);
    expect((await catalog.detect('/repo')).hasBmad).toBe(true);
    expect(catalog.setupCalls).toEqual([
      ['status', '/repo'],
      ['setup', '/repo'],
      ['status', '/repo'],
    ]);
  });

  it('refuses a setup in a repo that already has _bmad or is set up, writing nothing (story 4.3)', async () => {
    const catalog = createMemoryBmadCatalog({ '/has': { hasBmad: true } }, {}, { setup: { '/done': { state: 'current', outputFolder: '_bmad-output', bundledVersion: MEMORY_BUNDLED_BMAD_VERSION, installedVersion: MEMORY_BUNDLED_BMAD_VERSION, problems: [] } } });
    const progress: BmadSetupProgress[] = [];
    await expect(catalog.setup('/has', (step) => progress.push(step))).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    await expect(catalog.setup('/done', (step) => progress.push(step))).rejects.toBeInstanceOf(BmadAlreadySetUpError);
    expect(progress).toEqual([]);
    expect((await catalog.setupStatus('/has')).state).toBe('not_set_up');
  });

  it('a setup told to fail rejects after its steps, and the repo stays as it was', async () => {
    const catalog = createMemoryBmadCatalog({}, {}, { setupFails: new Error('no disk') });
    await expect(catalog.setup('/repo', () => {})).rejects.toThrow('no disk');
    expect((await catalog.setupStatus('/repo')).state).toBe('not_set_up');
  });
});

describe('bmad-catalog without a repo or the script runner (story 4.2)', () => {
  it('the catalog of a missing repo is empty; setup without the script runner rejects (story 4.3)', async () => {
    const real = createBmadCatalog();
    expect(await real.catalog('/no/such/repo')).toEqual({ modules: [], skills: [], agents: [], entryAction: null, capabilities: { plain_labels: false, ticket_tree: false } });
    await expect(real.setupStatus('/no/such/repo')).rejects.toThrow(/4\.3/);
    await expect(real.setup('/no/such/repo', () => {})).rejects.toThrow(/4\.3/);
  });
});
