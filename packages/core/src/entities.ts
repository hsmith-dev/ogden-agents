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
  DriverChangeCause as DriverChangeCauseSchema,
  IsoUtcTimestamp,
  ModelChangeCause as ModelChangeCauseSchema,
  ModelId as ModelIdSchema,
  PermissionMode as PermissionModeSchema,
  PermissionModeChangeCause as PermissionModeChangeCauseSchema,
  RunOutcome as RunOutcomeSchema,
  SessionDriver as SessionDriverSchema,
  SessionKind as SessionKindSchema,
  SessionState as SessionStateSchema,
  TicketRef as TicketRefSchema,
  canonicalBmadPieces,
  DEFAULT_CAUTION_LEVEL,
  type AdapterRefs,
  type AgentId,
  type BmadPiece,
  type DriverChangeCause,
  type MessageRole,
  type ModelChangeCause,
  type PermissionMode,
  type PermissionModeChangeCause,
  type Run,
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
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
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
  title?: string | null;
  /** Agent and CLI ids (AD-9). */
  adapterRefs?: AdapterRefs;
  /** The agent it is started with (epic 6), never changed. */
  agentId?: AgentId;
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
}

export interface NewRun {
  /** Must be a `build` session without a run. */
  sessionId: SessionId;
  ticketRef: string;
  worktreePath?: string | null;
  sandbox?: string | null;
  /** ISO 8601 UTC. */
  deadline?: string | null;
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

  /** Creates the run of a `build` session with outcome `running`, and appends `run.created`. */
  createRun(input: NewRun): Run;
  getRun(id: RunId): Run | undefined;
  /** Sets the outcome (AD-8), appending `run.outcome_changed` if it changed. */
  setRunOutcome(id: RunId, outcome: RunOutcome): Run;
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
  model: row.model,
  title: row.title,
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
        const workspace: Workspace = { id: newId('ws'), path: canonical, realPath: real, createdAt: now() };
        orm
          .insert(workspaces)
          .values({ ...workspace, realPath: real, cautionLevel: DEFAULT_CAUTION_LEVEL, bmadPieces: JSON.stringify(bmadPieces), defaultAgentId: defaultAgentId ?? null })
          .run();
        log.append({
          type: 'workspace.created',
          workspaceId: workspace.id,
          streamId: workspace.id,
          payload: { workspace },
        });
        // A project that starts with pieces on (story 10.4) or its own default agent (epic 6, entry 6)
        // says so right after it is created, in the same transaction.
        if (bmadPieces.length > 0 || defaultAgentId !== undefined) {
          log.append({
            type: 'workspace.settings_changed',
            workspaceId: workspace.id,
            streamId: workspace.id,
            payload: {
              cautionLevel: DEFAULT_CAUTION_LEVEL,
              previous: DEFAULT_CAUTION_LEVEL,
              ...(bmadPieces.length > 0 ? { bmadPieces, previousBmadPieces: [] } : {}),
              ...(defaultAgentId === undefined ? {} : { defaultAgentId, previousDefaultAgentId: null }),
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
      const session: Session = {
        id: newId('ses'),
        workspaceId: input.workspaceId,
        kind: check(SessionKindSchema, input.kind, 'session kind'),
        state: check(SessionStateSchema, input.state ?? 'idle', 'session state'),
        driver: check(SessionDriverSchema, input.driver ?? 'ui', 'session driver'),
        // Every chat starts in Ask, whatever the agent's own settings say.
        permissionMode: 'ask',
        ...(input.agentId === undefined ? {} : { agentId: check(AgentIdSchema, input.agentId, 'agent id') }),
        model: input.model === undefined || input.model === null ? null : check(ModelIdSchema, input.model, 'model'),
        title: input.title ?? null,
        adapterRefs: check(AdapterRefsSchema, input.adapterRefs ?? {}, 'adapter refs'),
        createdAt: at,
        updatedAt: at,
      };
      return log.transaction(() => {
        if (getWorkspace(input.workspaceId) === undefined) throw new NotFoundError('workspace', input.workspaceId);
        orm.insert(sessions).values(session).run();
        sessionEvents.appendSessionEvent(session.id, { type: 'session.created', payload: { session } });
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
        if (session.model === next) return session;
        const updated: Session = { ...session, model: next, updatedAt: now() };
        orm.update(sessions).set({ model: next, updatedAt: updated.updatedAt }).where(eq(sessions.id, id)).run();
        sessionEvents.appendSessionEvent(session.id, {
          type: 'session.model_changed',
          payload: { sessionId: session.id, model: next, previous: session.model, cause, ...(reason === undefined || reason === '' ? {} : { reason }) },
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

    createRun(input) {
      const ticketRef = check(TicketRefSchema, input.ticketRef, 'ticket ref');
      const deadline = check(IsoUtcTimestamp.nullable(), input.deadline ?? null, 'run deadline');
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
          createdAt: at,
          updatedAt: at,
        };
        orm.insert(runs).values(run).run();
        log.append({ type: 'run.created', workspaceId: run.workspaceId, streamId: session.id, payload: { run } });
        return run;
      });
    },

    getRun,

    setRunOutcome(id, outcome) {
      check(RunOutcomeSchema, outcome, 'run outcome');
      return log.transaction(() => {
        const run = getRun(id);
        if (run === undefined) throw new NotFoundError('run', id);
        if (run.outcome === outcome) return run;
        const updated: Run = { ...run, outcome, updatedAt: now() };
        orm.update(runs).set({ outcome, updatedAt: updated.updatedAt }).where(eq(runs.id, id)).run();
        log.append({
          type: 'run.outcome_changed',
          workspaceId: run.workspaceId,
          streamId: run.sessionId,
          payload: { runId: run.id, outcome, previous: run.outcome },
        });
        return updated;
      });
    },
  };
}
