/**
 * The Codex server test hook (epic 12 entry 5): a Node script inside the temp
 * folder plays Codex's `codex-acp` adapter, only under a test run on a data
 * folder inside the temp folder; for anyone else the pinned adapter runs as
 * shipped. Nothing here starts a server or an agent.
 */
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexWiring } from '../src/codex-wiring.js';
import { CODEX_SERVER_ENV, resolveTestHooks, testCodexServer, testHooksLogFields } from '../src/test-hooks.js';
import { tempDataDir } from './helpers.js';

const OUTSIDE = process.cwd();
const run = { NODE_ENV: 'test' };

const script = () => {
  const file = join(tempDataDir(), 'codex-server.mjs');
  writeFileSync(file, '');
  return file;
};

describe('testCodexServer (epic 12 entry 5)', () => {
  it('gives the script inside the temp folder by its real path, when hooks are allowed', () => {
    const file = script();
    expect(testCodexServer({ ...run, [CODEX_SERVER_ENV]: file }, tempDataDir())).toBe(realpathSync.native(file));
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset', () => {
    const missing = join(tempDataDir(), 'missing.mjs');
    expect(testCodexServer({ [CODEX_SERVER_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testCodexServer({ ...run, [CODEX_SERVER_ENV]: missing }, OUTSIDE)).toBeUndefined();
    expect(testCodexServer({ ...run }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path and a script outside the temp folder is ignored', () => {
    expect(() => testCodexServer({ ...run, [CODEX_SERVER_ENV]: 'server.mjs' }, tempDataDir())).toThrow(/must be an absolute path/);
    expect(testCodexServer({ ...run, [CODEX_SERVER_ENV]: join(OUTSIDE, 'tests', 'fixtures', 'fake-codex.mjs') }, tempDataDir())).toBeUndefined();
  });

  it('is read for start only when no test gave or left out Codex, shows in the log line, and picks the script the wiring runs', () => {
    const file = script();
    const env = { ...run, [CODEX_SERVER_ENV]: file };
    const hooks = resolveTestHooks(env, tempDataDir(), { ownsCore: true });
    expect(hooks.codexServer).toBe(realpathSync.native(file));
    expect(testHooksLogFields(hooks)).toMatchObject({ codexServer: true });
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, codex: false }).codexServer).toBeUndefined();
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, codex: {} }).codexServer).toBeUndefined();
    expect(codexWiring({ dataDir: tempDataDir(), serverScript: hooks.codexServer }).descriptor.agentId).toBe('codex');
  });
});
