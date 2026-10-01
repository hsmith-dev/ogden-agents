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
 * protected path ({@link isProtectedSegment}) is never answered by the
 * level or by a rule: it always shows a card.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  alwaysAllowRefusal,
  BmadPieces as BmadPiecesSchema,
  bmadPiecesProblem,
  canonicalBmadPieces,
  CautionLevel as CautionLevelSchema,
  DEFAULT_CAUTION_LEVEL,
  MAX_DENY_REASON_LENGTH,
  ToolKind as ToolKindSchema,
  type AlwaysAllowScope,
  type BmadPiece,
  type CautionLevel,
  type CoreEvent,
  type PermissionDecision,
  type PermissionRule,
  type PermissionRuleId,
  type SessionId,
  type ToolKind,
  type Workspace,
  type WorkspaceId,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { and, asc, eq } from 'drizzle-orm';
import { monotonicFactory } from 'ulid';
import { readBmadPieces } from './bmad-features.js';
import type { AgentPermissionDecision, AgentPermissionRequest } from './agent-port.js';
import type { Database } from './db/database.js';
import { permissionRules, workspaces } from './db/schema.js';
import { canonicalWorkspacePath, isCaseInsensitivePath, type Entities } from './entities.js';
import { CoreError, FeatureUnavailableError, NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { SessionEvents } from './session-events.js';

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

export interface Permissions {
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
  /** The workspace's settings (its caution level and BMad pieces). {@link NotFoundError} for an unknown workspace. */
  getSettings(workspaceId: WorkspaceId): WorkspaceSettings;
  /**
   * Changes the workspace's settings, its caution level and its BMad pieces
   * (AD-22; the only way the pieces change), and appends one
   * `workspace.settings_changed` in the same transaction; nothing changed
   * appends nothing. A level applies to requests not yet shown. The pieces
   * are stored in canonical order and must satisfy the dependency rule; a
   * piece newly turned on must be available (story 10.2), while one already
   * on is kept and turning off is always allowed.
   * {@link ValidationError} for an unknown level or piece, a broken
   * dependency rule, or neither given; {@link FeatureUnavailableError} for a
   * newly-on piece this install doesn't ship; {@link NotFoundError} for an
   * unknown workspace. Every refusal writes nothing.
   */
  updateSettings(workspaceId: WorkspaceId, input: { cautionLevel?: unknown; bmadPieces?: unknown }): WorkspaceSettings;
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
    getSettings: () => ({ cautionLevel: DEFAULT_CAUTION_LEVEL, bmadPieces: [] }),
    updateSettings: (workspaceId) => {
      throw new NotFoundError('workspace', workspaceId);
    },
    close: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Scope and matching (user decisions, 2026-09-30).
// ---------------------------------------------------------------------------

/**
 * Shell control syntax: `;`, `&`, `|`, a backtick, `$(`, `${`, `>`, `<`, a
 * line break, any other control character, or whitespace other than a space
 * or a tab (NBSP, U+2028, `\v`, `\f`, zero-width spaces, ...), which could
 * hide a word boundary the rule does not see. A command holding any of it
 * never matches a rule, so a rule for `npm install` can't let
 * `npm install x && rm -rf ~` through.
 */
const SHELL_SYNTAX =
  /[;&|`<>\u0000-\u0008\u000a-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]|\$\(|\$\{/;

export const hasShellSyntax = (command: string): boolean => SHELL_SYNTAX.test(command);

/**
 * What the adapters write in place of a secret. A masked command is not the
 * command that runs, so it never matches a rule.
 */
const MASKED = '[redacted]';

/** Words split on spaces and tabs only; any other whitespace is refused by {@link SHELL_SYNTAX}. */
const words = (command: string): string[] => command.trim().split(/[ \t]+/).filter((word) => word !== '');

/** A flag (`-x`, `--x`) or a path (`./a`, `~/a`, `a/b`, `a\b`): never a subcommand. */
const isFlagOrPath = (word: string) => word.startsWith('-') || word.startsWith('.') || word.startsWith('~') || /[\\/]/.test(word);

/**
 * The command prefix an "Always allow" of `command` covers: its first two
 * words when the second is not a flag or a path, else its first word
 * (`npm install stripe` -> `npm install`, `ls -la` -> `ls`).
 */
export function commandPrefix(command: string): string | undefined {
  const [first, second] = words(command);
  if (first === undefined) return undefined;
  return second === undefined || isFlagOrPath(second) ? first : `${first} ${second}`;
}

/** Plain words for a tool-kind scope, as the card writes it under Always allow ("Editing files in clay-and-kiln"). */
const TOOL_SCOPE_LABELS: Record<Exclude<ToolKind, 'execute' | 'other'>, string> = {
  read: 'Reading files',
  edit: 'Editing files',
  delete: 'Deleting files',
  move: 'Moving files',
  search: 'Searching files',
  think: 'Thinking',
  fetch: 'Fetching from the web',
  switch_mode: 'Switching modes',
};

/**
 * Tool kinds that act on paths: their always-allow rules match only when
 * every path the tool call names lies inside the workspace (user decision
 * 2026-09-30, review F1). Other named kinds (`fetch`, …) stay per kind.
 */
export const PATH_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['read', 'edit', 'delete', 'move', 'search']);

/**
 * `path` as it would be reached: absolute (relative to `base` otherwise),
 * with the symlinks of its nearest existing parent resolved, case-folded
 * where that filesystem ignores case. `undefined` when it can't be told: a
 * `~` path, a masked one, control characters, or a read error.
 */
function reachedPath(base: string, path: string): string | undefined {
  if (path === '' || path.startsWith('~') || path.includes(MASKED) || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  let current = isAbsolute(path) ? resolve(path) : resolve(base, path);
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      const reached = rest.length === 0 ? real : join(real, ...rest.reverse());
      return isCaseInsensitivePath(real) ? reached.toLowerCase() : reached;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined;
      const parent = dirname(current);
      if (parent === current) return undefined;
      rest.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Whether the tool call names at least one path and every one of them lies
 * inside the workspace's canonical real path (AD-2). No path, or any path
 * outside or unresolvable, is `false`.
 */
export function pathsInsideWorkspace(workspace: Pick<Workspace, 'path' | 'realPath'>, paths: readonly string[] | undefined): boolean {
  if (paths === undefined || paths.length === 0) return false;
  let root: string;
  let base: string;
  try {
    base = realpathSync.native(workspace.realPath ?? workspace.path);
    root = canonicalWorkspacePath(base);
  } catch {
    return false;
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  return paths.every((path) => {
    const reached = reachedPath(base, path);
    return reached !== undefined && (reached === root || reached.startsWith(prefix));
  });
}

/**
 * What "Always allow" would cover for a request: for `execute`, its command
 * prefix; for another named kind, the kind; for `other`, an unknown kind,
 * an `execute` without a command, or a command led by an interpreter, a
 * wrapper or a variable assignment, nothing (`null`: Always allow is not offered).
 */
export function alwaysAllowScope(kind: ToolKind, command: string | undefined): AlwaysAllowScope | null {
  if (kind === 'execute') {
    if (command !== undefined && alwaysAllowRefusal(command) !== undefined) return null;
    const prefix = command === undefined ? undefined : commandPrefix(command);
    return prefix === undefined ? null : { kind: 'command_prefix', value: prefix, label: prefix };
  }
  if (kind === 'other') return null;
  return { kind: 'tool', value: kind, label: TOOL_SCOPE_LABELS[kind] };
}

/**
 * Whether a stored rule answers a request of `kind` with `command`. A
 * command prefix matches whole words only (`npm install` never matches
 * `npm installer`), and nothing matches a command with shell syntax, a
 * masked command, or one led by an interpreter or wrapper. A rule for a
 * file kind matches only when `pathsInside` (every path the call names is
 * inside the workspace; {@link pathsInsideWorkspace}).
 */
export function ruleMatches(
  rule: Pick<AlwaysAllowScope, 'kind' | 'value'>,
  kind: ToolKind,
  command: string | undefined,
  pathsInside = false,
): boolean {
  if (command !== undefined && (hasShellSyntax(command) || command.includes(MASKED) || alwaysAllowRefusal(command) !== undefined)) return false;
  if (rule.kind === 'tool') return kind !== 'execute' && kind !== 'other' && rule.value === kind && (!PATH_KINDS.has(kind) || pathsInside);
  if (rule.kind !== 'command_prefix' || kind !== 'execute' || command === undefined) return false;
  const prefix = words(rule.value);
  const given = words(command);
  return prefix.length > 0 && prefix.length <= given.length && prefix.every((word, index) => given[index] === word);
}

/**
 * The caution ladder (user decision 2026-09-30, strictest first), a pure
 * table: whether `level` answers a request of `kind` without a card.
 * `pathsInside` is whether the request's paths all lie inside the workspace;
 * for `read`, `search` and `edit` it must also name at least one
 * ({@link pathsInsideWorkspace}), for `think` it must name none or only
 * inside ones.
 *
 * - `ask_every_time`: nothing.
 * - `ask_for_commands`: `read` and `search` inside the project, and `think`.
 * - `ask_risky_only`: those, and `edit` inside the project.
 *
 * `execute`, `delete`, `move`, `fetch`, `switch_mode`, `other`, an unknown
 * kind or level, and any path outside the project always ask (a 2.6 rule may
 * still answer them).
 */
export function cautionAllows(level: CautionLevel, kind: ToolKind, pathsInside: boolean): boolean {
  if (pathsInside !== true) return false;
  switch (level) {
    case 'ask_for_commands':
      return kind === 'read' || kind === 'search' || kind === 'think';
    case 'ask_risky_only':
      return kind === 'read' || kind === 'search' || kind === 'think' || kind === 'edit';
    default:
      return false;
  }
}

/**
 * Protected paths (user decision 2026-09-30, 2.8 F1): files and folders that
 * control how the agent or git runs, so writing one could give the agent
 * more than the request says (a hook, a settings allow-list, an MCP server).
 * Folder or file names, at any depth, compared ignoring case everywhere
 * (stricter than the filesystem needs on a case-sensitive one).
 */
const PROTECTED_NAMES: ReadonlySet<string> = new Set(['.claude', '.git', '.vscode', '.idea', '.mcp.json', 'claude.md', 'agents.md', '.envrc']);

/** Tool kinds that write: a protected path among their paths always asks. Reads and searches are not protected. */
export const WRITE_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['edit', 'delete', 'move']);

/** Whether one path segment is a protected name. */
export const isProtectedSegment = (segment: string): boolean => PROTECTED_NAMES.has(segment.toLowerCase());

/**
 * Whether any path the tool call names reaches a protected name inside the
 * workspace, symlinks resolved (a link to `.git/hooks` counts). Paths
 * outside the workspace or unresolvable are not checked here: they never
 * pass {@link pathsInsideWorkspace}, so they ask anyway.
 */
export function touchesProtectedPath(workspace: Pick<Workspace, 'path' | 'realPath'>, paths: readonly string[] | undefined): boolean {
  if (paths === undefined || paths.length === 0) return false;
  let root: string;
  let base: string;
  try {
    base = realpathSync.native(workspace.realPath ?? workspace.path);
    root = canonicalWorkspacePath(base);
  } catch {
    return false;
  }
  const prefix = root.endsWith(sep) ? root : root + sep;
  return paths.some((path) => {
    const reached = reachedPath(base, path);
    if (reached === undefined || !reached.startsWith(prefix)) return false;
    return reached.slice(prefix.length).split(/[\\/]/).some(isProtectedSegment);
  });
}

/** Whether a command names a protected path in any word (`cp x .git/hooks/pre-commit`): no rule answers it. */
export function commandNamesProtectedPath(command: string): boolean {
  return words(command).some((word) => word.replace(/["']/g, '').split(/[\\/]/).some(isProtectedSegment));
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

  /** The workspace's stored level; the strictest one when it can't be read. */
  const readLevel = (workspaceId: string): CautionLevel | undefined => {
    const row = orm.select({ cautionLevel: workspaces.cautionLevel }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
    if (row === undefined) return undefined;
    const parsed = CautionLevelSchema.safeParse(row.cautionLevel);
    return parsed.success ? parsed.data : DEFAULT_CAUTION_LEVEL;
  };

  const findRule = (workspaceId: string, kind: ToolKind, command: string | undefined, pathsInside: boolean) =>
    orm
      .select()
      .from(permissionRules)
      .where(eq(permissionRules.workspaceId, workspaceId))
      .orderBy(asc(permissionRules.createdAt), asc(permissionRules.id))
      .all()
      .find((row) => ruleMatches(row, kind, command, pathsInside));

  return {
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
          const cautionLevel = readLevel(session.workspaceId) ?? DEFAULT_CAUTION_LEVEL;
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
              alwaysAllowScope: scope,
              cautionLevel,
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
          if (!protectedPath && command === undefined && session.workspaceId === workspace?.id && cautionAllows(cautionLevel, kind, cautionPathsInside)) {
            sessionEvents.appendSessionEvent(sessionId, {
              type: 'permission.resolved',
              payload: { sessionId, requestId, decision: 'allow_once', by: 'caution' },
            });
            return { type: 'caution' as const };
          }
          const rule = protectedPath ? undefined : findRule(session.workspaceId, kind, command, pathsInside && session.workspaceId === workspace?.id);
          if (rule !== undefined) {
            sessionEvents.appendSessionEvent(sessionId, {
              type: 'permission.resolved',
              payload: { sessionId, requestId, decision: 'allow_once', by: 'rule', ruleId: rule.id as PermissionRuleId },
            });
            return { type: 'rule' as const };
          }
          entities.setSessionState(sessionId, 'waiting');
          return { type: 'ask' as const, workspaceId: session.workspaceId };
        });

        if (outcome.type === 'rule' || outcome.type === 'caution') return { outcome: 'allow_once' };
        if (outcome.type === 'cancelled') return { outcome: 'cancelled' };
        return await new Promise<AgentPermissionDecision>((answer) => {
          const refusal = kind === 'execute' && command !== undefined ? alwaysAllowRefusal(command) : undefined;
          pending.set(requestId, { requestId, sessionId, workspaceId: outcome.workspaceId, scope, refusal, answer });
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

    getSettings(workspaceId) {
      const cautionLevel = readLevel(workspaceId);
      const bmadPieces = readBmadPieces(orm, workspaceId);
      if (cautionLevel === undefined || bmadPieces === undefined) throw new NotFoundError('workspace', workspaceId);
      return { cautionLevel, bmadPieces };
    },

    updateSettings(workspaceId, input) {
      let cautionLevel: CautionLevel | undefined;
      if (input.cautionLevel !== undefined) {
        const parsed = CautionLevelSchema.safeParse(input.cautionLevel);
        if (!parsed.success) {
          throw new ValidationError('Choose Ask every time, Ask for commands or Ask only for risky actions.', [
            { path: ['cautionLevel'], message: 'unknown caution level' },
          ]);
        }
        cautionLevel = parsed.data;
      }
      let bmadPieces: BmadPiece[] | undefined;
      if (input.bmadPieces !== undefined) {
        const parsed = BmadPiecesSchema.safeParse(input.bmadPieces);
        if (!parsed.success) throw new ValidationError('Choose BMad Method features this version has.', [{ path: ['bmadPieces'], message: 'unknown or repeated piece' }]);
        const problem = bmadPiecesProblem(parsed.data);
        if (problem !== undefined) throw new ValidationError(problem, [{ path: ['bmadPieces'], message: 'dependency rule' }]);
        bmadPieces = canonicalBmadPieces(parsed.data);
      }
      if (cautionLevel === undefined && bmadPieces === undefined) {
        throw new ValidationError('Choose a setting to change.', [{ path: [], message: 'nothing to change' }]);
      }
      return events.transaction(() => {
        const previous = readLevel(workspaceId);
        const previousBmadPieces = readBmadPieces(orm, workspaceId);
        if (previous === undefined || previousBmadPieces === undefined) throw new NotFoundError('workspace', workspaceId);
        const level = cautionLevel ?? previous;
        // Compared as sets: the same pieces in another order change nothing.
        const piecesChanged =
          bmadPieces !== undefined && (bmadPieces.length !== previousBmadPieces.length || bmadPieces.some((piece) => !previousBmadPieces.includes(piece)));
        const pieces = piecesChanged ? bmadPieces! : previousBmadPieces;
        // A piece is turned on only when this install ships it (AD-22); one already on is kept.
        const unavailable = pieces.find((piece) => !previousBmadPieces.includes(piece) && !isBmadPieceAvailable(piece));
        if (unavailable !== undefined) throw new FeatureUnavailableError(unavailable);
        if (level === previous && !piecesChanged) return { cautionLevel: level, bmadPieces: pieces };
        orm.update(workspaces).set({ cautionLevel: level, bmadPieces: JSON.stringify(pieces) }).where(eq(workspaces.id, workspaceId)).run();
        events.append({
          type: 'workspace.settings_changed',
          workspaceId,
          streamId: workspaceId,
          payload: { cautionLevel: level, previous, ...(piecesChanged ? { bmadPieces: pieces, previousBmadPieces } : {}) },
        });
        return { cautionLevel: level, bmadPieces: pieces };
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
