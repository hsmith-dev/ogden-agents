/**
 * The upstream BMad Method fixture as a pinned source (story 4.14; shared by
 * the server tests and the installed-package suite since story 4.13): the
 * fixture folder as codeload would serve it, a lock pinning its content
 * hash, and the uv-managed Python the real-uv tests run BMad Method's
 * scripts with. No network: the tarball is built in memory.
 *
 * Plain Node only (no test runner import), so Vitest and Playwright specs can
 * both use it.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gunzipLimited, hashEntries, parseTar, selectVerified } from '../../packages/adapters/src/bmad-source/archive.ts';
import { repoTarGz, type TarEntry } from './tar.js';

/** The upstream fixture (`tests/fixtures/bmad-upstream`): the pinned `tickets.py`, and `setup.py` with its payload and module records (story 4.3), unchanged. */
export const UPSTREAM_FIXTURE = fileURLToPath(new URL('./bmad-upstream', import.meta.url));
export const FIXTURE_COMMIT = 'c0ffee'.padEnd(40, '0');
/** The tarball's top folder, as codeload names it. */
export const FIXTURE_TOP = `BMAD-METHOD-${FIXTURE_COMMIT}`;

/**
 * The Python the real-uv tests run BMad Method's scripts with: a uv-managed
 * CPython of this minor version, never a Python preinstalled on the computer.
 * CI provisions it with `uv python install` (ci.yml, the only step that
 * downloads it); the tests never download it.
 */
export const TEST_PYTHON = '3.12';

/** The fixture (plus `extra` entries, paths under {@link FIXTURE_TOP}) as a codeload tarball, and a lock pinning its content hash. */
export function fixtureSource(extra: readonly TarEntry[] = []) {
  const tarball = repoTarGz(UPSTREAM_FIXTURE, FIXTURE_TOP, extra);
  const contentHash = hashEntries(selectVerified(parseTar(gunzipLimited(tarball, 64 * 1024 * 1024)), 'skills/'));
  const lock = {
    sources: {
      'bmad-method': { repo: 'bmad-code-org/BMAD-METHOD', ref: 'main', commit: FIXTURE_COMMIT, version: '6.13.0-fixture', include: 'skills/', contentHash },
    },
  };
  return { tarball, lock };
}

/** Whether `uv` is on PATH and has the uv-managed {@link TEST_PYTHON} installed (no download). */
export function hasManagedPython(): boolean {
  try {
    execFileSync('uv', ['python', 'find', '--managed-python', '--no-python-downloads', TEST_PYTHON], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Whether the real-uv tests skip: never in CI (it provisions uv and the managed Python), else when either is missing. */
export function realUvMissing(): boolean {
  return process.env.CI === undefined && !hasManagedPython();
}
