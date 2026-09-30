import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/database.js';
import { tempDir } from './helpers.js';

const opened: Database[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('database', () => {
  it('opens in WAL mode with foreign keys on, migrated, and readable only by the user', () => {
    const db = openDatabase(tempDir());
    opened.push(db);
    const { sqlite, file } = db;
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    const tables = sqlite
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['events', 'runs', 'sessions', 'workspaces']));
    const indexes = sqlite
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'")
      .all()
      .map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(['events_workspace_seq_idx', 'events_stream_idx']));
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('migration 0001 backfills real_path from the canonical path for workspaces created before it', () => {
    const drizzle = join(import.meta.dirname, '..', 'drizzle');
    const old = join(tempDir(), 'drizzle');
    mkdirSync(join(old, 'meta'), { recursive: true });
    cpSync(join(drizzle, '0000_init.sql'), join(old, '0000_init.sql'));
    const journal = JSON.parse(JSON.stringify(readJournal(drizzle)));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx === 0);
    writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify(journal));

    const dataDir = tempDir();
    const before = openDatabase(dataDir, { migrationsFolder: old });
    before.sqlite.prepare("INSERT INTO workspaces (id, path, created_at) VALUES ('ws_1', '/users/a/repo', '2026-09-29T00:00:00.000Z')").run();
    before.close();

    const after = openDatabase(dataDir, { migrationsFolder: drizzle });
    opened.push(after);
    expect(after.sqlite.prepare('SELECT path, real_path FROM workspaces').all()).toEqual([{ path: '/users/a/repo', real_path: '/users/a/repo' }]);
  });
});

function readJournal(dir: string): { entries: Array<{ idx: number }> } {
  return JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number }> };
}
