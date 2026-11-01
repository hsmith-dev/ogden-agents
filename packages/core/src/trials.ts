/**
 * One task tried by several agents (epic 27, 27.8; CAP-35, AD-37,
 * EXPERIENCE.md Try with several agents). A trial is one local worktree
 * chat per agent, each sent the same task; Keep this one keeps one chat as
 * a normal worktree chat and puts the others' copies away (`not_kept`,
 * restorable) or deletes them (27.3's Delete chat). Nothing is merged,
 * pushed or changed in the kept chat.
 *
 * Decisions (2026-11-01): only agents a local chat can start now are taken
 * (no `unavailable`, project trust included), and a trial never takes a
 * machine; its copies count toward the install's cap like any worktree
 * chat, but the sweep never puts one away before Keep ({@link TrialStore.spared}),
 * so older idle copies go instead.
 *
 * The order of a start: every agent checked, then one chat after another
 * (a failure removes the ones made, nothing written), then the trial row
 * with `workspace.trial_started`, then each chat is sent the task. The
 * order of a Keep (story 27.8 design notes): validate; refuse mid-turn and,
 * deleting, uncommitted changes in any other chat not named in `discard`,
 * before anything goes; then each other one goes, a refusal leaving
 * it `left`; then the kept row, the results and `workspace.trial_kept` in
 * one transaction. A repeat after a crash skips chats already put away or
 * gone. Rows hold the task; events carry ids only.
 */
