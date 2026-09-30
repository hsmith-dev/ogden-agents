/**
 * The chat use-case (story 2.2, the tracer bullet): open a workspace for a
 * repo, create a chat session in it, and send the session's agent a message.
 *
 * Core stores the user's message, marks the session `working` as it hands the
 * message over, and from then on follows the adapter's signals (AD-4): each
 * reply chunk becomes a `session.message_delta`, and when the adapter reports
 * `idle` or `error` the reply is completed (`session.message_completed`, which
 * prunes its deltas; AD-5) and the state is set. Every session event goes
 * through the session-event helper (E2-R7).
 *
 * Tool calls become `session.tool_call` and `session.tool_call_updated`
 * events, each carrying the whole call as it stands. Permission requests go
 * to {@link Permissions}.
 *
 * The agent's own session id is stored as the adapter ref
 * {@link AGENT_SESSION_REF} (AD-9), never in an event. When a chat that has
 * one gets a message and has no live agent (after a restart or a crash), core
 * reopens it (story 2.7, E2-R2): the adapter resumes or loads it, else starts
 * a new session that core primes with the chat's transcript
 * ({@link primedPrompt}). Every reopen appends `session.resumed`. Reopening is
 * lazy, so a server start spawns no agent.
 *
 * A reopen that had to start a new session saves the new id only once its
 * primed prompt succeeded (2.7 F4), so a restart before that primes again.
 *
 * Story 2.10: a message sent while the agent answers is queued (E2-R1;
 * `session.message_queued`, at most {@link MAX_QUEUED_MESSAGES}) and sent,
 * first in first out, once the turn ends; a Deny reason goes first, as the
 * user's message `I denied "<command or title>": <reason>`. The agent is never
 * sent anything mid-turn. A turn that ends in `error` (or a Stop, or a close)
 * leaves the rest of the queue unsent. Reply chunks are coalesced to at most
 * one delta per {@link DELTA_INTERVAL_MS} per reply. A quiet agent is never
 * timed out: after {@link DEFAULT_CHECK_IN_MS} with no agent event while
 * `working`, core appends `session.check_in` and keeps waiting. Stop
 * ({@link Chat.cancel}) asks the agent to cancel its prompt and drops it if it
 * has not ended within {@link STOP_GRACE_MS}.
 *
 * The agent itself sits behind {@link AgentPort} (AD-1); this file names none.
 */
import { homedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { DEFAULT_CAUTION_LEVEL, MAX_DIFF_TEXT_LENGTH, ToolCallStatus, ToolKind, type Session, type SessionId, type ToolCallDiff, type Workspace, type WorkspaceId } from '@ogden-agents/shared';
import { monotonicFactory } from 'ulid';
import {
  AgentError,
  type AgentEvent,
  type AgentPermissionDecision,
  type AgentPermissionRequest,
  type AgentPort,
  type AgentRestored,
  type AgentSession,
  type AgentToolCallDiff,
} from './agent-port.js';
import { canonicalWorkspacePath, type Entities } from './entities.js';
import {
  CoreError,
  InvalidOperationError,
  NotFoundError,
  QueueFullError,
  SessionBusyError,
  SessionNotBusyError,
  WorkspaceBusyError,
} from './errors.js';
import type { HistoryDeleted } from './event-log.js';
import { createDecliningPermissions, type Permissions } from './permissions.js';
import { primedPrompt } from './resume-prime.js';
import type { SessionEvents } from './session-events.js';

/** The reason on sessions the server moved to `idle` because it stopped or restarted under them (AD-3). */
export const RESTARTED_REASON = 'Ogden Agents was restarted';

/** The adapter ref that holds the agent's own session id (AD-9). */
export const AGENT_SESSION_REF = 'agentSessionId';

/** The most messages a session holds queued while its agent answers; the next one is refused (409). */
export const MAX_QUEUED_MESSAGES = 20;

/** How long an agent may send nothing while `working` before core checks in (user decision: 10 minutes, no timeout). */
export const DEFAULT_CHECK_IN_MS = 10 * 60_000;

/** The shortest and longest check-in delay core accepts (a timer can't wait longer than 2^31-1 ms). */
export const MIN_CHECK_IN_MS = 1_000;
export const MAX_CHECK_IN_MS = 2 ** 31 - 1;

/** `ms` as a usable check-in delay: a whole number within [{@link MIN_CHECK_IN_MS}, {@link MAX_CHECK_IN_MS}]. */
export const clampCheckInDelay = (ms: number): number =>
  Number.isFinite(ms) ? Math.min(MAX_CHECK_IN_MS, Math.max(MIN_CHECK_IN_MS, Math.round(ms))) : DEFAULT_CHECK_IN_MS;

/** The longest command or title a Deny-reason message quotes, ellipsis included. */
export const MAX_DENIED_QUOTE_LENGTH = 200;

/** The user's message that carries a Deny reason to the agent after the turn (user decision, story 2.10). */
export const deniedMessage = (what: string, reason: string): string => {
  const quoted = what.length > MAX_DENIED_QUOTE_LENGTH ? `${what.slice(0, MAX_DENIED_QUOTE_LENGTH - 1)}…` : what;
  return `I denied "${quoted}": ${reason}`;
};

/** At most one `session.message_delta` per reply in this many milliseconds (2.2 per-chunk writes). */
export const DELTA_INTERVAL_MS = 50;

/** How long Stop waits for the agent to end its turn before it drops the agent. */
export const STOP_GRACE_MS = 5_000;

export interface ChatOptions {
  entities: Entities;
  /**
   * Ogden Agents' own data folder: never a workspace, nor inside or above
   * one, so an agent can't be pointed at the database, logs or tokens.
   */
  dataDir: string;
  sessionEvents: SessionEvents;
  agent: AgentPort;
  /**
   * Answers the agents' permission requests. Default: the declining stub
   * ({@link createDecliningPermissions}), which denies every request.
   */
  permissions?: Permissions;
  /**
   * The environment each agent process gets (AD-16: API keys go here and
   * nowhere else). Called for every agent start. Default: none.
   */
  agentEnv?: () => Readonly<Record<string, string>>;
  /** Called with every agent failure, for the log. Its `details` hold no secret. */
  onAgentError?: (sessionId: SessionId, error: AgentError) => void;
  /** Called when applying an agent's event failed (such as a session deleted mid-reply), for the log. */
  onInternalError?: (sessionId: SessionId, error: unknown) => void;
  /** How long a `working` agent may be silent before core checks in, clamped by {@link clampCheckInDelay}. Default {@link DEFAULT_CHECK_IN_MS}. */
  checkInDelayMs?: number;
  /** How long Stop waits for the turn to end before dropping the agent. Default {@link STOP_GRACE_MS}. */
  stopGraceMs?: number;
}

export interface Chat {
  /**
   * The workspace for the repo at `path`, created if new (AD-2). `path` must
   * be absolute (a leading `~` is the user's home). Throws
   * {@link InvalidOperationError} if it isn't, if it is not an existing
   * folder, or if it is, holds or sits inside Ogden Agents' data folder.
   */
  openWorkspace(path: string): Workspace;
  /** Every workspace of this install, oldest first. */
  listWorkspaces(): Workspace[];
  /** The workspace ({@link NotFoundError} if there is none). */
  getWorkspace(workspaceId: WorkspaceId): Workspace;
  /** The workspace's sessions, oldest first ({@link NotFoundError} for an unknown workspace). */
  listSessions(workspaceId: WorkspaceId): Session[];
  /**
   * Deletes the workspace's history: its events, sessions and runs; the
   * workspace and every other workspace stay. Throws
   * {@link WorkspaceBusyError}, deleting nothing, while one of its sessions is
   * `working` or `waiting` or its agent is still answering, and
   * {@link NotFoundError} for an unknown workspace. The deleted sessions'
   * idle agents are then stopped.
   */
  deleteHistory(workspaceId: WorkspaceId): Omit<HistoryDeleted, 'event'>;
  /** A new chat session in the workspace, `idle`. */
  createChatSession(workspaceId: WorkspaceId): Session;
  /** The session, which must belong to the workspace ({@link NotFoundError} otherwise). */
  getSession(workspaceId: WorkspaceId, sessionId: SessionId): Session;
  /**
   * Stores the user's message and hands it to the session's agent, starting
   * the agent first if needed. Returns once the message is stored; the reply
   * and the state follow through the event log. While the agent is still
   * answering, the message is queued (`queued: true`) and sent when the turn
   * ends. Throws {@link QueueFullError} when {@link MAX_QUEUED_MESSAGES} are
   * already queued, {@link SessionBusyError} while a failed turn is ending,
   * and {@link InvalidOperationError} while the terminal drives the session (AD-6).
   */
  sendMessage(workspaceId: WorkspaceId, sessionId: SessionId, text: string): { messageId: string; queued: boolean };
  /**
   * Stop: asks the agent to cancel its running prompt, declines the pending
   * permission requests (the session leaves `waiting` for `idle`) and drops
   * the queued messages, which stay unsent. The session ends `idle`; an agent
   * that has not ended its turn within the grace period is dropped and the
   * session is `idle`, resumable. Throws {@link SessionNotBusyError} when no
   * turn is running and {@link NotFoundError} for an unknown session.
   */
  cancel(workspaceId: WorkspaceId, sessionId: SessionId): void;
  /** Resolves once no agent turn is running (tests, shutdown). */
  settled(): Promise<void>;
  /**
   * Ends every agent session and stops their processes (AD-3: the server
   * owns them). Sessions still answering become `idle`, resumable, with
   * {@link RESTARTED_REASON}, before their agents stop.
   */
  close(): Promise<void>;
}

const nextUlid = monotonicFactory();

/** An adapter's tool kind as the shared enum, or `undefined` when it named none or an unknown one. */
const toolKind = (kind: string | undefined): ToolKind | undefined => {
  const parsed = ToolKind.safeParse(kind);
  return parsed.success ? parsed.data : undefined;
};
const toolStatus = (status: string | undefined): ToolCallStatus | undefined => {
  const parsed = ToolCallStatus.safeParse(status);
  return parsed.success ? parsed.data : undefined;
};
/**
 * The adapter's diffs as events carry them: each side cut to
 * {@link MAX_DIFF_TEXT_LENGTH} characters and flagged `truncated` when it was
 * (story 2.3 review F1), so no adapter can put an unbounded file in the log.
 */
const capDiffs = (diffs: readonly AgentToolCallDiff[] | undefined): ToolCallDiff[] | undefined =>
  diffs?.map(({ path, oldText, newText }) => {
    const cut = (text: string) => (text.length > MAX_DIFF_TEXT_LENGTH ? text.slice(0, MAX_DIFF_TEXT_LENGTH) : text);
    const truncated = newText.length > MAX_DIFF_TEXT_LENGTH || (oldText !== null && oldText.length > MAX_DIFF_TEXT_LENGTH);
    return { path, oldText: oldText === null ? null : cut(oldText), newText: cut(newText), ...(truncated ? { truncated: true as const } : {}) };
  });
const sameDiffs = (a: readonly ToolCallDiff[] | undefined, b: readonly ToolCallDiff[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
/** The event payload for `call`; `withDiffs: false` leaves its diffs out (an update that did not change them). */
const toolCallPayload = (sessionId: SessionId, toolCallId: string, call: ToolCallState, withDiffs = true) => ({
  sessionId,
  toolCallId,
  title: call.title,
  kind: call.kind,
  status: call.status,
  ...(!withDiffs || call.diffs === undefined || call.diffs.length === 0 ? {} : { diffs: call.diffs }),
});
/** Message ids are unique within the install; they are not entity keys. */
const newMessageId = () => `msg_${nextUlid()}`;

/** A tool call as core last recorded it: each event carries the whole call (diffs only when they change). */
interface ToolCallState {
  title: string;
  kind: ToolKind;
  status: ToolCallStatus;
  diffs: ToolCallDiff[] | undefined;
}

type Timer = ReturnType<typeof setTimeout>;

/** Starts a timer that never keeps the process alive. */
const later = (ms: number, run: () => void): Timer => {
  const timer = setTimeout(run, ms);
  (timer as { unref?: () => void }).unref?.();
  return timer;
};

/** One session's live agent, and the reply it is writing, if any. */
interface Live {
  agent: Promise<AgentSession>;
  reply: { messageId: string; text: string } | undefined;
  /** Reply text received but not yet appended as a delta (coalesced). */
  pendingDelta: string;
  /** Running while deltas are held back: at most one append per {@link DELTA_INTERVAL_MS}. */
  deltaTimer: Timer | undefined;
  /** The tool calls of the current turn, by id; cleared when the turn ends (2.3 F7). */
  toolCalls: Map<string, ToolCallState>;
  /** Stops listening to the agent. */
  off: (() => void) | undefined;
  /**
   * The agent started a new session in place of the chat's earlier one: the
   * next prompt carries the transcript ({@link primedPrompt}) until one succeeds.
   */
  prime: boolean;
  /** That new session's id, saved as the adapter ref only once a primed prompt succeeded (2.7 F4). */
  unsavedRef: string | undefined;
  /** Resolves when the agent is dropped or closed: a prompt still running is abandoned. */
  gone: Promise<void>;
  markGone: () => void;
}

/** A session whose agent is answering: from the first message until nothing is left to send. */
interface Turn {
  /** Messages sent while the agent answered, oldest first. */
  queue: Array<{ messageId: string; text: string }>;
  /** Deny reasons to send after the turn, ahead of the queue. */
  reasons: string[];
  /** Fires the check-in after a quiet stretch. */
  quiet: Timer | undefined;
  /** Drops the agent if a Stop did not end the turn in time. */
  stopTimer: Timer | undefined;
  stopping: boolean;
  /** The turn ended in `error`: nothing more is sent. */
  failed: boolean;
}

export function createChat(options: ChatOptions): Chat {
  const { entities, sessionEvents, agent } = options;
  const permissions = options.permissions ?? createDecliningPermissions();
  const agentEnv = options.agentEnv ?? (() => ({}));
  const checkInDelayMs = clampCheckInDelay(options.checkInDelayMs ?? DEFAULT_CHECK_IN_MS);
  const stopGraceMs = options.stopGraceMs ?? STOP_GRACE_MS;
  const live = new Map<SessionId, Live>();
  /** Sessions whose agent is answering, with what is left to send; another message is queued until it ends. */
  const busy = new Map<SessionId, Turn>();
  const running = new Set<Promise<void>>();
  /** Set by `close`: no event from a stopping agent changes a session any more. */
  let closing = false;
  const dataHome = canonicalWorkspacePath(options.dataDir);

  const internalError = (sessionId: SessionId, error: unknown) => {
    try {
      options.onInternalError?.(sessionId, error);
    } catch {
      // Logging must never break a turn.
    }
  };

  const toAgentError = (error: unknown): AgentError =>
    error instanceof AgentError
      ? error
      : new AgentError('agent_failed', `${agent.displayName} stopped with an error. Try again.`, {
          details: { reason: error instanceof Error ? error.message : String(error) },
          cause: error,
        });

  // --- Coalesced reply deltas (2.2 per-chunk writes) ---------------------------------------

  /** Appends the reply text held back, if any, as one delta. */
  const flushDelta = (sessionId: SessionId, entry: Live) => {
    const reply = entry.reply;
    if (reply === undefined || entry.pendingDelta === '') return;
    const text = entry.pendingDelta;
    entry.pendingDelta = '';
    sessionEvents.appendSessionEvent(sessionId, {
      type: 'session.message_delta',
      payload: { messageId: reply.messageId, role: 'agent', text },
    });
  };

  const stopDeltaTimer = (entry: Live) => {
    if (entry.deltaTimer !== undefined) clearTimeout(entry.deltaTimer);
    entry.deltaTimer = undefined;
  };

  /** Every {@link DELTA_INTERVAL_MS} while text keeps arriving: appends what came in since the last delta. */
  const tickDelta = (sessionId: SessionId, entry: Live) => {
    entry.deltaTimer = undefined;
    if (closing || entry.pendingDelta === '') return;
    try {
      flushDelta(sessionId, entry);
    } catch (error) {
      internalError(sessionId, error);
      return;
    }
    entry.deltaTimer = later(DELTA_INTERVAL_MS, () => tickDelta(sessionId, entry));
  };

  /** Appends the session's held-back reply text before any other event of it. */
  const flushSession = (sessionId: SessionId) => {
    const entry = live.get(sessionId);
    if (entry !== undefined) flushDelta(sessionId, entry);
  };

  /** Completes the reply being written, if any, with everything received so far. */
  const finishReply = (sessionId: SessionId, entry: Live) => {
    stopDeltaTimer(entry);
    const reply = entry.reply;
    if (reply === undefined) return;
    flushDelta(sessionId, entry);
    entry.reply = undefined;
    sessionEvents.completeMessage(sessionId, { messageId: reply.messageId, role: 'agent', content: reply.text });
  };

  // --- The quiet agent (2.2 hung agent: a check-in, never a timeout) -----------------------

  const clearQuiet = (turn: Turn) => {
    if (turn.quiet !== undefined) clearTimeout(turn.quiet);
    turn.quiet = undefined;
  };

  const clearTurnTimers = (turn: Turn) => {
    clearQuiet(turn);
    if (turn.stopTimer !== undefined) clearTimeout(turn.stopTimer);
    turn.stopTimer = undefined;
  };

  /** Starts the quiet stretch again: the agent just did something. */
  const armQuiet = (sessionId: SessionId) => {
    const turn = busy.get(sessionId);
    if (turn === undefined || turn.stopping || turn.failed || closing) return;
    clearQuiet(turn);
    turn.quiet = later(checkInDelayMs, () => checkIn(sessionId, turn));
  };

  /**
   * The agent has been quiet for the whole delay. While `waiting` the user
   * is the one to act: the stretch starts again. While `working`, core says
   * so (`session.check_in`, naming the tool call still in progress, if any)
   * and keeps waiting; it never fails or stops the session itself.
   */
  const checkIn = (sessionId: SessionId, turn: Turn) => {
    turn.quiet = undefined;
    if (closing || busy.get(sessionId) !== turn || turn.stopping || turn.failed) return;
    try {
      const state = entities.getSession(sessionId)?.state;
      if (state === 'waiting') {
        armQuiet(sessionId);
        return;
      }
      if (state !== 'working') return;
      const entry = live.get(sessionId);
      if (entry !== undefined) flushDelta(sessionId, entry);
      const inProgress = entry === undefined ? undefined : [...entry.toolCalls.values()].reverse().find((call) => call.status === 'pending' || call.status === 'in_progress');
      sessionEvents.appendSessionEvent(sessionId, {
        type: 'session.check_in',
        payload: { sessionId, ...(inProgress === undefined || inProgress.title === '' ? {} : { waitingOn: inProgress.title }) },
      });
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  /** A request the agent made after a Stop: `permission.requested` and `resolved by:cancelled`, never a card. */
  const recordStoppedRequest = (sessionId: SessionId, request: AgentPermissionRequest) => {
    try {
      const kind = toolKind(request.kind) ?? 'other';
      const command = typeof request.command === 'string' && request.command.trim() !== '' ? request.command : undefined;
      const requestId = `preq_${nextUlid()}`;
      sessionEvents.appendSessionEvent(sessionId, {
        type: 'permission.requested',
        payload: {
          sessionId,
          requestId,
          toolCall: { toolCallId: request.toolCallId, title: request.title, kind, ...(command === undefined ? {} : { command }) },
          alwaysAllowScope: null,
          cautionLevel: DEFAULT_CAUTION_LEVEL,
        },
      });
      sessionEvents.appendSessionEvent(sessionId, {
        type: 'permission.resolved',
        payload: { sessionId, requestId, decision: 'deny', by: 'cancelled' },
      });
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  // --- Agents ----------------------------------------------------------------------------

  /** Ends the session's agent (it failed or went away); the next message starts a fresh one. */
  const drop = (sessionId: SessionId, entry: Live) => {
    if (live.get(sessionId) === entry) live.delete(sessionId);
    stopDeltaTimer(entry);
    entry.off?.();
    entry.off = undefined;
    entry.markGone();
    entry.agent.then(
      (session) => session.close(),
      () => undefined,
    ).catch((error: unknown) => internalError(sessionId, error));
  };

  /** Whether the session has a Deny reason or a queued message to send once this turn ends. */
  const hasNext = (sessionId: SessionId) => {
    const turn = busy.get(sessionId);
    return turn !== undefined && !turn.failed && !closing && (turn.reasons.length > 0 || turn.queue.length > 0);
  };

  /** A turn ended: its reply is complete and its tool calls are forgotten (2.3 F7). */
  const endTurn = (sessionId: SessionId, entry: Live) => {
    const turn = busy.get(sessionId);
    if (turn !== undefined) clearQuiet(turn);
    entry.toolCalls.clear();
    finishReply(sessionId, entry);
  };

  /**
   * Puts the session in `error` with the plain reason. `dropAgent` only when
   * the agent's process is gone (or never started): a prompt that merely
   * failed, such as a rate limit, keeps the agent session for the next message.
   * Nothing queued is sent after it.
   */
  const fail = (sessionId: SessionId, entry: Live | undefined, error: AgentError, dropAgent: boolean) => {
    if (closing) return;
    const turn = busy.get(sessionId);
    if (turn !== undefined) {
      turn.failed = true;
      clearQuiet(turn);
    }
    try {
      options.onAgentError?.(sessionId, error);
    } catch {
      // Logging must never hide the failure from the UI.
    }
    try {
      if (entry !== undefined) endTurn(sessionId, entry);
      entities.setSessionState(sessionId, 'error', { reason: error.message });
    } catch (caught) {
      internalError(sessionId, caught);
    }
    if (entry !== undefined && dropAgent) drop(sessionId, entry);
  };

  /** Applies one adapter event to the session (AD-4, AD-5). */
  const apply = (sessionId: SessionId, entry: Live, event: AgentEvent) => {
    if (closing) return;
    try {
      armQuiet(sessionId);
      // Held-back reply text goes before any other event of the session.
      if (event.type !== 'message_chunk') flushDelta(sessionId, entry);
      switch (event.type) {
        case 'message_chunk': {
          if (event.text === '') return;
          entry.reply ??= { messageId: newMessageId(), text: '' };
          entry.reply.text += event.text;
          entry.pendingDelta += event.text;
          if (entry.deltaTimer === undefined) {
            flushDelta(sessionId, entry);
            entry.deltaTimer = later(DELTA_INTERVAL_MS, () => tickDelta(sessionId, entry));
          }
          return;
        }
        case 'state':
          if (event.state === 'working') {
            // Only a decision leaves `waiting` for `working` (Permissions.decide); a Stop leaves it for good.
            const state = entities.getSession(sessionId)?.state;
            if (state !== 'waiting' && busy.get(sessionId)?.stopping !== true) entities.setSessionState(sessionId, 'working');
          } else if (event.state === 'idle') {
            endTurn(sessionId, entry);
            // With a reason or a queued message to send, the session goes straight on working.
            // A turn that recorded an `error` keeps it (and its Try again), even if the prompt then ends.
            if (!hasNext(sessionId) && busy.get(sessionId)?.failed !== true) entities.setSessionState(sessionId, 'idle');
          } else {
            fail(sessionId, entry, new AgentError('agent_failed', event.reason ?? `${agent.displayName} stopped unexpectedly.`), event.fatal === true);
          }
          return;
        case 'tool_call': {
          const call: ToolCallState = {
            title: event.title,
            kind: toolKind(event.kind) ?? 'other',
            status: toolStatus(event.status) ?? 'pending',
            diffs: capDiffs(event.diffs),
          };
          entry.toolCalls.set(event.toolCallId, call);
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.tool_call',
            payload: toolCallPayload(sessionId, event.toolCallId, call),
          });
          return;
        }
        case 'tool_call_update': {
          const known = entry.toolCalls.get(event.toolCallId);
          // A call this turn never reported (a late update after its turn ended): nothing to update.
          if (known === undefined) return;
          const call: ToolCallState = {
            title: event.title ?? known?.title ?? '',
            kind: toolKind(event.kind) ?? known?.kind ?? 'other',
            status: toolStatus(event.status) ?? known?.status ?? 'pending',
            diffs: capDiffs(event.diffs) ?? known?.diffs,
          };
          entry.toolCalls.set(event.toolCallId, call);
          // Diffs can be large: an update repeats them only when they changed (review F1).
          const diffsChanged = !sameDiffs(call.diffs, known?.diffs);
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.tool_call_updated',
            payload: toolCallPayload(sessionId, event.toolCallId, call, diffsChanged),
          });
          return;
        }
      }
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  /** The session's current adapter ref for its agent session, if it ever reached an agent. */
  const storedAgentSessionId = (sessionId: SessionId): string | undefined => {
    const ref = entities.getSession(sessionId)?.adapterRefs[AGENT_SESSION_REF];
    return ref === undefined || ref === '' ? undefined : ref;
  };

  const agentFor = (session: Session, workspace: Workspace): Live => {
    const existing = live.get(session.id);
    if (existing !== undefined) return existing;
    let markGone!: () => void;
    const gone = new Promise<void>((resolve) => (markGone = resolve));
    const entry: Live = {
      agent: Promise.resolve(undefined as never),
      reply: undefined,
      pendingDelta: '',
      deltaTimer: undefined,
      toolCalls: new Map(),
      off: undefined,
      prime: false,
      unsavedRef: undefined,
      gone,
      markGone,
    };
    const onPermissionRequest = async (request: AgentPermissionRequest): Promise<AgentPermissionDecision> => {
      try {
        flushSession(session.id);
        if (busy.get(session.id)?.stopping === true) {
          // After a Stop nothing new is asked: declined at once, with no card, and recorded as cancelled.
          recordStoppedRequest(session.id, request);
          return { outcome: 'cancelled' };
        }
        const decision = await permissions.request(session.id, request);
        // The user answered (or a rule did): the quiet stretch starts again.
        armQuiet(session.id);
        const reason = decision.outcome === 'deny' ? decision.reason?.trim() : undefined;
        const turn = busy.get(session.id);
        if (reason !== undefined && reason !== '' && turn !== undefined && !turn.stopping && !turn.failed) {
          // Sent after the turn, as the user's own message: never to the agent mid-turn.
          turn.reasons.push(deniedMessage(request.command?.trim() || request.title, reason));
        }
        return decision;
      } catch (error) {
        // A failure never lets the tool call run.
        internalError(session.id, error);
        return { outcome: 'deny' };
      }
    };
    // The real-cased path: the case-folded key is for uniqueness only (AD-2).
    const input = { cwd: workspace.realPath ?? workspace.path, env: { ...agentEnv() }, onPermissionRequest };
    const previous = storedAgentSessionId(session.id);
    // A chat that reached an agent before, and has none now, reopens that agent's session (2.7).
    const opening: Promise<{ session: AgentSession; restored: AgentRestored | undefined }> =
      previous === undefined
        ? agent.startSession(input).then((started) => ({ session: started, restored: undefined }))
        : agent.reopenSession({ ...input, agentSessionId: previous });
    entry.agent = opening.then(async ({ session: started, restored }) => {
      if (live.get(session.id) !== entry) {
        // Closed (or dropped) while starting: stop it before anyone waiting on this
        // entry goes on, so `close` returns only once its process has exited.
        await started.close().catch(() => undefined);
        throw new AgentError('agent_failed', `${agent.displayName} was stopped.`);
      }
      try {
        // The id stays an adapter ref: it is in no event (AD-9). A new session in
        // place of the earlier one is saved only once its primed prompt succeeded (2.7 F4).
        if (restored === 'new') entry.unsavedRef = started.agentSessionId;
        else if (started.agentSessionId !== previous) entities.setSessionAdapterRefs(session.id, { [AGENT_SESSION_REF]: started.agentSessionId });
        if (restored !== undefined) {
          sessionEvents.appendSessionEvent(session.id, {
            type: 'session.resumed',
            payload: { sessionId: session.id, via: restored === 'new' ? 'transcript' : restored },
          });
        }
      } catch (error) {
        await started.close().catch(() => undefined);
        throw error;
      }
      entry.prime = restored === 'new';
      entry.off = started.onEvent((event) => apply(session.id, entry, event));
      return started;
    });
    live.set(session.id, entry);
    return entry;
  };

  /**
   * What the agent is sent for the user's `text`: the text itself, or, on a
   * session that replaced the chat's earlier one, the text after the chat's
   * transcript up to (not including) this message. A slash command (`/…`)
   * goes as it is, so the agent still reads it as a command, and the next
   * ordinary message is primed instead (review F1). `primed` says which.
   */
  const promptFor = (sessionId: SessionId, entry: Live, messageId: string, text: string): { prompt: string; primed: boolean } => {
    if (!entry.prime || text.trimStart().startsWith('/')) return { prompt: text, primed: false };
    const earlier = entities.listCompletedMessages(sessionId).filter((message) => message.messageId !== messageId);
    return { prompt: primedPrompt(earlier, text, agent.displayName), primed: true };
  };

  /** One prompt and its turn. Ends when the agent ended it, failed, or was dropped (a Stop past its grace, a close). */
  const runTurn = async (session: Session, workspace: Workspace, turn: Turn, messageId: string, text: string): Promise<void> => {
    const entry = agentFor(session, workspace);
    armQuiet(session.id);
    let started: AgentSession | undefined;
    try {
      started = await Promise.race([entry.agent, entry.gone.then(() => undefined)]);
    } catch (error) {
      fail(session.id, entry, toAgentError(error), true);
      return;
    }
    // Stopped (or dropped) before the prompt went out: nothing is sent.
    if (started === undefined || turn.stopping) return;
    try {
      const { prompt, primed } = promptFor(session.id, entry, messageId, text);
      const prompting = started.prompt(prompt);
      // Abandoned if the agent is dropped; its late rejection is not unhandled.
      prompting.catch(() => undefined);
      const result = await Promise.race([prompting, entry.gone.then(() => undefined)]);
      if (result === undefined) return;
      if (primed) {
        // Primed once: the agent has the transcript now, and its session is the chat's (2.7 F4).
        entry.prime = false;
        if (entry.unsavedRef !== undefined) {
          entities.setSessionAdapterRefs(session.id, { [AGENT_SESSION_REF]: entry.unsavedRef });
          entry.unsavedRef = undefined;
        }
      }
      // The adapter reports `idle` itself; this only covers one that didn't. An `error` it reported stays.
      if (!turn.failed) apply(session.id, entry, { type: 'state', state: 'idle' });
    } catch (error) {
      // The adapter has usually reported `error` already; this covers one that didn't.
      // A process that is gone reports `fatal` itself, which drops the agent.
      if (live.get(session.id) === entry) fail(session.id, entry, toAgentError(error), false);
    }
  };

  /** The next thing to send once a turn ended: a Deny reason first, then the oldest queued message. */
  const takeNext = (turn: Turn): { messageId: string; text: string; queued: boolean } | undefined => {
    const reason = turn.reasons.shift();
    if (reason !== undefined) return { messageId: newMessageId(), text: reason, queued: false };
    const queued = turn.queue.shift();
    return queued === undefined ? undefined : { ...queued, queued: true };
  };

  /** Runs turns until nothing is left to send, then leaves the session settled: never `working` or `waiting`. */
  const drive = async (session: Session, workspace: Workspace, turn: Turn, first: { messageId: string; text: string }): Promise<void> => {
    let next = first;
    for (;;) {
      await runTurn(session, workspace, turn, next.messageId, next.text);
      if (closing || turn.failed) break;
      const following = takeNext(turn);
      if (following === undefined) break;
      try {
        // A leftover card is never answered by moving on: the turn is over.
        if (entities.getSession(session.id)?.state === 'waiting') break;
        // A Stop ended the turn before; what was sent after it starts a new one.
        turn.stopping = false;
        clearTurnTimers(turn);
        flushSession(session.id);
        // A queued message completes under its own id; a Deny reason is a new user message.
        sessionEvents.completeMessage(session.id, { messageId: following.messageId, role: 'user', content: following.text });
        entities.setSessionState(session.id, 'working');
      } catch (error) {
        internalError(session.id, error);
        break;
      }
      next = following;
    }
    clearTurnTimers(turn);
    if (closing || turn.failed) return;
    try {
      const state = entities.getSession(session.id)?.state;
      if (state === 'working' || state === 'waiting') entities.setSessionState(session.id, 'idle');
    } catch (error) {
      internalError(session.id, error);
    }
  };

  const getWorkspace = (workspaceId: WorkspaceId): Workspace => {
    const workspace = entities.getWorkspace(workspaceId);
    if (workspace === undefined) throw new NotFoundError('workspace', workspaceId);
    return workspace;
  };

  const getSession = (workspaceId: WorkspaceId, sessionId: SessionId): Session => {
    const session = entities.getSession(sessionId);
    // Another workspace's session is as absent as a missing one: nothing leaks across (AD-2).
    if (session === undefined || session.workspaceId !== workspaceId) throw new NotFoundError('session', sessionId);
    return session;
  };

  return {
    openWorkspace(input) {
      const path = input === '~' ? homedir() : input.startsWith('~/') || input.startsWith('~\\') ? join(homedir(), input.slice(2)) : input;
      if (!isAbsolute(path)) throw new InvalidOperationError('Enter the full path of the folder, starting from the top of the disk.');
      try {
        const candidate = canonicalWorkspacePath(path);
        const within = (inner: string, outer: string) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
        if (within(candidate, dataHome) || within(dataHome, candidate)) {
          throw new InvalidOperationError("That folder holds Ogden Agents' own data, so it can't be a project.");
        }
        return entities.ensureWorkspace(path);
      } catch (error) {
        if (error instanceof CoreError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') throw new InvalidOperationError('There is no folder at that path on this computer.');
        if (code === 'EACCES' || code === 'EPERM') throw new InvalidOperationError("Ogden Agents can't open that folder: permission denied.");
        throw error;
      }
    },

    listWorkspaces: () => entities.listWorkspaces(),

    getWorkspace,

    listSessions(workspaceId) {
      getWorkspace(workspaceId);
      return entities.listSessions(workspaceId);
    },

    deleteHistory(workspaceId) {
      const sessionIds = entities.listSessions(workspaceId).map((session) => session.id);
      // A turn can be starting before its state reads `working`: the busy set covers that gap.
      if (sessionIds.some((id) => busy.has(id))) throw new WorkspaceBusyError(workspaceId);
      const { deletedEvents, deletedSessions, deletedRuns } = entities.deleteWorkspaceHistory(workspaceId);
      for (const sessionId of sessionIds) {
        const entry = live.get(sessionId);
        if (entry !== undefined) drop(sessionId, entry);
      }
      return { deletedEvents, deletedSessions, deletedRuns };
    },

    createChatSession(workspaceId) {
      return entities.createSession({ workspaceId, kind: 'chat' });
    },

    getSession,

    sendMessage(workspaceId, sessionId, text) {
      if (closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      const workspace = entities.getWorkspace(workspaceId);
      if (workspace === undefined) throw new NotFoundError('workspace', workspaceId);
      if (session.driver === 'terminal') throw new InvalidOperationError('The terminal is driving this session.');
      const current = busy.get(sessionId);
      if (current !== undefined) {
        // A failed turn is ending: nothing more goes after it.
        if (current.failed) throw new SessionBusyError(sessionId);
        if (current.queue.length >= MAX_QUEUED_MESSAGES) throw new QueueFullError(sessionId);
        const messageId = newMessageId();
        flushSession(sessionId);
        sessionEvents.appendSessionEvent(sessionId, { type: 'session.message_queued', payload: { sessionId, messageId, content: text } });
        current.queue.push({ messageId, text });
        return { messageId, queued: true };
      }
      const messageId = newMessageId();
      sessionEvents.completeMessage(sessionId, { messageId, role: 'user', content: text });
      entities.setSessionState(sessionId, 'working');
      const turn: Turn = { queue: [], reasons: [], quiet: undefined, stopTimer: undefined, stopping: false, failed: false };
      busy.set(sessionId, turn);
      const done = drive(session, workspace, turn, { messageId, text })
        .catch((error: unknown) => internalError(sessionId, error))
        .finally(() => {
          clearTurnTimers(turn);
          if (busy.get(sessionId) === turn) busy.delete(sessionId);
          running.delete(done);
        });
      running.add(done);
      return { messageId, queued: false };
    },

    cancel(workspaceId, sessionId) {
      if (closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      getSession(workspaceId, sessionId);
      const turn = busy.get(sessionId);
      if (turn === undefined || turn.failed) throw new SessionNotBusyError(sessionId);
      if (turn.stopping) return;
      turn.stopping = true;
      // What was queued, and any Deny reason, stays unsent: the UI shows it "Not sent".
      turn.queue = [];
      turn.reasons = [];
      clearQuiet(turn);
      const entry = live.get(sessionId);
      try {
        if (entry !== undefined) flushDelta(sessionId, entry);
        // Leaving `waiting` declines its pending requests (Permissions), so the agent can end its turn.
        if (entities.getSession(sessionId)?.state === 'waiting') entities.setSessionState(sessionId, 'idle');
      } catch (error) {
        internalError(sessionId, error);
      }
      entry?.agent
        .then(
          (started) => started.cancel(),
          () => undefined,
        )
        .catch((error: unknown) => internalError(sessionId, error));
      turn.stopTimer = later(stopGraceMs, () => {
        turn.stopTimer = undefined;
        if (closing || busy.get(sessionId) !== turn) return;
        // The agent did not end its turn: it is dropped, and the chat can be resumed.
        const current = live.get(sessionId);
        try {
          if (current !== undefined) endTurn(sessionId, current);
        } catch (error) {
          internalError(sessionId, error);
        }
        if (current !== undefined) drop(sessionId, current);
        // A message sent after the Stop goes next (the session goes on `working`): it is never shown "Not sent".
        if (turn.queue.length > 0) return;
        try {
          entities.setSessionState(sessionId, 'idle', { resumable: true });
        } catch (error) {
          internalError(sessionId, error);
        }
      });
    },

    async settled() {
      while (running.size > 0) await Promise.all([...running]);
    },

    async close() {
      if (!closing) {
        // Before the agents stop, so their exits don't read as crashes.
        for (const sessionId of new Set([...busy.keys(), ...live.keys()])) {
          try {
            const state = entities.getSession(sessionId)?.state;
            if (state === 'working' || state === 'waiting') {
              for (const entry of [live.get(sessionId)]) if (entry !== undefined) finishReply(sessionId, entry);
              entities.setSessionState(sessionId, 'idle', { reason: RESTARTED_REASON, resumable: true });
            }
          } catch (error) {
            internalError(sessionId, error);
          }
        }
      }
      closing = true;
      // Queued messages are not sent: the `idle` above marks them "Not sent".
      for (const turn of busy.values()) {
        clearTurnTimers(turn);
        turn.queue = [];
        turn.reasons = [];
      }
      const entries = [...live.entries()];
      live.clear();
      await Promise.all(
        entries.map(async ([sessionId, entry]) => {
          stopDeltaTimer(entry);
          entry.off?.();
          entry.markGone();
          try {
            await (await entry.agent).close();
          } catch (error) {
            if (!(error instanceof AgentError)) internalError(sessionId, error);
          }
        }),
      );
    },
  };
}
