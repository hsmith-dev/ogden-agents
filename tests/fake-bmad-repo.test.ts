/**
 * The fake BMad repo fixture (story 10.2): it lays out `_bmad/` and
 * `_bmad-output/` only when asked, and its file-tree hash changes with any
 * change to the repo and with nothing else.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, FAKE_TEST_COMMAND_FILES, FAKE_TEST_SCRIPT, FAKE_TESTS_FAIL_MARKER, hashFileTree, type FakeBmadRepo } from './fixtures/fake-bmad-repo.ts';

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

describe("the fake test command (story 5.3; 5.8's re-run and 11.2's Check again)", () => {
  /** Runs it as `npm test` would: one Node process in the project, stdin closed. */
  const run = (cwd: string): { code: number; out: string } => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [FAKE_TEST_SCRIPT], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { code: failed.status, out: failed.stdout };
    }
  };

  it('passes, fails 3 tests while the marker exists, and passes again once it is gone', () => {
    const repo = make({ files: FAKE_TEST_COMMAND_FILES });
    expect(JSON.parse(String(FAKE_TEST_COMMAND_FILES['package.json'])).scripts.test).toBe(`node ${FAKE_TEST_SCRIPT}`);
    expect(run(repo.path)).toEqual({ code: 0, out: 'Tests: 5 passed, 5 total\n' });
    writeFileSync(join(repo.path, FAKE_TESTS_FAIL_MARKER), 'fail\n');
    expect(run(repo.path)).toEqual({ code: 1, out: 'Tests: 3 failed, 2 passed, 5 total\n' });
    rmSync(join(repo.path, FAKE_TESTS_FAIL_MARKER));
    expect(run(repo.path).code).toBe(0);
  });
});
