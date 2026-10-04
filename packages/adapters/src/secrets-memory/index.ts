/**
 * `secrets-memory` (story 2.3): an in-memory `SecretStorePort` for tests (the
 * server's default is the keychain, `secrets-keyring`, since onboarding 9.2).
 * Deterministic; nothing is written anywhere and nothing survives a restart.
 */
import type { SecretStorePort } from '@ogden-agents/core';

export function createMemorySecretStore(initial: Readonly<Record<string, string>> = {}): SecretStorePort {
  const values = new Map(Object.entries(initial));
  return {
    backend: 'memory',
    get: async (name) => values.get(name),
    set: async (name, value) => {
      values.set(name, value);
    },
    delete: async (name) => {
      values.delete(name);
    },
  };
}
