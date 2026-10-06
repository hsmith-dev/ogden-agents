/**
 * The persistent, append-only event log (AD-5).
 *
 * Core is the only writer (AD-11). Every event is validated against its shared
 * schema, stored in SQLite, which assigns the install-wide `seq`, and then
 * delivered to live subscribers.
 *
 * `better-sqlite3` is synchronous, so appending and notifying happen in one
 * tick, and so do reading a subscriber's backlog and registering it. That is
 * what makes "subscribe after seq N" gap-free and duplicate-free without locks.
 *
 * Session events (`session.*`, and `permission.*`, which live on the
 * session's stream) are refused here: they go only through the
 * session-event helper (`session-events.ts`), which looks the session up and
 * stamps its `workspaceId`, so no event can name a session in another
 * workspace (E2-R7). The helper reaches the raw append through
 * {@link sessionAppender}, which the package index does not export.
 */
import {
  MAX_PAGE_EVENTS,
  NewCoreEvent as NewCoreEventSchema,
  type CoreEvent,
  type NewCoreEvent,
  type NewEventOf,
  type SessionMessageCompletedEvent,
  type WorkspaceHistoryDeletedEvent,
  type SessionId,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, max, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { events, orchestrationRuns, orchestrationSteps, runs, sessions, workspaces } from './db/schema.js';
import { EventValidationError, NotFoundError, SessionEventScopeError } from './errors.js';
import { newId } from './ids.js';

export type EventListener = (event: CoreEvent) => void;

export interface ReadOptions {
  /** Only this workspace's events; `null` for install-level events only. Default: every event. */
  workspaceId?: WorkspaceId | null;
  /** At most this many events. Default {@link DEFAULT_READ_LIMIT}. */
  limit?: number;
}

/**
 * What a scoped subscription streams (E2-R8): `'install'` is every
 * install-level event (`workspaceId: null`) plus every `workspace.created`,
 * so a project added in another tab is seen; a workspace id is that
 * workspace's other events (each event reaches a tab following both once).
 */
export type EventScope = 'install' | WorkspaceId;

/**
 * Where a scoped subscription starts: after a `seq` (a reconnect, or the
 * install stream), or with only the most recent `window` events.
 */
export type ScopeStart = { afterSeq: number } | { window: number };

export interface ScopeSubscription {
  unsubscribe(): void;
  /** The oldest `seq` the backlog delivered, or `null` when it delivered none. */
  oldestSeq: number | null;
  /** Whether the scope has events older than the backlog (the UI offers "Show earlier"). */
  hasEarlier: boolean;
}

export interface HistoryPage {
  /** Oldest first. */
  events: CoreEvent[];
  /** Whether still older events exist. */
  hasMore: boolean;
}

export interface HistoryDeleted {
  /** The `workspace.history_deleted` event appended after the deletion. */
  event: WorkspaceHistoryDeletedEvent;
  deletedEvents: number;
  deletedSessions: number;
  deletedRuns: number;
}

export interface EventLog {
  /**
   * Validates and appends one event, then notifies subscribers (after commit,
   * when called inside {@link EventLog.transaction}). Throws
   * {@link EventValidationError}, writing nothing, if the event fails its schema,
   * and {@link SessionEventScopeError} for any `session.*` or `permission.*`
   * event: those go through the session-event helper (`appendSessionEvent`).
   */
  append<E extends NewCoreEvent>(event: E): Extract<CoreEvent, { type: E['type'] }>;
  /** Events with `seq > afterSeq`, in `seq` order. */
  readAfter(afterSeq: number, options?: ReadOptions): CoreEvent[];
  /**
   * Delivers every stored event with `seq > afterSeq`, in order and
   * synchronously, then every new event live. No event is delivered twice or
   * skipped. Returns an unsubscribe function.
   */
  subscribe(afterSeq: number, listener: EventListener): () => void;
  /**
   * {@link EventLog.subscribe} for one scope (E2-R8): the backlog (every
   * scope event after `afterSeq`, or the newest `window` of them, oldest
   * first), then the scope's new events live, read and registered in one
   * synchronous tick. Throws {@link NotFoundError} for an unknown workspace.
   */
  subscribeScope(scope: EventScope, from: ScopeStart, listener: EventListener): ScopeSubscription;
  /**
   * How many of the scope's events have `seq > afterSeq`, counting at most
   * `cap` (story 2.10): whether a reconnect missed too many to replay, read
   * from `events_workspace_seq_idx` and bounded, however large the gap.
   */
  countAfter(scope: EventScope, afterSeq: number, cap: number): number;
  /**
   * Up to `limit` (at most `MAX_PAGE_EVENTS`) of the workspace's events with
   * `seq < beforeSeq`, oldest first; with `sessionId`, only that session's
   * stream in this workspace (another workspace's session gives an empty
   * page). Throws {@link NotFoundError} for an unknown workspace.
   */
  readBefore(workspaceId: WorkspaceId, beforeSeq: number, limit: number, sessionId?: SessionId): HistoryPage;
  /**
   * Deletes one workspace's events, sessions and runs, keeps the workspace
   * row, and appends `workspace.history_deleted`.
   */
  deleteWorkspaceHistory(workspaceId: WorkspaceId): HistoryDeleted;
  /**
   * Runs `fn` in one database transaction. Events appended inside it are
   * delivered only after it commits, and not at all if it throws.
   */
  transaction<T>(fn: () => T): T;
  /** The highest `seq` ever assigned, or `0` for an empty log. */
  lastSeq(): number;
}

export interface EventLogOptions {
  /** Called when a subscriber throws; the error never reaches the appender. Default: `console.error`. */
  onListenerError?: (error: unknown) => void;
}

/**
 * The raw appends the session-event helper uses once it has checked an
 * event's scope. Internal to core: not exported from the package index.
 */
export interface SessionAppender {
  append(event: NewCoreEvent): CoreEvent;
  /**
   * Appends `session.message_completed` with the full content, then prunes
   * that message's `session.message_delta` events (AD-5), atomically.
   */
  completeMessage(event: NewEventOf<'session.message_completed'>): SessionMessageCompletedEvent;
}

const appenders = new WeakMap<EventLog, SessionAppender>();

/** The raw session appends of `log`, for the session-event helper only. */
export function sessionAppender(log: EventLog): SessionAppender {
  const appender = appenders.get(log);
  if (appender === undefined) throw new Error('not an event log created by createEventLog');
  return appender;
}

/**
 * Whether `type` is a session-scoped event (`session.*` or `permission.*`),
 * which only the session-event helper appends (E2-R7).
 */
export const isSessionEventType = (type: unknown): boolean =>
  typeof type === 'string' && (type.startsWith('session.') || type.startsWith('permission.'));

export const DEFAULT_READ_LIMIT = 500;
/** Backlog page size for {@link EventLog.subscribe}. */
const SUBSCRIBE_PAGE = 500;

function assertCursor(afterSeq: number): void {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new RangeError(`afterSeq must be a non-negative integer, got ${String(afterSeq)}`);
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_EVENTS) {
    throw new RangeError(`${name} must be an integer from 1 to ${MAX_PAGE_EVENTS}, got ${String(value)}`);
  }
}

