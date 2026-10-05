/**
 * Installing the Claude Agent ACP adapter (story 9.3): finding npm, the
 * install's every outcome through a fake npm runner (EINTEGRITY, a stall,
 * a stop, no npm, a wrong package), where it lands and what it leaves, then
 * the real npm installing the fake adapter from a local tarball pinned by
 * integrity, offline, with the home folders and npm's prefix pointed at
 * empty temp folders that must stay empty. No test downloads anything.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { AgentSetupError, type AgentInstallProgress } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import { packFakeAdapter, testNpmCli } from '../../../tests/fixtures/fake-adapter/pack.mjs';
import {
  ADAPTER_PINS,
  CLAUDE_CODE_DIR,
  createClaudeCodeSetup,
  findNpmCli,
  installAdapter,
  installedAdapter,
  locateClaudeAdapter,
  npmEnv,
  packagesToFetch,
  pinnedVersion,
  type AdapterPins,
  type ClaudeCodeSetup,
  type NpmRunInput,
  type NpmRunner,
} from '../src/index.js';

const dirs: string[] = [];
const setups: ClaudeCodeSetup[] = [];
afterEach(() => {
  for (const setup of setups.splice(0)) setup.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(prefix = 'ogden-agents-install-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const PACKAGE_PATH = ['node_modules', '@agentclientprotocol', 'claude-agent-acp'];

/** Pins for a fake adapter version, without the SDK's platform binaries. */
function fakePins(version = '9.9.9'): AdapterPins {
  return {
    packageJson: { name: 'ogden-agents-claude-code', private: true, dependencies: { '@agentclientprotocol/claude-agent-acp': version } },
    lock: {
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/@agentclientprotocol/claude-agent-acp': { version, integrity: 'sha512-x' },
        'node_modules/dep-a': { version: '1.0.0', integrity: 'sha512-a' },
        'node_modules/dep-b': { version: '1.0.0', integrity: 'sha512-b' },
        'node_modules/optional-elsewhere': { version: '1.0.0', integrity: 'sha512-c', optional: true, os: ['!' + process.platform] },
      },
    },
  };
}

/** Writes what `npm ci` would into `cwd`: the adapter's manifest and entry script. */
function writeAdapter(cwd: string, version: string) {
  const root = join(cwd, ...PACKAGE_PATH);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@agentclientprotocol/claude-agent-acp', version }));
  writeFileSync(join(root, 'dist', 'index.js'), '');
}

/** A fake npm: `script` prints lines and decides how it ends; every call is recorded. */
function fakeNpm(script: (input: NpmRunInput, end: (exitCode: number | null) => void) => void) {
  const calls: NpmRunInput[] = [];
  let kills = 0;
  const runNpm: NpmRunner = (input) => {
    calls.push(input);
    let end!: (exitCode: number | null) => void;
    const exited = new Promise<{ exitCode: number | null }>((resolve) => (end = (exitCode) => resolve({ exitCode })));
    queueMicrotask(() => script(input, end));
    return {
      exited,
      kill: () => {
        kills++;
        end(null);
      },
    };
  };
  return { runNpm, calls, kills: () => kills };
}

/** The error `install` rejects with; fails the test if it resolves. */
async function failureOf(install: Promise<unknown>): Promise<AgentSetupError> {
  const outcome = await install.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(AgentSetupError);
  return outcome as AgentSetupError;
}

/** What is left in `<dataDir>/agents/claude-code`. */
const leftIn = (dataDir: string) => (existsSync(join(dataDir, CLAUDE_CODE_DIR)) ? readdirSync(join(dataDir, CLAUDE_CODE_DIR)).sort() : []);

/** A file that exists, standing in for npm-cli.js (the fake runner never runs it). */
function npmCliFile(): string {
  const file = join(tempDir(), 'npm-cli.js');
  writeFileSync(file, '');
  return file;
}

