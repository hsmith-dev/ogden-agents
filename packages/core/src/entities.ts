/**
 * The entity model (AD-2, AD-8, AD-9): workspaces, sessions and runs.
 *
 * Every change is written together with its event in one transaction, so the
 * rows and the event log never disagree, and subscribers hear about a change
 * only once it is committed.
 */
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdapterRefs as AdapterRefsSchema,
  AgentId as AgentIdSchema,
  BlockedCode as BlockedCodeSchema,
  BuildAgent as BuildAgentSchema,
  DEFAULT_BUILD_AGENT,
  DriverChangeCause as DriverChangeCauseSchema,
  IsoUtcTimestamp,
  ModelChangeCause as ModelChangeCauseSchema,
  ModelId as ModelIdSchema,
  PermissionMode as PermissionModeSchema,
  PermissionModeChangeCause as PermissionModeChangeCauseSchema,
  RunDecision as RunDecisionSchema,
  RunOutcome as RunOutcomeSchema,
  SessionDriver as SessionDriverSchema,
  SessionKind as SessionKindSchema,
  SessionState as SessionStateSchema,
  TicketRef as TicketRefSchema,
  autoChatName,
  canonicalBmadPieces,
  CHAT_NAME_MAX,
  CHAT_NAME_TOO_LONG,
  chatNameFits,
  normalizeChatName,
  DEFAULT_CAUTION_LEVEL,
  type AdapterRefs,
  type AgentId,
  type BlockedCode,
  type BmadPiece,
  type BuildAgent,
  type CoreEvent,
  type CoreEventType,
  type SessionAgentChangedEvent,
  type DriverChangeCause,
  type MessageRole,
  type ModelChangeCause,
  type PermissionMode,
  type PermissionModeChangeCause,
  type Run,
  type RunDecision,
  type RunId,
  type RunOutcome,
  type Session,
  type SessionDriver,
  type SessionErrorCode,
  type SessionId,
  type SessionKind,
  type SessionState,
  type Workspace,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './db/database.js';
import { events, runs, sessions, workspaces } from './db/schema.js';
import { InvalidOperationError, NotFoundError, ValidationError, WorkspaceBusyError } from './errors.js';
import type { EventLog, HistoryDeleted } from './event-log.js';
import { newId } from './ids.js';
import type { SessionEvents } from './session-events.js';

/** The reason on a mode a server start set back to Ask. */
export const RESTART_MODE_REASON = 'Ogden Agents was restarted, so this chat is back in Ask.';

export interface NewSession {
  workspaceId: WorkspaceId;
  kind: SessionKind;
  /** Default `ui`. */
  driver?: SessionDriver;
  /** Default `idle`. */
  state?: SessionState;
  /** The user's name for the chat; stored as given (callers normalize). */
  title?: string | null;
  /** The automatic name it starts with (a planning action's label), normalized and shortened here. */
  autoTitle?: string | null;
  /** Agent and CLI ids (AD-9). */
  adapterRefs?: AdapterRefs;
  /** The agent it is started with (epic 6), never changed. */
  agentId?: AgentId;
  /**
   * The permission mode it starts in (default permission mode): chosen and
   * checked by the caller (its project's default, the agent's modes,
   * Developer mode). Default Ask.
   */
  permissionMode?: PermissionMode;
  /** Plain words about that starting mode, carried on `session.created`. */
  permissionModeNote?: string;
  /** The model it starts on (story 11): the agent's own id; absent or `null`, the agent's own choice. */
  model?: string | null;
}

/** What a newly created workspace starts with (story 10.4). Ignored when the workspace already exists. */
export interface NewWorkspaceOptions {
  /**
   * The BMad pieces it starts with, in the creating transaction, or a
   * function that returns them, called only when the workspace is created
   * (inside that transaction: a throw creates nothing). The caller checks
   * them (pieces, dependency rule, availability). Default none.
   */
  bmadPieces?: readonly BmadPiece[] | (() => readonly BmadPiece[]);
  /**
   * The agent its new chats preselect (epic 6, entry 6: the install's default
   * for new projects), or a function that returns it, called only when the
   * workspace is created. The caller checks it is registered. Default none
   * (the install's default).
   */
  defaultAgentId?: AgentId | undefined | (() => AgentId | undefined);
  /**
   * The mode its new chats start in (the app-wide default for new projects),
   * or a function that returns it, called only when the workspace is
   * created. Skip all is kept as Ask waiting for the user's confirmation for
   * this project (notice `skip_all_unconfirmed`). Default Ask.
   */
  defaultPermissionMode?: PermissionMode | undefined | (() => PermissionMode | undefined);
}

