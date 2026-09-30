import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import envPaths from 'env-paths';

/** Environment variable that overrides the data folder (tests, portable installs). */
export const DATA_DIR_ENV = 'OGDEN_AGENTS_DATA_DIR';

/**
 * The retired session-cookie signing key (story 1.4). Since story 2.1 a tab
 * signs in with a per-tab token held only in the server's memory (AD-15 as
 * amended); the server deletes a leftover file of this name when it starts.
 */
export const LEGACY_AUTH_KEY_FILE = 'auth.key';

/**
 * The port file in the data folder (AD-15): `{ port, pid, version, startedAt }`
 * of the running server, readable only by the user, so a launcher can find it.
 */
export const PORT_FILE = 'server.json';

/**
 * The per-user data folder (Conventions): the OS data directory's `ogden-agents/`,
 * or `$OGDEN_AGENTS_DATA_DIR` when set. It holds the database, logs, the port file
 * and the launcher token; nothing is ever written into user repos.
 */
export function dataDirPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DATA_DIR_ENV];
  if (override !== undefined && override.trim() !== '') return resolve(override);
  return envPaths('ogden-agents', { suffix: '' }).data;
}

/** Creates `dir` (and missing parents), readable only by the user, if missing. Returns its absolute path. */
export function createDataDir(dir: string): string {
  const absolute = resolve(dir);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  return absolute;
}

/** Resolves the data folder and creates it, readable only by the user, if missing. */
export function ensureDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return createDataDir(dataDirPath(env));
}
