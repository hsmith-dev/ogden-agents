/**
 * The Local model's install, uninstall and status (epic 14, story 14.2),
 * against fixture archives served by a fake `fetch` (no test reaches GitHub
 * or runs the real harness): the pinned archive is checked by its SHA-256 and
 * size, unpacked file by file (a zip on macOS and Windows, a tar.gz on Linux),
 * Windows gets its pinned ripgrep beside it, and nothing is left half installed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSetupError, type AgentPlatform } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLocalSetup,
  extractPinnedTarGz,
  installedOpenCode,
  localHome,
  localInstallDir,
  localVersionDir,
  ripgrepCacheFile,
  seedRipgrep,
  UnsafeArchiveError,
  type LocalPins,
} from '../src/index.js';
import { tarGz, zip } from './archives.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-local-setup-'));
  dirs.push(dir);
  return dir;
};
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const BINARY = randomBytes(120_000);
const RIPGREP = randomBytes(30_000);

interface Fixture {
  pins: LocalPins;
  platform: AgentPlatform;
  /** What the fake `fetch` serves, by URL. */
  served: Map<string, Buffer>;
  fetched: string[];
  fetch: typeof fetch;
}

/** Pins for `platform` over fixture archives: a zip (or, for Linux, a tar.gz) of one file, and Windows' ripgrep zip. */
function fixture(platform: AgentPlatform, options: { archive?: Buffer; extra?: boolean } = {}): Fixture {
  const windows = platform.startsWith('win32');
  const binary = windows ? 'opencode.exe' : 'opencode';
  const format = platform.startsWith('linux') ? 'tar.gz' : 'zip';
  const archive = options.archive ?? (format === 'zip' ? zip([{ name: binary, data: BINARY }, ...(options.extra === true ? [{ name: 'evil.sh', data: 'x' }] : [])]) : tarGz([{ name: binary, data: BINARY }, ...(options.extra === true ? [{ name: 'evil.sh', data: 'x' }] : [])]));
  const url = `https://fixtures.invalid/opencode-${platform}.${format}`;
  const rgUrl = 'https://fixtures.invalid/ripgrep.zip';
  const rgArchive = zip([
    { name: 'ripgrep-fixture/', data: '' },
    { name: 'ripgrep-fixture/doc/README.md', data: 'docs' },
    { name: 'ripgrep-fixture/rg.exe', data: RIPGREP },
  ]);
  const served = new Map<string, Buffer>([[url, archive], [rgUrl, rgArchive]]);
  const fetched: string[] = [];
  const pins: LocalPins = {
    registry: 'fixture',
    version: '9.9.9',
    archives: {
      [platform]: { url, sha256: sha256(options.archive === undefined ? archive : options.archive), size: archive.length, format, binary, args: ['acp'], files: { [binary]: { size: BINARY.length, sha256: sha256(BINARY) } } },
    },
    ripgrep: windows ? { version: '0.0.0', archives: { [platform]: { url: rgUrl, sha256: sha256(rgArchive), size: rgArchive.length, member: 'ripgrep-fixture/rg.exe', file: { size: RIPGREP.length, sha256: sha256(RIPGREP) } } } } : { version: '0.0.0', archives: {} },
  };
  const fakeFetch = (async (input: string | URL | Request) => {
    const requested = String(input);
    fetched.push(requested);
    const body = served.get(requested);
    return body === undefined ? new Response('not found', { status: 404 }) : new Response(new Uint8Array(body), { status: 200 });
  }) as typeof fetch;
  return { pins, platform, served, fetched, fetch: fakeFetch };
}

const setupOf = (dataDir: string, f: Fixture) => createLocalSetup({ dataDir, platform: f.platform, pins: f.pins, fetch: f.fetch, backoffMs: 1 });

