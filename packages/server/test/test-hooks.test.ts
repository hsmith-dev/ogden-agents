/**
 * The test hooks (story 9.7): an install source and an accepting API key
 * check, beside the in-memory secret store. They act only under a test
 * runner (`NODE_ENV=test` or `VITEST`) on a data folder inside the OS temp
 * folder, with their own variable set; for anyone else they are inert. A
 * test install must still be a local `file:` fixture pinned by integrity. No
 * test here installs anything or reaches the network.
 */
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_KEY_CHECK_ENV, CLAUDE_CLI_ENV, CLAUDE_INSTALL_ENV, insideTemp, isTestRun, testApiKeyCheck, testClaudeCli, testClaudeInstall, testHooksAllowed } from '../src/test-hooks.js';
import { startTestServer, tempDataDir } from './helpers.js';

const INTEGRITY = 'sha512-QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
/** Not inside the temp folder: this repository's checkout (a user's data folder stands for it). */
const OUTSIDE = process.cwd();
const NPM_CLI = join(OUTSIDE, 'npm', 'bin', 'npm-cli.js');

const pins = (entry: Record<string, unknown> = {}) => ({
  packageJson: { name: 'ogden-agents-claude-code', private: true },
  lock: {
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/@agentclientprotocol/claude-agent-acp': { version: '0.0.0-fixture', resolved: 'file:/tmp/fixture.tgz', integrity: INTEGRITY, ...entry } },
  },
});

/** Writes `body` (JSON unless a string) to a file in a fresh temp folder and returns its path. */
function installFile(body: unknown): string {
  const file = join(tempDataDir(), 'install.json');
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isTestRun and testHooksAllowed', () => {
  it('a test run is NODE_ENV=test or a non-empty VITEST', () => {
    expect(isTestRun({ NODE_ENV: 'test' })).toBe(true);
    expect(isTestRun({ VITEST: 'true' })).toBe(true);
    expect(isTestRun({})).toBe(false);
    expect(isTestRun({ NODE_ENV: 'production', VITEST: '' })).toBe(false);
    expect(isTestRun({ NODE_ENV: 'TEST' })).toBe(false);
  });

  it('hooks are allowed only in a test run on a data folder inside the temp folder', () => {
    const dir = tempDataDir();
    expect(testHooksAllowed({ NODE_ENV: 'test' }, dir)).toBe(true);
    expect(testHooksAllowed({}, dir)).toBe(false);
    expect(testHooksAllowed({ NODE_ENV: 'test' }, OUTSIDE)).toBe(false);
    // The temp folder itself, and a folder that doesn't exist, don't count.
    expect(testHooksAllowed({ NODE_ENV: 'test' }, tmpdir())).toBe(false);
    expect(testHooksAllowed({ NODE_ENV: 'test' }, join(dir, 'missing'))).toBe(false);
  });

  it('compares real paths: a temp folder reached through a link still counts, and a link out of it does not', () => {
    const dir = tempDataDir();
    const inside = join(dir, 'inside');
    mkdirSync(inside);
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      symlinkSync(OUTSIDE, join(dir, 'out'), type);
      symlinkSync(tmpdir(), join(dir, 'tmp-link'), type);
    } catch {
      return; // No links here: macOS's /var → /private/var covers real paths on CI.
    }
    expect(insideTemp(inside)).toBe(true);
    expect(insideTemp(join(dir, 'out'))).toBe(false);
    expect(insideTemp(inside, join(dir, 'tmp-link'))).toBe(true);
  });
});

describe('testApiKeyCheck', () => {
  it('accepts every key only when hooks are allowed and the variable is accept', async () => {
    const check = testApiKeyCheck({ NODE_ENV: 'test', [API_KEY_CHECK_ENV]: 'accept' }, tempDataDir());
    expect(check).toBeDefined();
    expect(await check!('sk-ant-anything', new AbortController().signal)).toBe('ok');
  });

  it('is inert outside a test run, on a data folder outside the temp folder, unset, or set to anything else', () => {
    const dir = tempDataDir();
    expect(testApiKeyCheck({ [API_KEY_CHECK_ENV]: 'accept' }, dir)).toBeUndefined();
    expect(testApiKeyCheck({ [API_KEY_CHECK_ENV]: 'accept', NODE_ENV: 'production', VITEST: '' }, dir)).toBeUndefined();
    expect(testApiKeyCheck({ [API_KEY_CHECK_ENV]: 'accept', NODE_ENV: 'test' }, OUTSIDE)).toBeUndefined();
    expect(testApiKeyCheck({ NODE_ENV: 'test' }, dir)).toBeUndefined();
    expect(testApiKeyCheck({ NODE_ENV: 'test', [API_KEY_CHECK_ENV]: 'ACCEPT' }, dir)).toBeUndefined();
  });
});

