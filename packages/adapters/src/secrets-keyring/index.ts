/**
 * `secrets-keyring` (story 9.2, AD-16): core's `SecretStorePort` over the OS
 * keychain through `@napi-rs/keyring` (macOS Keychain, Windows Credential
 * Manager, Linux Secret Service). Each secret is one entry, service
 * `ogden-agents`, account the secret's name.
 *
 * - The module is imported lazily, once, on first use: a computer where it
 *   doesn't load (no prebuilt binary, say) runs the rest of Ogden Agents as
 *   usual, and only saving an API key is refused.
 * - On Linux the entry is pinned to Secret Service: the library's default
 *   falls back to the kernel keyring silently, which forgets everything at
 *   reboot.
 * - Every failure is `SecretsUnavailableError` with plain words, whose cause
 *   is a code only: "no keychain" for a missing one or a load failure, "didn't
 *   answer" for a timeout, a locked keychain or a dismissed prompt. Reads time
 *   out sooner (5 s, at start) than writes (60 s: the user may be answering a
 *   prompt). There is no on-disk fallback of any kind.
 * - Nothing here logs; a value never leaves the returned promise.
 */
import { KEYCHAIN_NO_ANSWER_MESSAGE, SecretsUnavailableError, type SecretStorePort } from '@ogden-agents/core';

/** The module's package name. Kept in a variable so the bundler leaves the import alone until it runs. */
const KEYRING_MODULE = '@napi-rs/keyring';

/** The service every Ogden Agents secret is stored under (what Keychain Access and Credential Manager show). */
export const KEYRING_SERVICE = 'ogden-agents';

/** How long a read may take (at start, before serving). */
export const KEYRING_READ_TIMEOUT_MS = 5_000;
/** How long a save or a removal may take: long enough for the user to answer a keychain prompt. */
export const KEYRING_WRITE_TIMEOUT_MS = 60_000;

/** The entry options every entry gets: Linux pinned to Secret Service (ignored on other platforms). */
export const KEYRING_ENTRY_OPTIONS = { linux: { store: 'secret-service' } } as const;

/** What this adapter needs of `@napi-rs/keyring`'s `AsyncEntry`. */
export interface KeyringEntry {
  getPassword(signal?: AbortSignal | null): Promise<string | undefined | null>;
  setPassword(password: string, signal?: AbortSignal | null): Promise<void>;
  deleteCredential(signal?: AbortSignal | null): Promise<boolean>;
}

/** What this adapter needs of the `@napi-rs/keyring` module. */
export interface KeyringModule {
  AsyncEntry: new (service: string, account: string, options?: typeof KEYRING_ENTRY_OPTIONS) => KeyringEntry;
}

export interface KeyringSecretStoreOptions {
  /** Default {@link KEYRING_SERVICE}. */
  service?: string;
  /** Loads the module. Default: a dynamic import of `@napi-rs/keyring`. Tests pass a fake: they never touch the real keychain. */
  load?: () => Promise<KeyringModule>;
  /** Default {@link KEYRING_READ_TIMEOUT_MS}. */
  readTimeoutMs?: number;
  /** Default {@link KEYRING_WRITE_TIMEOUT_MS}. */
  writeTimeoutMs?: number;
}

/** A failure's code for the log: a short identifier, never a message (which could say anything). */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'keychain_error';
}

/**
 * Whether the keychain is there but refused access: locked, or a prompt the
 * user dismissed. The `keyring` crate says "Couldn't access platform secure
 * storage" (`NoStorageAccess`) for those; the message is only matched, never kept.
 */
function isNoAccess(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /couldn'?t access platform secure storage|user (canceled|cancelled)|interaction (is )?not allowed|locked/i.test(message);
}

export function createKeyringSecretStore(options: KeyringSecretStoreOptions = {}): SecretStorePort {
  const service = options.service ?? KEYRING_SERVICE;
  const readTimeoutMs = options.readTimeoutMs ?? KEYRING_READ_TIMEOUT_MS;
  const writeTimeoutMs = options.writeTimeoutMs ?? KEYRING_WRITE_TIMEOUT_MS;
  const load = options.load ?? (async () => (await import(KEYRING_MODULE)) as KeyringModule);
  let loaded: Promise<KeyringModule> | undefined;

  const module = (): Promise<KeyringModule> => {
    loaded ??= load().then(
      (value) => {
        if (typeof value?.AsyncEntry !== 'function') throw new SecretsUnavailableError(undefined, { cause: 'load_failed' });
        return value;
      },
      () => {
        throw new SecretsUnavailableError(undefined, { cause: 'load_failed' });
      },
    );
    return loaded;
  };

  /** Runs one keychain call on the entry for `name`, stopped after `timeoutMs`. */
  const withEntry = async <T>(name: string, timeoutMs: number, call: (entry: KeyringEntry, signal: AbortSignal) => Promise<T>): Promise<T> => {
    const { AsyncEntry } = await module();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new SecretsUnavailableError(KEYCHAIN_NO_ANSWER_MESSAGE, { cause: 'timeout' }));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      const entry = new AsyncEntry(service, name, KEYRING_ENTRY_OPTIONS);
      return await Promise.race([call(entry, controller.signal), timedOut]);
    } catch (error) {
      if (error instanceof SecretsUnavailableError) throw error;
      if (isNoAccess(error)) throw new SecretsUnavailableError(KEYCHAIN_NO_ANSWER_MESSAGE, { cause: 'no_access' });
      throw new SecretsUnavailableError(undefined, { cause: codeOf(error) });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    backend: 'keychain',
    get: (name) => withEntry(name, readTimeoutMs, async (entry, signal) => (await entry.getPassword(signal)) ?? undefined),
    set: (name, value) => withEntry(name, writeTimeoutMs, (entry, signal) => entry.setPassword(value, signal)),
    delete: (name) =>
      withEntry(name, writeTimeoutMs, async (entry, signal) => {
        // `false` means there was nothing to delete: not an error.
        await entry.deleteCredential(signal);
      }),
  };
}