export interface NewRun {
  /** Must be a `build` session without a run. */
  sessionId: SessionId;
  ticketRef: string;
  worktreePath?: string | null;
  sandbox?: string | null;
  /** ISO 8601 UTC. */
  deadline?: string | null;
  /** The run's own branch (story 5.2). */
  branch?: string | null;
  /** The commit its branch started from (story 5.2). */
  baseRevision?: string | null;
  /** The agent that builds (story 5.3). Default Claude Code, the only one in v1. */
  agent?: BuildAgent;
  /** Where it waits in the workspace's queue (story 5.3; 5.8), `null` when dispatched now. */
  queuePosition?: number | null;
}

export interface SessionStateDetail {
  reason?: string | undefined;
  resumable?: boolean | undefined;
  /** Set with `error` when the UI acts on the cause (`auth_required`: sign in again; 9.4). */
  errorCode?: SessionErrorCode | undefined;
}

/** One completed message of a session, as `session.message_completed` stored it. */
export interface CompletedMessage {
  messageId: string;
  role: MessageRole;
  content: string;
}

export interface Entities {
  /**
   * Returns the workspace for the repo at `path`, creating it (and appending
   * `workspace.created`) if none exists. A symlink or a different casing of
   * the same repo returns the existing workspace (AD-2).
   */
  ensureWorkspace(path: string, options?: NewWorkspaceOptions): Workspace;
  getWorkspace(id: WorkspaceId): Workspace | undefined;
  listWorkspaces(): Workspace[];
  /**
   * Deletes the workspace's events, sessions and runs (the workspace stays)
   * and appends `workspace.history_deleted`, in one transaction. Throws
   * {@link WorkspaceBusyError}, deleting nothing, while any of its sessions is
   * `working` or `waiting`, and {@link NotFoundError} for an unknown workspace.
   */
  deleteWorkspaceHistory(workspaceId: WorkspaceId): HistoryDeleted;

