/**
 * A data folder as Ogden Agents 0.2.0 left it (story 10.7; E10-R7, CAP-19,
 * AD-5): the database built by 0.2.0's own migrations (0000 to 0003, copied
 * from the live folder, which keeps them unchanged) holding the rows 0.2.0
 * wrote, and the `onboarding.json` its Welcome kept (left out with
 * `onboarding: false`: 0.2.0 writes it only when Welcome is finished or
 * skipped, or when it is first read with projects). No `preferences.json`:
 * 0.2.0 had none.
 *
 * The rows (`data-folder-0.2.0/rows.json`) were captured by running 0.2.0's
 * own server (`5765a09`) with the fake ACP agent: two projects (a repo that
 * has `_bmad/` and a plain one), a caution level, an always-allow rule kept
 * and one removed, and two chats with their events (messages, a queued
 * message, tool calls, permission cards answered by the user and by a rule,
 * a deny with its reason, a resume after a restart). Repo paths in them are
 * placeholders, filled in here with two fresh fake repos.
 *
 * `stopAt` builds the folder a later build left instead: 4 is after 10.1's
 * migration 0004 (the `_bmad/` project has Planning on), 5 after 10.3's
 * 0005 (its offer also dismissed), each with the column and the event that
 * build wrote.
 *
 * Plain Node only (no test runner import), so Vitest and Playwright specs can
 * both use it.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createFakeBmadRepo, type FakeBmadRepo } from './fake-bmad-repo.js';

/** The live migrations folder (`packages/core/drizzle`). */
export const LIVE_MIGRATIONS = fileURLToPath(new URL('../../packages/core/drizzle', import.meta.url));
/** The database file's name in a data folder (core's `DATABASE_FILE`). */
export const DATABASE_FILE_020 = 'ogden-agents.db';
/** The migrations 0.2.0 shipped, by tag; frozen. */
export const MIGRATIONS_020 = ['0000_init', '0001_workspace_real_path', '0002_permission_rules', '0003_caution_level'] as const;

/** One stored event row, as the `events` table holds it. */
export interface EventRow {
  seq: number;
  id: string;
  workspace_id: string | null;
  stream_id: string;
  type: string;
  at: string;
  payload: string;
}

interface Rows {
  onboarding: string;
  tables: {
    workspaces: Array<Record<string, string>>;
    sessions: Array<Record<string, string | null>>;
    permission_rules: Array<Record<string, string>>;
    runs: Array<Record<string, string | null>>;
    events: EventRow[];
  };
}

export interface DataFolder020Options {
  /** The last migration applied (its journal idx). Default 3: 0.2.0 itself. */
  stopAt?: 3 | 4 | 5;
  /** An existing empty folder to use as the data folder (the installed suite's own). Default: a new temp folder. */
  dataDir?: string;
  /**
   * Write the `onboarding.json` 0.2.0's Welcome writes when finished or
   * skipped. Default `true`; `false` is a 0.2.0 folder whose Welcome never
   * wrote it (0.2.0 writes it only from Welcome, or when it is first read
   * with projects).
   */
  onboarding?: boolean;
}

export interface DataFolder020 {
  /** The data folder (a temp folder). */
  dataDir: string;
  /** The projects' repos: `bmad` has `_bmad/`, `plain` has not. */
  repos: { bmad: FakeBmadRepo; plain: FakeBmadRepo };
  /** The two workspaces' ids, as 0.2.0 stored them. */
  workspaceIds: { bmad: string; plain: string };
  /** The two chats' ids: `bmad`'s (four turns, rules, a resume) and `plain`'s (a queued message). */
  sessionIds: { bmad: string; plain: string };
  /** Every event row as stored, in `seq` order (with the paths filled in). */
  events: EventRow[];
  /** The bytes of the `onboarding.json` written (or that would have been, with `onboarding: false`). */
  onboarding: string;
  /** Removes the data folder and both repos. Close every server on it first. */
  remove(): void;
}

const ROWS_FILE = fileURLToPath(new URL('./data-folder-0.2.0/rows.json', import.meta.url));

/**
 * A workspace key as core computes it (AD-2, `canonicalWorkspacePath`): the
 * real path, case-folded when the filesystem is case-insensitive. Kept here
 * because Playwright specs can't load core's source; the core upgrade test
 * checks the two agree.
 */
export function workspaceKeyOf(path: string): { path: string; realPath: string } {
  const real = realpathSync.native(resolve(path));
  const swapped = [...real].map((char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase())).join('');
  let insensitive: boolean;
  if (swapped === real) insensitive = process.platform === 'win32' || process.platform === 'darwin';
  else {
    const original = statSync(real, { bigint: true });
    const other = statSync(swapped, { bigint: true, throwIfNoEntry: false });
    insensitive = other !== undefined && other.dev === original.dev && other.ino === original.ino;
  }
  return { path: insensitive ? real.toLowerCase() : real, realPath: real };
}

