/**
 * The `catalog-memory` stub of `BmadCatalogPort.detect` (story 10.2): it
 * answers what it was told, async, records each call, and reports a path it
 * doesn't know as having neither folder, as the real adapter does for a
 * missing repo.
 */
import { describe, expect, it } from 'vitest';
import { createMemoryBmadCatalog } from '../src/index.js';

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