describe('finding npm', () => {
  /** A fake file system: `files` exist, `links` resolve (a symlinked `npm`). Nothing on this computer is looked at. */
  const fakeFs = (files: string[], links: Record<string, string> = {}) => ({
    exists: (file: string) => files.includes(file) || file in links,
    realpath: (file: string) => links[file] ?? file,
  });

  it('1. beside Node, in the Windows and POSIX layouts, also through a symlinked node', () => {
    const windowsCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    expect(findNpmCli({ platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', ...fakeFs([windowsCli]) })).toBe(windowsCli);
    const posixCli = '/usr/local/lib/node_modules/npm/bin/npm-cli.js';
    expect(findNpmCli({ platform: 'linux', execPath: '/usr/local/bin/node', ...fakeFs([posixCli]) })).toBe(posixCli);
    const linked = '/opt/node-24/lib/node_modules/npm/bin/npm-cli.js';
    expect(findNpmCli({ platform: 'linux', execPath: '/usr/bin/node', ...fakeFs([linked], { '/usr/bin/node': '/opt/node-24/bin/node' }) })).toBe(linked);
    // Beside Node comes first, whatever else is offered.
    expect(findNpmCli({ platform: 'linux', execPath: '/usr/local/bin/node', launcherNpm: '/elsewhere/npm-cli.js', ...fakeFs([posixCli, '/elsewhere/npm-cli.js']) })).toBe(posixCli);
    expect(findNpmCli({ platform: 'linux', execPath: '/usr/local/bin/node', ...fakeFs([]) })).toBeUndefined();
  });

  it('2. else the npm that launched Ogden Agents, only as an absolute path to an existing npm-cli.js (or npx-cli.js beside one)', () => {
    const base = { platform: 'linux' as const, execPath: '/pnpm/runtime/bin/node' };
    const cli = '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js';
    expect(findNpmCli({ ...base, launcherNpm: cli, ...fakeFs([cli]) })).toBe(cli);
    const npx = '/opt/homebrew/lib/node_modules/npm/bin/npx-cli.js';
    expect(findNpmCli({ ...base, launcherNpm: npx, ...fakeFs([cli, npx]) })).toBe(cli);
    // Relative, missing, or not npm's own script (pnpm sets npm_execpath to itself): refused.
    expect(findNpmCli({ ...base, launcherNpm: 'lib/node_modules/npm/bin/npm-cli.js', ...fakeFs(['lib/node_modules/npm/bin/npm-cli.js']) })).toBeUndefined();
    expect(findNpmCli({ ...base, launcherNpm: cli, ...fakeFs([]) })).toBeUndefined();
    expect(findNpmCli({ ...base, launcherNpm: '/pnpm/bin/pnpm.cjs', ...fakeFs(['/pnpm/bin/pnpm.cjs']) })).toBeUndefined();
    expect(findNpmCli({ ...base, launcherNpm: '/tmp/evil.js', ...fakeFs(['/tmp/evil.js']) })).toBeUndefined();
    const winCli = 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    expect(findNpmCli({ platform: 'win32', execPath: 'D:\\pnpm\\node.exe', launcherNpm: winCli, ...fakeFs([winCli]) })).toBe(winCli);
  });

  it('3. else an npm on an absolute PATH entry, resolved to its npm-cli.js; relative entries and the current folder are ignored', () => {
    const base = { platform: 'linux' as const, execPath: '/pnpm/runtime/bin/node' };
    const cli = '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js';
    // A symlinked npm (Homebrew).
    expect(findNpmCli({ ...base, pathEnv: '/usr/bin:/opt/homebrew/bin', ...fakeFs([cli], { '/opt/homebrew/bin/npm': cli }) })).toBe(cli);
    // An npm shell script beside a Node install's lib folder.
    const nvm = '/home/u/.nvm/versions/node/v24/lib/node_modules/npm/bin/npm-cli.js';
    expect(findNpmCli({ ...base, pathEnv: '/home/u/.nvm/versions/node/v24/bin', ...fakeFs(['/home/u/.nvm/versions/node/v24/bin/npm', nvm]) })).toBe(nvm);
    // Relative entries (".", "bin", "") are skipped, even when they hold an npm.
    const relative = fakeFs(['bin/npm', 'lib/node_modules/npm/bin/npm-cli.js', 'npm', 'node_modules/npm/bin/npm-cli.js'], { 'bin/npm': 'lib/node_modules/npm/bin/npm-cli.js' });
    expect(findNpmCli({ ...base, pathEnv: '.:bin::', ...relative })).toBeUndefined();
    // The launcher's npm comes before PATH.
    expect(findNpmCli({ ...base, launcherNpm: '/l/npm-cli.js', pathEnv: '/opt/homebrew/bin', ...fakeFs(['/l/npm-cli.js', cli], { '/opt/homebrew/bin/npm': cli }) })).toBe('/l/npm-cli.js');
    // Windows: npm.cmd in a quoted absolute entry, never the .cmd itself; a relative entry is skipped.
    const winCli = 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    expect(findNpmCli({ platform: 'win32', execPath: 'D:\\pnpm\\node.exe', pathEnv: '"C:\\nodejs";.', ...fakeFs(['C:\\nodejs\\npm.cmd', winCli]) })).toBe(winCli);
    expect(findNpmCli({ platform: 'win32', execPath: 'D:\\pnpm\\node.exe', pathEnv: 'nodejs;.', ...fakeFs(['nodejs\\npm.cmd', 'nodejs\\node_modules\\npm\\bin\\npm-cli.js']) })).toBeUndefined();
    // An npm whose npm-cli.js can't be found gives nothing (the npm itself is never run).
    expect(findNpmCli({ ...base, pathEnv: '/usr/bin', ...fakeFs(['/usr/bin/npm']) })).toBeUndefined();
  });

  it("npm's environment drops every inherited npm_* variable (any case) and keeps the cache in the temp folder", () => {
    const env = npmEnv({ PATH: '/bin', HOME: '/h', npm_config_prefix: '/global', NPM_CONFIG_GLOBAL: 'true', npm_lifecycle_event: 'x', gone: undefined }, '/work/cache');
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', npm_config_cache: '/work/cache', npm_config_update_notifier: 'false' });
  });

  it("npm's environment is an allowlist (AD-16): its proxies and certificates pass, no agent key or other variable does", () => {
    const env = npmEnv(
      { PATH: '/bin', HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/ca.pem', ANTHROPIC_API_KEY: 'sk-ant-x', GEMINI_API_KEY: 'AIza-x', GITHUB_TOKEN: 'ghp_x', OGDEN_AGENTS_TEST_CLAUDE_INSTALL: '/x', NODE_OPTIONS: '--require /evil.js' },
      '/work/cache',
    );
    expect(env).toEqual({ PATH: '/bin', HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/ca.pem', npm_config_cache: '/work/cache', npm_config_update_notifier: 'false' });
  });

  it('counts the packages npm fetches: optional ones only with the binary, and only for this computer', () => {
    const pins = fakePins();
    expect(packagesToFetch(pins.lock, false)).toBe(3);
    expect(packagesToFetch(pins.lock, true)).toBe(3);
    const here = { ...pins.lock, packages: { ...pins.lock.packages, 'node_modules/optional-here': { optional: true, os: [process.platform], cpu: [process.arch] } } };
    expect(packagesToFetch(here, false)).toBe(3);
    expect(packagesToFetch(here, true)).toBe(4);
  });

  it('the shipped pins lock an exact adapter version, every package with its integrity', () => {
    expect(pinnedVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect((ADAPTER_PINS.packageJson as { dependencies: Record<string, string> }).dependencies['@agentclientprotocol/claude-agent-acp']).toBe(pinnedVersion());
    const entries = Object.entries(ADAPTER_PINS.lock.packages).filter(([path]) => path !== '');
    expect(entries.length).toBeGreaterThan(50);
    for (const [path, entry] of entries) {
      expect(entry.integrity, path).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
      // Review F1: every tarball comes from the public registry, never a mirror from whoever ran --update.
      expect((entry as { resolved?: string }).resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });
});

describe('installing the adapter (fake npm)', () => {
  it('runs npm ci with fixed arguments and no shell, reports progress, and renames the result into place', async () => {
    const dataDir = tempDir();
    // A stale temp folder from a killed install is removed first.
    mkdirSync(join(dataDir, CLAUDE_CODE_DIR, '.install-stale'), { recursive: true });
    const npm = fakeNpm((input, end) => {
      input.onLine('npm http fetch GET 200 https://registry.npmjs.org/dep-a/-/dep-a-1.0.0.tgz 12ms (cache miss)');
      input.onLine('npm http fetch GET 200 https://registry.npmjs.org/dep-b/-/dep-b-1.0.0.tgz 12ms (cache miss)');
      input.onLine('npm http fetch GET 200 https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/x.tgz 12ms (cache miss)');
      writeAdapter(input.cwd, '9.9.9');
      end(0);
    });
    const progress: AgentInstallProgress[] = [];
    const installed = await installAdapter({
      dataDir,
      withBinary: false,
      onProgress: (p) => progress.push(p),
      pins: fakePins(),
      runNpm: npm.runNpm,
      npmCli: npmCliFile(),
      env: { PATH: '/bin', npm_config_global: 'true' },
    });
    const target = join(dataDir, CLAUDE_CODE_DIR, 'adapter-9.9.9');
    expect(installed).toEqual({ path: join(target, ...PACKAGE_PATH, 'dist', 'index.js'), version: '9.9.9', bundled: false });
    expect(leftIn(dataDir)).toEqual(['adapter-9.9.9']);

    const call = npm.calls[0]!;
    expect(call.nodePath).toBe(process.execPath);
    expect(call.args).toEqual(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', '--no-progress', '--color=false', '--loglevel', 'http', '--omit=optional']);
    expect(call.cwd.startsWith(join(dataDir, CLAUDE_CODE_DIR, '.install-'))).toBe(true);
    expect(call.env.npm_config_global).toBeUndefined();
    expect(call.env.npm_config_cache!.startsWith(join(dataDir, CLAUDE_CODE_DIR, '.install-'))).toBe(true);
    expect(JSON.parse(readFileSync(join(target, 'package-lock.json'), 'utf8'))).toEqual(fakePins().lock);

    expect(progress.map((p) => p.percent)).toEqual([0, 30, 60, 90, 95, 100]);
    expect(progress[0]!.step).toBe('Downloading Claude Code');
    expect(progress.at(-1)!.step).toBe('Checking Claude Code');

    expect(installedAdapter(dataDir, fakePins())).toEqual(installed);
    expect(locateClaudeAdapter({ dataDir, pins: fakePins() })).toEqual({ path: installed.path, version: '9.9.9', needsClaude: true });
  });

  it('with the binary it keeps optional dependencies and names the folder -bundled; the pinned bundled copy comes first', async () => {
    const dataDir = tempDir();
    const npm = fakeNpm((input, end) => {
      writeAdapter(input.cwd, '9.9.9');
      end(0);
    });
    const pins = fakePins();
    const bundled = await installAdapter({ dataDir, withBinary: true, onProgress: () => {}, pins, runNpm: npm.runNpm, npmCli: npmCliFile() });
    expect(npm.calls[0]!.args).not.toContain('--omit=optional');
    expect(bundled.bundled).toBe(true);
    await installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins, runNpm: npm.runNpm, npmCli: npmCliFile() });
    // An older version left from before a pin bump comes after the pinned one.
    writeAdapter(join(dataDir, CLAUDE_CODE_DIR, 'adapter-9.9.1'), '9.9.1');
    expect(leftIn(dataDir)).toEqual(['adapter-9.9.1', 'adapter-9.9.9', 'adapter-9.9.9-bundled']);
    expect(installedAdapter(dataDir, pins)).toMatchObject({ version: '9.9.9', bundled: true });
    expect(installedAdapter(dataDir, fakePins('10.0.0'))).toMatchObject({ version: '9.9.9', bundled: true });
    // Installing again replaces the copy in place.
    await installAdapter({ dataDir, withBinary: true, onProgress: () => {}, pins, runNpm: npm.runNpm, npmCli: npmCliFile() });
    expect(leftIn(dataDir)).toEqual(['adapter-9.9.1', 'adapter-9.9.9', 'adapter-9.9.9-bundled']);
  });

  it("a tarball that doesn't match the lock (EINTEGRITY) fails in plain words, with npm's code for the log only, and leaves nothing", async () => {
    const dataDir = tempDir();
    const npm = fakeNpm((input, end) => {
      input.onLine('npm warn tarball tarball data for dep-a (sha512-a) seems to be corrupted. Trying again.');
      input.onLine('npm error code EINTEGRITY');
      input.onLine('npm error sha512-a integrity checksum failed when using sha512: wanted sha512-a but got sha512-z. (231 bytes)');
      writeAdapter(input.cwd, '9.9.9');
      end(1);
    });
    const failure = await failureOf(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: npm.runNpm, npmCli: npmCliFile() }));
    expect(failure.message).toBe("The download didn't match the expected files, so nothing was installed. Try again.");
    expect(failure.details).toEqual({ step: 'npm_ci', exitCode: 1, npmCode: 'EINTEGRITY' });
    expect(leftIn(dataDir)).toEqual([]);
  });

  it('a network error, or no output and no download for the idle timeout, fails as offline, kills npm and leaves nothing', async () => {
    const dataDir = tempDir();
    const offline = fakeNpm((input, end) => {
      input.onLine('npm error code ENOTFOUND');
      end(1);
    });
    await expect(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: offline.runNpm, npmCli: npmCliFile() })).rejects.toThrow(
      "The download didn't finish. Check your internet connection and try again.",
    );
    const stalled = fakeNpm((input) => input.onLine('npm http fetch GET 200 https://registry.npmjs.org/dep-a 1ms'));
    const failure = await failureOf(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: stalled.runNpm, npmCli: npmCliFile(), idleTimeoutMs: 50 }));
    expect(failure.message).toBe("The download didn't finish. Check your internet connection and try again.");
    expect(failure.details).toMatchObject({ stalled: true });
    expect(stalled.kills()).toBe(1);
    expect(leftIn(dataDir)).toEqual([]);
  });

  it('a stop (the server stopping) kills npm and leaves nothing', async () => {
    const dataDir = tempDir();
    const hanging = fakeNpm(() => {});
    const controller = new AbortController();
    const running = installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: hanging.runNpm, npmCli: npmCliFile(), signal: controller.signal });
    await expect.poll(() => hanging.calls.length).toBe(1);
    controller.abort();
    await expect(running).rejects.toThrow('Installing Claude Code was stopped.');
    expect(hanging.kills()).toBe(1);
    expect(leftIn(dataDir)).toEqual([]);
  });

  it('without a given npm it uses the launcher npm, else one on an absolute PATH entry, and runs it with the given Node', async () => {
    const dataDir = tempDir();
    // A Node with no npm beside it.
    const nodePath = join(tempDir(), 'bin', 'node');
    const npm = fakeNpm((input, end) => {
      writeAdapter(input.cwd, '9.9.9');
      end(0);
    });
    const launcherCli = join(tempDir(), 'npm-cli.js');
    writeFileSync(launcherCli, '');
    await installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: npm.runNpm, nodePath, launcherNpm: launcherCli, env: { PATH: '' } });
    expect(npm.calls[0]).toMatchObject({ nodePath, npmCli: launcherCli });

    const prefix = tempDir();
    const pathCli = join(prefix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    mkdirSync(dirname(pathCli), { recursive: true });
    writeFileSync(pathCli, '');
    mkdirSync(join(prefix, 'bin'));
    writeFileSync(join(prefix, 'bin', process.platform === 'win32' ? 'npm.cmd' : 'npm'), '');
    // A relative entry first: skipped.
    const onPath = process.platform === 'win32' ? join(prefix, 'bin', 'node_modules', 'npm', 'bin', 'npm-cli.js') : pathCli;
    if (process.platform === 'win32') {
      mkdirSync(dirname(onPath), { recursive: true });
      writeFileSync(onPath, '');
    }
    await installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: npm.runNpm, nodePath, launcherNpm: '/pnpm/pnpm.cjs', env: { PATH: ['.', join(prefix, 'bin')].join(delimiter) } });
    // Resolved through the real path of the npm found (macOS's /var is /private/var).
    expect(npm.calls[1]).toMatchObject({ nodePath, npmCli: realpathSync(onPath) });
  });

  it("an npm that can't start is logged by its errno code only, never a message or a path (review F3)", async () => {
    const dataDir = tempDir();
    const secretDir = join(tempDir(), 'secret-dir-9f3');
    // The real runner, with a Node that isn't there.
    const real = await failureOf(
      installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), npmCli: npmCliFile(), nodePath: join(secretDir, 'node') }),
    );
    expect(real.message).toBe("Claude Code couldn't be installed. Try again.");
    expect(real.details).toEqual({ step: 'npm_ci', startError: 'ENOENT' });
    // A runner that reports more than a code still gets only a code into the details.
    const chatty: NpmRunner = () => ({ exited: Promise.resolve({ exitCode: null, startError: `spawn ${secretDir}/node ENOENT` }), kill: () => {} });
    const noisy = await failureOf(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: chatty, npmCli: npmCliFile() }));
    expect(noisy.details).toEqual({ step: 'npm_ci', startError: 'unknown' });
    // npm's error code line is read as a code only.
    const odd = fakeNpm((input, end) => {
      input.onLine(`npm error code ${secretDir}/x`);
      end(1);
    });
    const junk = await failureOf(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: odd.runNpm, npmCli: npmCliFile() }));
    expect(junk.details).toEqual({ step: 'npm_ci', exitCode: 1, npmCode: null });
    for (const failure of [real, noisy, junk]) expect(JSON.stringify(failure.details) + failure.message).not.toContain('secret-dir-9f3');
  });

  it('a crash mid-swap leaves the old copy in the temp folder: the next start puts it back instead of deleting it (review F4)', async () => {
    const dataDir = tempDir();
    const dir = join(dataDir, CLAUDE_CODE_DIR);
    // As left by a crash after the old copy was moved aside and before the new one was renamed in.
    writeAdapter(join(dir, '.install-crashed', 'previous', 'adapter-9.9.9'), '9.9.9');
    mkdirSync(join(dir, '.install-crashed', 'adapter'), { recursive: true });
    // A copy aside whose place is taken again (the swap finished) is only a leftover.
    writeAdapter(join(dir, '.install-done', 'previous', 'adapter-9.9.8'), '9.9.8');
    writeAdapter(join(dir, 'adapter-9.9.8'), '9.9.8');
    writeFileSync(join(dir, 'adapter-9.9.8', 'marker'), 'current');
    setups.push(createClaudeCodeSetup({ env: () => ({}), listAuthMethods: async () => [], dataDir }));
    expect(leftIn(dataDir)).toEqual(['adapter-9.9.8', 'adapter-9.9.9']);
    expect(readFileSync(join(dir, 'adapter-9.9.8', 'marker'), 'utf8')).toBe('current');
    expect(installedAdapter(dataDir, fakePins())).toMatchObject({ version: '9.9.9', bundled: false });

    // The same at an install's start; and a reinstall's own swap leaves no temp folder behind.
    writeAdapter(join(dir, '.install-again', 'previous', 'adapter-9.9.9-bundled'), '9.9.9');
    const npm = fakeNpm((input, end) => {
      writeAdapter(input.cwd, '9.9.9');
      end(0);
    });
    await installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: npm.runNpm, npmCli: npmCliFile() });
    expect(leftIn(dataDir)).toEqual(['adapter-9.9.8', 'adapter-9.9.9', 'adapter-9.9.9-bundled']);
  });

  it('no npm anywhere fails at once and writes nothing', async () => {
    const dataDir = tempDir();
    const npm = fakeNpm((_input, end) => end(0));
    await expect(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: npm.runNpm, npmCli: join(dataDir, 'no-npm-cli.js') })).rejects.toThrow(
      "Ogden Agents couldn't find npm, so Claude Code wasn't installed. Install Node.js with npm, then try again.",
    );
    expect(npm.calls).toHaveLength(0);
    expect(existsSync(join(dataDir, 'agents'))).toBe(false);
  });

  it("a package that isn't the pinned adapter, or a missing bundled binary, fails and leaves nothing", async () => {
    const dataDir = tempDir();
    const wrong = fakeNpm((input, end) => {
      writeAdapter(input.cwd, '6.6.6');
      end(0);
    });
    await expect(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins: fakePins(), runNpm: wrong.runNpm, npmCli: npmCliFile() })).rejects.toThrow(
      "Claude Code was downloaded but didn't look right, so nothing was installed. Try again.",
    );
    const withBinaries = fakePins();
    withBinaries.lock.packages['node_modules/@anthropic-ai/claude-agent-sdk-plan9-mips'] = { optional: true, os: ['plan9'] };
    const noBinary = fakeNpm((input, end) => {
      writeAdapter(input.cwd, '9.9.9');
      end(0);
    });
    await expect(installAdapter({ dataDir, withBinary: true, onProgress: () => {}, pins: withBinaries, runNpm: noBinary.runNpm, npmCli: npmCliFile() })).rejects.toThrow(
      'Claude Code has no build for this computer',
    );
    expect(leftIn(dataDir)).toEqual([]);
  });
});

