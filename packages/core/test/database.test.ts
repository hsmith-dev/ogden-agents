import { statSync } from 'node:fs';
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
});
