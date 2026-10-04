/**
 * `secrets-keyring` (story 9.2) through a fake `@napi-rs/keyring` module: no
 * test here, or anywhere, touches the real OS keychain. The entry is pinned
 * to Secret Service on Linux, every call is stopped after the timeout, a
 * load failure is a plain reason, and a missing item is `undefined`.
 */
import { KEYCHAIN_NO_ANSWER_MESSAGE, SECRETS_UNAVAILABLE_MESSAGE, SecretsUnavailableError } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import {
  createKeyringSecretStore,
  KEYRING_ENTRY_OPTIONS,
  KEYRING_READ_TIMEOUT_MS,
  KEYRING_SERVICE,
  KEYRING_WRITE_TIMEOUT_MS,
  type KeyringEntry,
  type KeyringModule,
} from '../src/index.js';

/** An in-memory stand-in for the keychain, recording every entry made and the signal each call got. */
function fakeKeyring(overrides: Partial<KeyringEntry> = {}) {
  const items = new Map<string, string>();
  const entries: Array<{ service: string; account: string; options: unknown }> = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  let loads = 0;
  const module: KeyringModule = {
    AsyncEntry: class implements KeyringEntry {
      constructor(
        private readonly service: string,
        private readonly account: string,
        options?: unknown,
      ) {
        entries.push({ service, account, options });
      }
      private get key() {
        return `${this.service}/${this.account}`;
      }
      getPassword = overrides.getPassword ?? (async (signal?: AbortSignal | null) => {
        signals.push(signal);
        return items.get(this.key);
      });
      setPassword = overrides.setPassword ?? (async (password: string, signal?: AbortSignal | null) => {
        signals.push(signal);
        items.set(this.key, password);
      });
      deleteCredential = overrides.deleteCredential ?? (async (signal?: AbortSignal | null) => {
        signals.push(signal);
        return items.delete(this.key);
      });
    },
  };
  const load = async () => {
    loads++;
    return module;
  };
  return { load, items, entries, signals, loads: () => loads };
}

