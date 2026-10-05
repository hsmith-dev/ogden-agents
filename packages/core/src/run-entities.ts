/**
 * The run entities (stories 5.2, 5.3, 5.8, 5.9; story 5.10 moved them out of
 * `entities.ts`): creating a run, its outcome and decision, the queue and the
 * dispatch of a queued run. Built on the entities' database handle and event log.
 */
/**
 * The entity model (AD-2, AD-8, AD-9): workspaces, sessions and runs.
 *
 * Every change is written together with its event in one transaction, so the
 * rows and the event log never disagree, and subscribers hear about a change
 * only once it is committed.
 */
import {
  BlockedCode as BlockedCodeSchema,
  BuildAgent as BuildAgentSchema,
  IsoUtcTimestamp,
  RunDecision as RunDecisionSchema,
  RunOutcome as RunOutcomeSchema,
  TicketRef as TicketRefSchema,
  type AdapterRefs,
  type AgentId,
  type BmadPiece,
  type BuildAgent,
  type MessageRole,
  type PermissionMode,
  type Run,
  type RunQueueEntry,
  type RunId,
  type Session,
  type SessionDriver,
  type SessionErrorCode,
  type SessionId,
  type SessionKind,
  type SessionState,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { runs, sessions, workspaces } from './db/schema.js';
import { InvalidOperationError, NotFoundError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';

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
  /** The branch it started from (story 5.5). */
  baseBranch?: string | null;
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

import type { Orm } from './db/database.js';
import { check } from './entity-check.js';
import type { Entities } from './entities.js';

type RunRow = typeof runs.$inferSelect;

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
  baseBranch: row.baseBranch,
  reason: row.reason,
  agent: row.agent,
  blockedCode: row.blockedCode,
  queuePosition: row.queuePosition,
  decision: row.decision,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The `Entities` methods about runs. */
export type RunEntities = Pick<
  Entities,
  | 'createRun'
  | 'getRun'
  | 'getRunBySession'
  | 'latestRunForTicket'
  | 'listRuns'
  | 'listRunsWithWorktree'
  | 'activeRunForTicket'
  | 'listRunningRuns'
  | 'listQueuedRuns'
  | 'queueOf'
  | 'queueRun'
  | 'dispatchRun'
  | 'setRunBase'
  | 'leaveQueue'
  | 'settleInterruptedRuns'
  | 'setRunOutcome'
  | 'setRunDecision'
>;

export function createRunEntities({ orm, log, now, requireSession }: { orm: Orm; log: EventLog; now: () => string; requireSession: (id: SessionId) => Session }): RunEntities {
  const getRun = (id: RunId) => {
    const row = orm.select().from(runs).where(eq(runs.id, id)).get();
    return row === undefined ? undefined : toRun(row);
  };

  /** The workspace's queued runs in order (oldest first), positions as stored. */
  const queueOf = (workspaceId: WorkspaceId): RunQueueEntry[] =>
    orm
      .select()
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), eq(runs.outcome, 'running'), isNotNull(runs.queuePosition)))
      .orderBy(asc(runs.queuePosition), asc(runs.createdAt), asc(runs.id))
      .all()
      .map((row, index) => ({ runId: row.id as RunId, ticketRef: row.ticketRef, position: index + 1 }));

  /** Renumbers the workspace's queue 1, 2, 3 and appends `run.queue_changed` when it differs from `before` (the queue before the change). */
  const refreshQueue = (workspaceId: WorkspaceId, before: RunQueueEntry[]): void => {
    const queue = queueOf(workspaceId);
    for (const entry of queue) orm.update(runs).set({ queuePosition: entry.position }).where(eq(runs.id, entry.runId)).run();
    const same = queue.length === before.length && queue.every((entry, index) => before[index]?.runId === entry.runId && before[index]?.position === entry.position);
    if (!same) log.append({ type: 'run.queue_changed', workspaceId, streamId: workspaceId, payload: { queue } });
  };


  return {
    createRun(input) {
      const ticketRef = check(TicketRefSchema, input.ticketRef, 'ticket ref');
      const deadline = check(IsoUtcTimestamp.nullable(), input.deadline ?? null, 'run deadline');
      const agent = check(BuildAgentSchema.nullable(), input.agent ?? null, 'build agent');
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
          baseBranch: input.baseBranch ?? null,
          reason: null,
          agent,
          blockedCode: null,
          queuePosition,
          decision: null,
          createdAt: at,
          updatedAt: at,
        };
        // A queued run goes last in its workspace's line (the position asked for is only a flag).
        const before = queueOf(session.workspaceId);
        const queued: Run = queuePosition === null ? run : { ...run, queuePosition: before.length + 1 };
        orm.insert(runs).values(queued).run();
        log.append({ type: 'run.created', workspaceId: queued.workspaceId, streamId: session.id, payload: { run: queued } });
        if (queuePosition !== null) refreshQueue(queued.workspaceId, before);
        return queued;
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

    listRunsWithWorktree(workspaceIds) {
      if (workspaceIds !== undefined && workspaceIds.length === 0) return [];
      const withWorktree = isNotNull(runs.worktreePath);
      return orm
        .select()
        .from(runs)
        .where(workspaceIds === undefined ? withWorktree : and(withWorktree, inArray(runs.workspaceId, [...workspaceIds])))
        .orderBy(asc(runs.createdAt), asc(runs.id))
        .all()
        .map(toRun);
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

    listRuns(workspaceId, limit = 200) {
      return orm.select().from(runs).where(eq(runs.workspaceId, workspaceId)).orderBy(desc(runs.createdAt), desc(runs.id)).limit(limit).all().map(toRun);
    },

    listRunningRuns() {
      return orm.select().from(runs).where(and(eq(runs.outcome, 'running'), isNull(runs.queuePosition))).orderBy(asc(runs.createdAt), asc(runs.id)).all().map(toRun);
    },

    listQueuedRuns() {
      return orm.select().from(runs).where(and(eq(runs.outcome, 'running'), isNotNull(runs.queuePosition))).orderBy(asc(runs.createdAt), asc(runs.id)).all().map(toRun);
    },

    queueOf: queueOf,

    queueRun(id) {
      return log.transaction(() => {
        const run = getRun(id);
        if (run === undefined) throw new NotFoundError('run', id);
        if (run.outcome !== 'running') throw new InvalidOperationError(`run ${id} is not running, so it cannot be queued`);
        const before = queueOf(run.workspaceId);
        orm.update(runs).set({ queuePosition: before.length + 1, updatedAt: now() }).where(eq(runs.id, id)).run();
        refreshQueue(run.workspaceId, before);
        return getRun(id)!;
      });
    },

    dispatchRun(id, dispatch) {
      return log.transaction(() => {
        const run = getRun(id);
        if (run === undefined) throw new NotFoundError('run', id);
        const at = now();
        const deadline = check(IsoUtcTimestamp, dispatch.deadline, 'run deadline');
        const before = queueOf(run.workspaceId);
        orm
          .update(runs)
          .set({ worktreePath: dispatch.worktreePath, sandbox: dispatch.sandbox, branch: dispatch.branch, baseRevision: dispatch.baseRevision, baseBranch: dispatch.baseBranch, deadline, queuePosition: null, updatedAt: at })
          .where(eq(runs.id, id))
          .run();
        log.append({
          type: 'run.dispatched',
          workspaceId: run.workspaceId,
          streamId: run.sessionId,
          payload: { runId: run.id, worktreePath: dispatch.worktreePath, branch: dispatch.branch, baseRevision: dispatch.baseRevision, sandbox: dispatch.sandbox, deadline },
        });
        // A retried run (blocked, failed or stopped) is running again, its blocked fields cleared.
        if (run.outcome !== 'running') {
          orm.update(runs).set({ outcome: 'running', reason: null, blockedCode: null }).where(eq(runs.id, id)).run();
          log.append({ type: 'run.outcome_changed', workspaceId: run.workspaceId, streamId: run.sessionId, payload: { runId: run.id, outcome: 'running', previous: run.outcome } });
        }
        refreshQueue(run.workspaceId, before);
        return getRun(id)!;
      });
    },

    setRunBase(id, baseRevision) {
      const run = getRun(id);
      if (run === undefined) throw new NotFoundError('run', id);
      orm.update(runs).set({ baseRevision, updatedAt: now() }).where(eq(runs.id, id)).run();
      return getRun(id)!;
    },

    leaveQueue(id) {
      return log.transaction(() => {
        const run = getRun(id);
        if (run === undefined) throw new NotFoundError('run', id);
        if (run.queuePosition === null) return run;
        const before = queueOf(run.workspaceId);
        orm.update(runs).set({ queuePosition: null, updatedAt: now() }).where(eq(runs.id, id)).run();
        refreshQueue(run.workspaceId, before);
        return getRun(id)!;
      });
    },

    settleInterruptedRuns(reason) {
      // A queued run has no agent to lose: it stays queued and is drained at the start (story 5.8).
      return orm
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.outcome, 'running'), isNull(runs.queuePosition)))
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
