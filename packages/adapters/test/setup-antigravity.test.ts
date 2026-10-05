/**
 * Epic 6 entry 7: Antigravity's install, uninstall, Google sign-in, sign-out
 * and key check, against local fixture archives served on 127.0.0.1 and the
 * fake agent's Antigravity personality as its server. No test reaches Google,
 * runs the real server, touches the keychain, or reads the real `~/.gemini`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentPlatform } from '@ogden-agents/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BAD_GEMINI_KEY,
  createAntigravitySetup,
  createGeminiApiKey,
  currentPlatform,
  downloadVerified,
  DownloadError,
  extractPinned,
  GEMINI_VERIFY_URL,
  isSafeEntryName,
  signInRecordPath,
  UnsafeArchiveError,
  type AntigravityPins,
  type AntigravitySetupOptions,
} from '../src/index.js';
import { zip } from './archives.js';

const FAKE_ANTIGRAVITY = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-antigravity.mjs');
const KEY = `AIza${'K'.repeat(31)}9876`;
const dirs: string[] = [];
const servers: Server[] = [];
const closers: Array<() => void> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function tempDir(prefix = 'ogden-agents-agy7-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** The two files a fixture archive holds, small stand-ins for the server and its helper. */
const SERVER = randomBytes(200_000);
const HELPER = Buffer.from('fake helper');
const FILES = { 'agy_acp_server.par': SERVER, localharness_external: HELPER };
const filePins = (files: Record<string, Buffer> = FILES) => Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { size: data.length, sha256: sha256(data) }]));

interface Served {
  url: string;
  requests: Array<{ range: string | undefined; ifRange: string | undefined; encoding: string | undefined }>;
  /** Cut the next answer after this many bytes (a dropped connection). */
  cutAfter?: number;
  /** Answer 200 to a range request (an archive that changed). */
  ignoreRange?: boolean;
  etag: string;
}