describe('testClaudeInstall', () => {
  const env = (file: string, extra: Record<string, string> = { NODE_ENV: 'test' }) => ({ ...extra, [CLAUDE_INSTALL_ENV]: file });

  it('reads the pins (and npm) from a file inside the temp folder, when hooks are allowed', () => {
    expect(testClaudeInstall(env(installFile({ pins: pins(), npmCli: NPM_CLI })), tempDataDir())).toEqual({ pins: pins(), npmCli: NPM_CLI });
    expect(testClaudeInstall(env(installFile({ pins: pins() }), { VITEST: 'true' }), tempDataDir())).toEqual({ pins: pins() });
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset; the file is then never read', () => {
    const missing = join(tempDataDir(), 'missing.json');
    expect(testClaudeInstall(env(missing, {}), tempDataDir())).toBeUndefined();
    expect(testClaudeInstall(env(missing, { NODE_ENV: 'production', VITEST: '' }), tempDataDir())).toBeUndefined();
    expect(testClaudeInstall(env(missing), OUTSIDE)).toBeUndefined();
    expect(testClaudeInstall({ NODE_ENV: 'test' }, tempDataDir())).toBeUndefined();
    expect(testClaudeInstall(env(''), tempDataDir())).toBeUndefined();
  });

  it('ignores a file outside the temp folder', () => {
    expect(testClaudeInstall(env(join(OUTSIDE, 'package.json')), tempDataDir())).toBeUndefined();
  });

  it('ignores pins that are not all a local file: fixture (the registry, a git URL, none)', () => {
    for (const resolved of ['https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-0.1.0.tgz', 'git+https://example.com/x.git', '', undefined]) {
      expect(testClaudeInstall(env(installFile({ pins: pins({ resolved }) })), tempDataDir())).toBeUndefined();
    }
  });

  it('refuses a package without a sha512 integrity: a test install is checked as a real one is', () => {
    for (const integrity of [undefined, '', 'sha1-abc', 'sha512-', 'sha512-not base64!']) {
      expect(() => testClaudeInstall(env(installFile({ pins: pins({ integrity }) })), tempDataDir())).toThrow(/has no sha512 integrity/);
    }
  });

  it('refuses anything else unusable', () => {
    const dir = tempDataDir();
    expect(() => testClaudeInstall(env('install.json'), dir)).toThrow(/absolute path/);
    expect(() => testClaudeInstall(env(join(dir, 'missing.json')), dir)).toThrow(/unreadable \(ENOENT\)/);
    expect(() => testClaudeInstall(env(installFile('not json')), dir)).toThrow(/unreadable \(bad JSON\)/);
    expect(() => testClaudeInstall(env(installFile({})), dir)).toThrow(/v3 lockfile/);
    expect(() => testClaudeInstall(env(installFile({ pins: { ...pins(), lock: { lockfileVersion: 2, packages: {} } } })), dir)).toThrow(/v3 lockfile/);
    expect(() => testClaudeInstall(env(installFile({ pins: { ...pins(), lock: { lockfileVersion: 3, packages: { '': {} } } } })), dir)).toThrow(/pins no package/);
    expect(() => testClaudeInstall(env(installFile({ pins: pins(), npmCli: 'npm-cli.js' })), dir)).toThrow(/npmCli/);
    expect(() => testClaudeInstall(env(installFile({ pins: pins(), npmCli: join(OUTSIDE, 'evil.js') })), dir)).toThrow(/npmCli/);
  });
});

