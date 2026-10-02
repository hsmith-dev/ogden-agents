/**
 * The SQLite schema (AD-5, AD-8, AD-9, AD-11). Only core opens this database.
 *
 * Migrations are generated from this file by `pnpm --filter @ogden-agents/core
 * db:generate` into `packages/core/drizzle/` and committed. Import nothing
 * here but `drizzle-orm` and types: `drizzle-kit` loads this file on its own.
 */
import type {
  AdapterRefs,
  CautionLevel,
  PermissionMode,
  RunOutcome,
  SessionDriver,
  SessionKind,
  SessionState,
} from '@ogden-agents/shared';
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    /** Canonical real path, case-folded on case-insensitive filesystems (AD-2). */
    path: text('path').notNull(),
    /**
     * The real path as the filesystem spells it (not case-folded): what the
     * agent runs in. Added in story 2.2; rows from before it hold `path`.
     */
    realPath: text('real_path').notNull().default(''),
    /** What the workspace's agents may run without a card (E2-R4; story 2.8). */
    cautionLevel: text('caution_level').$type<CautionLevel>().notNull().default('ask_every_time'),
    /**
     * The BMad pieces this workspace has on, as JSON array text (CAP-19,
     * AD-22; story 10.1). `[]`, every piece off, for new and upgraded
     * workspaces. Plain text, parsed only by `readBmadPieces`, so a damaged
     * value reads as off rather than failing every workspace read.
     */
    bmadPieces: text('bmad_pieces').notNull().default('[]'),
    /**
     * Whether the user answered the "already uses BMad Method" offer with
     * Not now (story 10.3): kept per project, so the offer never shows again
     * for it. Changed only by `bmadDetection.dismissOffer`.
     */
    bmadOfferDismissed: integer('bmad_offer_dismissed', { mode: 'boolean' }).notNull().default(false),
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
    /**
     * The chat's permission mode (`ask`, `auto`, `skip_all`). Rows from
     * before it read `ask`; a server start sets every other one back to `ask`.
     */
    permissionMode: text('permission_mode').$type<PermissionMode>().notNull().default('ask'),
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

/**
 * Always-allow permission rules (E2-R3, story 2.6): stored and enforced in
 * core, scoped to one workspace. They survive Delete history, which removes
 * events, sessions and runs only.
 */
export const permissionRules = sqliteTable(
  'permission_rules',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    /** `command_prefix` or `tool` (`AlwaysAllowScope.kind`). */
    kind: text('kind').$type<'command_prefix' | 'tool'>().notNull(),
    value: text('value').notNull(),
    label: text('label').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('permission_rules_scope_unique').on(t.workspaceId, t.kind, t.value)],
);

/**
 * Install-wide settings the server enforces (one row, `id = 1`, created on
 * first write): Developer mode, which gates a chat's Skip all.
 */
export const installSettings = sqliteTable('install_settings', {
  id: integer('id').primaryKey(),
  developerMode: integer('developer_mode', { mode: 'boolean' }).notNull().default(false),
});
