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
 */
import {
  NewCoreEvent as NewCoreEventSchema,
  type CoreEvent,
  type NewCoreEvent,
  type NewEventOf,
  type SessionMessageCompletedEvent,
  type WorkspaceHistoryDeletedEvent,
  type WorkspaceId,
} from '@ogdenmad/shared';
import { and, asc, eq, gt, isNull, lt, max, sql } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { events, runs, sessions, workspaces } from './db/schema.js';
import { EventValidationError, NotFoundError } from './errors.js';
import { newId } from './ids.js';

export type EventListener = (event: CoreEvent) => void;

export interface ReadOptions {
  /** Only this workspace's events; `null` for install-level events only. Default: every event. */
  workspaceId?: WorkspaceId | null;
  /** At most this many events. Default {@link DEFAULT_READ_LIMIT}. */
  limit?: number;
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
   * {@link EventValidationError}, writing nothing, if the event fails its schema.
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
   * Appends `session.message_completed` with the full content, then prunes
   * that message's `session.message_delta` events (AD-5), atomically.
   */
  completeMessage(event: NewEventOf<'session.message_completed'>): SessionMessageCompletedEvent;
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

export const DEFAULT_READ_LIMIT = 500;
/** Backlog page size for {@link EventLog.subscribe}. */
const SUBSCRIBE_PAGE = 500;

function assertCursor(afterSeq: number): void {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new RangeError(`afterSeq must be a non-negative integer, got ${String(afterSeq)}`);
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

  const readAfter = (afterSeq: number, { workspaceId, limit = DEFAULT_READ_LIMIT }: ReadOptions = {}) => {
    assertCursor(afterSeq);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive integer, got ${limit}`);
    const scope =
      workspaceId === undefined
        ? undefined
        : workspaceId === null
          ? isNull(events.workspaceId)
          : eq(events.workspaceId, workspaceId);
    return orm
      .select()
      .from(events)
      .where(and(gt(events.seq, afterSeq), scope))
      .orderBy(asc(events.seq))
      .limit(limit)
      .all()
      .map(toEvent);
  };

  return {
    append: append as EventLog['append'],
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
      // Backlog, then live, in one synchronous tick. Keep reading until a read
      // comes back empty, so an event appended by the listener itself while it
      // handles the backlog is still delivered.
      for (;;) {
        const page = readAfter(cursor, { limit: SUBSCRIBE_PAGE });
        if (page.length === 0 || !active) break;
        for (const event of page) subscriber.deliver(event);
      }
      subscribers.add(subscriber);
      return () => {
        active = false;
        subscribers.delete(subscriber);
      };
    },

    completeMessage(input) {
      return transaction(() => {
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
    },

    deleteWorkspaceHistory(workspaceId) {
      return transaction(() => {
        const exists = orm.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
        if (exists === undefined) throw new NotFoundError('workspace', workspaceId);
        const deletedEvents = orm.delete(events).where(eq(events.workspaceId, workspaceId)).run().changes;
        const deletedRuns = orm.delete(runs).where(eq(runs.workspaceId, workspaceId)).run().changes;
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
}

