/**
 * Codex's setup port (epic 12 entry 6): status from the data folder, install
 * through the shared installer on a fixture lock with a stubbed npm, no
 * sign-in, and the OpenAI API key check with a fake `fetch` (never the
 * network, the keychain or the real Codex).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BAD_OPENAI_API_KEY, CODEX_NO_SIGN_IN_NOTICE, createCodexSetup, OPENAI_VERIFY_URL, type NpmRunner } from '../src/index.js';

const KEY = `sk-proj-${'K'.repeat(40)}4321`;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-codexsetup-'));
  dirs.push(dir);
  return dir;
};

const fakeNpm: NpmRunner = (input) => {
  const root = join(input.cwd, 'node_modules', '@agentclientprotocol', 'codex-acp');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@agentclientprotocol/codex-acp', version: '2.1.1' }));
  writeFileSync(join(root, 'dist', 'index.js'), '');
  return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
};
const PINS = {
  packageJson: {},
  lock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/@agentclientprotocol/codex-acp': { version: '2.1.1', integrity: 'sha512-fixture' } } },
};
const setupOf = (dataDir: string, apiKey = {}) => createCodexSetup({ dataDir, install: { pins: PINS, runNpm: fakeNpm, npmCli: __filename }, apiKey });

describe("Codex's setup port (epic 12 entry 6)", () => {
  it('reads not installed, then installed, always as an API key only agent with the reason on its card', async () => {
    const dataDir = tempDir();
    const setup = setupOf(dataDir);
    expect(await setup.status()).toMatchObject({ agentId: 'codex', install: 'not_installed', version: null, auth: 'needs_sign_in', apiKeyOnly: true, subscription: 'signed_out', notices: [CODEX_NO_SIGN_IN_NOTICE] });
    const steps: string[] = [];
    expect(await setup.install((progress) => steps.push(progress.step))).toEqual({ version: '2.1.1' });
    expect(steps.some((step) => step.startsWith('Downloading Codex'))).toBe(true);
    expect(await setup.status()).toMatchObject({ install: 'installed', version: '2.1.1', apiKeyOnly: true });
    expect(setup.apiKeyOnly).toBe(true);
  });

  it('states the no sign-in reason without long dashes and without overclaiming', () => {
    expect(CODEX_NO_SIGN_IN_NOTICE).toBe("Codex uses your own OpenAI API key. Signing in with a ChatGPT account isn't supported here, because OpenAI's terms don't allow other apps to use subscription sign-in.");
    expect(CODEX_NO_SIGN_IN_NOTICE).not.toMatch(/[–—]/);
  });

  it('offers no sign-in or sign-out', async () => {
    const setup = setupOf(tempDir());
    await expect(setup.signIn()).rejects.toThrow(/can't be signed in with an account/);
    expect(setup.signOut).toBeUndefined();
  });

  it('checks the key shape, and asks OpenAI with a free call (a fake fetch): ok, refused, or not checked', async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const answer = (status: number) =>
      (async (url: string, init: RequestInit) => {
        calls.push({ url, auth: (init.headers as Record<string, string>).authorization });
        return new Response('secret body', { status });
      }) as unknown as typeof fetch;
    const verify = (status: number) => setupOf(tempDir(), { fetch: answer(status) }).apiKey!.verify(KEY, new AbortController().signal);
    expect(setupOf(tempDir()).apiKey?.envName).toBe('CODEX_API_KEY');
    expect(setupOf(tempDir()).apiKey?.check(KEY)).toBeUndefined();
    expect(setupOf(tempDir()).apiKey?.check('sk-ant-nope')).toBe(BAD_OPENAI_API_KEY);
    expect(await verify(200)).toBe('ok');
    expect(await verify(401)).toBe('refused');
    expect(await verify(500)).toBe('unchecked');
    expect(calls[0]).toEqual({ url: OPENAI_VERIFY_URL, auth: `Bearer ${KEY}` });
    const failing = setupOf(tempDir(), {
      fetch: (async () => {
        throw Object.assign(new Error('boom'), { cause: { code: 'ECONNRESET' } });
      }) as unknown as typeof fetch,
    });
    expect(await failing.apiKey!.verify(KEY, new AbortController().signal)).toBe('unchecked');
  });
});