/** Serves `archive` on 127.0.0.1 with `Range`, `If-Range` and an `ETag`, as dl.google.com does. */
async function serve(archive: Buffer): Promise<Served> {
  const served: Served = { url: '', requests: [], etag: '"fixture-1"' };
  const server = createServer((req, res) => {
    served.requests.push({ range: req.headers.range, ifRange: req.headers['if-range'] as string | undefined, encoding: req.headers['accept-encoding'] });
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    let start = 0;
    const etag = served.etag === '' ? {} : { etag: served.etag };
    if (range !== null && !served.ignoreRange && (served.etag === '' || req.headers['if-range'] === served.etag)) {
      start = Number(range[1]);
      if (start >= archive.length) {
        res.writeHead(416);
        res.end();
        return;
      }
      res.writeHead(206, { 'content-range': `bytes ${start}-${archive.length - 1}/${archive.length}`, 'content-length': archive.length - start, ...etag });
    } else {
      res.writeHead(200, { 'content-length': archive.length, ...etag, 'accept-ranges': 'bytes' });
    }
    const body = archive.subarray(start);
    if (served.cutAfter !== undefined) {
      const cut = served.cutAfter;
      served.cutAfter = undefined;
      // Sent, then the connection drops once the client had time to read it.
      res.write(body.subarray(0, cut), () => setTimeout(() => res.socket?.destroy(), 100));
      return;
    }
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  served.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/agy-acp-server-1.3.0.zip`;
  return served;
}

function pinsFor(archive: Buffer, url: string, options: { version?: string; files?: Record<string, Buffer>; platform?: AgentPlatform } = {}): AntigravityPins {
  return {
    registry: 'antigravity-acp',
    version: options.version ?? '1.3.0',
    archives: {
      [options.platform ?? currentPlatform()]: { url, sha256: sha256(archive), size: archive.length, binary: 'agy_acp_server.par', args: ['--uid='], files: filePins(options.files) },
    },
  };
}

/** A setup on a temp data folder whose server is the fake agent's Antigravity personality, run by Node. */
function setupOf(dataDir: string, pins: AntigravityPins, extra: Partial<AntigravitySetupOptions> = {}) {
  const diagnostics: Array<[string, Record<string, unknown> | undefined]> = [];
  const setup = createAntigravitySetup({
    dataDir,
    pins,
    env: () => ({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', GEMINI_API_KEY: KEY }),
    serverCommand: (server) => ({ command: process.execPath, args: [FAKE_ANTIGRAVITY, ...server.args] }),
    timeouts: { startMs: 20_000, urlMs: 10_000, signInMs: 30_000, backoffMs: 1, idleMs: 5_000 },
    apiKey: { verify: async () => 'ok' },
    onDiagnostic: (message, fields) => diagnostics.push([message, fields]),
    ...extra,
  });
  closers.push(() => setup.close());
  return { setup, diagnostics };
}

const versionDir = (dataDir: string) => join(dataDir, 'agents', 'antigravity', '1.3.0');
const home = (dataDir: string) => join(dataDir, 'agents', 'antigravity-home');

async function waitFor(predicate: () => boolean, what: string, ms = 10_000) {
  const until = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('the safe unzip (entry 7)', () => {
  const unpackInto = async (archive: Buffer, files = filePins()) => {
    const dir = tempDir();
    const file = join(dir, 'a.zip');
    writeFileSync(file, archive);
    const out = join(dir, 'out');
    mkdirSync(out);
    await extractPinned(file, out, files);
    return out;
  };

  it('unpacks the pinned files, deflated or stored, each checked against its pin', async () => {
    const out = await unpackInto(zip([{ name: 'agy_acp_server.par', data: SERVER, mode: 0o100755 }, { name: 'localharness_external', data: HELPER, stored: true }]));
    expect(readFileSync(join(out, 'agy_acp_server.par')).equals(SERVER)).toBe(true);
    expect(readFileSync(join(out, 'localharness_external')).equals(HELPER)).toBe(true);
  });

  it.each([
    ['a path out of the folder', '../agy_acp_server.par', {}],
    ['an absolute path', '/tmp/agy_acp_server.par', {}],
    ['a drive letter', 'C:agy_acp_server.par', {}],
    ['a backslash', 'x\\..\\agy_acp_server.par', {}],
    ['a link', 'agy_acp_server.par', { mode: 0o120777 }],
    ['a folder', 'agy_acp_server.par', { dosAttributes: 0x10 }],
    ['a file not in the pin', 'extra', {}],
  ])('refuses %s before writing anything', async (_what, name, attributes) => {
    const dir = tempDir();
    const file = join(dir, 'a.zip');
    writeFileSync(file, zip([{ name: 'localharness_external', data: HELPER }, { name, data: SERVER, ...attributes }]));
    const out = join(dir, 'out');
    mkdirSync(out);
    await expect(extractPinned(file, out, filePins())).rejects.toBeInstanceOf(UnsafeArchiveError);
    expect(readdirSync(out)).toEqual([]);
    expect(existsSync(join(dir, 'agy_acp_server.par'))).toBe(false);
  });

  it('refuses a missing file, a duplicate, and a file that is not its pinned content', async () => {
    await expect(unpackInto(zip([{ name: 'agy_acp_server.par', data: SERVER }]))).rejects.toThrow('a pinned file is missing');
    await expect(unpackInto(zip([{ name: 'agy_acp_server.par', data: SERVER }, { name: 'agy_acp_server.par', data: SERVER }, { name: 'localharness_external', data: HELPER }]))).rejects.toThrow('twice');
    const other = Buffer.from('x'.repeat(HELPER.length));
    await expect(unpackInto(zip([{ name: 'agy_acp_server.par', data: SERVER }, { name: 'localharness_external', data: other }]))).rejects.toThrow('does not match its pin');
  });

  it('accepts plain names only', () => {
    expect(isSafeEntryName('agy_acp_server.exe')).toBe(true);
    for (const bad of ['', '.', '..', 'a/../b', 'a//b', '/a', 'a\\b', 'C:/a', 'a\0b', 'dir/']) expect(isSafeEntryName(bad)).toBe(false);
  });
});

describe('the resumable download (entry 7)', () => {
  const archive = zip([{ name: 'agy_acp_server.par', data: SERVER }, { name: 'localharness_external', data: HELPER }]);

  it('asks for the identity bytes, resumes a dropped download with Range and If-Range, and checks the SHA-256', async () => {
    const served = await serve(archive);
    served.cutAfter = 1000;
    const partFile = join(tempDir(), 'a.zip.part');
    const progress: number[] = [];
    await downloadVerified({ url: served.url, size: archive.length, sha256: sha256(archive), partFile, backoffMs: 1, onProgress: (bytes) => progress.push(bytes) });
    expect(readFileSync(partFile).equals(archive)).toBe(true);
    expect(served.requests).toHaveLength(2);
    expect(served.requests[0]).toMatchObject({ range: undefined, encoding: 'identity' });
    // Fetch itself adds `identity` again to a range request.
    expect(served.requests[1]).toMatchObject({ range: 'bytes=1000-', ifRange: served.etag, encoding: expect.stringMatching(/^identity(, identity)?$/) });
    expect(progress.at(-1)).toBe(archive.length);
  });

  it('a later install picks up a part file left by an earlier one', async () => {
    const served = await serve(archive);
    served.cutAfter = 500;
    const partFile = join(tempDir(), 'a.zip.part');
    await expect(downloadVerified({ url: served.url, size: archive.length, sha256: sha256(archive), partFile, attempts: 1 })).rejects.toMatchObject({ kind: 'network' });
    await downloadVerified({ url: served.url, size: archive.length, sha256: sha256(archive), partFile, attempts: 1 });
    expect(served.requests[1]?.range).toBe('bytes=500-');
    expect(readFileSync(partFile).equals(archive)).toBe(true);
  });

  it('resumes without an ETag too (the SHA-256 still decides)', async () => {
    const served = await serve(archive);
    served.etag = '';
    served.cutAfter = 800;
    const partFile = join(tempDir(), 'a.zip.part');
    await downloadVerified({ url: served.url, size: archive.length, sha256: sha256(archive), partFile, backoffMs: 1 });
    expect(served.requests[1]?.range).toBe('bytes=800-');
    expect(readFileSync(partFile).equals(archive)).toBe(true);
  });

  it('starts over when the server answers a resume with the whole file', async () => {
    const served = await serve(archive);
    served.cutAfter = 700;
    served.ignoreRange = true;
    const partFile = join(tempDir(), 'a.zip.part');
    await downloadVerified({ url: served.url, size: archive.length, sha256: sha256(archive), partFile, backoffMs: 1 });
    expect(readFileSync(partFile).equals(archive)).toBe(true);
  });

  it('deletes a file whose SHA-256 is not the pin, and never takes more than the pinned size', async () => {
    const served = await serve(archive);
    const partFile = join(tempDir(), 'a.zip.part');
    await expect(downloadVerified({ url: served.url, size: archive.length, sha256: 'f'.repeat(64), partFile })).rejects.toMatchObject({ kind: 'mismatch' });
    expect(existsSync(partFile)).toBe(false);
    await expect(downloadVerified({ url: served.url, size: archive.length - 10, sha256: sha256(archive), partFile })).rejects.toMatchObject({ kind: 'mismatch' });
    expect(existsSync(partFile)).toBe(false);
  });

  it('gives up after its tries with a network failure', async () => {
    const partFile = join(tempDir(), 'a.zip.part');
    const failing = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const error = await downloadVerified({ url: 'http://127.0.0.1:9/x.zip', size: 10, sha256: 'a'.repeat(64), partFile, fetch: failing, backoffMs: 1, attempts: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error).toMatchObject({ kind: 'network', details: { code: 'ECONNREFUSED' } });
  });
});

describe('Install and Uninstall (entry 7)', { timeout: 60_000 }, () => {
  const archive = zip([{ name: 'agy_acp_server.par', data: SERVER, mode: 0o100755 }, { name: 'localharness_external', data: HELPER, mode: 0o100555 }]);

  it('downloads, checks, unpacks, reads the version from initialize, and reads installed; Uninstall keeps its home and sign-in', async () => {
    const served = await serve(archive);
    const dataDir = tempDir();
    const { setup } = setupOf(dataDir, pinsFor(archive, served.url));
    expect(await setup.status()).toMatchObject({ install: 'not_installed', installNote: expect.stringContaining('~/.gemini/antigravity/bin') });
    const steps: string[] = [];
    expect(await setup.install((progress) => steps.push(progress.step))).toEqual({ version: '1.3.0' });
    expect(steps).toEqual(expect.arrayContaining(['Downloading Antigravity', 'Unpacking Antigravity', 'Checking Antigravity']));
    expect(readFileSync(join(versionDir(dataDir), 'agy_acp_server.par')).equals(SERVER)).toBe(true);
    expect(await setup.status()).toMatchObject({ install: 'installed', version: '1.3.0', auth: 'needs_sign_in', canUninstall: true });
    // No download, staging or aside folder is left.
    expect(readdirSync(join(dataDir, 'agents', 'antigravity')).sort()).toEqual(['.download', '1.3.0']);
    expect(readdirSync(join(dataDir, 'agents', 'antigravity', '.download'))).toEqual([]);

    mkdirSync(home(dataDir), { recursive: true });
    writeFileSync(join(home(dataDir), 'chat.db'), 'kept');
    writeFileSync(signInRecordPath(dataDir), '{}');
    await setup.uninstall!();
    expect(existsSync(join(dataDir, 'agents', 'antigravity'))).toBe(false);
    expect(readFileSync(join(home(dataDir), 'chat.db'), 'utf8')).toBe('kept');
    expect(existsSync(signInRecordPath(dataDir))).toBe(true);
    expect(await setup.status()).toMatchObject({ install: 'not_installed' });
  });

  it('refuses an archive whose hash does not match, leaving nothing installed', async () => {
    const served = await serve(archive);
    const dataDir = tempDir();
    const pins = pinsFor(archive, served.url);
    const { setup } = setupOf(dataDir, { ...pins, archives: { [currentPlatform()]: { ...pins.archives[currentPlatform()]!, sha256: 'e'.repeat(64) } } });
    await expect(setup.install(() => {})).rejects.toThrow("The download didn't match the expected file, so nothing was installed. Try again.");
    expect(existsSync(versionDir(dataDir))).toBe(false);
    expect(await setup.status()).toMatchObject({ install: 'not_installed' });
  });

  it('refuses an archive holding an unsafe entry, even one matching its pin, and removes it', async () => {
    const hostile = zip([{ name: 'agy_acp_server.par', data: SERVER }, { name: 'localharness_external', data: HELPER }, { name: '../escape', data: 'x' }]);
    const served = await serve(hostile);
    const dataDir = tempDir();
    const { setup } = setupOf(dataDir, pinsFor(hostile, served.url));
    await expect(setup.install(() => {})).rejects.toThrow("The download wasn't the expected Antigravity files");
    expect(existsSync(join(dataDir, 'agents', 'escape'))).toBe(false);
    expect(readdirSync(join(dataDir, 'agents', 'antigravity')).filter((name) => name !== '.download')).toEqual([]);
    expect(readdirSync(join(dataDir, 'agents', 'antigravity', '.download'))).toEqual([]);
  });

  it('refuses a copy whose initialize reports another version', async () => {
    const served = await serve(archive);
    const dataDir = tempDir();
    const { setup } = setupOf(dataDir, pinsFor(archive, served.url, { version: '9.9.9' }));
    await expect(setup.install(() => {})).rejects.toThrow("didn't start on this computer");
    expect(existsSync(join(dataDir, 'agents', 'antigravity', '9.9.9'))).toBe(false);
  });

  it('reuses a matching copy already in the data folder without downloading, and replaces one that does not match', async () => {
    const served = await serve(archive);
    const dataDir = tempDir();
    mkdirSync(versionDir(dataDir), { recursive: true });
    for (const [name, data] of Object.entries(FILES)) writeFileSync(join(versionDir(dataDir), name), data);
    const { setup, diagnostics } = setupOf(dataDir, pinsFor(archive, served.url));
    expect(await setup.status()).toMatchObject({ install: 'not_installed' });
    await setup.install(() => {});
    expect(served.requests).toHaveLength(0);
    expect(diagnostics.some(([message]) => message.includes('adopted'))).toBe(true);
    expect(await setup.status()).toMatchObject({ install: 'installed', version: '1.3.0' });

    const other = tempDir();
    mkdirSync(versionDir(other), { recursive: true });
    writeFileSync(join(versionDir(other), 'agy_acp_server.par'), 'not the pinned server');
    writeFileSync(join(versionDir(other), 'localharness_external'), HELPER);
    const second = setupOf(other, pinsFor(archive, served.url)).setup;
    await second.install(() => {});
    expect(served.requests).toHaveLength(1);
    expect(readFileSync(join(versionDir(other), 'agy_acp_server.par')).equals(SERVER)).toBe(true);
  });

  it('an install removes other versions and an earlier uninstall that could not finish', async () => {
    const served = await serve(archive);
    const dataDir = tempDir();
    mkdirSync(join(dataDir, 'agents', 'antigravity', '1.2.1'), { recursive: true });
    mkdirSync(join(dataDir, 'agents', '.antigravity-removing-abcd'), { recursive: true });
    await setupOf(dataDir, pinsFor(archive, served.url)).setup.install(() => {});
    expect(readdirSync(join(dataDir, 'agents', 'antigravity')).sort()).toEqual(['.download', '1.3.0']);
    expect(readdirSync(join(dataDir, 'agents'))).not.toContain('.antigravity-removing-abcd');
  });

  it('says it is not available on a computer with no pin, with no download', async () => {
    const dataDir = tempDir();
    const { setup } = setupOf(dataDir, pinsFor(archive, 'http://127.0.0.1:9/x.zip', { platform: 'linux-x64' }), { platform: 'win32-arm64' });
    expect(await setup.status()).toMatchObject({ install: 'not_installed', canInstall: false, reason: expect.stringMatching(/^Antigravity isn't available on this computer\./) });
    await expect(setup.install(() => {})).rejects.toThrow("isn't available on this computer");
  });
});

describe('Google sign-in and sign-out (entry 7)', { timeout: 60_000 }, () => {
  const archive = zip([{ name: 'agy_acp_server.par', data: SERVER }, { name: 'localharness_external', data: HELPER }]);

  async function installed(extra: Partial<AntigravitySetupOptions> = {}) {
    const served = await serve(archive);
    const dataDir = tempDir();
    const made = setupOf(dataDir, pinsFor(archive, served.url), extra);
    await made.setup.install(() => {});
    return { dataDir, ...made };
  }

  it("hands back the Google link once, never logs it, and reads signed in when the browser finishes; sign-out uses the server's logout", async () => {
    const { dataDir, setup, diagnostics } = await installed();
    const signIn = await setup.signIn();
    expect(new URL(signIn.url!).hostname).toBe('accounts.google.com');
    expect(signIn.submitCode).toBeUndefined();
    expect(JSON.stringify(diagnostics)).not.toContain('accounts.google.com');
    expect(JSON.stringify(diagnostics)).not.toContain('fake-state');
    if (process.platform !== 'win32') expect(diagnostics).toContainEqual(['Antigravity sign-in started', { step: 'spawn', browserHelper: true }]);
    // The "browser" approves.
    writeFileSync(join(home(dataDir), 'fake-google-consent'), '');
    expect(await signIn.done).toBe('signed_in');
    expect(existsSync(signInRecordPath(dataDir))).toBe(true);
    expect(readFileSync(signInRecordPath(dataDir), 'utf8')).not.toContain('accounts.google.com');
    expect(await setup.status()).toMatchObject({ auth: 'signed_in', method: 'subscription', canSignOut: true, subscription: 'signed_in', signInNote: expect.stringContaining('browser on this computer') });

    await setup.signOut!();
    expect(existsSync(signInRecordPath(dataDir))).toBe(false);
    expect(existsSync(join(home(dataDir), 'fake-google-signed-in'))).toBe(false);
    expect(await setup.status()).toMatchObject({ auth: 'needs_sign_in', subscription: 'signed_out' });
  });

  it('never gives the sign-in server an API key, and keeps it in its own home', async () => {
    const { dataDir, setup } = await installed({ env: () => ({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', GEMINI_API_KEY: KEY, gemini_api_key: KEY, GEMINI_HOME: '/elsewhere' }) });
    const signIn = await setup.signIn();
    // The fake signs in only with Google here, never with a key from its environment.
    writeFileSync(join(home(dataDir), 'fake-google-consent'), '');
    expect(await signIn.done).toBe('signed_in');
    expect(existsSync(join(home(dataDir), 'fake-google-signed-in'))).toBe(true);
    expect(readFileSync(join(home(dataDir), 'fake-google-env'), 'utf8')).toBe('key=none\n');
  });

  it('a refused sign-in is failed, a cancelled one stops its server, and no link from another host is ever taken', async () => {
    const { dataDir, setup } = await installed();
    const refused = await setup.signIn();
    writeFileSync(join(home(dataDir), 'fake-google-deny'), '');
    expect(await refused.done).toBe('failed');
    expect(await setup.status()).toMatchObject({ auth: 'needs_sign_in' });

    const cancelled = await setup.signIn();
    await cancelled.cancel();
    expect(await cancelled.done).toBe('cancelled');

    const other = await installed({
      env: () => ({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', FAKE_ACP_OAUTH_URL: 'https://evil.example/o/oauth2?state=x' }),
      timeouts: { startMs: 20_000, urlMs: 3_000, signInMs: 30_000, backoffMs: 1 },
    });
    await expect(other.setup.signIn()).rejects.toThrow("didn't show a Google sign-in link");
  });

  it('a sign-in already kept in its home finishes at once, with no link', async () => {
    const { dataDir, setup } = await installed();
    writeFileSync(join(home(dataDir), 'fake-google-signed-in'), 'signed in\n');
    const signIn = await setup.signIn();
    expect(signIn.url).toBeNull();
    expect(await signIn.done).toBe('signed_in');
    expect(existsSync(signInRecordPath(dataDir))).toBe(true);
  });

  it('Uninstall stops a sign-in still starting, before its link arrives', async () => {
    const { dataDir, setup } = await installed({ env: () => ({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', FAKE_ACP_INIT_DELAY_MS: '3000' }) });
    const starting = setup.signIn().catch((error: unknown) => error);
    await waitFor(() => readdirSync(join(dataDir, 'agents')).some((name) => name.startsWith('.signin-')), 'the sign-in to start');
    await setup.uninstall!();
    expect(await starting).toBeInstanceOf(Error);
    expect(existsSync(join(dataDir, 'agents', 'antigravity'))).toBe(false);
    expect(readdirSync(join(dataDir, 'agents')).filter((name) => name.startsWith('.signin-'))).toEqual([]);
  });

  it('refuses to sign in or out when not installed', async () => {
    const { setup } = setupOf(tempDir(), pinsFor(archive, 'http://127.0.0.1:9/x.zip'));
    await expect(setup.signIn()).rejects.toThrow("isn't installed");
    await expect(setup.signOut!()).rejects.toThrow("isn't installed");
  });
});

describe("the Gemini key's free check (entry 7)", () => {
  const verifyWith = (respond: () => Promise<Response>) => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond();
    }) as unknown as typeof fetch;
    return { support: createGeminiApiKey({ fetch: fake }), calls };
  };

  it('asks Google with the key in a header only, and reads ok, refused or unchecked', async () => {
    const ok = verifyWith(async () => new Response('{}', { status: 200 }));
    expect(await ok.support.verify(KEY, new AbortController().signal)).toBe('ok');
    expect(ok.calls[0]!.url).toBe(GEMINI_VERIFY_URL);
    expect(ok.calls[0]!.url).not.toContain(KEY);
    expect(ok.calls[0]!.init).toMatchObject({ headers: { 'x-goog-api-key': KEY }, redirect: 'error' });
    for (const status of [400, 401, 403]) expect(await verifyWith(async () => new Response('', { status })).support.verify(KEY, new AbortController().signal)).toBe('refused');
    expect(await verifyWith(async () => new Response('', { status: 503 })).support.verify(KEY, new AbortController().signal)).toBe('unchecked');
    expect(
      await verifyWith(async () => {
        throw new TypeError('offline');
      }).support.verify(KEY, new AbortController().signal),
    ).toBe('unchecked');
    expect(ok.support.check('AIza-too-short')).toBe(BAD_GEMINI_KEY);
  });
});
