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
import {
  API_KEY_CHECK_ENV,
  BMAD_AVAILABLE_ENV,
  BMAD_PROBE_ENV,
  BMAD_SOURCE_ENV,
  resolveTestHooks,
  CLAUDE_CLI_ENV,
  CHECK_IN_MS_ENV,
  CLAUDE_INSTALL_ENV,
  insideTemp,
  isTestRun,
  testApiKeyCheck,
  testBmadAvailable,
  testBmadProbe,
  testBmadSource,
  testClaudeCli,
  testClaudeInstall,
  testHooksAllowed,
} from '../src/test-hooks.js';
import { createLogger } from '../src/log.js';
import { createBmadSourceAndCatalog } from '../src/start-planning.js';
import { fixtureUpstream, startTestServer, tempDataDir } from './helpers.js';

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

describe('testBmadProbe (story 10.1)', () => {
  it('is on only for a test run on a temp data folder with its variable set to 1', () => {
    const dir = tempDataDir();
    expect(testBmadProbe({ NODE_ENV: 'test', [BMAD_PROBE_ENV]: '1' }, dir)).toBe(true);
    expect(testBmadProbe({ [BMAD_PROBE_ENV]: '1' }, dir)).toBe(false);
    expect(testBmadProbe({ NODE_ENV: 'production', VITEST: '', [BMAD_PROBE_ENV]: '1' }, dir)).toBe(false);
    expect(testBmadProbe({ NODE_ENV: 'test', [BMAD_PROBE_ENV]: '1' }, OUTSIDE)).toBe(false);
    expect(testBmadProbe({ NODE_ENV: 'test' }, dir)).toBe(false);
    expect(testBmadProbe({ NODE_ENV: 'test', [BMAD_PROBE_ENV]: 'true' }, dir)).toBe(false);
  });
});

