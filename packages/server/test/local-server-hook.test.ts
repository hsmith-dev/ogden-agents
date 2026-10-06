/**
 * The Local model's server test hooks (epic 14 story 14.2): a Node script
 * inside the temp folder plays the pinned harness, and a loopback endpoint is
 * named for its chats, only under a test run on a data folder inside the temp
 * folder; for anyone else the shipped behavior runs. Nothing here starts a
 * server or an agent.
 */
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localWiring } from '../src/local-wiring.js';
import { LOCAL_ENDPOINT_ENV, LOCAL_SERVER_ENV, resolveTestHooks, testHooksLogFields, testLocalEndpoint, testLocalServer } from '../src/test-hooks.js';
import { tempDataDir } from './helpers.js';

const OUTSIDE = process.cwd();
const run = { NODE_ENV: 'test' };

const script = () => {
  const file = join(tempDataDir(), 'local-server.mjs');
  writeFileSync(file, '');
  return file;
};

describe('testLocalServer', () => {
  it('gives the script inside the temp folder by its real path, when hooks are allowed', () => {
    const file = script();
    expect(testLocalServer({ ...run, [LOCAL_SERVER_ENV]: file }, tempDataDir())).toBe(realpathSync.native(file));
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset', () => {
    const missing = join(tempDataDir(), 'missing.mjs');
    expect(testLocalServer({ [LOCAL_SERVER_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testLocalServer({ ...run, [LOCAL_SERVER_ENV]: missing }, OUTSIDE)).toBeUndefined();
    expect(testLocalServer({ ...run }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path, and ignores a script outside the temp folder', () => {
    expect(() => testLocalServer({ ...run, [LOCAL_SERVER_ENV]: 'server.mjs' }, tempDataDir())).toThrow(/must be an absolute path/);
    expect(testLocalServer({ ...run, [LOCAL_SERVER_ENV]: join(OUTSIDE, 'tests', 'fixtures', 'fake-opencode.mjs') }, tempDataDir())).toBeUndefined();
  });
});

describe('testLocalEndpoint', () => {
  const endpoint = (value: unknown) => ({ ...run, [LOCAL_ENDPOINT_ENV]: typeof value === 'string' ? value : JSON.stringify(value) });

  it('names a loopback endpoint (and a dummy key and a model), when hooks are allowed', async () => {
    const source = testLocalEndpoint(endpoint({ baseUrl: 'http://127.0.0.1:5555/v1', key: 'dummy', model: 'fake-large' }), tempDataDir())!;
    expect(await source()).toEqual({ baseUrl: 'http://127.0.0.1:5555/v1', key: 'dummy', model: 'fake-large' });
    expect(testLocalEndpoint(endpoint({ baseUrl: 'http://localhost:1234/v1' }), tempDataDir())).toBeDefined();
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset', () => {
    const value = JSON.stringify({ baseUrl: 'http://127.0.0.1:5555/v1' });
    expect(testLocalEndpoint({ [LOCAL_ENDPOINT_ENV]: value }, tempDataDir())).toBeUndefined();
    expect(testLocalEndpoint(endpoint(value), OUTSIDE)).toBeUndefined();
    expect(testLocalEndpoint({ ...run }, tempDataDir())).toBeUndefined();
  });

  it('refuses, loudly, anything but a loopback http endpoint, and bad JSON', () => {
    for (const baseUrl of ['https://api.example.com/v1', 'http://192.168.1.5:1234/v1', 'http://example.com/v1', 'ftp://127.0.0.1/v1', 'nonsense']) {
      expect(() => testLocalEndpoint(endpoint({ baseUrl }), tempDataDir()), baseUrl).toThrow(/baseUrl must be/);
    }
    expect(() => testLocalEndpoint(endpoint('not json'), tempDataDir())).toThrow(/not JSON/);
    expect(() => testLocalEndpoint(endpoint({}), tempDataDir())).toThrow(/baseUrl must be/);
  });
});

describe('the hooks together', () => {
  it('are read for start only when no test gave or left out the Local model, and show in the log line', () => {
    const file = script();
    const env = { ...run, [LOCAL_SERVER_ENV]: file, [LOCAL_ENDPOINT_ENV]: JSON.stringify({ baseUrl: 'http://127.0.0.1:5555/v1' }) };
    const hooks = resolveTestHooks(env, tempDataDir(), { ownsCore: true });
    expect(hooks.localServer).toBe(realpathSync.native(file));
    expect(hooks.localEndpoint).toBeDefined();
    expect(testHooksLogFields(hooks)).toMatchObject({ localServer: true, localEndpoint: true });
    for (const local of [false as const, {}]) {
      const given = resolveTestHooks(env, tempDataDir(), { ownsCore: true, local });
      expect(given.localServer).toBeUndefined();
      expect(given.localEndpoint).toBeUndefined();
    }
    expect(localWiring({ dataDir: tempDataDir(), serverScript: hooks.localServer, target: hooks.localEndpoint }).descriptor.agentId).toBe('local');
  });
});