  /** Creates a session and appends `session.created`. */
  createSession(input: NewSession): Session;
  getSession(id: SessionId): Session | undefined;
  listSessions(workspaceId: WorkspaceId): Session[];
  /**
   * Sets the normalized state (AD-4), appending `session.state_changed` if it
   * changed. `reason` is plain words for the user (an error's cause), never a
   * secret; `resumable` marks an `idle` whose agent process is gone (AD-3).
   */
  setSessionState(id: SessionId, state: SessionState, detail?: SessionStateDetail): Session;
  /**
   * Moves every `working` or `waiting` session to `idle`, marked resumable,
   * with `reason`: their agent processes are gone (AD-3). Returns them.
   */
  settleInterruptedSessions(reason: string): Session[];
  /**
   * Hands every session a stopped server left with `driver = terminal` back
   * to the chat (story 3.1 review F3): its terminal died with that server.
   * Appends `session.driver_changed` (cause `server_restarted`) for each. Returns them.
   */
  releaseTerminalDrivers(): Session[];
  /**
   * Merges `refs` into the session's adapter refs (AD-9: the agent's own ids,
   * never keys). Appends no event, so an agent's id never reaches the log,
   * and leaves `updatedAt` alone. {@link NotFoundError} for an unknown session.
   */
  setSessionAdapterRefs(id: SessionId, refs: AdapterRefs): Session;
  /** The session's completed messages (`session.message_completed`), oldest first. */
  listCompletedMessages(sessionId: SessionId): CompletedMessage[];
  /** The session's events of `types`, oldest first (the handoff brief reads its history from them). */
  listSessionEvents(sessionId: SessionId, types: readonly CoreEventType[]): CoreEvent[];
  /**
   * Hands the session to the agent `agentId` (handoff): sets its agent and
   * merges `refs` into its adapter refs, appending `session.agent_changed`
   * with the previous agent, `brief` and `resumes`, in one transaction;
   * `leftAtRef`, when given, is set to that event's seq in it too.
   * Checks nothing else: who may hand off when is the chat's to enforce.
   * {@link NotFoundError} for an unknown session.
   */
  setSessionAgent(
    id: SessionId,
    change: { agentId: AgentId; previous: AgentId; brief: string; resumes: boolean; refs: AdapterRefs; leftAtRef?: string | undefined },
  ): { session: Session; event: SessionAgentChangedEvent };
  /** Sets the driver (AD-6), appending `session.driver_changed` (with `cause`, if given) if it changed. */
  setSessionDriver(id: SessionId, driver: SessionDriver, cause?: DriverChangeCause): Session;
  /**
   * Sets the chat's permission mode, appending `session.permission_mode_changed`
   * with `cause` (and `reason`, plain words) if it changed. Checks nothing
   * else: who may choose which mode is the caller's to enforce (the chat's
   * `setPermissionMode`, Developer mode). {@link NotFoundError} for an unknown session.
   */
  setSessionPermissionMode(id: SessionId, mode: PermissionMode, cause: PermissionModeChangeCause, reason?: string): Session;
  /**
   * Sets the chat's model (story 11; `null`: the agent's own choice),
   * appending `session.model_changed` with `cause` (and `reason`) if it
   * changed. Checks only that it is a model id: whether the agent offers it is
   * the caller's. {@link NotFoundError} for an unknown session.
   */
  setSessionModel(id: SessionId, model: string | null, cause: ModelChangeCause, reason?: string): Session;
  /** Every session in `mode`, oldest first, across workspaces. */
  listSessionsInPermissionMode(mode: PermissionMode): Session[];
  /**
   * Sets every session not in `ask` back to `ask` (cause `restart`): run at a
   * server start, so no mode but Ask outlives the run it was chosen in. Returns them.
   */
  resetPermissionModes(): Session[];
  /**
   * Sets the user's name for the chat (backlog story 12), normalized:
   * control characters removed, white space collapsed; blank or `null`
   * clears it. Appends `session.renamed` (cause `user`) if it changed, and
   * leaves `updatedAt` alone. {@link ValidationError} (nothing stored) for a
   * name over {@link CHAT_NAME_MAX} characters; {@link NotFoundError} for an
   * unknown session.
   */
  setSessionTitle(id: SessionId, title: string | null): Session;
  /**
   * Names every chat that has no automatic name yet from its first user
   * message (not a Deny reason): chats from before chat names. Run at a
   * server start; returns the sessions it named.
   */
  backfillAutoTitles(): Session[];

  /** Creates the run of a `build` session with outcome `running`, and appends `run.created`. */
  createRun(input: NewRun): Run;
  getRun(id: RunId): Run | undefined;
  /** The run of a `build` session (story 5.2), if it has one. */
  getRunBySession(sessionId: SessionId): Run | undefined;
  /** The workspace's latest run of ticket `ticketRef` (story 5.2), if any. */
  latestRunForTicket(workspaceId: WorkspaceId, ticketRef: string): Run | undefined;
  /** The workspace's run of ticket `ticketRef` still `running` (story 5.2), if any. */
  activeRunForTicket(workspaceId: WorkspaceId, ticketRef: string): Run | undefined;
  /**
   * Sets the outcome (AD-8) and its plain `reason` (story 5.2: `null` when
   * not given), appending `run.outcome_changed` if either changed.
   */
  setRunOutcome(id: RunId, outcome: RunOutcome, reason?: string | null, options?: { blockedCode?: BlockedCode | null }): Run;
  /**
   * Records what the user decided on the review page (story 5.3): sets the
   * run's `decision` and appends `run.decided` (with the merge commit for
   * `approved`, and the revision the user reviewed). The outcome is set
   * separately. The same decision again changes nothing and appends nothing.
   */
  setRunDecision(id: RunId, decision: RunDecision, mergeRevision?: string, reviewedRevision?: string): Run;
  /**
   * Sets every run still `running` to `blocked` with `reason` and the code
   * `interrupted` (story 5.2 review loop 1; 5.3): run at a server start,
   * whose agents are gone with the process that ran them (AD-3). Their
   * worktrees stay. Returns them.
   */
  settleInterruptedRuns(reason: string): Run[];
}

/** Parses `value`, throwing a {@link ValidationError} that names `what`. */
function check<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      `invalid ${what}`,
      parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    );
  }
  return parsed.data;
}

type WorkspaceRow = typeof workspaces.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type RunRow = typeof runs.$inferSelect;

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id as WorkspaceId,
  path: row.path,
  realPath: row.realPath === '' ? row.path : row.realPath,
  createdAt: row.createdAt,
});

