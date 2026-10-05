/**
 * The Grok server test hook (epic 12 entry 7): a Node script inside the temp
 * folder plays Grok's `codex-acp` adapter, only under a test run on a data
 * folder inside the temp folder; for anyone else the pinned adapter runs as
 * shipped. Nothing here starts a server or an agent.
 */
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { grokWiring } from '../src/grok-wiring.js';
import { GROK_SERVER_ENV, resolveTestHooks, testGrokServer, testHooksLogFields } from '../src/test-hooks.js';
import { tempDataDir } from './helpers.js';

const OUTSIDE = process.cwd();
const run = { NODE_ENV: 'test' };

const script = () => {
  const file = join(tempDataDir(), 'grok-server.mjs');
  writeFileSync(file, '');
  return file;
};

describe('testGrokServer (epic 12 entry 7)', () => {
  it('gives the script inside the temp folder by its real path, when hooks are allowed', () => {
    const file = script();
    expect(testGrokServer({ ...run, [GROK_SERVER_ENV]: file }, tempDataDir())).toBe(realpathSync.native(file));
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset', () => {
    const missing = join(tempDataDir(), 'missing.mjs');
    expect(testGrokServer({ [GROK_SERVER_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testGrokServer({ ...run, [GROK_SERVER_ENV]: missing }, OUTSIDE)).toBeUndefined();
    expect(testGrokServer({ ...run }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path and a script outside the temp folder is ignored', () => {
    expect(() => testGrokServer({ ...run, [GROK_SERVER_ENV]: 'server.mjs' }, tempDataDir())).toThrow(/must be an absolute path/);
    expect(testGrokServer({ ...run, [GROK_SERVER_ENV]: join(OUTSIDE, 'tests', 'fixtures', 'fake-grok.mjs') }, tempDataDir())).toBeUndefined();
  });

  it('is read for start only when no test gave or left out Grok, shows in the log line, and picks the script the wiring runs', () => {
    const file = script();
    const env = { ...run, [GROK_SERVER_ENV]: file };
    const hooks = resolveTestHooks(env, tempDataDir(), { ownsCore: true });
    expect(hooks.grokServer).toBe(realpathSync.native(file));
    expect(testHooksLogFields(hooks)).toMatchObject({ grokServer: true });
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, grok: false }).grokServer).toBeUndefined();
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, grok: {} }).grokServer).toBeUndefined();
    expect(grokWiring({ dataDir: tempDataDir(), serverScript: hooks.grokServer }).descriptor.agentId).toBe('grok');
  });
});