type EventRow = typeof events.$inferSelect;

function toEvent(row: EventRow): CoreEvent {
  // Rows were validated on the way in; the stored JSON is the payload as parsed.
  return {
    id: row.id,
    seq: row.seq,
    workspaceId: row.workspaceId,
    streamId: row.streamId,
    type: row.type,
    at: row.at,
    payload: row.payload,
  } as CoreEvent;
}

interface Subscriber {
  deliver(event: CoreEvent): void;
}

export function createEventLog(db: Database, options: EventLogOptions = {}): EventLog {
  const { orm, sqlite } = db;
  const onListenerError = options.onListenerError ?? ((error: unknown) => console.error(error));
  const subscribers = new Set<Subscriber>();
  /** Events appended inside the current outermost transaction, delivered on commit. */
  let pending: CoreEvent[] | undefined;

  const publish = (event: CoreEvent) => {
    for (const subscriber of [...subscribers]) subscriber.deliver(event);
  };

  const transaction = <T>(fn: () => T): T => {
    if (pending !== undefined) {
      // Nested: a savepoint. Forget its events if it rolls back.
      const mark = pending.length;
      try {
        return sqlite.transaction(fn)();
      } catch (error) {
        pending.length = mark;
        throw error;
      }
    }
    pending = [];
    let committed: CoreEvent[];
    let result: T;
    try {
      result = sqlite.transaction(fn)();
      committed = pending;
    } finally {
      pending = undefined;
    }
    for (const event of committed) publish(event);
    return result;
  };

  const append = (input: NewCoreEvent): CoreEvent => {
    const parsed = NewCoreEventSchema.safeParse(input);
    if (!parsed.success) {
      throw new EventValidationError(
        `event ${JSON.stringify((input as { type?: unknown } | null)?.type ?? null)} fails its schema`,
        parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      );
    }
    const data = parsed.data;
    const id = newId('evt');
    const at = new Date().toISOString();
    const row = orm
      .insert(events)
      .values({ id, workspaceId: data.workspaceId, streamId: data.streamId, type: data.type, at, payload: data.payload })
      .returning({ seq: events.seq })
      .get();
    const event = {
      id,
      seq: row.seq,
      workspaceId: data.workspaceId,
      streamId: data.streamId,
      type: data.type,
      at,
      payload: data.payload,
    } as CoreEvent;
    if (pending !== undefined) pending.push(event);
    else publish(event);
    return event;
  };

  const readWhere = (afterSeq: number, scope: SQL | undefined, limit: number) =>
    orm
      .select()
      .from(events)
      .where(and(gt(events.seq, afterSeq), scope))
      .orderBy(asc(events.seq))
      .limit(limit)
      .all()
      .map(toEvent);

  const readAfter = (afterSeq: number, { workspaceId, limit = DEFAULT_READ_LIMIT }: ReadOptions = {}) => {
    assertCursor(afterSeq);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive integer, got ${limit}`);
    const scope =
      workspaceId === undefined
        ? undefined
        : workspaceId === null
          ? isNull(events.workspaceId)
          : eq(events.workspaceId, workspaceId);
    return readWhere(afterSeq, scope, limit);
  };

  const assertWorkspace = (workspaceId: WorkspaceId) => {
    const exists = orm.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (exists === undefined) throw new NotFoundError('workspace', workspaceId);
  };

  /** The SQL filter and the live match of a scope. */
  const scopeFilter = (scope: EventScope): { where: SQL; matches: (event: CoreEvent) => boolean } =>
    scope === 'install'
      ? {
          where: or(isNull(events.workspaceId), eq(events.type, 'workspace.created'))!,
          matches: (event) => event.workspaceId === null || event.type === 'workspace.created',
        }
      : {
          // Its `workspace.created` comes with the install scope, so a tab following both gets it once.
          where: and(eq(events.workspaceId, scope), ne(events.type, 'workspace.created'))!,
          matches: (event) => event.workspaceId === scope && event.type !== 'workspace.created',
        };

  /** Whether any event matching `where` has `seq < beforeSeq`. */
  const anyBefore = (where: SQL, beforeSeq: number) =>
    orm
      .select({ seq: events.seq })
      .from(events)
      .where(and(where, lt(events.seq, beforeSeq)))
      .limit(1)
      .get() !== undefined;

  /**
   * Registers `subscriber` for live events after delivering the backlog
   * after `cursor()`, in one synchronous tick. Reads until a read comes back
   * empty, so an event the listener itself appends while it handles the
   * backlog is still delivered.
   */
  const drainAndRegister = (subscriber: Subscriber, cursor: () => number, active: () => boolean, where: SQL | undefined) => {
    for (;;) {
      const page = readWhere(cursor(), where, SUBSCRIBE_PAGE);
      if (page.length === 0 || !active()) break;
      for (const event of page) subscriber.deliver(event);
    }
    subscribers.add(subscriber);
  };

  const completeMessage = (input: NewEventOf<'session.message_completed'>): SessionMessageCompletedEvent =>
    transaction(() => {
      const completed = append(input) as SessionMessageCompletedEvent;
      orm
        .delete(events)
        .where(
          and(
            eq(events.streamId, completed.streamId),
            eq(events.type, 'session.message_delta'),
            sql`json_extract(${events.payload}, '$.messageId') = ${completed.payload.messageId}`,
            lt(events.seq, completed.seq),
          ),
        )
        .run();
      return completed;
    });

  /** The public append: every event but a session event (E2-R7). */
  const guardedAppend = (input: NewCoreEvent): CoreEvent => {
    const type = (input as { type?: unknown } | null)?.type;
    if (isSessionEventType(type)) {
      throw new SessionEventScopeError(
        `${String(type)} must be appended through appendSessionEvent, which stamps the session's workspace`,
      );
    }
    return append(input);
  };

  const log: EventLog = {
    append: guardedAppend as EventLog['append'],
    readAfter,
    transaction,

    subscribe(afterSeq, listener) {
      assertCursor(afterSeq);
      let cursor = afterSeq;
      let active = true;
      const subscriber: Subscriber = {
        deliver(event) {
          if (!active || event.seq <= cursor) return;
          cursor = event.seq;
          try {
            listener(event);
          } catch (error) {
            onListenerError(error);
          }
        },
      };
      // Backlog, then live, in one synchronous tick.
      drainAndRegister(subscriber, () => cursor, () => active, undefined);
      return () => {
        active = false;
        subscribers.delete(subscriber);
      };
    },

    subscribeScope(scope, from, listener) {
      if ('afterSeq' in from) assertCursor(from.afterSeq);
      else assertCount('window', from.window);
      if (scope !== 'install') assertWorkspace(scope);
      const { where, matches } = scopeFilter(scope);
      let active = true;
      let oldestSeq: number | null = null;
      let cursor: number;
      const subscriber: Subscriber = {
        deliver(event) {
          if (!active || event.seq <= cursor || !matches(event)) return;
          cursor = event.seq;
          oldestSeq ??= event.seq;
          try {
            listener(event);
          } catch (error) {
            onListenerError(error);
          }
        },
      };
      let hasEarlierBefore: number;
      if ('afterSeq' in from) {
        cursor = from.afterSeq;
        hasEarlierBefore = from.afterSeq + 1;
      } else {
        // The newest `window` events, read newest first and delivered oldest
        // first. Everything up to the log's end is then behind the cursor.
        const end = log.lastSeq();
        const window = orm
          .select()
          .from(events)
          .where(and(where, lte(events.seq, end)))
          .orderBy(desc(events.seq))
          .limit(from.window)
          .all()
          .map(toEvent)
          .reverse();
        cursor = 0;
        for (const event of window) subscriber.deliver(event);
        cursor = Math.max(cursor, end);
        hasEarlierBefore = window[0]?.seq ?? 0;
      }
      // Then anything newer (or appended by the listener), then live, in the same tick.
      drainAndRegister(subscriber, () => cursor, () => active, where);
      const hasEarlier = anyBefore(where, oldestSeq ?? hasEarlierBefore);
      return {
        oldestSeq,
        hasEarlier,
        unsubscribe() {
          active = false;
          subscribers.delete(subscriber);
        },
      };
    },

    countAfter(scope, afterSeq, cap) {
      assertCursor(afterSeq);
      if (!Number.isSafeInteger(cap) || cap < 1) throw new RangeError(`cap must be a positive integer, got ${String(cap)}`);
      // Reads at most `cap` seqs: the work stays bounded, however many events were missed.
      return orm
        .select({ seq: events.seq })
        .from(events)
        .where(and(scopeFilter(scope).where, gt(events.seq, afterSeq)))
        .limit(cap)
        .all().length;
    },

    readBefore(workspaceId, beforeSeq, limit, sessionId) {
      if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1) {
        throw new RangeError(`beforeSeq must be a positive integer, got ${String(beforeSeq)}`);
      }
      assertCount('limit', limit);
      assertWorkspace(workspaceId);
      const rows = orm
        .select()
        .from(events)
        .where(
          and(
            eq(events.workspaceId, workspaceId),
            sessionId === undefined ? undefined : eq(events.streamId, sessionId),
            lt(events.seq, beforeSeq),
          ),
        )
        .orderBy(desc(events.seq))
        .limit(limit + 1)
        .all();
      const hasMore = rows.length > limit;
      return { events: rows.slice(0, limit).map(toEvent).reverse(), hasMore };
    },

    deleteWorkspaceHistory(workspaceId) {
      return transaction(() => {
        assertWorkspace(workspaceId);
        const deletedEvents = orm.delete(events).where(eq(events.workspaceId, workspaceId)).run().changes;
        const deletedRuns = orm.delete(runs).where(eq(runs.workspaceId, workspaceId)).run().changes;
        // Orchestration runs (epic 15) go with the history they point into: their chats and events are gone.
        orm.delete(orchestrationSteps).where(inArray(orchestrationSteps.runId, orm.select({ id: orchestrationRuns.id }).from(orchestrationRuns).where(eq(orchestrationRuns.workspaceId, workspaceId)))).run();
        orm.delete(orchestrationRuns).where(eq(orchestrationRuns.workspaceId, workspaceId)).run();
        const deletedSessions = orm.delete(sessions).where(eq(sessions.workspaceId, workspaceId)).run().changes;
        const event = append({
          type: 'workspace.history_deleted',
          workspaceId,
          streamId: workspaceId,
          payload: { deletedEvents, deletedSessions, deletedRuns },
        }) as WorkspaceHistoryDeletedEvent;
        return { event, deletedEvents, deletedSessions, deletedRuns };
      });
    },

    lastSeq() {
      // AUTOINCREMENT keeps the highest seq ever used in sqlite_sequence, even
      // after the newest rows are deleted; fall back to the table for safety.
      const recorded = sqlite
        .prepare<[], { seq: number }>("SELECT seq FROM sqlite_sequence WHERE name = 'events'")
        .get();
      const stored = orm.select({ seq: max(events.seq) }).from(events).get()?.seq ?? 0;
      return Math.max(recorded?.seq ?? 0, stored);
    },
  };
  appenders.set(log, { append, completeMessage });
  return log;
}

