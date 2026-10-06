/**
 * The SQLite schema (AD-5, AD-8, AD-9, AD-11). Only core opens this database.
 *
 * Migrations are generated from this file by `pnpm --filter @ogden-agents/core
 * db:generate` into `packages/core/drizzle/` and committed. Import nothing
 * here but `drizzle-orm` and types: `drizzle-kit` loads this file on its own.
 */
import type {
  AdapterRefs,
  AgentId,
  BlockedCode,
  BuildAgent,
  CautionLevel,
  PermissionMode,
  RunDecision,
  RunOutcome,
  SessionDriver,
  SessionKind,
  SessionState,
} from '@ogden-agents/shared';
import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    /**
     * The epics whose "Look back on it?" offer the user answered with Not now
     * (epic 7, story 7.2), as JSON array text of epic names, `[]` for new and
     * upgraded workspaces. Changed only by `lookBackOffers.dismiss`; parsed
     * only there, so a damaged value reads as none dismissed.
     */
    lookBackDismissed: text('look_back_dismissed').notNull().default('[]'),
    /**
     * Whether the user allowed Ogden Agents to run this project's own BMad
     * Method scripts (story 4.2, AD-22 note 2026-10-02). Not trusted for new
     * and upgraded workspaces; changed only by `bmadScriptTrust.trustScripts`,
     * never revoked by turning pieces off.
     */
    bmadScriptsTrusted: integer('bmad_scripts_trusted', { mode: 'boolean' }).notNull().default(false),
    /**
     * The contents of the project's `_bmad/scripts/` when the user trusted
     * them (story 4.13, user decision 2026-10-04): `BmadCatalogPort.scriptsFingerprint`.
     * `null` when not trusted, or trusted before this column (read as changed: asked again).
     */
    bmadScriptsFingerprint: text('bmad_scripts_fingerprint'),
    /**
     * The contents of the files the agents that need project trust run
     * (`.claude/settings.json` hooks, `.mcp.json`; epic 12, 12.3, user
     * decision 2026-10-04) when the user trusted the project. The same trust
     * as the scripts': recorded by the same `trustScripts`. `null` when not
     * trusted, or trusted before this column (read as changed: asked again).
     */
    agentFilesFingerprint: text('agent_files_fingerprint'),
    /**
     * The agent this project's new chats preselect (epic 6, entry 6), or
     * NULL for the install's default. No SQL default: core names no agent.
     * Changed only through the workspace settings use-case.
     */
    defaultAgentId: text('default_agent_id'),
    /**
     * The permission mode new chats start in (default permission mode):
     * `ask`, `auto` or `skip_all`; null (and anything unreadable) is Ask.
     * Changed only through the workspace settings use-case, and set back to
     * Ask from Skip all when Developer mode is turned off.
     */
    defaultPermissionMode: text('default_permission_mode'),
    /** Why the default reads as it does (`DefaultModeNotice`), or null; cleared by the user's next choice. */
    defaultPermissionModeNotice: text('default_permission_mode_notice'),
    /**
     * The project's own default model per agent (story 11), as a JSON object
     * of agent id to the agent's model id. `{}` for new and upgraded
     * workspaces. Read only through `readDefaultModels`, so a damaged value
     * reads as none. Changed only through the workspace settings use-case.
     */
    defaultModels: text('default_models').notNull().default('{}'),
    /**
     * The project's own choice of what a message sent while the agent works
     * does (`wait` | `now`; send now or wait), or NULL for the app-wide one.
     */
    whileWorking: text('while_working'),
    /**
     * Whether the Orchestration piece is on for this project (epic 15 story 15.2;
     * AD-22 style, off by default). It is not a BMad Method piece, so it has its
     * own column. Changed only through the workspace settings use-case.
     */
    orchestrationEnabled: integer('orchestration_enabled', { mode: 'boolean' }).notNull().default(false),
    /**
     * The project's orchestration mode (epic 15 story 15.2): `approve_each` or
     * `automatic`; NULL (and anything unreadable) is Approve each instruction.
     * Changed only through the workspace settings use-case.
     */
    orchestrationMode: text('orchestration_mode'),
    /** The project's team roster as JSON (`TeamRoster`), or NULL for nobody assigned. Read only through `readOrchestrationRoster`. */
    orchestrationRoster: text('orchestration_roster'),
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
    /**
     * The agent the session was started with (epic 6), never changed. `NULL`
     * on rows from before agents could be chosen: they are the install's
     * original agent, which the server wiring names (core names none, AD-1).
     */
    agentId: text('agent_id').$type<AgentId>(),
    /**
     * The model the chat runs on (story 11): the agent's own id, or `NULL`
     * for the agent's own choice (and on rows from before it existed).
     */
    model: text('model'),
    /** The user's name for the chat (backlog story 12); `NULL` until they give one. */
    title: text('title'),
    /** The name core gave the chat (the planning action's label, or its first message), set once; `NULL` until then. */
    autoTitle: text('auto_title'),
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
    /** The run's own branch, `ogden/<ref>-<slug>` (story 5.2); `null` in runs from before it. */
    branch: text('branch'),
    /** The commit the run's branch started from (story 5.2): its diff is against it. */
    baseRevision: text('base_revision'),
    /** The branch the main checkout had checked out when the run started (story 5.5): approve merges only into it. */
    baseBranch: text('base_branch'),
    /** Why the run ended as it did, in plain words (story 5.2): a blocked or failed run's reason. */
    reason: text('reason'),
    /** The agent that builds (story 5.3); `null` in runs from before it, read as Claude Code. */
    agent: text('agent').$type<BuildAgent>(),
    /** Why a `blocked` run is blocked (story 5.3): Ogden Agents' code. */
    blockedCode: text('blocked_code').$type<BlockedCode>(),
    /** Where a waiting run is in its workspace's queue (story 5.3; 5.8 fills it). */
    queuePosition: integer('queue_position'),
    /** What the user decided on the review page (story 5.3): `approved` or `rejected`. */
    decision: text('decision').$type<RunDecision>(),
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
 * When each BMad Method module first appeared in a workspace's catalog
 * (story 4.4), for the catalog's `installedAt` (the Plan page's New tag).
 * The first catalog read that finds any module is the baseline: those
 * modules are recorded with `installed_at` `null` (they were there before
 * Ogden Agents looked); a module first seen later gets that time. Written
 * only by `bmadModulesSeen.stamp`; a row stays when its module goes.
 */
