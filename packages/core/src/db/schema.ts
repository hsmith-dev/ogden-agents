/**
 * The SQLite schema (AD-5, AD-8, AD-9, AD-11). Only core opens this database.
 *
 * Migrations are generated from this file by `pnpm --filter @ogdenmad/core
 * db:generate` into `packages/core/drizzle/` and committed. Import nothing
 * here but `drizzle-orm` and types: `drizzle-kit` loads this file on its own.
 */
import type {
  AdapterRefs,
  RunOutcome,
  SessionDriver,
  SessionKind,
  SessionState,
} from '@ogdenmad/shared';
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    /** Canonical real path, case-folded on case-insensitive filesystems (AD-2). */
    path: text('path').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('workspaces_path_unique').on(t.path)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    kind: text('kind').$type<SessionKind>().notNull(),
    state: text('state').$type<SessionState>().notNull(),
    driver: text('driver').$type<SessionDriver>().notNull(),
    title: text('title'),
    /** Agent and CLI ids (AD-9), as a JSON object. Never keys. */
    adapterRefs: text('adapter_refs', { mode: 'json' }).$type<AdapterRefs>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('sessions_workspace_idx').on(t.workspaceId)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    /** A ticket ref only; ticket status and content live in the BMAD files (AD-10). */
    ticketRef: text('ticket_ref').notNull(),
    worktreePath: text('worktree_path'),
    sandbox: text('sandbox'),
    deadline: text('deadline'),
    outcome: text('outcome').$type<RunOutcome>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.sessionId], foreignColumns: [sessions.id] }),
    // A build session has at most one run (AD-8).
    uniqueIndex('runs_session_unique').on(t.sessionId),
    index('runs_workspace_idx').on(t.workspaceId),
  ],
);

export const events = sqliteTable(
  'events',
  {
    /** `INTEGER PRIMARY KEY AUTOINCREMENT`: strictly increasing and never reused, even after deletes. */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    /** `null` only for install-level events such as `server.started`. */
    workspaceId: text('workspace_id').references(() => workspaces.id),
    streamId: text('stream_id').notNull(),
    type: text('type').notNull(),
    at: text('at').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (t) => [
    uniqueIndex('events_id_unique').on(t.id),
    index('events_workspace_seq_idx').on(t.workspaceId, t.seq),
    index('events_stream_idx').on(t.streamId),
  ],
);