import {
  CreateTrialRequest,
  KeepTrialRequest,
  SessionId,
  TRIAL_ALREADY_KEPT_TEXT,
  TRIAL_MID_TURN_MESSAGE,
  TRIAL_NOT_ITS_CHAT_TEXT,
  TRIAL_UNCOMMITTED_MESSAGE,
  TrialChatResult,
  TrialId,
  trialUnknownAgentText,
  trialUnreadyText,
  WorkspaceId,
  type AgentId,
  type Session,
  type Trial,
  type TrialChat,
} from '@ogden-agents/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Chat } from './chat/types.js';
import type { Database } from './db/database.js';
import { sessions, trialChats, trials } from './db/schema.js';
import { AgentMidTurnError, InvalidOperationError, NotFoundError, UncommittedChangesError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { Trials } from './where-work-runs.js';

export interface TrialStore {
  get(trialId: TrialId): Trial | undefined;
  /** The project's trials, newest first. */
  listByWorkspace(workspaceId: WorkspaceId): Trial[];
  /** Writes the trial and its chats with `workspace.trial_started` in one transaction. */
  insert(input: { workspaceId: WorkspaceId; text: string; chats: ReadonlyArray<{ sessionId: SessionId; agentId: AgentId }> }): Trial;
  /** Marks `sessionId` kept and each other chat's result with `workspace.trial_kept`, in one transaction; `InvalidOperationError` once kept. */
  keep(trialId: TrialId, sessionId: SessionId, results: ReadonlyMap<SessionId, Exclude<TrialChatResult, 'open' | 'kept'>>): Trial;
  /** Whether retention spares the chat: one of a trial not kept yet, or one made in a project while a trial starts there ({@link holdStarting}). */
  spared(sessionId: SessionId): boolean;
  /**
   * Spares every chat of `workspaceId` made from now on (any chat it doesn't hold yet), until the
   * returned release (once the trial row is written, which spares its chats
   * from then, or the start failed): a copy is spared from before
   * `createChatSession` returns, its own port and setup included.
   */
  holdStarting(workspaceId: WorkspaceId): () => void;
}

const OTHER_RESULTS = ['put_away', 'removed', 'left'] as const;

export function createTrialStore({ db, events, now = () => new Date().toISOString() }: { db: Database; events: EventLog; now?: () => string }): TrialStore {
  const { orm } = db;
  /** The starts in progress: each one's project and the chats it had when the start began. */
  const starting = new Set<{ workspaceId: WorkspaceId; before: ReadonlySet<string> }>();

  const chatsOf = (trialId: string): TrialChat[] =>
    orm
      .select()
      .from(trialChats)
      .where(eq(trialChats.trialId, trialId))
      .orderBy(asc(trialChats.position))
      .all()
      .map((row) => ({ sessionId: row.sessionId as SessionId, agentId: row.agentId, result: TrialChatResult.catch('open').parse(row.result) }));

  const trialOf = (row: typeof trials.$inferSelect): Trial => {
    const chats = chatsOf(row.id);
    return {
      id: row.id as TrialId,
      workspaceId: row.workspaceId as WorkspaceId,
      text: row.text,
      sessionIds: chats.map((chat) => chat.sessionId),
      chats,
      keptSessionId: row.keptSessionId === null ? null : (row.keptSessionId as SessionId),
      createdAt: row.createdAt,
    };
  };

  const get = (trialId: TrialId): Trial | undefined => {
    const row = orm.select().from(trials).where(eq(trials.id, trialId)).get();
    return row === undefined ? undefined : trialOf(row);
  };

  return {
    get,

    listByWorkspace: (workspaceId) => orm.select().from(trials).where(eq(trials.workspaceId, workspaceId)).orderBy(desc(trials.createdAt), desc(trials.id)).all().map(trialOf),

    insert({ workspaceId, text, chats }) {
      return events.transaction(() => {
        const id = newId('try');
        orm.insert(trials).values({ id, workspaceId, text, keptSessionId: null, createdAt: now() }).run();
        chats.forEach((chat, position) => orm.insert(trialChats).values({ trialId: id, position, sessionId: chat.sessionId, agentId: chat.agentId, result: 'open' }).run());
        events.append({ type: 'workspace.trial_started', workspaceId, streamId: workspaceId, payload: { trialId: id, sessionIds: chats.map((chat) => chat.sessionId) } });
        return get(id)!;
      });
    },

    keep(trialId, sessionId, results) {
      return events.transaction(() => {
        const trial = get(trialId);
        if (trial === undefined) throw new NotFoundError('trial', 'requested');
        if (trial.keptSessionId !== null) throw new InvalidOperationError(TRIAL_ALREADY_KEPT_TEXT);
        orm.update(trials).set({ keptSessionId: sessionId }).where(eq(trials.id, trialId)).run();
        orm.update(trialChats).set({ result: 'kept' }).where(and(eq(trialChats.trialId, trialId), eq(trialChats.sessionId, sessionId))).run();
        const by: Record<(typeof OTHER_RESULTS)[number], SessionId[]> = { put_away: [], removed: [], left: [] };
        for (const [other, result] of results) {
          if (other === sessionId) continue;
          orm.update(trialChats).set({ result }).where(and(eq(trialChats.trialId, trialId), eq(trialChats.sessionId, other))).run();
          by[result].push(other);
        }
        events.append({
          type: 'workspace.trial_kept',
          workspaceId: trial.workspaceId,
          streamId: trial.workspaceId,
          payload: { trialId, sessionId, putAway: by.put_away, removed: by.removed, left: by.left },
        });
        return get(trialId)!;
      });
    },

    spared(sessionId) {
      if (starting.size > 0) {
        const session = orm.select({ workspaceId: sessions.workspaceId }).from(sessions).where(eq(sessions.id, sessionId)).get();
        if (session !== undefined && [...starting].some((hold) => hold.workspaceId === session.workspaceId && !hold.before.has(sessionId))) return true;
      }
      const open = orm
        .select({ trialId: trialChats.trialId })
        .from(trialChats)
        .where(and(eq(trialChats.sessionId, sessionId), inArray(trialChats.trialId, orm.select({ id: trials.id }).from(trials).where(isNull(trials.keptSessionId)))))
        .limit(1)
        .get();
      return open !== undefined;
    },

    holdStarting(workspaceId) {
      const before = new Set(orm.select({ id: sessions.id }).from(sessions).where(eq(sessions.workspaceId, workspaceId)).all().map((row) => row.id));
      const hold = { workspaceId, before };
      starting.add(hold);
      return () => void starting.delete(hold);
    },
  };
}

export interface TrialsOptions {
  store: TrialStore;
  chat: Pick<Chat, 'getWorkspace' | 'getSession' | 'listSessions' | 'chatAgents' | 'createChatSession' | 'sendMessage' | 'deleteChat' | 'putAwayWorktree' | 'worktreeIdle' | 'copyHasUncommitted'>;
  /** Whether the chat's copy is put away now (27.6's store): a repeat Keep skips it. */
  isPutAway: (sessionId: SessionId) => boolean;
  /** Told of a chat the task couldn't be sent to, or one a failed start couldn't remove: ids and an error only, for the log. */
  onChatError?: ((sessionId: SessionId, step: 'send' | 'remove' | 'put_away' | 'delete', error: unknown) => void) | undefined;
  /** Called with the kept chat once a Keep is written (the server's sweep then runs, sparing it). A throw is caught. */
  onKept?: ((sessionId: SessionId) => void) | undefined;
}

const issuesOf = (error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }) => error.issues.map((issue) => ({ path: issue.path, message: issue.message }));