export const bmadModulesSeen = sqliteTable(
  'bmad_modules_seen',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    /** The module's code (`[bmod] code`). */
    code: text('code').notNull(),
    /** When it was installed (first seen after the baseline), or `null` for a baseline module. */
    installedAt: text('installed_at'),
    /** When it was first seen. */
    seenAt: text('seen_at').notNull(),
  },
  (t) => [uniqueIndex('bmad_modules_seen_unique').on(t.workspaceId, t.code)],
);

/**
 * Install-wide settings the server enforces (one row, `id = 1`, created on
 * first write): Developer mode, which gates a chat's Skip all.
 */
export const installSettings = sqliteTable('install_settings', {
  id: integer('id').primaryKey(),
  developerMode: integer('developer_mode', { mode: 'boolean' }).notNull().default(false),
});

/**
 * Per agent, install-wide (story 11): the model new chats with it start on
 * (`NULL`: its own choice; Settings → Agents) and the models it last listed
 * (JSON array of `AgentModel`), so Settings and a chat's picker can offer
 * them before the agent starts. A row per agent that ever had either; core
 * names no agent.
 */
export const agentSettings = sqliteTable('agent_settings', {
  agentId: text('agent_id').$type<AgentId>().primaryKey(),
  defaultModel: text('default_model'),
  models: text('models').notNull().default('[]'),
});

/**
 * App-wide chat settings (one row, `id = 1`, created on first write; send
 * now or wait): what a message sent while the agent works does. Kept apart
 * from `install_settings`, whose row's existence says Developer mode was
 * ever set.
 */
export const chatSettings = sqliteTable('chat_settings', {
  id: integer('id').primaryKey(),
  /** `wait` | `now`. */
  whileWorking: text('while_working').notNull().default('wait'),
});

/**
 * Unattended builds' install-wide limits (story 5.8; one row, `id = 1`,
 * created on first write): runs at once in the install and the maximum run
 * time. A missing row or value reads as the defaults.
 */
export const buildLimits = sqliteTable('build_limits', {
  id: integer('id').primaryKey(),
  maxConcurrentRunsPerInstall: integer('max_concurrent_runs_per_install'),
  maxRunMinutes: integer('max_run_minutes'),
});

/**
 * A project's build settings (story 5.8; a row on first write): its limit
 * of runs at once and the test command the verification re-run uses instead
 * of the detected one (11.2 edits it). `NULL` reads as the default.
 */
export const workspaceBuildSettings = sqliteTable('workspace_build_settings', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id),
  maxConcurrentRuns: integer('max_concurrent_runs'),
  testCommand: text('test_command'),
});

