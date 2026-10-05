import { chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { guardBeforeMigrating, writeLastVersion } from './upgrade-guard.js';

/** The database file's name inside the data folder. */
export const DATABASE_FILE = 'ogden-agents.db';

export type Orm = BetterSQLite3Database<typeof schema>;

/**
 * An open Ogden Agents database. Only core holds one (AD-11): adapters never see
 * it, and server routes call core operations instead of writing rows.
 */
export interface Database {
  /** The raw `better-sqlite3` handle (transactions, pragmas). */
  readonly sqlite: Sqlite.Database;
  /** Drizzle over the same handle. */
  readonly orm: Orm;
  /** Absolute path of the database file. */
  readonly file: string;
  close(): void;
}

export interface OpenDatabaseOptions {
  /** Override where the SQL migrations are read from (tests). */
  migrationsFolder?: string;
  /**
   * The running version (story 13.6). With it, a database a newer version
   * migrated is refused and an upgrade is backed up first; without it
   * (tests) a newer database is still refused, and nothing is backed up.
   */
  appVersion?: string;
}

/**
 * Where the committed SQL migrations are, in order:
 * - `./drizzle` beside the server bundle (`dist/server.js`, as built and packed);
 * - `packages/core/drizzle`, resolved from `src/db/database.ts` (workspace, tests).
 */
const MIGRATION_CANDIDATES = [
  fileURLToPath(new URL('./drizzle', import.meta.url)),
  fileURLToPath(new URL('../../drizzle', import.meta.url)),
] as const;

export function defaultMigrationsFolder(): string {
  const found = MIGRATION_CANDIDATES.find((dir) => existsSync(join(dir, 'meta', '_journal.json')));
  if (found === undefined) {
    throw new Error(`Ogden Agents database migrations not found; looked in ${MIGRATION_CANDIDATES.join(', ')}`);
  }
  return found;
}

/**
 * Opens (creating if needed) the database in `dataDir`, in WAL mode with
 * foreign keys on, and applies any pending migrations.
 */
export function openDatabase(dataDir: string, options: OpenDatabaseOptions = {}): Database {
  const file = join(dataDir, DATABASE_FILE);
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  // Before anything writes: refuse a newer database, back up before an upgrade (story 13.6).
  guardBeforeMigrating({ dataDir, file, migrationsFolder, version: options.appVersion });
  const sqlite = new Sqlite(file);
  try {
    if (process.platform !== 'win32') chmodSync(file, 0o600);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    const orm = drizzle({ client: sqlite, schema });
    migrate(orm, { migrationsFolder });
    if (options.appVersion !== undefined) writeLastVersion(dataDir, options.appVersion);
    return {
      sqlite,
      orm,
      file,
      close: () => {
        if (sqlite.open) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
