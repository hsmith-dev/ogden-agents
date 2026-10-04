/**
 * Permission requests (CAP-4, E2-R3; story 2.6): what core answers when an
 * agent asks to run a tool call. The tool call does not run until
 * {@link Permissions.request} resolves, and it resolves `allow_once` only on
 * an explicit user decision or a matching always-allow rule. Every failure,
 * cancel or unknown state ends in a decline.
 *
 * A request appends `permission.requested` through the session-event helper
 * (E2-R7) and moves the session to `waiting` until the user answers its card
 * ({@link Permissions.decide}). An "Always allow" is stored here as a rule of
 * the workspace (the agent is only ever told "once") and answers later
 * matching requests in code: `requested` and `resolved by:rule` in one
 * transaction, without `waiting`. A pending request is cancelled when its
 * session leaves `waiting` for any other reason (the agent went away, a
 * restart, a close), or when its history is deleted.
 *
 * Before any rule, the workspace's caution level (story 2.8) may answer a
 * low-risk request in code: `requested` and `resolved by:caution` in one
 * transaction ({@link cautionAllows}). The level is read inside that
 * transaction, so a card already shown is never re-evaluated. A write to a
 * protected path (`isProtectedSegment`) is never answered by the
 * level or by a rule: it always shows a card.
 *
 * A chat in Skip all (permission modes) skips both the level and the rules:
 * whatever reaches core from it is one of the agent's own safety checks, so
 * it always shows a card, with no Always allow ({@link SKIP_ALL_REFUSAL}).
 * The mode is read inside the same transaction as the level.
 */
