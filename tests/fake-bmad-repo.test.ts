/**
 * The fake BMad repo fixture (story 10.2): it lays out `_bmad/` and
 * `_bmad-output/` only when asked, and its file-tree hash changes with any
 * change to the repo and with nothing else.
 */
import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, hashFileTree, type FakeBmadRepo } from './fixtures/fake-bmad-repo.ts';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});
const make = (...args: Parameters<typeof createFakeBmadRepo>) => {
  const repo = createFakeBmadRepo(...args);
  repos.push(repo);
  return repo;
};

describe('the fake BMad repo', () => {
  it('has _bmad/ by default, _bmad-output/ only when asked, and neither for a plain repo', () => {
    const bmad = make();
    expect(statSync(join(bmad.path, '_bmad')).isDirectory()).toBe(true);
    expect(existsSync(join(bmad.path, '_bmad-output'))).toBe(false);
    const both = make({ output: true });
    expect(statSync(join(both.path, '_bmad-output')).isDirectory()).toBe(true);
    const plain = make({ bmad: false, files: { 'src/index.ts': 'export {};\n' } });
    expect(existsSync(join(plain.path, '_bmad'))).toBe(false);
    expect(existsSync(join(plain.path, 'src', 'index.ts'))).toBe(true);
  });

  it('hashes the tree: the same after touching timestamps, different after a write or a new folder', () => {
    const repo = make({ output: true });
    const before = repo.hash();
    expect(hashFileTree(repo.path)).toBe(before);
    utimesSync(join(repo.path, 'README.md'), new Date(0), new Date(0));
    expect(repo.hash()).toBe(before);

    writeFileSync(join(repo.path, 'README.md'), '# Changed\n');
    const changed = repo.hash();
    expect(changed).not.toBe(before);
    mkdirSync(join(repo.path, '_bmad', 'empty'));
    expect(repo.hash()).not.toBe(changed);
  });
});