export function createTrials({ store, chat, isPutAway, onChatError, onKept }: TrialsOptions): Trials {
  const report = (sessionId: SessionId, step: 'send' | 'remove' | 'put_away' | 'delete', error: unknown): void => {
    try {
      onChatError?.(sessionId, step, error);
    } catch {
      // The log never changes the answer.
    }
  };

  const workspaceOf = (workspaceId: unknown): WorkspaceId => {
    const parsed = WorkspaceId.safeParse(workspaceId);
    if (!parsed.success) throw new NotFoundError('workspace', 'requested');
    // Another install's project, or none: NotFoundError.
    chat.getWorkspace(parsed.data);
    return parsed.data;
  };

  const trialOf = (workspaceId: WorkspaceId, trialId: unknown): Trial => {
    const parsed = TrialId.safeParse(trialId);
    const trial = parsed.success ? store.get(parsed.data) : undefined;
    if (trial === undefined || trial.workspaceId !== workspaceId) throw new NotFoundError('trial', 'requested');
    return trial;
  };

  /** Trials being kept now: a second Keep of the same one waits for nothing and is refused. */
  const keeping = new Set<TrialId>();

  return {
    async list(workspaceId) {
      return { trials: store.listByWorkspace(workspaceOf(workspaceId)) };
    },

    async get(workspaceId, trialId) {
      return { trial: trialOf(workspaceOf(workspaceId), trialId) };
    },

    async start(workspaceId, body) {
      const ws = workspaceOf(workspaceId);
      // Strict: a `machineId` (a remote trial) is a 400, as is anything else unknown.
      const request = CreateTrialRequest.safeParse(body);
      if (!request.success) throw new ValidationError('Give the task and 2 to 4 different agents.', issuesOf(request.error));
      const { text, agentIds } = request.data;
      // Every agent checked before any chat is made.
      const { agents } = await chat.chatAgents(ws);
      for (const agentId of agentIds) {
        const agent = agents.find((each) => each.agentId === agentId);
        if (agent === undefined) throw new InvalidOperationError(trialUnknownAgentText(agentId));
        if (agent.unavailable !== undefined) throw new InvalidOperationError(trialUnreadyText(agent.displayName, agent.unavailable.reason));
      }
      const made: Session[] = [];
      /** Removes the chats made: a copy goes with its uncommitted changes only while its chat is as it was made (nothing sent to it since). */
      const rollBack = async () => {
        for (const session of made) {
          let unchanged = false;
          try {
            const now = chat.getSession(ws, session.id);
            unchanged = now.updatedAt === session.updatedAt && now.state === session.state;
          } catch {
            continue;
          }
          try {
            await chat.deleteChat(ws, session.id, { discardUncommitted: unchanged });
          } catch (removal) {
            // A chat the user used meanwhile stays, its changes with it.
            report(session.id, 'remove', removal);
          }
        }
      };
      // Every chat of this project made from now is spared by retention, from before its creation returns.
      const release = store.holdStarting(ws);
      let trial: Trial;
      try {
        try {
          for (const agentId of agentIds) made.push(await chat.createChatSession(ws, { agentId, location: 'worktree', machineId: null }));
          trial = store.insert({ workspaceId: ws, text, chats: made.map((session, index) => ({ sessionId: session.id, agentId: agentIds[index]! })) });
        } catch (error) {
          // The trial isn't written; each copy made goes with 27.3's removal.
          await rollBack();
          throw error;
        }
      } finally {
        // The row spares them from here.
        release();
      }
      for (const session of made) {
        try {
          chat.sendMessage(ws, session.id, text);
        } catch (error) {
          // The chat stays; the user can send it the task from its own page.
          report(session.id, 'send', error);
        }
      }
      return { trial };
    },

    async keep(workspaceId, trialId, body) {
      const ws = workspaceOf(workspaceId);
      const trial = trialOf(ws, trialId);
      const request = KeepTrialRequest.safeParse(body);
      if (!request.success) throw new ValidationError('Choose one of the chats to keep.', issuesOf(request.error));
      const { sessionId: kept, others, discard } = request.data;
      if (trial.keptSessionId !== null) throw new InvalidOperationError(TRIAL_ALREADY_KEPT_TEXT);
      if (!trial.sessionIds.includes(kept)) throw new InvalidOperationError(TRIAL_NOT_ITS_CHAT_TEXT);
      // Only the other chats can be named for their changes to go.
      if (discard.some((id) => id === kept || !trial.sessionIds.includes(id))) throw new InvalidOperationError(TRIAL_NOT_ITS_CHAT_TEXT);
      if (keeping.has(trial.id)) throw new InvalidOperationError(TRIAL_ALREADY_KEPT_TEXT);
      keeping.add(trial.id);
      try {
        // The kept chat must still be there (another project's or deleted: NotFoundError).
        chat.getSession(ws, kept);
        const existing = new Map(chat.listSessions(ws).map((session) => [session.id, session]));
        const results = new Map<SessionId, (typeof OTHER_RESULTS)[number]>();
        const pending: SessionId[] = [];
        for (const other of trial.sessionIds) {
          if (other === kept) continue;
          // A repeat after a crash: a chat already gone or put away is skipped.
          if (!existing.has(other)) results.set(other, 'removed');
          else if (others === 'put_away' && isPutAway(other)) results.set(other, 'put_away');
          else pending.push(other);
        }
        // Refused, changing nothing, while any other chat works, waits, is busy, switches or the terminal drives it.
        // Each one's place in time is read here: a named copy's changes go only while nothing ran in it since.
        const seen = new Map<SessionId, { updatedAt: string; state: Session['state'] }>();
        for (const other of pending) {
          const session = existing.get(other)!;
          const putAway = isPutAway(other);
          const idle = putAway ? session.state !== 'working' && session.state !== 'waiting' && session.driver !== 'terminal' : chat.worktreeIdle(other);
          if (!idle) throw new AgentMidTurnError(TRIAL_MID_TURN_MESSAGE);
          seen.set(other, { updatedAt: session.updatedAt, state: session.state });
        }
        // A copy with uncommitted changes the confirmation didn't name refuses the whole Keep before anything is removed.
        if (others === 'delete') {
          for (const other of pending) if (!discard.includes(other) && (await chat.copyHasUncommitted(ws, other))) throw new UncommittedChangesError(TRIAL_UNCOMMITTED_MESSAGE);
        }
        /** Whether this named chat is still as it was when checked (else its changes are new and were never confirmed). */
        const unchanged = (other: SessionId): boolean => {
          try {
            const now = chat.getSession(ws, other);
            const before = seen.get(other);
            return before !== undefined && now.updatedAt === before.updatedAt && now.state === before.state;
          } catch {
            return false;
          }
        };
        for (const other of pending) {
          try {
            if (others === 'put_away') {
              await chat.putAwayWorktree(other, 'not_kept');
              results.set(other, 'put_away');
            } else {
              await chat.deleteChat(ws, other, { discardUncommitted: discard.includes(other) && unchanged(other) });
              results.set(other, 'removed');
            }
          } catch (error) {
            // A copy that can't go safely (or changed since it was named) stays as it was, and is said.
            report(other, others === 'put_away' ? 'put_away' : 'delete', error);
            results.set(other, 'left');
          }
        }
        const done = store.keep(trial.id, kept, results);
        try {
          onKept?.(kept);
        } catch {
          // The sweep never changes the answer.
        }
        return { trial: done };
      } finally {
        keeping.delete(trial.id);
      }
    },
  };
}
