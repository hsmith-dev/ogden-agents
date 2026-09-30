/**
 * The port for secrets (AD-16; story 2.3 contract, filled by onboarding 9.4):
 * API keys live in the OS keychain, or an encrypted file readable only by
 * the user where there is no keychain. Core names neither: the adapter does.
 * A value never reaches the database, an event or a log line.
 */
export interface SecretStorePort {
  /** Where the secrets are kept, for the UI and the log (never the values): `keychain`, `encrypted-file`, `memory`. */
  readonly backend: string;
  /** The secret stored under `name`, or `undefined`. */
  get(name: string): Promise<string | undefined>;
  /** Stores `value` under `name`, replacing any earlier one. */
  set(name: string, value: string): Promise<void>;
  /** Removes the secret under `name`; removing a missing one is not an error. */
  delete(name: string): Promise<void>;
}