describe('the keychain secret store', () => {
  it('keeps each secret as one entry under ogden-agents, pinned to Secret Service on Linux; a missing item is undefined', async () => {
    const keyring = fakeKeyring();
    const store = createKeyringSecretStore({ load: keyring.load });
    expect(store.backend).toBe('keychain');
    expect(keyring.loads()).toBe(0);

    expect(await store.get('agent-api-key/claude-code')).toBeUndefined();
    await store.set('agent-api-key/claude-code', 'sk-ant-api03-value');
    expect(await store.get('agent-api-key/claude-code')).toBe('sk-ant-api03-value');
    expect(keyring.items.get(`${KEYRING_SERVICE}/agent-api-key/claude-code`)).toBe('sk-ant-api03-value');
    await store.delete('agent-api-key/claude-code');
    // Deleting a missing one is not an error.
    await store.delete('agent-api-key/claude-code');
    expect(await store.get('agent-api-key/claude-code')).toBeUndefined();

    expect(KEYRING_SERVICE).toBe('ogden-agents');
    expect(KEYRING_ENTRY_OPTIONS).toEqual({ linux: { store: 'secret-service' } });
    for (const entry of keyring.entries) expect(entry).toEqual({ service: 'ogden-agents', account: 'agent-api-key/claude-code', options: { linux: { store: 'secret-service' } } });
    // Loaded lazily, once; every call can be aborted.
    expect(keyring.loads()).toBe(1);
    for (const signal of keyring.signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('a null password (the native "none") reads as undefined', async () => {
    const keyring = fakeKeyring({ getPassword: async () => null });
    expect(await createKeyringSecretStore({ load: keyring.load }).get('x')).toBeUndefined();
  });

  it('a module that fails to load is a plain reason, every time, and is not retried', async () => {
    let loads = 0;
    const store = createKeyringSecretStore({
      load: async () => {
        loads++;
        throw new Error('Cannot find module @napi-rs/keyring-linux-x64-gnu at /secret/path');
      },
    });
    for (const call of [() => store.get('a'), () => store.set('a', 'sk-ant-api03-never-shown'), () => store.delete('a')]) {
      const error = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SecretsUnavailableError);
      expect((error as SecretsUnavailableError).message).toBe(SECRETS_UNAVAILABLE_MESSAGE);
      expect((error as SecretsUnavailableError).code).toBe('secrets_unavailable');
      expect((error as Error).cause).toBe('load_failed');
    }
    expect(loads).toBe(1);
  });

  it('a module without AsyncEntry is a load failure', async () => {
    const store = createKeyringSecretStore({ load: async () => ({}) as KeyringModule });
    await expect(store.get('a')).rejects.toMatchObject({ code: 'secrets_unavailable', cause: 'load_failed' });
  });

  it('no keychain (Linux without Secret Service) is "no keychain"; a locked one or a dismissed prompt is "didn\'t answer"; codes only', async () => {
    const failure = Object.assign(new Error('Platform secure storage failure: org.freedesktop.DBus.Error.ServiceUnknown with sk-ant-api03-in-a-message'), {
      code: 'GenericFailure',
    });
    const keyring = fakeKeyring({
      setPassword: async () => {
        throw failure;
      },
      getPassword: async () => {
        throw new Error('locked');
      },
    });
    const store = createKeyringSecretStore({ load: keyring.load });
    const saved = await store.set('a', 'sk-ant-api03-never-shown').catch((caught: unknown) => caught);
    expect(saved).toBeInstanceOf(SecretsUnavailableError);
    expect((saved as Error).cause).toBe('GenericFailure');
    expect(JSON.stringify({ message: (saved as Error).message, cause: (saved as Error).cause })).not.toContain('sk-ant');
    expect((saved as Error).message).toBe(SECRETS_UNAVAILABLE_MESSAGE);
    await expect(store.get('a')).rejects.toMatchObject({ code: 'secrets_unavailable', cause: 'no_access', message: KEYCHAIN_NO_ANSWER_MESSAGE });

    const denied = fakeKeyring({
      deleteCredential: async () => {
        throw new Error("Couldn't access platform secure storage: The user name or passphrase you entered is not correct.");
      },
      setPassword: async () => {
        throw new Error('Platform secure storage failure: User canceled the operation.');
      },
    });
    const prompted = createKeyringSecretStore({ load: denied.load });
    await expect(prompted.delete('a')).rejects.toMatchObject({ cause: 'no_access', message: KEYCHAIN_NO_ANSWER_MESSAGE });
    await expect(prompted.set('a', 'v')).rejects.toMatchObject({ cause: 'no_access', message: KEYCHAIN_NO_ANSWER_MESSAGE });
    expect(KEYCHAIN_NO_ANSWER_MESSAGE).toBe("The keychain didn't answer. Check for a prompt from your computer and try again.");
  });

  it('a call that hangs (a prompt nobody answers) is stopped after the timeout and aborted', async () => {
    let aborted = false;
    const keyring = fakeKeyring({
      getPassword: (signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    const store = createKeyringSecretStore({ load: keyring.load, readTimeoutMs: 10 });
    await expect(store.get('a')).rejects.toMatchObject({ code: 'secrets_unavailable', cause: 'timeout', message: KEYCHAIN_NO_ANSWER_MESSAGE });
    expect(aborted).toBe(true);
  });

  it('even a call that ignores its signal is stopped after the timeout', async () => {
    const keyring = fakeKeyring({ setPassword: () => new Promise(() => {}) });
    const store = createKeyringSecretStore({ load: keyring.load, writeTimeoutMs: 10 });
    await expect(store.set('a', 'v')).rejects.toMatchObject({ code: 'secrets_unavailable', cause: 'timeout', message: KEYCHAIN_NO_ANSWER_MESSAGE });
  });

  it('reads time out at 5 s by default and writes at 60 s: a write slower than a read timeout still lands', async () => {
    expect(KEYRING_READ_TIMEOUT_MS).toBe(5_000);
    expect(KEYRING_WRITE_TIMEOUT_MS).toBe(60_000);
    // A prompt answered after the read timeout but within the write one.
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const keyring = fakeKeyring();
    const slow = fakeKeyring({
      setPassword: async (password) => {
        await answered;
        keyring.items.set('slow', password);
      },
    });
    const store = createKeyringSecretStore({ load: slow.load, readTimeoutMs: 10, writeTimeoutMs: 10_000 });
    const saving = store.set('a', 'v');
    // Past the read timeout: the write is still waiting on the prompt.
    await new Promise((resolve) => setTimeout(resolve, 30));
    answer();
    await expect(saving).resolves.toBeUndefined();
    expect(keyring.items.get('slow')).toBe('v');
  });
});
