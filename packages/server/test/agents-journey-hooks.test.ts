/**
 * The epic 6 journey's test hooks (entry 10): Antigravity's install from a
 * local fixture archive (pins in a JSON file, every archive on
 * `http://127.0.0.1`) and a test agent that needs a trusted project. Each is
 * honoured only under a test run on a data folder inside the temp folder;
 * for anyone else nothing changes. Nothing here starts a server or an agent.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANTIGRAVITY_INSTALL_ENV, resolveTestHooks, testAntigravityInstall, testHooksLogFields, testTrustAgent, TRUST_AGENT_ENV } from '../src/test-hooks.js';
import { tempDataDir } from './helpers.js';

const OUTSIDE = process.cwd();
const run = { NODE_ENV: 'test' };

const pin = (url: string) => ({ url, sha256: 'a'.repeat(64), size: 10, binary: 'agy_acp_server.par', args: [], files: { 'agy_acp_server.par': { size: 10, sha256: 'b'.repeat(64) } } });
const pinsFile = (archives: Record<string, unknown>) => {
  const file = join(tempDataDir(), 'antigravity-install.json');
  writeFileSync(file, JSON.stringify({ pins: { registry: 'antigravity-acp', version: '1.3.0', archives } }));
  return file;
};

describe('testAntigravityInstall (epic 6 entry 10)', () => {
  it('gives pins whose every archive is on 127.0.0.1, when hooks are allowed', () => {
    const file = pinsFile({ 'linux-x64': pin('http://127.0.0.1:4100/agy.zip') });
    expect(testAntigravityInstall({ ...run, [ANTIGRAVITY_INSTALL_ENV]: file }, tempDataDir())?.pins.archives).toHaveProperty('linux-x64');
    // No archive for any computer: the unsupported message's pins.
    expect(testAntigravityInstall({ ...run, [ANTIGRAVITY_INSTALL_ENV]: pinsFile({}) }, tempDataDir())?.pins.archives).toEqual({});
  });

  it('is ignored for an archive anywhere but loopback, outside a test run, outside the temp folder, or unset', () => {
    for (const url of ['https://dl.google.com/agy.zip', 'http://localhost:1/agy.zip', 'file:///tmp/agy.zip', 'http://127.0.0.2/agy.zip']) {
      expect(testAntigravityInstall({ ...run, [ANTIGRAVITY_INSTALL_ENV]: pinsFile({ 'linux-x64': pin(url) }) }, tempDataDir()), url).toBeUndefined();
    }
    const file = pinsFile({ 'linux-x64': pin('http://127.0.0.1:1/agy.zip') });
    expect(testAntigravityInstall({ [ANTIGRAVITY_INSTALL_ENV]: file }, tempDataDir())).toBeUndefined();
    expect(testAntigravityInstall({ ...run, [ANTIGRAVITY_INSTALL_ENV]: file }, OUTSIDE)).toBeUndefined();
    expect(testAntigravityInstall({ ...run, [ANTIGRAVITY_INSTALL_ENV]: join(OUTSIDE, 'package.json') }, tempDataDir())).toBeUndefined();
    expect(testAntigravityInstall({ ...run }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path, an unreadable file and malformed pins', () => {
    const at = (file: string) => () => testAntigravityInstall({ ...run, [ANTIGRAVITY_INSTALL_ENV]: file }, tempDataDir());
    expect(at('pins.json')).toThrow(/must be an absolute path/);
    expect(at(join(tempDataDir(), 'missing.json'))).toThrow(/unreadable \(ENOENT\)/);
    const bad = join(tempDataDir(), 'bad.json');
    writeFileSync(bad, JSON.stringify({ pins: { version: '1' } }));
    expect(at(bad)).toThrow(/needs pins/);
    expect(at(pinsFile({ 'linux-x64': { url: 'http://127.0.0.1:1/a.zip' } }))).toThrow(/needs a url, sha256, size and files/);
  });
});

describe('testTrustAgent (epic 6 entry 10)', () => {
  it('gives the script inside the temp folder, only when hooks are allowed', () => {
    const file = join(tempDataDir(), 'trust-agent.mjs');
    writeFileSync(file, '');
    expect(testTrustAgent({ ...run, [TRUST_AGENT_ENV]: file }, tempDataDir())).toBeDefined();
    expect(testTrustAgent({ [TRUST_AGENT_ENV]: file }, tempDataDir())).toBeUndefined();
    expect(testTrustAgent({ ...run, [TRUST_AGENT_ENV]: file }, OUTSIDE)).toBeUndefined();
  });

  it('both are read for start only when no test decides them, and show in the "test hooks in use" line', () => {
    const script = join(tempDataDir(), 'trust-agent.mjs');
    writeFileSync(script, '');
    const env = { ...run, [TRUST_AGENT_ENV]: script, [ANTIGRAVITY_INSTALL_ENV]: pinsFile({}) };
    const hooks = resolveTestHooks(env, tempDataDir(), { ownsCore: true });
    expect(hooks.trustAgent).toBeDefined();
    expect(hooks.antigravityInstall).toBeDefined();
    expect(testHooksLogFields(hooks)).toMatchObject({ trustAgent: true, antigravityInstall: true });
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, extraAgents: [] }).trustAgent).toBeUndefined();
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, antigravity: false }).antigravityInstall).toBeUndefined();
  });
});
