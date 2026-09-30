/**
 * `secrets-memory` (story 2.3): an in-memory `SecretStorePort`, the default
 * until the keychain adapter ships (onboarding 9.4), and for tests.
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
