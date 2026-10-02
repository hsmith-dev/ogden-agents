/**
 * The `toolchain-uv` adapter against a local HTTP fixture server serving fake
 * archives. No test touches the network, a real uv, or the user's PATH: the
 * fake `uv` files hold the text their `--version` prints, and a fake runner
 * reads it back.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolchainError } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareVersions,
  createUvToolchain,
  parseVersion,
  selectTarget,
  shortVersion,
  UV_IGNORE_SYSTEM_ENV,
  versionEnvironment,
  UV_RELEASE,
  UV_TARGETS,
  type UvRelease,
  type UvToolchainOptions,
} from '../src/index.js';
import { tarGz, zip } from './archives.js';

const VERSION = UV_RELEASE.version;
const dirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-'));
  dirs.push(dir);
  return dir;
}

/** Reads a fake `uv`: its contents are what it prints for `--version`. */
const fakeRunner = async (file: string) => {
  try {
    const text = readFileSync(file, 'utf8');
    return text.startsWith('uv ') ? text : null;
  } catch {
    return null;
  }
};

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

type Handler = (url: string, res: import('node:http').ServerResponse) => void;

/** A local server; `requests` lists every path asked for. */
async function fixtureServer(handler: Handler): Promise<{ baseUrl: string; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    handler(req.url ?? '', res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/download`, requests };
}

function serve(body: Buffer): Handler {
  return (_url, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length });
    // Several chunks, so progress reports more than once.
    const step = Math.ceil(body.length / 4);
    for (let i = 0; i < body.length; i += step) res.write(body.subarray(i, i + step));
    res.end();
  };
}

const fakeUvTarball = (target: string, version = VERSION) =>
  tarGz([
    { name: `uv-${target}/`, type: '5' },
    { name: `uv-${target}/uv`, data: `uv ${version} (fake ${target})\n` },
    { name: `uv-${target}/uvx`, data: `uvx ${version}\n` },
  ]);

/** The pinned release, with one target's archive replaced by the fixture's. */
function releaseWith(target: string, file: string, sha: string, size: number): UvRelease {
  return { ...UV_RELEASE, archives: { ...UV_RELEASE.archives, [target]: { file, sha256: sha, size } } };
}

function toolchain(overrides: Partial<UvToolchainOptions> & { dataDir: string }) {
  return createUvToolchain({
    env: { PATH: '' },
    standardDirs: [],
    platform: 'linux',
    arch: 'x64',
    libc: 'gnu',
    runVersion: fakeRunner,
    ...overrides,
  });
}

/** A folder holding a fake `uv` that reports `version`. */
function fakeSystemUv(version: string, exe = ''): string {
  const dir = tempDir();
  writeFileSync(join(dir, `uv${exe}`), `uv ${version} (Homebrew 2026-09-24)\n`);
  return dir;
}

describe('release pins and target selection', () => {
  it('pins 0.12.21 and a SHA-256 for every target', () => {
    expect(UV_RELEASE.version).toBe('0.12.21');
    expect(Object.keys(UV_RELEASE.archives).sort()).toEqual([...UV_TARGETS].sort());
    for (const target of UV_TARGETS) {
      const archive = UV_RELEASE.archives[target]!;
      expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(archive.size).toBeGreaterThan(1_000_000);
      expect(archive.file).toBe(`uv-${target}.${target.endsWith('windows-msvc') ? 'zip' : 'tar.gz'}`);
    }
  });

  it('maps each OS and CPU to its target, with glibc or musl on Linux', () => {
    const pick = (os: string, cpu: string, libc: 'gnu' | 'musl' = 'gnu') => selectTarget({ os, cpu, libc: () => libc });
    expect(pick('darwin', 'arm64')).toEqual({ target: 'aarch64-apple-darwin' });
    expect(pick('darwin', 'x64')).toEqual({ target: 'x86_64-apple-darwin' });
    expect(pick('linux', 'x64')).toEqual({ target: 'x86_64-unknown-linux-gnu' });
    expect(pick('linux', 'arm64', 'musl')).toEqual({ target: 'aarch64-unknown-linux-musl' });
    expect(pick('win32', 'x64')).toEqual({ target: 'x86_64-pc-windows-msvc' });
    expect(pick('win32', 'arm64')).toEqual({ target: 'aarch64-pc-windows-msvc' });
    expect(pick('freebsd', 'x64')).toEqual({ unsupported: expect.stringContaining("can't install uv on this computer") });
    expect(pick('linux', 'ia32')).toEqual({ unsupported: expect.stringContaining('ia32') });
  });

  it('parses and compares versions', () => {
    expect(parseVersion('uv 0.12.21 (Homebrew 2026-09-24 aarch64-apple-darwin)')).toEqual([0, 12, 21]);
    expect(parseVersion('0.4.0')).toEqual([0, 4, 0]);
    expect(parseVersion('something else')).toBeUndefined();
    expect(compareVersions([0, 12, 0], [0, 4, 30])).toBeGreaterThan(0);
    expect(compareVersions([0, 12, 21], [0, 12, 21])).toBe(0);
    expect(shortVersion('0.12.0')).toBe('0.12');
  });
});

describe('status', () => {
  it('is ready from the system when a uv on PATH is at least the minimum', async () => {
    const uv = toolchain({ dataDir: tempDir(), env: { PATH: fakeSystemUv('0.12.19') } });
    expect(await uv.status()).toEqual({ state: 'ready', version: '0.12.19', source: 'system' });
  });

  it('finds uv in a standard install folder when PATH lacks it', async () => {
    const uv = toolchain({ dataDir: tempDir(), standardDirs: [fakeSystemUv('0.13.2')] });
    expect(await uv.status()).toEqual({ state: 'ready', version: '0.13.2', source: 'system' });
  });

  it('finds uv.exe on Windows', async () => {
    const uv = toolchain({ dataDir: tempDir(), platform: 'win32', env: { Path: fakeSystemUv('0.12.21', '.exe') } });
    expect(await uv.status()).toEqual({ state: 'ready', version: '0.12.21', source: 'system' });
  });

  it('is missing, saying so, when the only uv is too old', async () => {
    const uv = toolchain({ dataDir: tempDir(), env: { PATH: fakeSystemUv('0.4.0') } });
    expect(await uv.status()).toEqual({ state: 'missing', reason: 'Your uv is older than 0.12 (this computer has 0.4.0).' });
  });

  it('skips a too-old uv for a newer one later on PATH', async () => {
    const path = [fakeSystemUv('0.4.0'), fakeSystemUv('0.12.3')].join(process.platform === 'win32' ? ';' : ':');
    const uv = toolchain({ dataDir: tempDir(), env: { PATH: path } });
    expect(await uv.status()).toEqual({ state: 'ready', version: '0.12.3', source: 'system' });
  });

  it('is missing when there is no uv anywhere, or the system one is ignored', async () => {
    expect(await toolchain({ dataDir: tempDir() }).status()).toEqual({ state: 'missing' });
    const ignored = toolchain({ dataDir: tempDir(), env: { PATH: fakeSystemUv('0.12.21'), [UV_IGNORE_SYSTEM_ENV]: '1' } });
    expect(await ignored.status()).toEqual({ state: 'missing' });
  });

  it('is ready from the private copy when it runs and reports the pinned version', async () => {
    const dataDir = tempDir();
    const uv = toolchain({ dataDir, env: { PATH: fakeSystemUv('0.4.0') } });
    mkdirSync(uv.privateDir, { recursive: true });
    writeFileSync(join(uv.privateDir, 'uv'), `uv ${VERSION}\n`);
    expect(await uv.status()).toEqual({ state: 'ready', version: VERSION, source: 'private' });

    // A broken private copy doesn't count.
    writeFileSync(join(uv.privateDir, 'uv'), 'garbage');
    expect(await uv.status()).toEqual({ state: 'missing', reason: expect.stringContaining('older than 0.12') });
  });

  it('fails with a plain explanation on an OS or CPU with no pinned target, even beside a too-old uv', async () => {
    const uv = toolchain({ dataDir: tempDir(), platform: 'linux', arch: 'ppc64' });
    expect(await uv.status()).toEqual({ state: 'failed', reason: expect.stringContaining("can't install uv"), canInstall: false });
    const old = toolchain({ dataDir: tempDir(), platform: 'linux', arch: 'ppc64', env: { PATH: fakeSystemUv('0.4.0') } });
    expect(await old.status()).toEqual({ state: 'failed', reason: expect.stringContaining("can't install uv"), canInstall: false });
  });
});

describe('versionEnvironment', () => {
  it('keeps only what uv needs to start: never an agent key or anything else', () => {
    const source = { PATH: '/bin', HOME: '/h', USERPROFILE: 'C:\\u', ANTHROPIC_API_KEY: 'sk-x', SECRET: 's', SystemRoot: 'C:\\Windows', PATHEXT: '.EXE' };
    expect(versionEnvironment(source, 'linux')).toEqual({ PATH: '/bin', HOME: '/h', USERPROFILE: 'C:\\u' });
    expect(versionEnvironment({ ...source, PATH: undefined, Path: 'C:\\bin', anthropic_api_key: 'sk-y' }, 'win32')).toEqual({
      Path: 'C:\\bin',
      HOME: '/h',
      USERPROFILE: 'C:\\u',
      SystemRoot: 'C:\\Windows',
      PATHEXT: '.EXE',
    });
  });
});

describe('locate (story 4.1)', () => {
  it('is the first usable system uv, else the private copy, else none', async () => {
    const old = fakeSystemUv('0.4.0');
    const usable = fakeSystemUv('0.12.19');
    const sep = process.platform === 'win32' ? ';' : ':';
    expect(await toolchain({ dataDir: tempDir(), env: { PATH: [old, usable].join(sep) } }).locate()).toBe(join(usable, 'uv'));

    const dataDir = tempDir();
    const uv = toolchain({ dataDir, env: { PATH: old } });
    expect(await uv.locate()).toBeUndefined();
    mkdirSync(uv.privateDir, { recursive: true });
    writeFileSync(join(uv.privateDir, 'uv'), `uv ${VERSION}\n`);
    expect(await uv.locate()).toBe(join(uv.privateDir, 'uv'));

    // An ignored system uv is never located.
    expect(await toolchain({ dataDir: tempDir(), env: { PATH: usable, [UV_IGNORE_SYSTEM_ENV]: '1' } }).locate()).toBeUndefined();
  });
});

describe('installUv', () => {
  const target = 'x86_64-unknown-linux-gnu';
  const file = `uv-${target}.tar.gz`;

  it('downloads the pinned archive, verifies it and unpacks uv into <dataDir>/tools/uv/<version>/', async () => {
    const archive = fakeUvTarball(target);
    const { baseUrl, requests } = await fixtureServer(serve(archive));
    const dataDir = tempDir();
    const uv = toolchain({ dataDir, baseUrl, release: releaseWith(target, file, sha256(archive), archive.length) });
    const progress: Array<{ bytes: number; total: number | null }> = [];

    await expect(uv.installUv((p) => progress.push(p))).resolves.toEqual({ version: VERSION });

    expect(requests).toEqual([`/download/${VERSION}/${file}`]);
    expect(uv.privateDir).toBe(join(dataDir, 'tools', 'uv', VERSION));
    expect(readFileSync(join(uv.privateDir, 'uv'), 'utf8')).toContain(`uv ${VERSION}`);
    expect(existsSync(join(uv.privateDir, 'uvx'))).toBe(true);
    // Only the version folder remains: the archive and temp folders are gone.
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([VERSION]);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toEqual({ bytes: archive.length, total: archive.length });
    if (process.platform !== 'win32') {
      expect(statSync(uv.privateDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(uv.privateDir, 'uv')).mode & 0o777).toBe(0o755);
    }
    expect(await uv.status()).toEqual({ state: 'ready', version: VERSION, source: 'private' });
  });

  it('unpacks the Windows zip, which holds uv.exe at its top level', async () => {
    const winTarget = 'x86_64-pc-windows-msvc';
    const winFile = `uv-${winTarget}.zip`;
    const archive = zip([
      { name: 'uv.exe', data: `uv ${VERSION} (fake windows)\n` },
      { name: 'uvx.exe', data: 'uvx' },
      { name: 'uvw.exe', data: 'uvw' },
    ]);
    const { baseUrl } = await fixtureServer(serve(archive));
    const uv = toolchain({ dataDir: tempDir(), platform: 'win32', arch: 'x64', baseUrl, release: releaseWith(winTarget, winFile, sha256(archive), archive.length) });
    await uv.installUv(() => {});
    expect(readdirSync(uv.privateDir).sort()).toEqual(['uv.exe', 'uvw.exe', 'uvx.exe']);
  });

  it('refuses an archive whose hash differs from the pin: nothing is extracted and temp files are removed', async () => {
    const archive = fakeUvTarball(target);
    const { baseUrl } = await fixtureServer(serve(archive));
    const dataDir = tempDir();
    const pinned = 'a'.repeat(64);
    const uv = toolchain({ dataDir, baseUrl, release: releaseWith(target, file, pinned, archive.length) });

    const error = await uv.installUv(() => {}).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolchainError);
    const failure = error as ToolchainError;
    expect(failure.code).toBe('hash_mismatch');
    expect(failure.message).toContain("didn't match the expected file");
    expect(failure.canInstall).toBe(true);
    expect(failure.details).toMatchObject({ target, expected: pinned, actual: sha256(archive) });
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([]);
    expect(await uv.status()).toEqual({ state: 'missing' });
  });

  it('stops a download as soon as it grows past the pinned size, or announces a larger one', async () => {
    const archive = fakeUvTarball(target);
    const pin = releaseWith(target, file, sha256(archive), archive.length - 10);
    // Declared too large: refused before reading.
    let served = await fixtureServer(serve(archive));
    let uv = toolchain({ dataDir: tempDir(), baseUrl: served.baseUrl, release: pin });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'hash_mismatch', details: { reason: 'larger than the pinned size' } });
    // No length declared: stopped once the bytes pass the pin.
    served = await fixtureServer((_url, res) => {
      res.writeHead(200);
      res.end(archive);
    });
    const dataDir = tempDir();
    uv = toolchain({ dataDir, baseUrl: served.baseUrl, release: pin });
    const progress: number[] = [];
    await expect(uv.installUv((p) => progress.push(p.bytes))).rejects.toMatchObject({ code: 'hash_mismatch' });
    expect(Math.max(...progress)).toBeLessThanOrEqual(archive.length - 10);
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([]);
  });

  it('installs when the server sends no length, reporting the pinned size as the total', async () => {
    const archive = fakeUvTarball(target);
    const { baseUrl } = await fixtureServer((_url, res) => {
      res.writeHead(200);
      res.end(archive);
    });
    const uv = toolchain({ dataDir: tempDir(), baseUrl, release: releaseWith(target, file, sha256(archive), archive.length) });
    const progress: Array<{ bytes: number; total: number | null }> = [];
    await uv.installUv((p) => progress.push(p));
    expect(progress.at(-1)).toEqual({ bytes: archive.length, total: archive.length });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'rejects, without crashing, when the data folder cannot be written',
    async () => {
      const archive = fakeUvTarball(target);
      const { baseUrl } = await fixtureServer(serve(archive));
      const dataDir = tempDir();
      const tools = join(dataDir, 'tools', 'uv');
      mkdirSync(tools, { recursive: true });
      const uv = toolchain({ dataDir, baseUrl, release: releaseWith(target, file, sha256(archive), archive.length) });
      chmodSync(tools, 0o500);
      try {
        await expect(uv.installUv(() => {})).rejects.toThrow();
      } finally {
        chmodSync(tools, 0o700);
      }
      expect(existsSync(uv.privateDir)).toBe(false);
    },
  );

  it('fails with a retry offer when the connection drops mid-download, removing the partial file', async () => {
    const { baseUrl } = await fixtureServer((_url, res) => {
      res.writeHead(200, { 'content-length': 100_000 });
      res.write(Buffer.alloc(1000));
      setTimeout(() => res.socket?.destroy(), 20);
    });
    const dataDir = tempDir();
    const uv = toolchain({ dataDir, baseUrl, release: releaseWith(target, file, 'b'.repeat(64), 100_000) });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'download_failed', canInstall: true });
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([]);
  });

  it('fails when the download stalls', async () => {
    const { baseUrl } = await fixtureServer((_url, res) => {
      res.writeHead(200, { 'content-length': 100_000 });
      res.write(Buffer.alloc(10));
      // Then nothing.
    });
    const uv = toolchain({ dataDir: tempDir(), baseUrl, idleTimeoutMs: 100, release: releaseWith(target, file, 'b'.repeat(64), 100_000) });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'download_failed' });
  });

  it('fails when the server answers with an error, or cannot be reached', async () => {
    const { baseUrl } = await fixtureServer((_url, res) => {
      res.writeHead(404);
      res.end();
    });
    const uv = toolchain({ dataDir: tempDir(), baseUrl, release: releaseWith(target, file, 'c'.repeat(64), 100) });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'download_failed', message: expect.stringContaining('error 404') });

    const offline = toolchain({ dataDir: tempDir(), baseUrl: 'http://127.0.0.1:1/download' });
    await expect(offline.installUv(() => {})).rejects.toMatchObject({ code: 'download_failed', canInstall: true });
  });

  it('fails on an unsupported OS or CPU without downloading anything', async () => {
    const { baseUrl, requests } = await fixtureServer(serve(Buffer.alloc(1)));
    const uv = toolchain({ dataDir: tempDir(), baseUrl, platform: 'sunos' });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'unsupported_platform', canInstall: false });
    expect(requests).toEqual([]);
  });

  it('fails without installing when the archive has no uv, or the unpacked uv does not run', async () => {
    const empty = tarGz([{ name: `uv-${target}/README`, data: 'nothing here' }]);
    let served = await fixtureServer(serve(empty));
    let dataDir = tempDir();
    let uv = toolchain({ dataDir, baseUrl: served.baseUrl, release: releaseWith(target, file, sha256(empty), empty.length) });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'extract_failed' });
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([]);

    const wrong = fakeUvTarball(target, '0.1.0');
    served = await fixtureServer(serve(wrong));
    dataDir = tempDir();
    uv = toolchain({ dataDir, baseUrl: served.baseUrl, release: releaseWith(target, file, sha256(wrong), wrong.length) });
    await expect(uv.installUv(() => {})).rejects.toMatchObject({ code: 'install_failed' });
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([]);
  });

  it('replaces a broken copy of the same version, and clears temp folders a crash left', async () => {
    const archive = fakeUvTarball(target);
    const { baseUrl } = await fixtureServer(serve(archive));
    const dataDir = tempDir();
    const uv = toolchain({ dataDir, baseUrl, release: releaseWith(target, file, sha256(archive), archive.length) });
    mkdirSync(uv.privateDir, { recursive: true });
    writeFileSync(join(uv.privateDir, 'uv'), 'broken');
    mkdirSync(join(dataDir, 'tools', 'uv', '.install-leftover'));

    await uv.installUv(() => {});
    expect(readFileSync(join(uv.privateDir, 'uv'), 'utf8')).toContain(`uv ${VERSION}`);
    expect(readdirSync(join(dataDir, 'tools', 'uv'))).toEqual([VERSION]);
  });
});
