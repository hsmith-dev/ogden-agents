/**
 * `scripts/bmad-lock.mjs` without the network (story 4.14): it hashes a
 * tarball exactly as the app does (the same `archive.ts`), names a hash that
 * doesn't match the lock, and accepts a commit only when GitHub's compare
 * says it is in the history of the lock's ref (a stubbed API), and, for the
 * maintained fork, that its upstream base is in upstream's history and an
 * ancestor of the pinned commit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gunzipLimited, hashEntries, parseTar, selectVerified } from '../packages/adapters/src/bmad-source/archive.ts';
import { checkBase, checkHash, checkHistory, contentHashOf, tarballUrl } from '../scripts/bmad-lock.mjs';
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
    expect(await checkHistory('bmad-method', PIN, api('identical'))).toEqual([]);
    expect(await checkHistory('bmad-method', PIN, api('behind'))).toEqual([]);
    expect(await checkHistory('bmad-method', PIN, api('diverged'))).toEqual([`bmad-method: ${COMMIT} is not in the history of o/r main (compare status diverged)`]);
    expect(await checkHistory('bmad-method', PIN, api(new Error('HTTP 404')))).toEqual([`bmad-method: could not compare main...${COMMIT} in o/r: HTTP 404`]);
  });

  it("checks a fork pin's upstream base: in upstream's history and an ancestor of the pinned commit (maintained-fork story)", async () => {
    const BASE = 'b'.repeat(40);
    const fork = { ...PIN, repo: 'me/r', ref: 'ogden-agents/2026-10-04', base: { repo: 'up/r', ref: 'main', commit: BASE } };
    const api = (answers: Record<string, string>) => async (path: string) => {
      if (!(path in answers)) throw new Error(`HTTP 404 ${path}`);
      return { status: answers[path] };
    };
    const good = { [`/repos/up/r/compare/main...${BASE}`]: 'behind', [`/repos/me/r/compare/${BASE}...${COMMIT}`]: 'ahead' };
    expect(await checkBase('bmad-method', fork, api(good))).toEqual([]);
    expect(await checkBase('bmad-method', PIN, api({}))).toEqual([]);
    expect(await checkBase('bmad-method', fork, api({ ...good, [`/repos/up/r/compare/main...${BASE}`]: 'diverged' }))).toEqual([
      `bmad-method base: ${BASE} is not in the history of up/r main (compare status diverged)`,
    ]);
    expect(await checkBase('bmad-method', fork, api({ ...good, [`/repos/me/r/compare/${BASE}...${COMMIT}`]: 'diverged' }))).toEqual([
      `bmad-method: me/r@${COMMIT} is not built on up/r@${BASE} (compare status diverged)`,
    ]);
  });

  it('checks the shipped lock file: the maintained fork, on an upstream base (user decision 2026-10-04)', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'packages', 'adapters', 'src', 'bmad-source', 'bmad-lock.json'), 'utf8')) as {
      sources: Record<string, { repo: string; ref: string; base?: { repo: string } }>;
    };
    expect(Object.keys(lock.sources).sort()).toEqual(['bmad-method']);
    for (const source of Object.values(lock.sources)) {
      expect(source.repo).toBe('hsmith-dev/BMAD-METHOD');
      // A tag, never the moving branch: a rebase of `ogden-agents` keeps every released pin in some tag's history.
      expect(source.ref).toMatch(/^ogden-agents\/\d{4}-\d{2}-\d{2}(?:\.\d+)?$/);
      expect(source.base?.repo).toBe('bmad-code-org/BMAD-METHOD');
    }
  });
});
