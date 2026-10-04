/**
 * The port for secrets (AD-16; story 2.3 contract, filled by onboarding 9.2):
 * API keys live in the OS keychain. Where there is none, the adapter throws
 * `SecretsUnavailableError` and nothing is stored: there is no on-disk
 * fallback. Core names no keychain: the adapter does. A value never reaches
 * the database, an event or a log line.
 */
export interface SecretStorePort {
  /** Where the secrets are kept, for the UI and the log (never the values): `keychain`, `memory`. */
  readonly backend: string;
  /** The secret stored under `name`, or `undefined`. Each method rejects with `SecretsUnavailableError` when the store can't be used. */
  get(name: string): Promise<string | undefined>;
  /** Stores `value` under `name`, replacing any earlier one. */
  set(name: string, value: string): Promise<void>;
  /** Removes the secret under `name`; removing a missing one is not an error. */
  delete(name: string): Promise<void>;
}