describe('the setup port with an install (fake npm)', () => {
  const baseOptions = { env: () => ({}), listAuthMethods: async () => [] };

  it('not installed: the size depends on a claude being found; Install brings the binary only without one', async () => {
    const dataDir = tempDir();
    const npm = fakeNpm((input, end) => {
      writeAdapter(input.cwd, '9.9.9');
      end(0);
    });
    const install = { pins: fakePins(), runNpm: npm.runNpm, npmCli: npmCliFile() };
    const withClaude = createClaudeCodeSetup({ ...baseOptions, dataDir, install, claudeExecutable: '/usr/local/bin/claude' });
    const withoutClaude = createClaudeCodeSetup({ ...baseOptions, dataDir, install, claudeExecutable: null });
    setups.push(withClaude, withoutClaude);
    expect(await withClaude.status()).toMatchObject({ install: 'not_installed', installSize: 'small' });
    expect(await withoutClaude.status()).toMatchObject({ install: 'not_installed', installSize: 'large' });

    expect(await withClaude.install(() => {})).toEqual({ version: '9.9.9' });
    expect(npm.calls[0]!.args).toContain('--omit=optional');
    // Installed without the binary, it counts only while the user's claude is found.
    expect(await withoutClaude.status()).toMatchObject({ install: 'not_installed', installSize: 'large', reason: expect.stringContaining("isn't found on this computer") });
    await expect(withoutClaude.signIn()).rejects.toBeInstanceOf(AgentSetupError);
    expect(await withoutClaude.install(() => {})).toEqual({ version: '9.9.9' });
    expect(npm.calls[1]!.args).not.toContain('--omit=optional');
    expect(leftIn(dataDir)).toEqual(['adapter-9.9.9', 'adapter-9.9.9-bundled']);
  });

  it('a second install while one runs is refused; close stops the running one', async () => {
    const dataDir = tempDir();
    const hanging = fakeNpm(() => {});
    const setup = createClaudeCodeSetup({ ...baseOptions, dataDir, install: { pins: fakePins(), runNpm: hanging.runNpm, npmCli: npmCliFile() }, claudeExecutable: null });
    setups.push(setup);
    const running = setup.install(() => {});
    await expect.poll(() => hanging.calls.length).toBe(1);
    await expect(setup.install(() => {})).rejects.toThrow('Claude Code is already being installed.');
    setup.close();
    await expect(running).rejects.toThrow('Installing Claude Code was stopped.');
    expect(leftIn(dataDir)).toEqual([]);
  });

  it('removes stale install folders when it is created (server start)', () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, CLAUDE_CODE_DIR, '.install-crashed', 'adapter'), { recursive: true });
    setups.push(createClaudeCodeSetup({ ...baseOptions, dataDir }));
    expect(leftIn(dataDir)).toEqual([]);
  });
});

