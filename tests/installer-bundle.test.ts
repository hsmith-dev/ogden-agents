/**
 * The built install helper (`packages/server/dist-installer/ogden-install.mjs`,
 * a release asset the start scripts run, story 3): one file, nothing from
 * node_modules, and never part of the npm package. Needs `pnpm build`, which
 * `pnpm test` runs first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = join(ROOT, 'packages', 'server', 'dist-installer', 'ogden-install.mjs');

describe('ogden-install.mjs', () => {
  it('is built, and imports only Node built-ins', () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const specifiers = [...readFileSync(BUNDLE, 'utf8').matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => !specifier?.startsWith('node:'))).toEqual([]);
  });

  it('is not in the dist/ the npm package ships', () => {
    expect(existsSync(join(ROOT, 'dist', 'ogden-install.mjs'))).toBe(false);
  });

  it('status runs with no network and no install, and shows where it would install', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'ogden install bundle '));
    try {
      const result = spawnSync(process.execPath, [BUNDLE, 'status'], { encoding: 'utf8', env: { ...process.env, OGDEN_AGENTS_APP_DIR: appDir, OGDEN_AGENTS_REPO: 'o/r' } });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('GitHub Releases of o/r');
      expect(result.stdout).toContain(`App folder: ${appDir}`);
      expect(result.stdout).toContain('Installed: nothing yet');
      expect(spawnSync(process.execPath, [BUNDLE, 'bogus'], { encoding: 'utf8', env: { ...process.env, OGDEN_AGENTS_APP_DIR: appDir } }).status).toBe(2);
    } finally {
      rmSync(appDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
