/**
 * The session-event helper (E2-R7, carried from story 1.3's review): the only
 * way a `session.*` or `permission.*` event is appended. It takes a session id, looks the
 * session up and stamps its `workspaceId` and stream, so no event can name a
 * session in another workspace, and deleting a workspace's history removes
 * every one of its session events.
 *
 * An event that already names a workspace, stream or session other than its
 * session's is refused with {@link SessionEventScopeError}; nothing is stored.
 */
import { autoChatName, type CoreEvent, type CoreEventType, type NewEventOf, type SessionId, type SessionMessageCompletedEvent } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { sessions } from './db/schema.js';
import { NotFoundError, SessionEventScopeError } from './errors.js';
import { isSessionEventType, sessionAppender, type EventLog } from './event-log.js';

/**
 * Every session-scoped event type (`session.created`, `session.message_delta`,
 * …, and `permission.requested` and `permission.resolved`, which live on the
 * session's stream).
 */
export type SessionEventType = Extract<CoreEventType, `session.${string}` | `permission.${string}`>;

/**
 * A session event as a caller writes it: its type and payload. `workspaceId`
 * and `streamId` are filled in from the session; if given, they must match it.
 */
export type SessionEventDraft = {
  [T in SessionEventType]: Omit<NewEventOf<T>, 'workspaceId' | 'streamId'> & {
    workspaceId?: string | null;
    streamId?: string;
  };
}[SessionEventType];

export type SessionEventOf<T extends SessionEventType> = Extract<CoreEvent, { type: T }>;

export interface SessionEvents {
  /**
   * Appends one session event for `sessionId`, stamped with the session's
   * workspace and stream. Throws {@link NotFoundError} for an unknown session
   * and {@link SessionEventScopeError} for an event naming another workspace,
   * stream or session; nothing is written either way.
   */
  appendSessionEvent<E extends SessionEventDraft>(sessionId: SessionId, event: E): SessionEventOf<E['type']>;
  /**
   * Appends `session.message_completed` for `sessionId` with the full
   * content, then prunes that message's deltas (AD-5), atomically.
   */
  completeMessage(
    sessionId: SessionId,
    payload: NewEventOf<'session.message_completed'>['payload'],
  ): SessionMessageCompletedEvent;
  /**
   * Gives the chat its automatic name from `text` (backlog story 2), only
   * when it has none yet, appending `session.renamed` (cause `auto`).
   * Whether it named the chat. {@link completeMessage} calls it for every
   * user message that isn't a Deny reason, so the first one names the chat
   * whoever sent it (the composer, a planning action, the terminal).
   */
  nameChat(sessionId: SessionId, text: string): boolean;
}

export function createSessionEvents(db: Database, log: EventLog): SessionEvents {
  const raw = sessionAppender(log);

  const lookUp = (sessionId: SessionId) => {
    const row = db.orm
      .select({ id: sessions.id, workspaceId: sessions.workspaceId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    if (row === undefined) throw new NotFoundError('session', sessionId);
    return row;
  };

  /** The event with its session's scope stamped in, or a refusal if it names another. */
  const scoped = (sessionId: SessionId, event: SessionEventDraft) => {
    const type = (event as { type?: unknown }).type;
    if (typeof type !== 'string' || !isSessionEventType(type)) {
      throw new SessionEventScopeError(`${String(type)} is not a session event`);
    }
    const session = lookUp(sessionId);
    if (event.workspaceId !== undefined && event.workspaceId !== session.workspaceId) {
      throw new SessionEventScopeError(
        `${type} names workspace ${String(event.workspaceId)}, but session ${session.id} belongs to ${session.workspaceId}`,
      );
    }
    if (event.streamId !== undefined && event.streamId !== session.id) {
      throw new SessionEventScopeError(`${type} names stream ${event.streamId}, but belongs to session ${session.id}`);
    }
    const named = (event.payload as { sessionId?: unknown } | undefined)?.sessionId;
    if (named !== undefined && named !== session.id) {
      throw new SessionEventScopeError(`${type} names session ${String(named)} in its payload, but was appended for ${session.id}`);
    }
    if (event.type === 'session.created') {
      const created = (event.payload as { session?: { id?: unknown; workspaceId?: unknown } } | undefined)?.session;
      if (created?.id !== session.id || created.workspaceId !== session.workspaceId) {
        throw new SessionEventScopeError(
          `session.created carries session ${String(created?.id)} in workspace ${String(created?.workspaceId)}, but was appended for ${session.id} in ${session.workspaceId}`,
        );
      }
    }
    return { ...event, workspaceId: session.workspaceId, streamId: session.id };
  };

  const nameChat = (sessionId: SessionId, text: string): boolean =>
    log.transaction(() => {
      const row = db.orm.select({ title: sessions.title, autoTitle: sessions.autoTitle }).from(sessions).where(eq(sessions.id, sessionId)).get();
      if (row === undefined) throw new NotFoundError('session', sessionId);
      if (row.autoTitle !== null) return false;
      const autoTitle = autoChatName(text);
      if (autoTitle === null) return false;
      // `updatedAt` is left alone: a name never moves a chat in the sidebar.
      db.orm.update(sessions).set({ autoTitle }).where(eq(sessions.id, sessionId)).run();
      raw.append(scoped(sessionId, { type: 'session.renamed', payload: { sessionId, title: row.title, autoTitle, cause: 'auto' } }) as never);
      return true;
    });

  return {
    appendSessionEvent(sessionId, event) {
      return log.transaction(() => raw.append(scoped(sessionId, event) as never)) as never;
    },

    completeMessage(sessionId, payload) {
      return log.transaction(() => {
        const event = scoped(sessionId, { type: 'session.message_completed', payload });
        const completed = raw.completeMessage(event as NewEventOf<'session.message_completed'>);
        // The first user message names the chat; a Deny reason is not what the chat is about.
        if (payload.role === 'user' && payload.origin !== 'deny_reason') nameChat(sessionId, payload.content);
        return completed;
      });
    },

    nameChat,
  };
}