describe('testClaudeCli (story 3.10)', () => {
  const run = { NODE_ENV: 'test' };
  const cliFile = () => {
    const file = join(tempDataDir(), 'claude.mjs');
    writeFileSync(file, '');
    return file;
  };

  it('gives the stand-in inside the temp folder by its real path, when hooks are allowed', () => {
    const file = cliFile();
    expect(testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: file }, tempDataDir())).toBe(realpathSync.native(file));
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset; the file is then never checked', () => {
    const missing = join(tempDataDir(), 'missing.mjs');
    expect(testClaudeCli({ [CLAUDE_CLI_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: missing }, OUTSIDE)).toBeUndefined();
    expect(testClaudeCli({ ...run }, tempDataDir())).toBeUndefined();
    expect(testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: '' }, tempDataDir())).toBeUndefined();
  });

  it('ignores a script outside the temp folder, present or not, and a link in temp that leads out of it', () => {
    expect(testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: join(OUTSIDE, 'tests', 'fixtures', 'fake-claude-cli.mjs') }, tempDataDir())).toBeUndefined();
    expect(testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: join(OUTSIDE, 'missing.mjs') }, tempDataDir())).toBeUndefined();
    const link = join(tempDataDir(), 'claude.mjs');
    try {
      symlinkSync(join(OUTSIDE, 'tests', 'fixtures', 'fake-claude-cli.mjs'), link);
    } catch {
      return; // No symlinks here (Windows without the privilege).
    }
    expect(testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: link }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path, a file that is not a Node script, a missing file and a folder', () => {
    expect(() => testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: 'claude.mjs' }, tempDataDir())).toThrow(/must be an absolute path/);
    expect(() => testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: join(tempDataDir(), 'claude.cmd') }, tempDataDir())).toThrow(/must be a Node script/);
    const folder = join(tempDataDir(), 'claude.mjs');
    mkdirSync(folder);
    expect(() => testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: folder }, tempDataDir())).toThrow(/not a file/);
    expect(() => testClaudeCli({ ...run, [CLAUDE_CLI_ENV]: join(tempDataDir(), 'missing.mjs') }, tempDataDir())).toThrow(/unreadable \(ENOENT\)/);
  });
});

describe('the server and the hooks', () => {
  const parsed = (lines: string[]) => lines.map((line) => JSON.parse(line) as { msg: string; claudeInstall?: boolean; apiKeyCheck?: boolean; claudeCli?: boolean; backend?: string });
  const hooksLine = (lines: string[]) => parsed(lines).find((line) => line.msg === 'test hooks in use');
  const secretsBackend = (lines: string[]) => parsed(lines).find((line) => line.msg === 'secrets store')?.backend;

  it('outside a test run, a server ignores the variables, even an unusable install file or a missing claude stand-in', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubEnv(CLAUDE_INSTALL_ENV, join(tempDataDir(), 'missing.json'));
    vi.stubEnv(API_KEY_CHECK_ENV, 'accept');
    vi.stubEnv(CLAUDE_CLI_ENV, join(tempDataDir(), 'missing.mjs'));
    const lines: string[] = [];
    await startTestServer({ lines, verifyApiKey: undefined });
    expect(hooksLine(lines)).toBeUndefined();
  });

  it('in a test run, a server on a temp data folder uses them (the memory secret store too), and says so in its log', async () => {
    vi.stubEnv(CLAUDE_INSTALL_ENV, installFile({ pins: pins() }));
    vi.stubEnv(API_KEY_CHECK_ENV, 'accept');
    const lines: string[] = [];
    await startTestServer({ lines, verifyApiKey: undefined, secrets: undefined });
    expect(hooksLine(lines)).toMatchObject({ claudeInstall: true, apiKeyCheck: true });
    // vitest.config.ts sets OGDEN_AGENTS_TEST_SECRET_STORE=memory.
    expect(secretsBackend(lines)).toBe('memory');
  });

  it('in a test run, an unusable install file stops the server starting', async () => {
    vi.stubEnv(CLAUDE_INSTALL_ENV, join(tempDataDir(), 'missing.json'));
    await expect(startTestServer()).rejects.toThrow(/OGDEN_AGENTS_TEST_CLAUDE_INSTALL: unreadable/);
  });

  it('in a test run, a server on a temp data folder takes the claude stand-in and says so; an extraAgentEnv executable wins', async () => {
    const file = join(tempDataDir(), 'claude.mjs');
    writeFileSync(file, '');
    vi.stubEnv(CLAUDE_CLI_ENV, file);
    const lines: string[] = [];
    await startTestServer({ lines });
    expect(hooksLine(lines)).toMatchObject({ claudeInstall: false, apiKeyCheck: false, claudeCli: true });
    const own: string[] = [];
    await startTestServer({ lines: own, extraAgentEnv: { CLAUDE_CODE_EXECUTABLE: file } });
    expect(hooksLine(own)).toBeUndefined();
  });

  it("a server's own options win over the variables", async () => {
    vi.stubEnv(CLAUDE_INSTALL_ENV, join(tempDataDir(), 'missing.json'));
    vi.stubEnv(API_KEY_CHECK_ENV, 'accept');
    const lines: string[] = [];
    await startTestServer({ lines, claudeInstall: { pins: pins() as never } });
    expect(hooksLine(lines)).toBeUndefined();
  });
});
