/**
 * What happens to the database file around a version change (story 13.6, E13-R5; AD-5), before
 * drizzle's migrations run:
 *
 * - A database a newer version already migrated (it records migrations this build does not have)
 *   is refused with a plain message and changed in no way. Drizzle alone would carry on and then
 *   fail on tables it has never heard of.
 * - When the version changed and migrations are pending, the database is copied first to
 *   `<dataDir>/backups/ogden-agents-<old version>.db` (the last three are kept), so an upgrade the
 *   user regrets can be undone by hand.
 *
 * The last version that opened the folder is `<dataDir>/last-version.json`, written only after
 * the migrations succeeded. The app and the npm route share the folder, so both write it.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { DATABASE_NEWER_MESSAGE } from '../data-dir.js';

export const LAST_VERSION_FILE = 'last-version.json';
export const BACKUP_DIR = 'backups';
/** How many backups are kept (the newest). */
export const KEEP_BACKUPS = 3;

/** A database a newer version migrated: refused, untouched. */
export class DatabaseNewerError extends Error {
  override readonly name = 'DatabaseNewerError';
  readonly code = 'database_newer';
  constructor() {
    super(DATABASE_NEWER_MESSAGE);
  }
}

export interface MigrationState {
  /** The database records a migration this build does not have. */
  newer: boolean;
  /** This build has migrations the database has not applied. */
  pending: number;
}

/** Reads (never writes) which migrations the database file has applied, against this build's. */
export function migrationState(file: string, migrationsFolder: string): MigrationState {
  const known = new Set(readMigrationFiles({ migrationsFolder }).map((m) => m.hash));
  const db = new Sqlite(file, { readonly: true, fileMustExist: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
    if (table === undefined) return { newer: false, pending: known.size };
    const applied = new Set((db.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{ hash: string }>).map((row) => row.hash));
    return { newer: [...applied].some((hash) => !known.has(hash)), pending: [...known].filter((hash) => !applied.has(hash)).length };
  } finally {
    db.close();
  }
}

/** The version that last opened this folder, or `undefined` (a folder from before this record). */
export function readLastVersion(dataDir: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, LAST_VERSION_FILE), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function writeLastVersion(dataDir: string, version: string): void {
  const file = join(dataDir, LAST_VERSION_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ version })}\n`, { mode: 0o600 });
    renameSync(temp, file);
  } catch {
    // A folder that cannot take this file still works; the next upgrade just has no old version to name.
    rmSync(temp, { force: true });
  }
}

/** A version as a file name part: letters, digits, dots and dashes only. */
const safe = (version: string): string => version.replace(/[^A-Za-z0-9.+-]/g, '_');

/** Copies the database to `backups/ogden-agents-<version>.db` and keeps the newest {@link KEEP_BACKUPS}. Returns the backup's path. */
export function backUp(dataDir: string, file: string, oldVersion: string | undefined): string {
  const dir = join(dataDir, BACKUP_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `ogden-agents-${oldVersion === undefined ? 'unknown' : safe(oldVersion)}.db`);
  rmSync(target, { force: true });
  const db = new Sqlite(file, { readonly: true, fileMustExist: true });
  try {
    // A consistent copy, including what is still in the write-ahead log.
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  if (process.platform !== 'win32') chmodSync(target, 0o600);
  const backups = readdirSync(dir)
    .filter((name) => /^ogden-agents-.+\.db$/.test(name))
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of backups.slice(KEEP_BACKUPS)) rmSync(join(dir, old.name), { force: true });
  return target;
}

export interface GuardResult {
  /** The backup made, if any. */
  backup?: string;
}

/**
 * The guard to run before the migrations: refuses a newer database, and backs up before an upgrade.
 * Does nothing for a database that does not exist yet. Throws {@link DatabaseNewerError}.
 */
export function guardBeforeMigrating({ dataDir, file, migrationsFolder, version }: { dataDir: string; file: string; migrationsFolder: string; version: string | undefined }): GuardResult {
  if (!existsSync(file) || statSync(file).size === 0) return {};
  const state = migrationState(file, migrationsFolder);
  if (state.newer) throw new DatabaseNewerError();
  if (version === undefined || state.pending === 0) return {};
  const last = readLastVersion(dataDir);
  if (last === version) return {};
  return { backup: backUp(dataDir, file, last) };
}