import {
  alwaysAllowRefusal,
  DEFAULT_CAUTION_LEVEL,
  SKIP_ALL_REFUSAL,
  MAX_DENY_REASON_LENGTH,
  ToolKind as ToolKindSchema,
  type AlwaysAllowScope,
  type BmadPiece,
  type CoreEvent,
  type PermissionDecision,
  type PermissionRule,
  type PermissionRuleId,
  type SessionId,
  type ToolKind,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { and, asc, eq } from 'drizzle-orm';
import { monotonicFactory } from 'ulid';
import type { AgentPermissionDecision, AgentPermissionRequest } from './agent-port.js';
import type { Database } from './db/database.js';
import { permissionRules } from './db/schema.js';
import type { Entities } from './entities.js';
import { CoreError, NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import {
  alwaysAllowScope,
  cautionAllows,
  commandNamesProtectedPath,
  PATH_KINDS,
  pathsInsideWorkspace,
  ruleMatches,
  touchesProtectedPath,
  WRITE_KINDS,
} from './permission-matching.js';
import type { SessionEvents } from './session-events.js';
import { createWorkspaceSettings, readCautionLevel, type WorkspaceSettingsAccess } from './workspace-settings.js';

// Moved to `permission-matching.ts` (story 10.8); still exported from here.
export * from './permission-matching.js';

/**
 * A decision for a request that is not waiting for one: already decided,
 * cancelled, unknown, or in another session or workspace (409). Nothing changed.
 */
export class PermissionNotPendingError extends CoreError {
  override readonly name = 'PermissionNotPendingError';
  constructor(requestId: string) {
    super('permission_not_pending', `permission request ${requestId} is not waiting for a decision`);
  }
}

/** The user's answer on a card. `reason` is kept only with `deny`. */
export interface PermissionDecisionInput {
  decision: PermissionDecision;
  reason?: string | undefined;
}

export interface Permissions extends WorkspaceSettingsAccess {
  /** Decides one request from the session's agent. Never rejects: a failure is a deny. */
  request(sessionId: SessionId, request: AgentPermissionRequest): Promise<AgentPermissionDecision>;
  /**
   * The user's answer to a pending request of this session in this
   * workspace. Throws {@link PermissionNotPendingError} when it is not
   * pending there, and {@link ValidationError} for an `allow_always` the
   * request does not offer (its scope is `null`) or a reason that is too long.
   */
  decide(workspaceId: WorkspaceId, sessionId: SessionId, requestId: string, input: PermissionDecisionInput): void;
  /** The workspace's always-allow rules, oldest first. {@link NotFoundError} for an unknown workspace. */
  listRules(workspaceId: WorkspaceId): PermissionRule[];
  /**
   * Undoes an always-allow rule and appends `workspace.permission_rule_removed`.
   * {@link NotFoundError} when the workspace has no such rule.
   */
  removeRule(workspaceId: WorkspaceId, ruleId: PermissionRuleId): void;
  /** Stops listening and tells every agent still waiting that its request was cancelled. */
  close(): void;
}

/**
 * The stub for tests and for wiring without core: denies every request and
 * appends nothing, so nothing an agent asks to run, runs without a person.
 */
export function createDecliningPermissions(): Permissions {
  return {
    request: async () => ({ outcome: 'deny' }),
    decide: (_workspaceId, _sessionId, requestId) => {
      throw new PermissionNotPendingError(requestId);
    },
    listRules: () => [],
    removeRule: (_workspaceId, ruleId) => {
      throw new NotFoundError('permission rule', ruleId);
    },
    getSettings: () => ({ cautionLevel: DEFAULT_CAUTION_LEVEL, bmadPieces: [], bmadScriptsTrusted: false }),
    updateSettings: (workspaceId) => {
      throw new NotFoundError('workspace', workspaceId);
    },
    close: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Core's permissions.
// ---------------------------------------------------------------------------

export interface PermissionsOptions {
  db: Database;
  events: EventLog;
  entities: Entities;
  sessionEvents: SessionEvents;
  /** Called with a failure while deciding or recording a request (it is declined all the same). Default: nothing. */
  onError?: (error: unknown) => void;
  /** Whether this install ships a BMad piece, so it may be turned on (core's `bmad.isAvailable`). Default: none is. */
  isBmadPieceAvailable?: (piece: BmadPiece) => boolean;
}

interface Pending {
  requestId: string;
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  scope: AlwaysAllowScope | null;
  /** Why Always allow isn't offered, when a command rules it out. */
  refusal: string | undefined;
  answer: (decision: AgentPermissionDecision) => void;
}

const nextUlid = monotonicFactory();
/** Request ids are unique within the install; they are not entity keys. */
const newRequestId = () => `preq_${nextUlid()}`;

type RuleRow = typeof permissionRules.$inferSelect;
const toRule = (row: RuleRow): PermissionRule => ({
  id: row.id as PermissionRuleId,
  workspaceId: row.workspaceId as WorkspaceId,
  scope: { kind: row.kind, value: row.value, label: row.label },
  createdAt: row.createdAt,
});

export function createPermissions({ db, events, entities, sessionEvents, onError, isBmadPieceAvailable = () => false }: PermissionsOptions): Permissions {
  const { orm } = db;
  /** Requests waiting for the user, by request id. */
  const pending = new Map<string, Pending>();
  let closed = false;

  const reportError = (error: unknown) => {
    try {
      onError?.(error);
    } catch {
      // Reporting must never break a decline.
    }
  };

  /** Records `resolved by:cancelled` for a request, if its session still exists. */
  const recordCancelled = (entry: Pending) => {
    try {
      sessionEvents.appendSessionEvent(entry.sessionId, {
        type: 'permission.resolved',
        payload: { sessionId: entry.sessionId, requestId: entry.requestId, decision: 'deny', by: 'cancelled' },
      });
    } catch (error) {
      // The session is gone (history deleted) or core is closing: the request stays declined.
      reportError(error);
    }
  };

  /**
   * Declines `entry` as cancelled: the agent is told at once. With `record`,
   * `resolved by:cancelled` is appended after every subscriber has the event
   * that caused it (appending while the log delivers would reorder it).
   */
  const cancel = (entry: Pending, record: boolean) => {
    pending.delete(entry.requestId);
    entry.answer({ outcome: 'cancelled' });
    if (record) queueMicrotask(() => recordCancelled(entry));
  };

  const unsubscribe = events.subscribe(events.lastSeq(), (event: CoreEvent) => {
    if (event.type === 'session.state_changed' && event.payload.state !== 'waiting') {
      // Leaving `waiting` other than by a decision: the agent went away, a restart, a close.
      for (const entry of [...pending.values()]) if (entry.sessionId === event.payload.sessionId) cancel(entry, true);
    } else if (event.type === 'workspace.history_deleted') {
      // Its sessions and their events are gone: nothing left to record on.
      for (const entry of [...pending.values()]) if (entry.workspaceId === event.workspaceId) cancel(entry, false);
    }
  });

  const findRule = (workspaceId: string, kind: ToolKind, command: string | undefined, pathsInside: boolean) =>
    orm
      .select()
      .from(permissionRules)
      .where(eq(permissionRules.workspaceId, workspaceId))
      .orderBy(asc(permissionRules.createdAt), asc(permissionRules.id))
      .all()
      .find((row) => ruleMatches(row, kind, command, pathsInside));

  return {
    // The caution level and BMad pieces (moved to `workspace-settings.ts`, story 10.8).
    ...createWorkspaceSettings({ db, events, isBmadPieceAvailable }),

    async request(sessionId, request) {
      try {
        if (closed) return { outcome: 'cancelled' };
        const parsedKind = ToolKindSchema.safeParse(request.kind);
        const kind: ToolKind = parsedKind.success ? parsedKind.data : 'other';
        const command = typeof request.command === 'string' && request.command.trim() !== '' ? request.command : undefined;
        const scope = alwaysAllowScope(kind, command);
        const requestId = newRequestId();
        // Resolved before the transaction: it reads the filesystem.
        const owner = entities.getSession(sessionId);
        const workspace = owner === undefined ? undefined : entities.getWorkspace(owner.workspaceId);
        const pathsInside = workspace !== undefined && PATH_KINDS.has(kind) && pathsInsideWorkspace(workspace, request.paths);
        // For the caution level: a path kind needs its paths inside; `think`
        // needs no path, but any path it names must be inside too.
        const named = Array.isArray(request.paths) ? request.paths : [];
        // A write to a protected path, or a command naming one, always shows a card (F1).
        const protectedPath =
          (WRITE_KINDS.has(kind) && (workspace === undefined || touchesProtectedPath(workspace, request.paths))) ||
          (command !== undefined && commandNamesProtectedPath(command));
        const cautionPathsInside = PATH_KINDS.has(kind)
          ? pathsInside
          : workspace !== undefined && (named.length === 0 || pathsInsideWorkspace(workspace, named));

        const outcome = events.transaction(() => {
          const session = entities.getSession(sessionId);
          if (session === undefined) throw new NotFoundError('session', sessionId);
          const cautionLevel = readCautionLevel(orm, session.workspaceId) ?? DEFAULT_CAUTION_LEVEL;
          const permissionMode = session.permissionMode;
          // Skip all: no caution level, no rule, and no Always allow (it never writes a rule).
          const skipAll = permissionMode === 'skip_all';
          const offered = skipAll ? null : scope;
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'permission.requested',
            payload: {
              sessionId,
              requestId,
              toolCall: {
                toolCallId: request.toolCallId,
                title: request.title,
                kind,
                ...(command === undefined ? {} : { command }),
                ...(protectedPath ? { protectedPath: true as const } : {}),
              },
              alwaysAllowScope: offered,
              cautionLevel,
              permissionMode,
            },
          });
          if (session.state !== 'working' && session.state !== 'waiting') {
            // No turn is running to hold: never ask, never allow.
            sessionEvents.appendSessionEvent(sessionId, {
              type: 'permission.resolved',
              payload: { sessionId, requestId, decision: 'deny', by: 'cancelled' },
            });
            return { type: 'cancelled' as const };
          }
          // A request that names a command never runs on the level: a command is asked or ruled (2.6).
          if (!skipAll && !protectedPath && command === undefined && session.workspaceId === workspace?.id && cautionAllows(cautionLevel, kind, cautionPathsInside)) {
            sessionEvents.appendSessionEvent(sessionId, {
              type: 'permission.resolved',
              payload: { sessionId, requestId, decision: 'allow_once', by: 'caution' },
            });
            return { type: 'caution' as const };
          }
          const rule = protectedPath || skipAll ? undefined : findRule(session.workspaceId, kind, command, pathsInside && session.workspaceId === workspace?.id);
          if (rule !== undefined) {
            sessionEvents.appendSessionEvent(sessionId, {
              type: 'permission.resolved',
              payload: { sessionId, requestId, decision: 'allow_once', by: 'rule', ruleId: rule.id as PermissionRuleId },
            });
            return { type: 'rule' as const };
          }
          entities.setSessionState(sessionId, 'waiting');
          return { type: 'ask' as const, workspaceId: session.workspaceId, scope: offered, skipAll };
        });

        if (outcome.type === 'rule' || outcome.type === 'caution') return { outcome: 'allow_once' };
        if (outcome.type === 'cancelled') return { outcome: 'cancelled' };
        return await new Promise<AgentPermissionDecision>((answer) => {
          const refusal = outcome.skipAll ? SKIP_ALL_REFUSAL : kind === 'execute' && command !== undefined ? alwaysAllowRefusal(command) : undefined;
          pending.set(requestId, { requestId, sessionId, workspaceId: outcome.workspaceId, scope: outcome.scope, refusal, answer });
        });
      } catch (error) {
        reportError(error);
        return { outcome: 'deny' };
      }
    },

    decide(workspaceId, sessionId, requestId, { decision, reason }) {
      const entry = pending.get(requestId);
      if (entry === undefined || entry.sessionId !== sessionId || entry.workspaceId !== workspaceId) {
        throw new PermissionNotPendingError(requestId);
      }
      if (decision !== 'allow_once' && decision !== 'allow_always' && decision !== 'deny') {
        throw new ValidationError('Choose Allow once, Always allow or Deny.', [{ path: ['decision'], message: 'unknown decision' }]);
      }
      if (decision === 'allow_always' && entry.scope === null) {
        throw new ValidationError(entry.refusal ?? "Always allow isn't offered for this request.", [{ path: ['decision'], message: 'no always-allow scope' }]);
      }
      // A card shown before the chat moved to Skip all: a Skip-all chat never writes a rule. Read now, in
      // the same synchronous step as the write below (no await between), so nothing can change it in between.
      if (decision === 'allow_always' && entities.getSession(sessionId)?.permissionMode === 'skip_all') {
        throw new ValidationError(SKIP_ALL_REFUSAL, [{ path: ['decision'], message: 'skip_all writes no rule' }]);
      }
      const kept = decision === 'deny' && reason !== undefined && reason.trim() !== '' ? reason : undefined;
      if (kept !== undefined && kept.length > MAX_DENY_REASON_LENGTH) {
        throw new ValidationError(`A reason can be at most ${MAX_DENY_REASON_LENGTH} characters.`, [{ path: ['reason'], message: 'too long' }]);
      }
      // Out of the map before the state changes, so leaving `waiting` does not cancel it.
      pending.delete(requestId);
      try {
        events.transaction(() => {
          let ruleId: PermissionRuleId | undefined;
          if (decision === 'allow_always' && entry.scope !== null) {
            const { kind, value, label } = entry.scope;
            const existing = orm
              .select({ id: permissionRules.id })
              .from(permissionRules)
              .where(and(eq(permissionRules.workspaceId, workspaceId), eq(permissionRules.kind, kind), eq(permissionRules.value, value)))
              .get();
            if (existing !== undefined) {
              ruleId = existing.id as PermissionRuleId;
            } else {
              ruleId = newId('rule');
              orm.insert(permissionRules).values({ id: ruleId, workspaceId, kind, value, label, createdAt: new Date().toISOString() }).run();
              events.append({
                type: 'workspace.permission_rule_added',
                workspaceId,
                streamId: workspaceId,
                payload: { ruleId, scope: { kind, value, label } },
              });
            }
          }
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'permission.resolved',
            payload: {
              sessionId,
              requestId,
              decision,
              by: 'user',
              ...(kept === undefined ? {} : { reason: kept }),
              ...(ruleId === undefined ? {} : { ruleId }),
            },
          });
          if (![...pending.values()].some((other) => other.sessionId === sessionId)) entities.setSessionState(sessionId, 'working');
        });
      } catch (error) {
        // Nothing was recorded: the request is declined, never left to allow later.
        entry.answer({ outcome: 'deny' });
        recordCancelled(entry);
        // Nothing holds the session any more unless another request of it is pending.
        try {
          if (![...pending.values()].some((other) => other.sessionId === sessionId) && entities.getSession(sessionId)?.state === 'waiting') {
            entities.setSessionState(sessionId, 'working');
          }
        } catch (stateError) {
          reportError(stateError);
        }
        throw error;
      }
      // The agent is only ever told "once"; chat.ts sends a Deny's reason as the user's next message (story 2.10).
      entry.answer(decision === 'deny' ? { outcome: 'deny', ...(kept === undefined ? {} : { reason: kept }) } : { outcome: 'allow_once' });
    },

    listRules(workspaceId) {
      if (entities.getWorkspace(workspaceId) === undefined) throw new NotFoundError('workspace', workspaceId);
      return orm
        .select()
        .from(permissionRules)
        .where(eq(permissionRules.workspaceId, workspaceId))
        .orderBy(asc(permissionRules.createdAt), asc(permissionRules.id))
        .all()
        .map(toRule);
    },

    removeRule(workspaceId, ruleId) {
      events.transaction(() => {
        const removed = orm
          .delete(permissionRules)
          .where(and(eq(permissionRules.id, ruleId), eq(permissionRules.workspaceId, workspaceId)))
          .run().changes;
        if (removed === 0) throw new NotFoundError('permission rule', ruleId);
        events.append({ type: 'workspace.permission_rule_removed', workspaceId, streamId: workspaceId, payload: { ruleId } });
      });
    },

    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const entry of [...pending.values()]) cancel(entry, false);
    },
  };
}
