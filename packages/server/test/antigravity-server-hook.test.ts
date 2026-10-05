/**
 * The Antigravity server test hook (epic 6 entry 8): a Node script inside
 * the temp folder plays Antigravity's ACP server, only under a test run on a
 * data folder inside the temp folder; for anyone else the pinned server runs
 * as shipped. Nothing here starts a server or an agent.
 */
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANTIGRAVITY_SERVER_ENV, resolveTestHooks, testAntigravityServer, testHooksLogFields } from '../src/test-hooks.js';
import { tempDataDir } from './helpers.js';

/** Not inside the temp folder: this repository's checkout (a user's data folder stands for it). */
const OUTSIDE = process.cwd();
const run = { NODE_ENV: 'test' };

const script = () => {
  const file = join(tempDataDir(), 'antigravity-server.mjs');
  writeFileSync(file, '');
  return file;
};

describe('testAntigravityServer (epic 6 entry 8)', () => {
  it('gives the script inside the temp folder by its real path, when hooks are allowed', () => {
    const file = script();
    expect(testAntigravityServer({ ...run, [ANTIGRAVITY_SERVER_ENV]: file }, tempDataDir())).toBe(realpathSync.native(file));
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset; the file is then never checked', () => {
    const missing = join(tempDataDir(), 'missing.mjs');
    expect(testAntigravityServer({ [ANTIGRAVITY_SERVER_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testAntigravityServer({ NODE_ENV: 'production', VITEST: '', [ANTIGRAVITY_SERVER_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testAntigravityServer({ ...run, [ANTIGRAVITY_SERVER_ENV]: missing }, OUTSIDE)).toBeUndefined();
    expect(testAntigravityServer({ ...run }, tempDataDir())).toBeUndefined();
    expect(testAntigravityServer({ ...run, [ANTIGRAVITY_SERVER_ENV]: '' }, tempDataDir())).toBeUndefined();
  });

  it('ignores a script outside the temp folder and a link in temp that leads out of it', () => {
    expect(testAntigravityServer({ ...run, [ANTIGRAVITY_SERVER_ENV]: join(OUTSIDE, 'tests', 'fixtures', 'fake-antigravity.mjs') }, tempDataDir())).toBeUndefined();
    const link = join(tempDataDir(), 'antigravity-server.mjs');
    try {
      symlinkSync(join(OUTSIDE, 'tests', 'fixtures', 'fake-antigravity.mjs'), link);
    } catch {
      return; // No symlinks here (Windows without the privilege).
    }
    expect(testAntigravityServer({ ...run, [ANTIGRAVITY_SERVER_ENV]: link }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path, a file that is not a Node script, a missing file and a folder', () => {
    const at = (file: string) => () => testAntigravityServer({ ...run, [ANTIGRAVITY_SERVER_ENV]: file }, tempDataDir());
    expect(at('server.mjs')).toThrow(new RegExp(`${ANTIGRAVITY_SERVER_ENV}: must be an absolute path`));
    expect(at(join(tempDataDir(), 'agy_acp_server.exe'))).toThrow(/must be a Node script/);
    const folder = join(tempDataDir(), 'server.mjs');
    mkdirSync(folder);
    expect(at(folder)).toThrow(/not a file/);
    expect(at(join(tempDataDir(), 'missing.mjs'))).toThrow(/unreadable \(ENOENT\)/);
  });

  it('is read for start only when no test gave or left out Antigravity, and shows in the "test hooks in use" line', () => {
    const file = script();
    const env = { ...run, [ANTIGRAVITY_SERVER_ENV]: file };
    const hooks = resolveTestHooks(env, tempDataDir(), { ownsCore: true });
    expect(hooks.antigravityServer).toBe(realpathSync.native(file));
    expect(testHooksLogFields(hooks)).toMatchObject({ antigravityServer: true });
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, antigravity: false }).antigravityServer).toBeUndefined();
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, antigravity: {} }).antigravityServer).toBeUndefined();
    expect(resolveTestHooks(env, OUTSIDE, { ownsCore: true }).antigravityServer).toBeUndefined();
  });
});