describe('the Local model install', () => {
  it.each(['darwin-arm64', 'win32-x64', 'linux-x64'] as const)('puts the checked harness for %s in the data folder, with Ogden\'s record, and nothing runs', async (platform) => {
    const dataDir = tempDir();
    const f = fixture(platform);
    const setup = setupOf(dataDir, f);
    expect(await setup.status()).toMatchObject({ install: 'not_installed', auth: 'needs_sign_in', version: null });
    const steps: string[] = [];
    const result = await setup.install((progress) => steps.push(progress.step));
    expect(result.version).toBe('9.9.9');
    const installed = installedOpenCode(dataDir, platform, f.pins)!;
    expect(installed.version).toBe('9.9.9');
    expect(installed.args).toEqual(['acp']);
    expect(installed.command).toBe(join(localVersionDir(dataDir, f.pins), platform.startsWith('win32') ? 'opencode.exe' : 'opencode'));
    expect(readFileSync(installed.command).equals(BINARY)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(installed.command).mode & 0o111).not.toBe(0);
    expect(steps.some((step) => /download/i.test(step))).toBe(true);
    // Only the pinned file and the record (and, on Windows, ripgrep): nothing else was unpacked, and no temp folder is left.
    const names = readdirSync(localVersionDir(dataDir, f.pins)).sort();
    expect(names).toEqual(['.ogden-install.json', ...(platform.startsWith('win32') ? ['opencode.exe', 'rg.exe'] : ['opencode'])].sort());
    expect(readdirSync(localInstallDir(dataDir)).filter((name) => name.startsWith('.staging-') || name.startsWith('.previous-'))).toEqual([]);
    expect(await setup.status()).toMatchObject({ install: 'installed', version: '9.9.9', auth: 'signed_in', canUninstall: true });
    // Only the pinned URLs were fetched.
    expect(new Set(f.fetched)).toEqual(new Set([...Object.values(f.pins.archives).map((pin) => pin!.url), ...Object.values(f.pins.ripgrep.archives).map((pin) => pin!.url)]));
  });

  it('refuses an archive whose hash is not the pinned one, and installs nothing', async () => {
    const dataDir = tempDir();
    const f = fixture('darwin-arm64');
    const url = f.pins.archives['darwin-arm64']!.url;
    // Same size, different bytes.
    const tampered = Buffer.from(f.served.get(url)!);
    tampered[tampered.length - 30] = (tampered[tampered.length - 30]! ^ 0xff) & 0xff;
    f.served.set(url, tampered);
    const error = await setupOf(dataDir, f).install(() => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentSetupError);
    expect((error as AgentSetupError).message).toMatch(/didn't match the expected file/);
    expect(existsSync(localVersionDir(dataDir, f.pins))).toBe(false);
    expect(installedOpenCode(dataDir, 'darwin-arm64', f.pins)).toBeUndefined();
  });

  it('refuses an archive with a file that is not pinned (a hash-correct but unexpected archive), and installs nothing', async () => {
    const dataDir = tempDir();
    const extra = fixture('darwin-arm64', { extra: true });
    const f = fixture('darwin-arm64');
    // The pin is for the archive with the extra file in it, but the file list names only the binary.
    f.pins.archives['darwin-arm64']!.sha256 = sha256(extra.served.get(extra.pins.archives['darwin-arm64']!.url)!);
    f.pins.archives['darwin-arm64']!.size = extra.served.get(extra.pins.archives['darwin-arm64']!.url)!.length;
    f.served.set(f.pins.archives['darwin-arm64']!.url, extra.served.get(extra.pins.archives['darwin-arm64']!.url)!);
    const error = await setupOf(dataDir, f).install(() => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentSetupError);
    expect((error as AgentSetupError).message).toMatch(/wasn't the expected/);
    expect(existsSync(localVersionDir(dataDir, f.pins))).toBe(false);
    expect(readdirSync(localInstallDir(dataDir)).filter((name) => name.startsWith('.staging-'))).toEqual([]);
  });

  it('refuses a Windows install whose ripgrep does not match its pin', async () => {
    const dataDir = tempDir();
    const f = fixture('win32-x64');
    const rg = f.pins.ripgrep.archives['win32-x64']!;
    rg.file = { ...rg.file, sha256: '0'.repeat(64) };
    const error = await setupOf(dataDir, f).install(() => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentSetupError);
    expect(existsSync(localVersionDir(dataDir, f.pins))).toBe(false);
  });

  it('has no Install for a computer with no pinned download, and says so', async () => {
    const f = fixture('darwin-arm64');
    const setup = createLocalSetup({ dataDir: tempDir(), platform: 'linux-arm64', pins: f.pins, fetch: f.fetch });
    expect(await setup.status()).toMatchObject({ install: 'not_installed', canInstall: false });
    await expect(setup.install(() => {})).rejects.toBeInstanceOf(AgentSetupError);
    expect(f.fetched).toEqual([]);
  });

  it('is installed again over an older copy, and Uninstall keeps the chat history and settings', async () => {
    const dataDir = tempDir();
    const f = fixture('linux-x64');
    const setup = setupOf(dataDir, f);
    await setup.install(() => {});
    // Another version left behind by an earlier release is removed at the next start.
    mkdirSync(join(localInstallDir(dataDir), '1.0.0'), { recursive: true });
    mkdirSync(join(localInstallDir(dataDir), '.staging-abc'), { recursive: true });
    const again = setupOf(dataDir, f);
    expect(readdirSync(localInstallDir(dataDir)).sort()).toEqual(['9.9.9']);
    // Its home (the harness's database) is the user's chats: Uninstall never touches it.
    const home = localHome(dataDir);
    mkdirSync(home.xdg.data, { recursive: true });
    writeFileSync(join(home.xdg.data, 'opencode.db'), 'chats');
    await again.uninstall!();
    expect(existsSync(localInstallDir(dataDir))).toBe(false);
    expect(readFileSync(join(home.xdg.data, 'opencode.db'), 'utf8')).toBe('chats');
    expect(await again.status()).toMatchObject({ install: 'not_installed' });
  });

  it('runs one install at a time', async () => {
    const f = fixture('darwin-arm64');
    const setup = setupOf(tempDir(), f);
    const first = setup.install(() => {});
    await expect(setup.install(() => {})).rejects.toThrow(/already being installed/);
    await first;
  });

  it('has no sign in, and its status says there is no account to set up, with the privacy statement', async () => {
    const setup = setupOf(tempDir(), fixture('darwin-arm64'));
    await expect(setup.signIn()).rejects.toBeInstanceOf(AgentSetupError);
    const status = await setup.status();
    expect(status.notices?.join(' ')).toMatch(/Nothing leaves this computer except to the server you set up/);
    expect(status.notices?.join(' ')).toMatch(/plain text/);
    expect(status.notices?.join(' ')).toMatch(/skills \(where Planning is on\), know that they are long/);
    expect(status.notices?.join(' ')).toMatch(/30B or more/);
    expect(JSON.stringify(status)).not.toMatch(/—|–/);
  });

  it('does not count a copy without Ogden\'s record, or with a file changed in size', async () => {
    const dataDir = tempDir();
    const f = fixture('darwin-arm64');
    await setupOf(dataDir, f).install(() => {});
    const binary = join(localVersionDir(dataDir, f.pins), 'opencode');
    writeFileSync(binary, 'short');
    expect(installedOpenCode(dataDir, 'darwin-arm64', f.pins)).toBeUndefined();
    rmSync(join(localVersionDir(dataDir, f.pins), '.ogden-install.json'));
    expect(installedOpenCode(dataDir, 'darwin-arm64', f.pins)).toBeUndefined();
  });
});

describe("Windows' ripgrep (spike 14.1: the harness would download it from GitHub)", () => {
  it('is placed in the harness\'s cache folder before a chat, once, so it never reaches out', async () => {
    const dataDir = tempDir();
    const f = fixture('win32-x64');
    await setupOf(dataDir, f).install(() => {});
    const installed = installedOpenCode(dataDir, 'win32-x64', f.pins)!;
    expect(installed.ripgrep).toBe(join(localVersionDir(dataDir, f.pins), 'rg.exe'));
    seedRipgrep(dataDir, installed);
    const target = ripgrepCacheFile(dataDir);
    expect(target).toBe(join(localHome(dataDir).xdg.cache, 'opencode', 'bin', 'rg.exe'));
    expect(readFileSync(target).equals(RIPGREP)).toBe(true);
    // Not copied again when it is there.
    const before = statSync(target).mtimeMs;
    seedRipgrep(dataDir, installed);
    expect(statSync(target).mtimeMs).toBe(before);
  });

  it.skipIf(process.platform === 'win32')('never follows a link the harness planted where rg.exe goes: it replaces the link, not the file it points at', async () => {
    const dataDir = tempDir();
    const f = fixture('win32-x64');
    await setupOf(dataDir, f).install(() => {});
    const installed = installedOpenCode(dataDir, 'win32-x64', f.pins)!;
    const target = ripgrepCacheFile(dataDir);
    mkdirSync(join(target, '..'), { recursive: true });
    const victim = join(tempDir(), 'important.txt');
    writeFileSync(victim, 'keep me');
    symlinkSync(victim, target);
    seedRipgrep(dataDir, installed);
    expect(readFileSync(victim, 'utf8')).toBe('keep me');
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(readFileSync(target).equals(RIPGREP)).toBe(true);
  });

  it('is nothing to do where there is no ripgrep to place', () => {
    const dataDir = tempDir();
    seedRipgrep(dataDir, {});
    expect(existsSync(ripgrepCacheFile(dataDir))).toBe(false);
  });
});

describe('unpacking a pinned tar.gz', () => {
  const files = { opencode: { size: BINARY.length, sha256: sha256(BINARY) } };
  const unpack = async (archive: Buffer, pinned: Record<string, { size: number; sha256: string }> = files) => {
    const dir = tempDir();
    const file = join(dir, 'a.tar.gz');
    writeFileSync(file, archive);
    mkdirSync(join(dir, 'out'));
    await extractPinnedTarGz(file, join(dir, 'out'), pinned);
    return join(dir, 'out');
  };

  it('writes the pinned file under its pinned name', async () => {
    const out = await unpack(tarGz([{ name: 'opencode', data: BINARY }]));
    expect(readFileSync(join(out, 'opencode')).equals(BINARY)).toBe(true);
  });

  it('accepts a leading ./ on the name', async () => {
    const out = await unpack(tarGz([{ name: './opencode', data: BINARY }]));
    expect(existsSync(join(out, 'opencode'))).toBe(true);
  });

  it.each([
    ['a file that is not pinned', [{ name: 'opencode', data: BINARY }, { name: 'other', data: 'x' }]],
    ['a path out of the folder', [{ name: '../opencode', data: BINARY }]],
    ['an absolute path', [{ name: '/opencode', data: BINARY }]],
    ['a link', [{ name: 'opencode', data: '', type: '2' }]],
    ['a folder', [{ name: 'opencode/', data: '', type: '5' }]],
    ['the file twice', [{ name: 'opencode', data: BINARY }, { name: 'opencode', data: BINARY }]],
    ['a file of another size', [{ name: 'opencode', data: Buffer.concat([BINARY, Buffer.from('x')]) }]],
    ['a file with other bytes', [{ name: 'opencode', data: randomBytes(BINARY.length) }]],
    ['no file', [{ name: 'readme', data: 'x' }]],
  ])('refuses %s', async (_name, entries) => {
    await expect(unpack(tarGz(entries))).rejects.toBeInstanceOf(UnsafeArchiveError);
  });

  it('refuses something that is not gzip', async () => {
    await expect(unpack(Buffer.from('not an archive'))).rejects.toBeInstanceOf(UnsafeArchiveError);
  });

  it('refuses an archive that unpacks to far more than the pin says', async () => {
    await expect(unpack(tarGz([{ name: 'opencode', data: randomBytes(BINARY.length) }, { name: 'padding', data: Buffer.alloc(1_000_000) }]))).rejects.toBeInstanceOf(UnsafeArchiveError);
  });

  it('refuses a truncated archive', async () => {
    const whole = tarGz([{ name: 'opencode', data: BINARY }]);
    await expect(unpack(whole.subarray(0, Math.floor(whole.length / 2)))).rejects.toBeInstanceOf(UnsafeArchiveError);
  });
});
