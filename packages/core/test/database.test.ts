import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceId } from '@ogden-agents/shared';
import { openCore } from '../src/core.js';
import { openDatabase, type Database } from '../src/db/database.js';
import { tempDir } from './helpers.js';

const opened: Database[] = [];
const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
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

  it('migration 0004 gives every workspace from 0.2.0 (migrations 0000 to 0003) its BMad pieces, all off (story 10.1)', () => {
    const drizzle = join(import.meta.dirname, '..', 'drizzle');
    const old = join(tempDir(), 'drizzle');
    mkdirSync(join(old, 'meta'), { recursive: true });
    const journal = JSON.parse(JSON.stringify(readJournal(drizzle))) as { entries: Array<{ idx: number; tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 3);
    for (const entry of journal.entries) cpSync(join(drizzle, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`));
    writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify(journal));

    const dataDir = tempDir();
    const before = openDatabase(dataDir, { migrationsFolder: old });
    before.sqlite
      .prepare(`INSERT INTO workspaces (id, path, real_path, caution_level, created_at) VALUES ('${WS}', '/users/a/repo', '/Users/a/repo', 'ask_for_commands', '2026-09-30T00:00:00.000Z')`)
      .run();
    // A caution-level change as 0.2.0 stored it: no pieces in the payload.
    before.sqlite
      .prepare(
        `INSERT INTO events (id, workspace_id, stream_id, type, at, payload) VALUES ('evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', '${WS}', '${WS}', 'workspace.settings_changed', '2026-09-30T00:00:01.000Z', '{"cautionLevel":"ask_for_commands","previous":"ask_every_time"}')`,
      )
      .run();
    before.close();

    const after = openDatabase(dataDir, { migrationsFolder: drizzle });
    expect(after.sqlite.prepare('SELECT caution_level, bmad_pieces FROM workspaces').all()).toEqual([{ caution_level: 'ask_for_commands', bmad_pieces: '[]' }]);
    after.close();

    // Core on the upgraded folder: the project is Simple, keeps its level, and the old event reads back.
    const core = openCore(dataDir);
    try {
      expect(core.permissions.getSettings(WS)).toEqual({ cautionLevel: 'ask_for_commands', bmadPieces: [], bmadScriptsTrusted: false });
      expect(core.events.readAfter(0).filter((event) => event.type === 'workspace.settings_changed').map((event) => event.payload)).toEqual([
        { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' },
      ]);
    } finally {
      core.close();
    }
  });

  it('migration 0005 gives every workspace from before story 10.3 an offer not yet dismissed', async () => {
    const drizzle = join(import.meta.dirname, '..', 'drizzle');
    const old = join(tempDir(), 'drizzle');
    mkdirSync(join(old, 'meta'), { recursive: true });
    const journal = JSON.parse(JSON.stringify(readJournal(drizzle))) as { entries: Array<{ idx: number; tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 4);
    for (const entry of journal.entries) cpSync(join(drizzle, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`));
    writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify(journal));

    const dataDir = tempDir();
    const before = openDatabase(dataDir, { migrationsFolder: old });
    before.sqlite
      .prepare(`INSERT INTO workspaces (id, path, real_path, created_at) VALUES ('${WS}', '/users/a/repo', '/Users/a/repo', '2026-09-30T00:00:00.000Z')`)
      .run();
    before.close();

    const after = openDatabase(dataDir, { migrationsFolder: drizzle });
    expect(after.sqlite.prepare('SELECT bmad_offer_dismissed FROM workspaces').all()).toEqual([{ bmad_offer_dismissed: 0 }]);
    after.close();

    const core = openCore(dataDir);
    try {
      expect(await core.bmadDetection.detect(WS)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });
    } finally {
      core.close();
    }
  });

  it('migration 0006 gives every workspace from before story 4.2 scripts not yet trusted', () => {
    const drizzle = join(import.meta.dirname, '..', 'drizzle');
    const old = join(tempDir(), 'drizzle');
    mkdirSync(join(old, 'meta'), { recursive: true });
    const journal = JSON.parse(JSON.stringify(readJournal(drizzle))) as { entries: Array<{ idx: number; tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 5);
    for (const entry of journal.entries) cpSync(join(drizzle, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`));
    writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify(journal));

    const dataDir = tempDir();
    const before = openDatabase(dataDir, { migrationsFolder: old });
    before.sqlite
      .prepare(`INSERT INTO workspaces (id, path, real_path, created_at) VALUES ('${WS}', '/users/a/repo', '/Users/a/repo', '2026-09-30T00:00:00.000Z')`)
      .run();
    before.close();

    const after = openDatabase(dataDir, { migrationsFolder: drizzle });
    expect(after.sqlite.prepare('SELECT bmad_scripts_trusted FROM workspaces').all()).toEqual([{ bmad_scripts_trusted: 0 }]);
    after.close();

    const core = openCore(dataDir);
    try {
      expect(core.bmadScriptTrust.scriptsTrusted(WS)).toBe(false);
      expect(core.permissions.getSettings(WS).bmadScriptsTrusted).toBe(false);
    } finally {
      core.close();
    }
  });
});

function readJournal(dir: string): { entries: Array<{ idx: number }> } {
  return JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number }> };
}
