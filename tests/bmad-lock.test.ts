/**
 * `scripts/bmad-lock.mjs` without the network (story 4.14): it hashes a
 * tarball exactly as the app does (the same `archive.ts`), names a hash that
 * doesn't match the lock, and accepts a commit only when GitHub's compare
 * says it is in the history of the lock's ref (a stubbed API).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gunzipLimited, hashEntries, parseTar, selectVerified } from '../packages/adapters/src/bmad-source/archive.ts';
import { checkHash, checkHistory, contentHashOf, tarballUrl } from '../scripts/bmad-lock.mjs';
import { repoTarGz } from './fixtures/tar.js';

const ROOT = join(import.meta.dirname, '..');
const COMMIT = 'a'.repeat(40);
const PIN = { repo: 'o/r', ref: 'main', commit: COMMIT, version: '1.0.0', include: 'skills/', contentHash: `sha256:${'0'.repeat(64)}` };

describe('bmad-lock.mjs', () => {
  it('names the exact commit tarball', () => {
    expect(tarballUrl(PIN)).toBe(`https://codeload.github.com/o/r/tar.gz/${COMMIT}`);
  });

  it('hashes a tarball as the app does', () => {
    const tarball = repoTarGz(join(ROOT, 'tests', 'fixtures', 'bmad-upstream'), `r-${COMMIT}`);
    const selected = selectVerified(parseTar(gunzipLimited(tarball, 1 << 26)), 'skills/');
    const app = hashEntries(selected);
    expect(contentHashOf(tarball, 'skills/')).toEqual({ hash: app, files: selected.size });
    expect(checkHash('bmad-method', { ...PIN, contentHash: app }, app)).toEqual([]);
    expect(checkHash('bmad-method', PIN, app)).toEqual([`bmad-method: o/r@${COMMIT} hashes ${app}, but bmad-lock.json pins ${PIN.contentHash}`]);
  });

  it("accepts a commit in the ref's history (identical or behind) and names any other", async () => {
    const api = (status: string | Error) => async (path: string) => {
      expect(path).toBe(`/repos/o/r/compare/main...${COMMIT}`);
      if (status instanceof Error) throw status;
      return { status };
    };
    expect(await checkHistory('bmad-loop', PIN, api('identical'))).toEqual([]);
    expect(await checkHistory('bmad-loop', PIN, api('behind'))).toEqual([]);
    expect(await checkHistory('bmad-loop', PIN, api('diverged'))).toEqual([`bmad-loop: ${COMMIT} is not in the history of o/r main (compare status diverged)`]);
    expect(await checkHistory('bmad-loop', PIN, api(new Error('HTTP 404')))).toEqual([`bmad-loop: could not compare main...${COMMIT} in o/r: HTTP 404`]);
  });

  it('checks the shipped lock file', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'packages', 'adapters', 'src', 'bmad-source', 'bmad-lock.json'), 'utf8')) as { sources: Record<string, { repo: string }> };
    expect(Object.keys(lock.sources).sort()).toEqual(['bmad-loop', 'bmad-method']);
    for (const source of Object.values(lock.sources)) expect(source.repo.startsWith('bmad-code-org/')).toBe(true);
  });
});