const toSession = (row: SessionRow): Session => ({
  id: row.id as SessionId,
  workspaceId: row.workspaceId as WorkspaceId,
  kind: row.kind,
  state: row.state,
  driver: row.driver,
  permissionMode: row.permissionMode,
  ...(row.agentId === null ? {} : { agentId: row.agentId }),
  ...(row.model === null ? {} : { model: row.model }),
  title: row.title,
  ...(row.autoTitle === null ? {} : { autoTitle: row.autoTitle }),
  adapterRefs: row.adapterRefs,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toRun = (row: RunRow): Run => ({
  id: row.id as RunId,
  sessionId: row.sessionId as SessionId,
  workspaceId: row.workspaceId as WorkspaceId,
  ticketRef: row.ticketRef,
  worktreePath: row.worktreePath,
  sandbox: row.sandbox,
  deadline: row.deadline,
  outcome: row.outcome,
  branch: row.branch,
  baseRevision: row.baseRevision,
  reason: row.reason,
  agent: row.agent ?? DEFAULT_BUILD_AGENT,
  blockedCode: row.blockedCode,
  queuePosition: row.queuePosition,
  decision: row.decision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Swaps the case of every letter, e.g. `/Users/a` -> `/uSERS/A`. */
function swapCase(value: string): string {
  let out = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    out += char === lower ? char.toUpperCase() : lower;
  }
  return out;
}

/**
 * Whether `path` (which must exist) lives on a case-insensitive filesystem:
 * the same path with every letter's case swapped names the same file.
 * A path with no letters falls back to the platform default.
 */
export function isCaseInsensitivePath(path: string): boolean {
  const swapped = swapCase(path);
  if (swapped === path) return process.platform === 'win32' || process.platform === 'darwin';
  const original = statSync(path, { bigint: true });
  const other = statSync(swapped, { bigint: true, throwIfNoEntry: false });
  return other !== undefined && other.dev === original.dev && other.ino === original.ino;
}

/**
 * The canonical form of a workspace path (AD-2): the real path, with symlinks
 * resolved, case-folded when the filesystem is case-insensitive. The path must
 * be an existing directory.
 */
export function canonicalWorkspacePath(path: string): string {
  return foldWorkspacePath(realWorkspacePath(path));
}

/** The real path of an existing directory, symlinks resolved, spelled as the filesystem spells it. */
export function realWorkspacePath(path: string): string {
  const real = realpathSync.native(resolve(path));
  if (!statSync(real).isDirectory()) {
    throw new InvalidOperationError(`workspace path is not a directory: ${real}`);
  }
  return real;
}

/** A real path case-folded when its filesystem is case-insensitive: the workspace key (AD-2). */
function foldWorkspacePath(real: string): string {
  return isCaseInsensitivePath(real) ? real.toLowerCase() : real;
}

export function createEntities(db: Database, log: EventLog, sessionEvents: SessionEvents): Entities {
  const { orm } = db;
  const now = () => new Date().toISOString();

  const getWorkspace = (id: WorkspaceId) => {
    const row = orm.select().from(workspaces).where(eq(workspaces.id, id)).get();
    return row === undefined ? undefined : toWorkspace(row);
  };
  const getSession = (id: SessionId) => {
    const row = orm.select().from(sessions).where(eq(sessions.id, id)).get();
    return row === undefined ? undefined : toSession(row);
  };
  const getRun = (id: RunId) => {
    const row = orm.select().from(runs).where(eq(runs.id, id)).get();
    return row === undefined ? undefined : toRun(row);
  };
  const requireSession = (id: SessionId) => {
    const session = getSession(id);
    if (session === undefined) throw new NotFoundError('session', id);
    return session;
  };

  return {
    ensureWorkspace(path, options = {}) {
      const real = realWorkspacePath(path);
      const canonical = foldWorkspacePath(real);
      return log.transaction(() => {
        const existing = orm.select().from(workspaces).where(eq(workspaces.path, canonical)).get();
        if (existing !== undefined) return toWorkspace(existing);
        const given = typeof options.bmadPieces === 'function' ? options.bmadPieces() : (options.bmadPieces ?? []);
        const bmadPieces = canonicalBmadPieces(given);
        const defaultAgentId = typeof options.defaultAgentId === 'function' ? options.defaultAgentId() : options.defaultAgentId;
        const wanted = typeof options.defaultPermissionMode === 'function' ? options.defaultPermissionMode() : options.defaultPermissionMode;
        // Skip all is confirmed once per project: from the app-wide default it waits for that confirmation, in Ask.
        const unconfirmed = wanted === 'skip_all';
        const permissionMode: PermissionMode = wanted === 'auto' ? 'auto' : 'ask';
        const workspace: Workspace = { id: newId('ws'), path: canonical, realPath: real, createdAt: now() };
        orm
          .insert(workspaces)
          .values({
            ...workspace,
            realPath: real,
            cautionLevel: DEFAULT_CAUTION_LEVEL,
            bmadPieces: JSON.stringify(bmadPieces),
            defaultAgentId: defaultAgentId ?? null,
            defaultPermissionMode: wanted === undefined ? null : permissionMode,
            defaultPermissionModeNotice: unconfirmed ? 'skip_all_unconfirmed' : null,
          })
          .run();
        log.append({
          type: 'workspace.created',
          workspaceId: workspace.id,
          streamId: workspace.id,
          payload: { workspace },
        });
        // A project that starts with pieces on (story 10.4) or its own default agent (epic 6, entry 6)
        // says so right after it is created, in the same transaction.
        if (bmadPieces.length > 0 || defaultAgentId !== undefined || permissionMode !== 'ask') {
          log.append({
            type: 'workspace.settings_changed',
            workspaceId: workspace.id,
            streamId: workspace.id,
            payload: {
              cautionLevel: DEFAULT_CAUTION_LEVEL,
              previous: DEFAULT_CAUTION_LEVEL,
              ...(bmadPieces.length > 0 ? { bmadPieces, previousBmadPieces: [] } : {}),
              ...(defaultAgentId === undefined ? {} : { defaultAgentId, previousDefaultAgentId: null }),
              ...(permissionMode === 'ask' ? {} : { defaultPermissionMode: permissionMode, previousDefaultPermissionMode: 'ask' as const, defaultPermissionModeCause: 'user' as const }),
            },
          });
        }
        return workspace;
      });
    },

    getWorkspace,

    listWorkspaces() {
      return orm.select().from(workspaces).orderBy(asc(workspaces.createdAt), asc(workspaces.id)).all().map(toWorkspace);
    },

    deleteWorkspaceHistory(workspaceId) {
      return log.transaction(() => {
        const busy = orm
          .select({ id: sessions.id })
          .from(sessions)
          .where(and(eq(sessions.workspaceId, workspaceId), inArray(sessions.state, ['working', 'waiting'])))
          .get();
        if (busy !== undefined) throw new WorkspaceBusyError(workspaceId);
        return log.deleteWorkspaceHistory(workspaceId);
      });
    },

    createSession(input) {
      const at = now();
      const autoTitle = input.autoTitle == null ? null : autoChatName(input.autoTitle, CHAT_NAME_MAX);
      const session: Session = {
        id: newId('ses'),
        workspaceId: input.workspaceId,
        kind: check(SessionKindSchema, input.kind, 'session kind'),
        state: check(SessionStateSchema, input.state ?? 'idle', 'session state'),
        driver: check(SessionDriverSchema, input.driver ?? 'ui', 'session driver'),
        // Ask unless the caller chose its project's default; never the agent's own settings.
        permissionMode: check(PermissionModeSchema, input.permissionMode ?? 'ask', 'permission mode'),
        ...(input.agentId === undefined ? {} : { agentId: check(AgentIdSchema, input.agentId, 'agent id') }),
        ...(input.model === undefined || input.model === null ? {} : { model: check(ModelIdSchema, input.model, 'model') }),
        title: input.title ?? null,
        ...(autoTitle === null ? {} : { autoTitle }),
        adapterRefs: check(AdapterRefsSchema, input.adapterRefs ?? {}, 'adapter refs'),
        createdAt: at,
        updatedAt: at,
      };
      return log.transaction(() => {
        if (getWorkspace(input.workspaceId) === undefined) throw new NotFoundError('workspace', input.workspaceId);
        orm.insert(sessions).values(session).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.created',
          payload: { session, ...(input.permissionModeNote === undefined || input.permissionModeNote === '' ? {} : { permissionModeNote: input.permissionModeNote }) },
        });
        return session;
      });
    },

    getSession,

    listSessions(workspaceId) {
      return orm
        .select()
        .from(sessions)
        .where(eq(sessions.workspaceId, workspaceId))
        .orderBy(asc(sessions.createdAt), asc(sessions.id))
        .all()
        .map(toSession);
    },

    setSessionState(id, state, { reason, resumable, errorCode } = {}) {
      check(SessionStateSchema, state, 'session state');
      return log.transaction(() => {
        const session = requireSession(id);
        if (session.state === state) return session;
        const updated: Session = { ...session, state, updatedAt: now() };
        orm.update(sessions).set({ state, updatedAt: updated.updatedAt }).where(eq(sessions.id, id)).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.state_changed',
          payload: {
            sessionId: session.id,
            state,
            previous: session.state,
            ...(reason === undefined || reason === '' ? {} : { reason }),
            ...(resumable === true ? { resumable: true as const } : {}),
            ...(state === 'error' && errorCode !== undefined ? { errorCode } : {}),
          },
        });
        return updated;
      });
    },

    settleInterruptedSessions(reason) {
      return log.transaction(() =>
        orm
          .select()
          .from(sessions)
          .where(inArray(sessions.state, ['working', 'waiting']))
          .all()
          .map((row) => this.setSessionState(row.id as SessionId, 'idle', { reason, resumable: true })),
      );
    },

    releaseTerminalDrivers() {
      return log.transaction(() =>
        orm
          .select()
          .from(sessions)
          .where(eq(sessions.driver, 'terminal'))
          .all()
          .map((row) => this.setSessionDriver(row.id as SessionId, 'ui', 'server_restarted')),
      );
    },

    setSessionAdapterRefs(id, refs) {
      check(AdapterRefsSchema, refs, 'adapter refs');
      return log.transaction(() => {
        const session = requireSession(id);
        const adapterRefs = { ...session.adapterRefs, ...refs };
        orm.update(sessions).set({ adapterRefs }).where(eq(sessions.id, id)).run();
        return { ...session, adapterRefs };
      });
    },

    listCompletedMessages(sessionId) {
      return orm
        .select({ payload: events.payload })
        .from(events)
        .where(and(eq(events.streamId, sessionId), eq(events.type, 'session.message_completed')))
        .orderBy(asc(events.seq))
        .all()
        .map(({ payload }) => {
          const { messageId, role, content } = payload as CompletedMessage;
          return { messageId, role, content };
        });
    },

    listSessionEvents(sessionId, types) {
      if (types.length === 0) return [];
      return orm
        .select()
        .from(events)
        .where(and(eq(events.streamId, sessionId), inArray(events.type, [...types])))
        .orderBy(asc(events.seq))
        .all()
        .map(
          (row) =>
            // Rows were validated on the way in; the stored JSON is the payload as parsed.
            ({ id: row.id, seq: row.seq, workspaceId: row.workspaceId, streamId: row.streamId, type: row.type, at: row.at, payload: row.payload }) as CoreEvent,
        );
    },

    setSessionAgent(id, { agentId, previous, brief, resumes, refs, leftAtRef }) {
      check(AgentIdSchema, agentId, 'agent id');
      check(AgentIdSchema, previous, 'agent id');
      check(AdapterRefsSchema, refs, 'adapter refs');
      return log.transaction(() => {
        const session = requireSession(id);
        const updated: Session = { ...session, agentId, adapterRefs: { ...session.adapterRefs, ...refs }, updatedAt: now() };
        orm.update(sessions).set({ agentId, adapterRefs: updated.adapterRefs, updatedAt: updated.updatedAt }).where(eq(sessions.id, id)).run();
        const event = sessionEvents.appendSessionEvent(session.id, {
          type: 'session.agent_changed',
          payload: { sessionId: session.id, agentId, previous, brief, resumes },
        }) as SessionAgentChangedEvent;
        if (leftAtRef === undefined) return { session: updated, event };
        // The event's own seq, as an adapter ref (no event of its own).
        const adapterRefs = { ...updated.adapterRefs, [leftAtRef]: String(event.seq) };
        orm.update(sessions).set({ adapterRefs }).where(eq(sessions.id, id)).run();
        return { session: { ...updated, adapterRefs }, event };
      });
    },

    setSessionDriver(id, driver, cause) {
      check(SessionDriverSchema, driver, 'session driver');
      if (cause !== undefined) check(DriverChangeCauseSchema, cause, 'driver change cause');
      return log.transaction(() => {
        const session = requireSession(id);
        if (session.driver === driver) return session;
        const updated: Session = { ...session, driver, updatedAt: now() };
        orm.update(sessions).set({ driver, updatedAt: updated.updatedAt }).where(eq(sessions.id, id)).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.driver_changed',
          payload: { sessionId: session.id, driver, previous: session.driver, ...(cause === undefined ? {} : { cause }) },
        });
        return updated;
      });
    },

    setSessionPermissionMode(id, mode, cause, reason) {
      check(PermissionModeSchema, mode, 'permission mode');
      check(PermissionModeChangeCauseSchema, cause, 'permission mode change cause');
      return log.transaction(() => {
        const session = requireSession(id);
        if (session.permissionMode === mode) return session;
        const updated: Session = { ...session, permissionMode: mode, updatedAt: now() };
        orm.update(sessions).set({ permissionMode: mode, updatedAt: updated.updatedAt }).where(eq(sessions.id, id)).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.permission_mode_changed',
          payload: {
            sessionId: session.id,
            mode,
            previous: session.permissionMode,
            cause,
            ...(reason === undefined || reason === '' ? {} : { reason }),
          },
        });
        return updated;
      });
    },

    setSessionModel(id, model, cause, reason) {
      const next = model === null ? null : check(ModelIdSchema, model, 'model');
      check(ModelChangeCauseSchema, cause, 'model change cause');
      return log.transaction(() => {
        const session = requireSession(id);
        const previous = session.model ?? null;
        if (previous === next) return session;
        const { model: _old, ...rest } = session;
        const updated: Session = { ...rest, ...(next === null ? {} : { model: next }), updatedAt: now() };
        orm.update(sessions).set({ model: next, updatedAt: updated.updatedAt }).where(eq(sessions.id, id)).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.model_changed',
          payload: { sessionId: session.id, model: next, previous, cause, ...(reason === undefined || reason === '' ? {} : { reason }) },
        });
        return updated;
      });
    },

    listSessionsInPermissionMode(mode) {
      return orm
        .select()
        .from(sessions)
        .where(eq(sessions.permissionMode, mode))
        .orderBy(asc(sessions.createdAt), asc(sessions.id))
        .all()
        .map(toSession);
    },

    resetPermissionModes() {
      return log.transaction(() =>
        orm
          .select()
          .from(sessions)
          .where(ne(sessions.permissionMode, 'ask'))
          .all()
          .map((row) => this.setSessionPermissionMode(row.id as SessionId, 'ask', 'restart', RESTART_MODE_REASON)),
      );
    },

    setSessionTitle(id, title) {
      const name = normalizeChatName(title);
      return log.transaction(() => {
        const session = requireSession(id);
        if (name !== null && !chatNameFits(name)) throw new ValidationError(CHAT_NAME_TOO_LONG, [{ path: ['title'], message: CHAT_NAME_TOO_LONG }]);
        if (session.title === name) return session;
        // `updatedAt` is left alone: a rename never moves a chat in the sidebar.
        orm.update(sessions).set({ title: name }).where(eq(sessions.id, id)).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.renamed',
          payload: { sessionId: session.id, title: name, autoTitle: session.autoTitle ?? null, cause: 'user' },
        });
        return { ...session, title: name };
      });
    },

    backfillAutoTitles() {
      return log.transaction(() => {
        const named: Session[] = [];
        const unnamed = orm.select({ id: sessions.id }).from(sessions).where(isNull(sessions.autoTitle)).orderBy(asc(sessions.createdAt), asc(sessions.id)).all();
        for (const { id } of unnamed) {
          const messages = orm
            .select({ payload: events.payload })
            .from(events)
            .where(and(eq(events.streamId, id), eq(events.type, 'session.message_completed')))
            .orderBy(asc(events.seq))
            .all()
            .map(({ payload }) => payload as { role: MessageRole; content: string; origin?: string })
            .filter((message) => message.role === 'user' && message.origin !== 'deny_reason');
          // As the live path does: the first message with visible text names it.
          if (messages.some((message) => sessionEvents.nameChat(id as SessionId, message.content))) named.push(requireSession(id as SessionId));
        }
        return named;
      });
    },

    createRun(input) {
      const ticketRef = check(TicketRefSchema, input.ticketRef, 'ticket ref');
      const deadline = check(IsoUtcTimestamp.nullable(), input.deadline ?? null, 'run deadline');
      const agent = check(BuildAgentSchema, input.agent ?? DEFAULT_BUILD_AGENT, 'build agent');
      const queuePosition = check(z.number().int().positive().nullable(), input.queuePosition ?? null, 'queue position');
      return log.transaction(() => {
        const session = requireSession(input.sessionId);
        if (session.kind !== 'build') {
          throw new InvalidOperationError(`a run needs a build session; ${session.id} is a ${session.kind} session`);
        }
        const taken = orm.select({ id: runs.id }).from(runs).where(eq(runs.sessionId, session.id)).get();
        if (taken !== undefined) throw new InvalidOperationError(`session ${session.id} already has run ${taken.id}`);
        const at = now();
        const run: Run = {
          id: newId('run'),
          sessionId: session.id,
          workspaceId: session.workspaceId,
          ticketRef,
          worktreePath: input.worktreePath ?? null,
          sandbox: input.sandbox ?? null,
          deadline,
          outcome: 'running',
          branch: input.branch ?? null,
          baseRevision: input.baseRevision ?? null,
          reason: null,
          agent,
          blockedCode: null,
          queuePosition,
          decision: null,
          createdAt: at,
          updatedAt: at,
        };
        orm.insert(runs).values(run).run();
        log.append({ type: 'run.created', workspaceId: run.workspaceId, streamId: session.id, payload: { run } });
        return run;
      });
    },

    getRun,

    getRunBySession(sessionId) {
      const row = orm.select().from(runs).where(eq(runs.sessionId, sessionId)).get();
      return row === undefined ? undefined : toRun(row);
    },

    latestRunForTicket(workspaceId, ticketRef) {
      const row = orm
        .select()
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.ticketRef, ticketRef)))
        .orderBy(desc(runs.createdAt), desc(runs.id))
        .limit(1)
        .get();
      return row === undefined ? undefined : toRun(row);
    },

    activeRunForTicket(workspaceId, ticketRef) {
      const row = orm
        .select()
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.ticketRef, ticketRef), eq(runs.outcome, 'running')))
        .limit(1)
        .get();
      return row === undefined ? undefined : toRun(row);
    },

    settleInterruptedRuns(reason) {
      return orm
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.outcome, 'running'))
        .all()
        .map((row) => this.setRunOutcome(row.id as RunId, 'blocked', reason, { blockedCode: 'interrupted' }));
    },

    setRunOutcome(id, outcome, reason = null, options = {}) {
      check(RunOutcomeSchema, outcome, 'run outcome');
      const why = reason === null || reason.trim() === '' ? null : reason;
      // A code only on a blocked run (story 5.3); any other outcome clears it.
      const blockedCode = outcome === 'blocked' ? check(BlockedCodeSchema.nullable(), options.blockedCode ?? null, 'blocked code') : null;
      return log.transaction(() => {
        const run = getRun(id);
        if (run === undefined) throw new NotFoundError('run', id);
        if (run.outcome === outcome && run.reason === why && run.blockedCode === blockedCode) return run;
        const updated: Run = { ...run, outcome, reason: why, blockedCode, updatedAt: now() };
        orm.update(runs).set({ outcome, reason: why, blockedCode, updatedAt: updated.updatedAt }).where(eq(runs.id, id)).run();
        log.append({
          type: 'run.outcome_changed',
          workspaceId: run.workspaceId,
          streamId: run.sessionId,
          payload: { runId: run.id, outcome, previous: run.outcome, ...(why === null ? {} : { reason: why }), ...(blockedCode === null ? {} : { blockedCode }) },
        });
        return updated;
      });
    },

    setRunDecision(id, decision, mergeRevision, reviewedRevision) {
      check(RunDecisionSchema, decision, 'run decision');
      return log.transaction(() => {
        const run = getRun(id);
        if (run === undefined) throw new NotFoundError('run', id);
        if (run.decision === decision) return run;
        const updated: Run = { ...run, decision, updatedAt: now() };
        orm.update(runs).set({ decision, updatedAt: updated.updatedAt }).where(eq(runs.id, id)).run();
        log.append({
          type: 'run.decided',
          workspaceId: run.workspaceId,
          streamId: run.sessionId,
          payload: { runId: run.id, decision, ...(mergeRevision === undefined ? {} : { mergeRevision }), ...(reviewedRevision === undefined ? {} : { reviewedRevision }) },
        });
        return updated;
      });
    },
  };
}