describe('installing the fake adapter with the real npm (offline)', () => {
  it('npm ci installs it from the pinned local tarball; nothing is written outside the data folder', async () => {
    const work = tempDir('ogden-agents-install-real-');
    const npmCli = testNpmCli();
    const { pins, version } = packFakeAdapter(join(work, 'fixture'), { npmCli });
    const dataDir = join(work, 'data');
    // The stop rule: every place npm could write outside the data folder is an empty temp folder.
    const outside = { HOME: join(work, 'home'), USERPROFILE: join(work, 'profile'), APPDATA: join(work, 'appdata'), LOCALAPPDATA: join(work, 'localappdata'), npm_config_prefix: join(work, 'prefix') };
    for (const dir of Object.values(outside)) mkdirSync(dir);
    mkdirSync(dataDir);
    const progress: AgentInstallProgress[] = [];
    const installed = await installAdapter({
      dataDir,
      withBinary: true,
      onProgress: (p) => progress.push(p),
      pins,
      npmCli,
      env: { ...process.env, ...outside },
    });
    expect(installed).toMatchObject({ version, bundled: true });
    expect(installed.path.startsWith(join(dataDir, CLAUDE_CODE_DIR, `adapter-${version}-bundled`))).toBe(true);
    expect(readFileSync(installed.path, 'utf8')).toContain('fake-acp-agent.mjs');
    expect(progress.at(-1)).toEqual({ step: 'Checking Claude Code', percent: 100 });
    expect(progress.some((p) => p.percent === 90)).toBe(true);
    expect(leftIn(dataDir)).toEqual([`adapter-${version}-bundled`]);
    for (const [name, dir] of Object.entries(outside)) expect(readdirSync(dir), name).toEqual([]);
  }, 60_000);

  it('a lock whose integrity the tarball does not match fails with nothing installed', async () => {
    const work = tempDir('ogden-agents-install-real-');
    const npmCli = testNpmCli();
    const { pins } = packFakeAdapter(join(work, 'fixture'), { npmCli });
    const entry = pins.lock.packages['node_modules/@agentclientprotocol/claude-agent-acp']!;
    entry.integrity = `sha512-${'A'.repeat(86)}==`;
    const dataDir = join(work, 'data');
    mkdirSync(dataDir);
    const failure = await failureOf(installAdapter({ dataDir, withBinary: false, onProgress: () => {}, pins, npmCli, env: { ...process.env, HOME: work, USERPROFILE: work } }));
    expect(failure.message).toBe("The download didn't match the expected files, so nothing was installed. Try again.");
    expect(failure.details).toMatchObject({ npmCode: 'EINTEGRITY' });
    expect(leftIn(dataDir)).toEqual([]);
  }, 60_000);
});
