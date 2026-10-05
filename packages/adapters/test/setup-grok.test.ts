/**
 * Grok's setup port (epic 12 entry 8): status from the data folder, install
 * through the shared installer on a fixture lock with a stubbed npm and a
 * fixture binary (checked by its SHA-256, never run), no sign-in, and the xAI
 * token check with a fake `fetch` (never the network, the keychain or the
 * real Grok).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { BAD_XAI_API_KEY, createGrokSetup, GROK_INSTALL_NOTE, GROK_KEY_NAME, GROK_NO_SIGN_IN_NOTICE, XAI_VERIFY_URL, type NpmRunner } from '../src/index.js';

const KEY = `xai-${'K'.repeat(60)}4321`;
const PLATFORM = `${process.platform}-${process.arch}`;
const BINARY = 'fixture grok binary';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-groksetup-'));
  dirs.push(dir);
  return dir;
};

const fakeNpm: NpmRunner = (input) => {
  const root = join(input.cwd, 'node_modules', '@xai-official', 'grok');
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@xai-official/grok', version: '1.0.49' }));
  writeFileSync(join(root, 'bin', 'grok'), '');
  const platform = join(input.cwd, 'node_modules', '@xai-official', `grok-${PLATFORM}`, 'bin');
  mkdirSync(platform, { recursive: true });
  writeFileSync(join(platform, process.platform === 'win32' ? 'grok.exe.br' : 'grok.br'), brotliCompressSync(Buffer.from(BINARY)));
  return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
};
const PINS = {
  packageJson: {},
  lock: {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/@xai-official/grok': { version: '1.0.49', integrity: 'sha512-fixture' },
      [`node_modules/@xai-official/grok-${PLATFORM}`]: { version: '1.0.49', integrity: 'sha512-fixture', optional: true },
    },
  },
};
const setupOf = (dataDir: string, apiKey = {}) =>
  createGrokSetup({
    dataDir,
    install: { pins: PINS, runNpm: fakeNpm, npmCli: __filename, binarySha256: { [PLATFORM]: createHash('sha256').update(BINARY).digest('hex') } as never, tokenProbe: async () => true },
    apiKey,
  });

describe("Grok's setup port (epic 12 entry 8)", () => {
  it('reads not installed, then installed, always as a token only agent with the reason on its card', async () => {
    const dataDir = tempDir();
    const setup = setupOf(dataDir);
    expect(await setup.status()).toMatchObject({
      agentId: 'grok',
      install: 'not_installed',
      version: null,
      auth: 'needs_sign_in',
      apiKeyOnly: true,
      apiKeyName: GROK_KEY_NAME,
      subscription: 'signed_out',
      notices: [GROK_NO_SIGN_IN_NOTICE],
      installNote: GROK_INSTALL_NOTE,
    });
    const steps: string[] = [];
    expect(await setup.install((progress) => steps.push(progress.step))).toEqual({ version: '1.0.49' });
    expect(steps.some((step) => step.startsWith('Downloading Grok'))).toBe(true);
    expect(await setup.status()).toMatchObject({ install: 'installed', version: '1.0.49', apiKeyOnly: true, notices: [GROK_NO_SIGN_IN_NOTICE] });
    expect(setup.apiKeyOnly).toBe(true);
  });

  it('states the no sign-in reason in plain words, with no long dashes and without claiming what xAI terms say', () => {
    expect(GROK_NO_SIGN_IN_NOTICE).toBe("Grok works with your own xAI API access token only. Signing in with an account isn't supported here.");
    expect(GROK_NO_SIGN_IN_NOTICE).not.toMatch(/[–—]/);
    expect(GROK_INSTALL_NOTE).not.toMatch(/[–—]/);
  });

  it('offers no sign-in or sign-out', async () => {
    const setup = setupOf(tempDir());
    await expect(setup.signIn()).rejects.toThrow(/can't be signed in with an account/);
    expect(setup.signOut).toBeUndefined();
  });

  it('checks the token shape, and asks xAI with a free call (a fake fetch): ok, refused, or not checked', async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const answer = (status: number) =>
      (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: (init.headers as Record<string, string>).authorization });
        return new Response('secret body', { status });
      }) as unknown as typeof fetch;
    const verify = (status: number) => setupOf(tempDir(), { fetch: answer(status) }).apiKey!.verify(KEY, new AbortController().signal);
    expect(setupOf(tempDir()).apiKey?.envName).toBe('XAI_API_KEY');
    expect(setupOf(tempDir()).apiKey?.check(KEY)).toBeUndefined();
    expect(setupOf(tempDir()).apiKey?.check('sk-proj-nope')).toBe(BAD_XAI_API_KEY);
    expect(BAD_XAI_API_KEY).not.toMatch(/[–—]/);
    expect(await verify(200)).toBe('ok');
    expect(await verify(401)).toBe('refused');
    expect(await verify(400)).toBe('refused');
    expect(await verify(500)).toBe('unchecked');
    expect(calls[0]).toEqual({ url: XAI_VERIFY_URL, auth: `Bearer ${KEY}` });
    const failing = setupOf(tempDir(), {
      fetch: (async () => {
        throw Object.assign(new Error('boom'), { cause: { code: 'ECONNRESET' } });
      }) as unknown as typeof fetch,
    });
    expect(await failing.apiKey!.verify(KEY, new AbortController().signal)).toBe('unchecked');
  });
});