describe('testBmadAvailable (story 10.2)', () => {
  it('names pieces only for a test run on a temp data folder with its variable set', () => {
    const dir = tempDataDir();
    expect(testBmadAvailable({ NODE_ENV: 'test', [BMAD_AVAILABLE_ENV]: ' board, planning,board ' }, dir)).toEqual(['board', 'planning']);
    expect(testBmadAvailable({ [BMAD_AVAILABLE_ENV]: 'planning' }, dir)).toEqual([]);
    expect(testBmadAvailable({ NODE_ENV: 'production', VITEST: '', [BMAD_AVAILABLE_ENV]: 'planning' }, dir)).toEqual([]);
    expect(testBmadAvailable({ NODE_ENV: 'test', [BMAD_AVAILABLE_ENV]: 'planning' }, OUTSIDE)).toEqual([]);
    expect(testBmadAvailable({ NODE_ENV: 'test' }, dir)).toEqual([]);
    expect(testBmadAvailable({ NODE_ENV: 'test', [BMAD_AVAILABLE_ENV]: '  ' }, dir)).toEqual([]);
  });

  it('throws on a name that is not a piece when hooks are allowed, and ignores it otherwise', () => {
    const dir = tempDataDir();
    expect(() => testBmadAvailable({ NODE_ENV: 'test', [BMAD_AVAILABLE_ENV]: 'planning,teleport' }, dir)).toThrow(/not a BMad piece/);
    expect(testBmadAvailable({ [BMAD_AVAILABLE_ENV]: 'teleport' }, dir)).toEqual([]);
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

describe('testBmadSource (story 4.13)', () => {
  const run = { NODE_ENV: 'test' };
  /** A fixture lock and its tarball written into a fresh temp folder, and the hook's JSON file beside them. */
  const sourceFile = (body: Record<string, unknown> = {}) => {
    const dir = tempDataDir();
    const upstream = fixtureUpstream();
    const tarball = join(dir, 'bmad.tar.gz');
    writeFileSync(tarball, upstream.tarball);
    const file = join(dir, 'bmad-source.json');
    writeFileSync(file, JSON.stringify({ lock: upstream.lock, tarball, ...body }));
    return { file, tarball, upstream };
  };

  it('gives the fixture lock, the tarball by its real path and only the allowlisted uv variables, when hooks are allowed', () => {
    const { file, tarball, upstream } = sourceFile({ uvEnv: { UV_CACHE_DIR: '/tmp/c', UV_PYTHON_DOWNLOADS: 'never', HTTPS_PROXY: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'sk-x', PATH: '/evil', UV_PYTHON: 3 } });
    expect(testBmadSource({ ...run, [BMAD_SOURCE_ENV]: file }, tempDataDir())).toEqual({
      lock: upstream.lock,
      tarball: realpathSync.native(tarball),
      uvEnv: { UV_CACHE_DIR: '/tmp/c', UV_PYTHON_DOWNLOADS: 'never', HTTPS_PROXY: 'http://127.0.0.1:9' },
    });
  });

  it('is inert outside a test run, on a data folder outside the temp folder, or unset; the file is then never read', () => {
    const missing = join(tempDataDir(), 'missing.json');
    expect(testBmadSource({ [BMAD_SOURCE_ENV]: missing }, tempDataDir())).toBeUndefined();
    expect(testBmadSource({ ...run, [BMAD_SOURCE_ENV]: missing }, OUTSIDE)).toBeUndefined();
    expect(testBmadSource({ ...run }, tempDataDir())).toBeUndefined();
    expect(testBmadSource({ ...run, [BMAD_SOURCE_ENV]: '' }, tempDataDir())).toBeUndefined();
  });

  it('ignores a file or a tarball outside the temp folder', () => {
    expect(testBmadSource({ ...run, [BMAD_SOURCE_ENV]: join(OUTSIDE, 'package.json') }, tempDataDir())).toBeUndefined();
    const { file } = sourceFile({ tarball: join(OUTSIDE, 'package.json') });
    expect(testBmadSource({ ...run, [BMAD_SOURCE_ENV]: file }, tempDataDir())).toBeUndefined();
  });

  it('refuses a relative path, an unreadable or bad file, a lock the schema refuses, and a missing or relative tarball', () => {
    expect(() => testBmadSource({ ...run, [BMAD_SOURCE_ENV]: 'bmad.json' }, tempDataDir())).toThrow(/must be an absolute path/);
    expect(() => testBmadSource({ ...run, [BMAD_SOURCE_ENV]: join(tempDataDir(), 'missing.json') }, tempDataDir())).toThrow(/unreadable \(ENOENT\)/);
    expect(() => testBmadSource({ ...run, [BMAD_SOURCE_ENV]: installFile('{') }, tempDataDir())).toThrow(/bad JSON/);
    expect(() => testBmadSource({ ...run, [BMAD_SOURCE_ENV]: sourceFile({ lock: { sources: {} } }).file }, tempDataDir())).toThrow(/BmadLock schema/);
    expect(() => testBmadSource({ ...run, [BMAD_SOURCE_ENV]: sourceFile({ tarball: 'bmad.tar.gz' }).file }, tempDataDir())).toThrow(/tarball must be an absolute path/);
    expect(() => testBmadSource({ ...run, [BMAD_SOURCE_ENV]: sourceFile({ tarball: join(tempDataDir(), 'missing.tar.gz') }).file }, tempDataDir())).toThrow(/tarball unreadable \(ENOENT\)/);
  });

  it("is not read when the server's options give a BMad Method source or fetch", () => {
    const env = { ...run, [BMAD_SOURCE_ENV]: join(tempDataDir(), 'missing.json') };
    expect(resolveTestHooks(env, tempDataDir(), { ownsCore: true, bmadFetch: async () => new Response('') }).bmadSource).toBeUndefined();
    expect(() => resolveTestHooks(env, tempDataDir(), { ownsCore: true })).toThrow(/unreadable/);
  });

  it("the server's source downloads the local tarball, checks it against the lock and is ready; a changed tarball is refused", async () => {
    const run = sourceFile();
    const hook = testBmadSource({ NODE_ENV: 'test', [BMAD_SOURCE_ENV]: run.file }, tempDataDir())!;
    const dataDir = tempDataDir();
    const { bmadSourcePort } = createBmadSourceAndCatalog({}, dataDir, createLogger(() => {}), hook);
    expect(bmadSourcePort.status().state).toBe('missing');
    expect((await bmadSourcePort.download()).state).toBe('ready');
    expect(bmadSourcePort.file('bmad-ticket/scripts/tickets.py')).toBeDefined();

    const other = sourceFile();
    writeFileSync(other.tarball, fixtureUpstream().tarball.subarray(0, 64));
    const changed = testBmadSource({ NODE_ENV: 'test', [BMAD_SOURCE_ENV]: other.file }, tempDataDir())!;
    const refused = createBmadSourceAndCatalog({}, tempDataDir(), createLogger(() => {}), changed).bmadSourcePort;
    await expect(refused.download()).rejects.toThrow();
    expect(refused.status().state).toBe('missing');
  });
});

describe('the server and the hooks', () => {
  const parsed = (lines: string[]) =>
    lines.map((line) => JSON.parse(line) as { msg: string; claudeInstall?: boolean; apiKeyCheck?: boolean; claudeCli?: boolean; checkInMs?: number; backend?: string });
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

  it('in a test run, an honoured check-in delay is named in the line; one the options give, or none, is not (story 10.8)', async () => {
    vi.stubEnv(CHECK_IN_MS_ENV, '5000');
    const lines: string[] = [];
    await startTestServer({ lines });
    expect(hooksLine(lines)).toMatchObject({ checkInMs: 5000, claudeInstall: false, apiKeyCheck: false });
    const own: string[] = [];
    await startTestServer({ lines: own, checkInDelayMs: 5000 });
    expect(hooksLine(own)).toBeUndefined();
    vi.stubEnv(CHECK_IN_MS_ENV, '');
    const file = join(tempDataDir(), 'claude.mjs');
    writeFileSync(file, '');
    vi.stubEnv(CLAUDE_CLI_ENV, file);
    const without: string[] = [];
    await startTestServer({ lines: without });
    expect(hooksLine(without)).toMatchObject({ claudeCli: true });
    expect(hooksLine(without)).not.toHaveProperty('checkInMs');
  });
});