/**
 * A project's terminal panes (epic 16, story 16.7): what a pane IS, never what
 * it printed: its id, launcher, name and when it was made. The program's
 * output and the arguments the user typed are not kept. After a restart each
 * comes back stopped, with a Start button.
 */
export const terminalPanes = sqliteTable(
  'terminal_panes',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    launcherId: text('launcher_id').notNull(),
    title: text('title').notNull(),
    createdAt: integer('created_at').notNull(),
    /** The user's opt in to notifications for this pane (story 16.8). */
    notify: integer('notify', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [index('terminal_panes_workspace_idx').on(table.workspaceId, table.createdAt)],
);

/** A project's terminal layout (tabs of split trees of pane ids and titles) as JSON; one row per project, written on change. */
export const terminalLayouts = sqliteTable('terminal_layouts', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  layout: text('layout').notNull(),
});

/**
 * OpenAI-compatible endpoints the Local model talks to (epic 14 story 14.3).
 * No key is ever here: `auth` says only that one is saved in the keychain
 * (`agent-endpoint-key/<id>`, AD-16). `remote_confirmed_for` is the host
 * (name and port) the user confirmed prompts and project text may go to;
 * `NULL` until then.
 */
export const localEndpoints = sqliteTable('local_endpoints', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  preset: text('preset'),
  baseUrl: text('base_url').notNull(),
  auth: text('auth').notNull().default('none'),
  model: text('model'),
  remoteConfirmedFor: text('remote_confirmed_for'),
  createdAt: text('created_at').notNull(),
});

/** The one row of Local model endpoint settings: which endpoint new chats use (`NULL`: the first). */
export const localEndpointSettings = sqliteTable('local_endpoint_settings', {
  id: integer('id').primaryKey(),
  defaultEndpointId: text('default_endpoint_id'),
});

/** The install's Terminals settings (epic 16, story 16.9): one row of JSON, written on first change. Never terminal output. */
export const terminalsSettings = sqliteTable('terminals_settings', {
  id: integer('id').primaryKey(),
  settings: text('settings').notNull(),
});

/**
 * Notification webhooks (story 11.4): one row per webhook the user added. Only
 * its id, its host as it may be shown (masked) and the events it gets; the URL
 * itself, which usually carries a token, is kept through `SecretStorePort`
 * under the id, never here (AD-16).
 */
export const notificationWebhooks = sqliteTable('notification_webhooks', {
  id: text('id').primaryKey(),
  host: text('host').notNull(),
  /** JSON array of `blocked` and `ready_for_review`. */
  events: text('events').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Install-wide notification settings (story 11.4; one row, `id = 1`, created on first write). */
export const notificationSettings = sqliteTable('notification_settings', {
  id: integer('id').primaryKey(),
  browserNotifications: integer('browser_notifications', { mode: 'boolean' }).notNull().default(false),
});

/**
 * An orchestration run (epic 15 story 15.2): a goal, the mode and limits it
 * runs under, and its state. No behaviour yet: entries 3 to 9 write it. The
 * manager's text is masked before it is stored (AD-16).
 */
export const orchestrationRuns = sqliteTable(
  'orchestration_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    goal: text('goal').notNull(),
    /** `OrchestrationRunState`. */
    state: text('state').notNull(),
    /** `OrchestrationMode` the run started under. */
    mode: text('mode').notNull(),
    /** The run's `RunLimits` as JSON. */
    limits: text('limits').notNull(),
    /** `OrchestrationStopReason`, once stopped. */
    stopReason: text('stop_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('orchestration_runs_workspace').on(t.workspaceId)],
);

/** One step of an orchestration run's plan, keyed by the run and the plan's own step id. */
export const orchestrationSteps = sqliteTable(
  'orchestration_steps',
  {
    runId: text('run_id')
      .notNull()
      .references(() => orchestrationRuns.id),
    stepId: text('step_id').notNull(),
    position: integer('position').notNull(),
    worker: text('worker').notNull(),
    /** `new` or a chat id. */
    chat: text('chat').notNull(),
    instruction: text('instruction').notNull(),
    /** The step ids this one waits on, as JSON. */
    dependsOn: text('depends_on').notNull().default('[]'),
    /** `OrchestrationStepState`. */
    state: text('state').notNull(),
    /** `user` or `mode`; NULL until approved. */
    approvedBy: text('approved_by'),
    /** The chat the instruction was sent to, once dispatched. */
    sessionId: text('session_id'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.stepId] })],
);