/** Copies the live migrations with journal idx at most `stopAt` into a new folder under `into`. */
function migrationsUpTo(stopAt: number, into: string): string {
  const folder = join(into, 'drizzle');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(LIVE_MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
  journal.entries = journal.entries.filter((entry) => entry.idx <= stopAt);
  for (const entry of journal.entries) cpSync(join(LIVE_MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  return folder;
}

/** Creates the 0.2.0 data folder (or the one `stopAt` names) with two fresh fake repos. */
export function createDataFolder020({ stopAt = 3, dataDir: given, onboarding = true }: DataFolder020Options = {}): DataFolder020 {
  const rows = JSON.parse(readFileSync(ROWS_FILE, 'utf8')) as Rows;
  const dataDir = given ?? mkdtempSync(join(tmpdir(), 'ogden-agents-data-0.2.0-'));
  const scratch = mkdtempSync(join(tmpdir(), 'ogden-agents-migrations-'));
  const bmad = createFakeBmadRepo({ bmad: true });
  const plain = createFakeBmadRepo({ bmad: false });
  const remove = () => {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    bmad.remove();
    plain.remove();
  };
  try {
    const keys = { bmad: workspaceKeyOf(bmad.path), plain: workspaceKeyOf(plain.path) };
    const tokens: Array<[string, string]> = [
      ['{{bmad.path}}', keys.bmad.path],
      ['{{bmad.realPath}}', keys.bmad.realPath],
      ['{{plain.path}}', keys.plain.path],
      ['{{plain.realPath}}', keys.plain.realPath],
    ];
    // A JSON column gets the path JSON-escaped (Windows backslashes); a plain column gets it as is.
    const fill = (column: string, value: unknown) => {
      if (typeof value !== 'string') return value;
      let out = value;
      for (const [token, path] of tokens) out = out.split(token).join(column === 'payload' ? JSON.stringify(path).slice(1, -1) : path);
      return out;
    };

    const sqlite = new Sqlite(join(dataDir, DATABASE_FILE_020));
    try {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('foreign_keys = ON');
      migrate(drizzle({ client: sqlite }), { migrationsFolder: migrationsUpTo(stopAt, scratch) });
      const insert = (table: string, row: object) => {
        const values = row as Record<string, unknown>;
        const columns = Object.keys(values);
        sqlite
          .prepare(`INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
          .run(...columns.map((column) => fill(column, values[column])));
      };
      sqlite.transaction(() => {
        for (const row of rows.tables.workspaces) insert('workspaces', row);
        for (const row of rows.tables.sessions) insert('sessions', row);
        for (const row of rows.tables.permission_rules) insert('permission_rules', row);
        for (const row of rows.tables.runs) insert('runs', row);
        for (const row of rows.tables.events) insert('events', row);
      })();
      const [bmadWs, plainWs] = rows.tables.workspaces as unknown as [{ id: string; caution_level: string }, { id: string }];
      const lastAt = rows.tables.events.at(-1)!.at;
      const later = (ms: number) => new Date(Date.parse(lastAt) + ms).toISOString();
      if (stopAt >= 4) {
        // 10.1's build: Planning turned on in the `_bmad/` project, with the event it appended.
        sqlite.prepare(`UPDATE workspaces SET bmad_pieces = '["planning"]' WHERE id = ?`).run(bmadWs.id);
        sqlite
          .prepare('INSERT INTO events (id, workspace_id, stream_id, type, at, payload) VALUES (?, ?, ?, ?, ?, ?)')
          .run('evt_01M3Y000000000000000000004', bmadWs.id, bmadWs.id, 'workspace.settings_changed', later(60_000), JSON.stringify({ cautionLevel: bmadWs.caution_level, previous: bmadWs.caution_level, bmadPieces: ['planning'], previousBmadPieces: [] }));
      }
      if (stopAt >= 5) {
        // 10.3's build: Not now on the `_bmad/` project's offer.
        sqlite.prepare('UPDATE workspaces SET bmad_offer_dismissed = 1 WHERE id = ?').run(bmadWs.id);
        sqlite
          .prepare('INSERT INTO events (id, workspace_id, stream_id, type, at, payload) VALUES (?, ?, ?, ?, ?, ?)')
          .run('evt_01M3Y000000000000000000005', bmadWs.id, bmadWs.id, 'workspace.bmad_offer_dismissed', later(120_000), '{}');
      }
      const events = sqlite.prepare<[], EventRow>('SELECT seq, id, workspace_id, stream_id, type, at, payload FROM events ORDER BY seq').all();
      const sessions = rows.tables.sessions as Array<{ id: string; workspace_id: string }>;
      sqlite.close();
      if (onboarding) writeFileSync(join(dataDir, 'onboarding.json'), rows.onboarding, { mode: 0o600 });
      return {
        dataDir,
        repos: { bmad, plain },
        workspaceIds: { bmad: bmadWs.id, plain: plainWs.id },
        sessionIds: {
          bmad: sessions.find((s) => s.workspace_id === bmadWs.id)!.id,
          plain: sessions.find((s) => s.workspace_id === plainWs.id)!.id,
        },
        events,
        onboarding: rows.onboarding,
        remove,
      };
    } finally {
      if (sqlite.open) sqlite.close();
    }
  } catch (error) {
    remove();
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
