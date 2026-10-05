/**
 * The database around a version change (story 13.6, E13-R5; AD-5): an upgrade is backed up first
 * (the last three kept), a database a newer version migrated is refused and left alone, and the
 * last version that opened the folder is recorded only after the migrations succeeded. Real
 * drizzle migrations on temp folders; a "newer" or "older" build is the same migrations with the
 * last one left out.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_NEWER_MESSAGE } from '../src/data-dir.js';
import { DATABASE_FILE, defaultMigrationsFolder, openDatabase } from '../src/db/database.js';
import { BACKUP_DIR, backUp, DatabaseNewerError, KEEP_BACKUPS, LAST_VERSION_FILE, readLastVersion } from '../src/db/upgrade-guard.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-upgrade-guard-'));
  dirs.push(dir);
  return dir;
};

/** The real migrations without the last `drop` of them: an older build. */
function olderMigrations(drop = 1): string {
  const dir = temp();
  cpSync(defaultMigrationsFolder(), dir, { recursive: true });
  const journalFile = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, -drop);
  writeFileSync(journalFile, JSON.stringify(journal));
  return dir;
}
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const workspaceCount = (file: string): number => {
  const db = new Sqlite(file, { readonly: true });
  try {
    return (db.prepare('SELECT count(*) AS n FROM workspaces').get() as { n: number }).n;
  } finally {
    db.close();
  }
};
const addWorkspace = (file: string): void => {
  const db = new Sqlite(file);
  try {
    db.prepare("INSERT INTO workspaces (id, path, real_path, created_at) VALUES ('ws_1', '/p', '/p', '2026-01-01T00:00:00.000Z')").run();
  } finally {
    db.close();
  }
};

describe('a version change', () => {
  it('records the version and makes no backup for a new folder', () => {
    const dir = temp();
    openDatabase(dir, { appVersion: '0.5.0' }).close();
    expect(readLastVersion(dir)).toBe('0.5.0');
    expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
  });

  it('backs up the database before a pending migration runs on an upgrade, and then only once', () => {
    const dir = temp();
    openDatabase(dir, { migrationsFolder: olderMigrations(), appVersion: '0.4.0' }).close();
    addWorkspace(join(dir, DATABASE_FILE));
    expect(readLastVersion(dir)).toBe('0.4.0');

    openDatabase(dir, { appVersion: '0.5.0' }).close();
    const backup = join(dir, BACKUP_DIR, 'ogden-agents-0.4.0.db');
    expect(existsSync(backup)).toBe(true);
    // The copy is the database as it was before the migration: it has the data, not the new migration.
    expect(workspaceCount(backup)).toBe(1);
    const old = new Sqlite(backup, { readonly: true });
    expect((old.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n).toBe(readdirSync(olderMigrations(0)).filter((n) => n.endsWith('.sql')).length - 1);
    old.close();
    expect(readLastVersion(dir)).toBe('0.5.0');

    // Nothing pending and the same version: no second backup.
    rmSync(backup);
    openDatabase(dir, { appVersion: '0.5.0' }).close();
    expect(existsSync(backup)).toBe(false);
  });

  it('names a backup "unknown" for a folder from before the version record', () => {
    const dir = temp();
    openDatabase(dir, { migrationsFolder: olderMigrations() }).close();
    expect(existsSync(join(dir, LAST_VERSION_FILE))).toBe(false);
    openDatabase(dir, { appVersion: '0.5.0' }).close();
    expect(existsSync(join(dir, BACKUP_DIR, 'ogden-agents-unknown.db'))).toBe(true);
  });

  it('makes no backup when no version is given (tests) and keeps only the newest three', () => {
    const dir = temp();
    openDatabase(dir, { migrationsFolder: olderMigrations() }).close();
    openDatabase(dir).close();
    expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);

    const file = join(dir, DATABASE_FILE);
    for (const [index, version] of ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0'].entries()) {
      backUp(dir, file, version);
      const at = new Date(Date.UTC(2026, 0, 1 + index));
      utimesSync(join(dir, BACKUP_DIR, `ogden-agents-${version}.db`), at, at);
    }
    backUp(dir, file, '0.6.0');
    expect(readdirSync(join(dir, BACKUP_DIR)).sort()).toHaveLength(KEEP_BACKUPS);
    expect(readdirSync(join(dir, BACKUP_DIR)).sort()).toEqual(['ogden-agents-0.4.0.db', 'ogden-agents-0.5.0.db', 'ogden-agents-0.6.0.db']);
  });
});

describe('a database a newer version migrated', () => {
  it('is refused with the plain message and left exactly as it was', () => {
    const dir = temp();
    openDatabase(dir, { appVersion: '0.6.0' }).close();
    addWorkspace(join(dir, DATABASE_FILE));
    const before = sha(join(dir, DATABASE_FILE));
    const lastVersion = readFileSync(join(dir, LAST_VERSION_FILE), 'utf8');

    let error: unknown;
    try {
      openDatabase(dir, { migrationsFolder: olderMigrations(), appVersion: '0.5.0' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DatabaseNewerError);
    expect((error as Error).message).toBe(DATABASE_NEWER_MESSAGE);
    expect((error as Error).message).not.toMatch(/[–—]|\s-\s/);
    expect(sha(join(dir, DATABASE_FILE))).toBe(before);
    expect(workspaceCount(join(dir, DATABASE_FILE))).toBe(1);
    expect(readFileSync(join(dir, LAST_VERSION_FILE), 'utf8')).toBe(lastVersion);
    expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
  });

  it('is refused even when no version is given', () => {
    const dir = temp();
    openDatabase(dir).close();
    expect(() => openDatabase(dir, { migrationsFolder: olderMigrations() })).toThrow(DatabaseNewerError);
  });

  it('never refuses the same build, an older database, or an empty file', () => {
    const dir = temp();
    openDatabase(dir, { appVersion: '0.5.0' }).close();
    expect(() => openDatabase(dir, { appVersion: '0.5.0' }).close()).not.toThrow();
    const empty = temp();
    mkdirSync(empty, { recursive: true });
    writeFileSync(join(empty, DATABASE_FILE), '');
    expect(() => openDatabase(empty, { appVersion: '0.5.0' }).close()).not.toThrow();
  });
});
