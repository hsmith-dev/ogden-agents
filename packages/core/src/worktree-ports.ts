/**
 * A worktree chat's own port (27.7; CAP-35, AD-38): one stable port from
 * `WORKTREE_PORT_RANGE` per worktree chat, held while its copy exists.
 *
 * Every assign and release runs on one chain, so two chats are never given
 * the same port (the partial unique index on held ports backs it). A port
 * is given only after the probe says it is free on this computer; the
 * lowest free one first, so a released port is reused. A released row is
 * kept, unheld, as the chat's remembered port: Restore gives it back when
 * no other chat holds it and it is still free, else the lowest other free
 * one. Each write goes in one transaction with its event
 * (`session.port_assigned`, `session.port_released`), which carry the
 * session id and the port only. The row is gone with its session.
 */
import { WORKTREE_PORT_RANGE, type SessionId } from '@ogden-agents/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { chatWorktreePorts } from './db/schema.js';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';
import type { SessionEvents } from './session-events.js';
import type { PortProbePort, WorktreePorts } from './where-work-runs.js';

export interface WorktreePortsDeps {
  db: Database;
  events: Pick<EventLog, 'transaction'>;
  sessionEvents: Pick<SessionEvents, 'appendSessionEvent'>;
  entities: Pick<Entities, 'getSession'>;
  probe: PortProbePort;
  /** Whether the chat's copy is put away now (27.6): it is given no port until Restore. */
  putAway?: ((sessionId: SessionId) => boolean) | undefined;
  /** The ports given from. Default {@link WORKTREE_PORT_RANGE}. */
  range?: { first: number; last: number } | undefined;
  now?: () => string;
}

export function createWorktreePorts({ db, events, sessionEvents, entities, probe, putAway, range = WORKTREE_PORT_RANGE, now = () => new Date().toISOString() }: WorktreePortsDeps): WorktreePorts {
  const { orm } = db;
  const rowOf = (sessionId: SessionId) => orm.select().from(chatWorktreePorts).where(eq(chatWorktreePorts.sessionId, sessionId)).get();
  /** The ports other chats hold now. */
  const heldByOthers = (sessionId: SessionId): Set<number> =>
    new Set(
      orm
        .select({ port: chatWorktreePorts.port })
        .from(chatWorktreePorts)
        .where(and(eq(chatWorktreePorts.held, 1), ne(chatWorktreePorts.sessionId, sessionId)))
        .all()
        .map((row) => row.port),
    );
  /** A local chat in its own copy, present (not put away). */
  const eligible = (sessionId: SessionId): boolean => {
    const session = entities.getSession(sessionId);
    return session !== undefined && session.kind === 'chat' && session.machineId === null && session.worktreePath !== null && putAway?.(sessionId) !== true;
  };
  /** Whether the probe says the port is free; a probe that throws says no. */
  const free = async (port: number): Promise<boolean> => {
    try {
      return (await probe.isFree(port)) === true;
    } catch {
      return false;
    }
  };

  /** One chain for every assign and release. */
  let chain: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  const assignNow = async (sessionId: SessionId): Promise<number | null> => {
    if (!eligible(sessionId)) return null;
    const row = rowOf(sessionId);
    if (row !== undefined && row.held === 1) return row.port;
    const taken = heldByOthers(sessionId);
    let port: number | undefined;
    // Its remembered port first (Restore, a hand-off back), when no other chat holds it and it is still free.
    if (row !== undefined && row.port >= range.first && row.port <= range.last && !taken.has(row.port) && (await free(row.port))) port = row.port;
    for (let candidate = range.first; port === undefined && candidate <= range.last; candidate++) {
      if (taken.has(candidate)) continue;
      if (await free(candidate)) port = candidate;
    }
    if (port === undefined) return null;
    const given = port;
    return events.transaction(() => {
      // The chat may have gone or moved while the ports were probed.
      if (!eligible(sessionId)) return null;
      orm
        .insert(chatWorktreePorts)
        .values({ sessionId, port: given, held: 1, assignedAt: now() })
        .onConflictDoUpdate({ target: chatWorktreePorts.sessionId, set: { port: given, held: 1, assignedAt: now() } })
        .run();
      sessionEvents.appendSessionEvent(sessionId, { type: 'session.port_assigned', payload: { sessionId, port: given } });
      return given;
    });
  };

  const releaseNow = async (sessionId: SessionId): Promise<void> => {
    events.transaction(() => {
      const row = rowOf(sessionId);
      if (row === undefined || row.held !== 1) return;
      orm.update(chatWorktreePorts).set({ held: 0 }).where(eq(chatWorktreePorts.sessionId, sessionId)).run();
      // A session already gone has no stream to append to: its row went with it.
      if (entities.getSession(sessionId) === undefined) return;
      sessionEvents.appendSessionEvent(sessionId, { type: 'session.port_released', payload: { sessionId, port: row.port } });
    });
  };

  return {
    assign: (sessionId) => serialized(() => assignNow(sessionId)),
    release: (sessionId) => serialized(() => releaseNow(sessionId)),
    portOf(sessionId) {
      const row = rowOf(sessionId);
      return row !== undefined && row.held === 1 ? row.port : null;
    },
  };
}
