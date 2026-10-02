/**
 * Turns (moved from `chat.ts`, story 3.11): applying the agent's events
 * (AD-4, AD-5), running prompts until nothing is left to send, the queue
 * (2.10), failures, and Stop.
 */
import type { Session, SessionId, Workspace } from '@ogden-agents/shared';
import { AgentError, type AgentEvent, type AgentSession } from '../agent-port.js';
import {
  DriverIsTerminalError,
  InvalidOperationError,
  QueueFullError,
  SessionBusyError,
  SessionNotBusyError,
  SessionNotIdleError,
} from '../errors.js';
import type { Agents } from './agents.js';
import type { CheckIn } from './check-in.js';
import { AGENT_SESSION_REF, DELTA_INTERVAL_MS, MAX_QUEUED_MESSAGES } from './constants.js';
import type { ChatContext } from './context.js';
import type { Replies } from './replies.js';
import { capDiffs, sameDiffs, toolCallPayload, toolKind, toolStatus } from './tool-calls.js';
import type { Chat, Live, ToolCallState, Turn } from './types.js';

export function createTurns(
  ctx: ChatContext,
  deps: Pick<Replies, 'flushDelta' | 'tickDelta' | 'flushSession' | 'finishReply'> &
    Pick<CheckIn, 'clearQuiet' | 'clearTurnTimers' | 'armQuiet'> &
    Pick<Agents, 'drop' | 'agentFor' | 'promptFor'>,
) {
  const { options, entities, sessionEvents, agent, stopGraceMs, live, busy, running, switching, internalError, toAgentError, later, newMessageId, getWorkspace, getSession } = ctx;
  const { flushDelta, tickDelta, flushSession, finishReply, clearQuiet, clearTurnTimers, armQuiet, drop, agentFor, promptFor } = deps;

  /** Whether the session has a Deny reason or a queued message to send once this turn ends. */
  const hasNext = (sessionId: SessionId) => {
    const turn = busy.get(sessionId);
    return turn !== undefined && !turn.failed && !ctx.closing && (turn.reasons.length > 0 || turn.queue.length > 0);
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
   * An expired sign-in (`auth_required`) always drops it, so the next message
   * starts a fresh process with the new credentials and reopens the session (9.4).
   * Nothing queued is sent after it.
   */
  const fail = (sessionId: SessionId, entry: Live | undefined, error: AgentError, dropAgent: boolean) => {
    if (ctx.closing) return;
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
      entities.setSessionState(sessionId, 'error', {
        reason: error.message,
        ...(error.code === 'auth_required' ? { errorCode: error.code } : {}),
      });
    } catch (caught) {
      internalError(sessionId, caught);
    }
    if (entry !== undefined && (dropAgent || error.code === 'auth_required')) drop(sessionId, entry);
  };

  /** A tool call turned `completed`: told once, after its event (story 4.7). */
  const completed = (sessionId: SessionId, toolCallId: string, call: ToolCallState) => {
    try {
      options.onToolCallCompleted?.(sessionId, toolCallId, call.diffs);
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  /** Applies one adapter event to the session (AD-4, AD-5). */
  const apply = (sessionId: SessionId, entry: Live, event: AgentEvent) => {
    if (ctx.closing) return;
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
            fail(
              sessionId,
              entry,
              new AgentError(event.code ?? 'agent_failed', event.reason ?? `${agent.displayName} stopped unexpectedly.`),
              event.fatal === true,
            );
          }
          return;
        case 'tool_call': {
          const call: ToolCallState = {
            title: event.title,
            kind: toolKind(event.kind) ?? 'other',
            status: toolStatus(event.status) ?? 'pending',
            diffs: capDiffs(event.diffs),
          };
          const before = entry.toolCalls.get(event.toolCallId);
          entry.toolCalls.set(event.toolCallId, call);
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.tool_call',
            payload: toolCallPayload(sessionId, event.toolCallId, call),
          });
          if (call.status === 'completed' && before?.status !== 'completed') completed(sessionId, event.toolCallId, call);
          return;
        }
        case 'tool_call_update': {
          const known = entry.toolCalls.get(event.toolCallId);
          // A call this turn never reported (a late update after its turn ended): nothing to update.
          if (known === undefined) return;
          const call: ToolCallState = {
            title: event.title ?? known.title,
            kind: toolKind(event.kind) ?? known.kind,
            status: toolStatus(event.status) ?? known.status,
            diffs: capDiffs(event.diffs) ?? known.diffs,
          };
          entry.toolCalls.set(event.toolCallId, call);
          // Diffs can be large: an update repeats them only when they changed (review F1).
          const diffsChanged = !sameDiffs(call.diffs, known.diffs);
          sessionEvents.appendSessionEvent(sessionId, {
            type: 'session.tool_call_updated',
            payload: toolCallPayload(sessionId, event.toolCallId, call, diffsChanged),
          });
          if (call.status === 'completed' && known.status !== 'completed') completed(sessionId, event.toolCallId, call);
          return;
        }
      }
    } catch (error) {
      internalError(sessionId, error);
    }
  };

  /** One prompt and its turn. Ends when the agent ended it, failed, or was dropped (a Stop past its grace, a close). */
  const runTurn = async (session: Session, workspace: Workspace, turn: Turn, messageId: string, text: string): Promise<void> => {
    const entry = agentFor(session, workspace, apply);
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
      if (ctx.closing || turn.failed) break;
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
        sessionEvents.completeMessage(session.id, {
          messageId: following.messageId,
          role: 'user',
          content: following.text,
          // A Deny reason is marked, so Try again never resends it as the user's own message (9.4 review F4).
          ...(following.queued ? {} : { origin: 'deny_reason' as const }),
        });
        entities.setSessionState(session.id, 'working');
      } catch (error) {
        internalError(session.id, error);
        break;
      }
      next = following;
    }
    clearTurnTimers(turn);
    if (ctx.closing || turn.failed) return;
    try {
      const state = entities.getSession(session.id)?.state;
      if (state === 'working' || state === 'waiting') entities.setSessionState(session.id, 'idle');
    } catch (error) {
      internalError(session.id, error);
    }
  };

  const methods: Pick<Chat, 'sendMessage' | 'cancel'> = {
    sendMessage(workspaceId, sessionId, text) {
      if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
      const session = getSession(workspaceId, sessionId);
      const workspace = getWorkspace(workspaceId);
      // Between drivers first: a switch back (or a CLI's exit) still reads `terminal` until it is done (story 3.4).
      if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is switching to or from the terminal. Try again in a moment.');
      if (session.driver === 'terminal') throw new DriverIsTerminalError();
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
      if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
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
        if (ctx.closing || busy.get(sessionId) !== turn) return;
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
  };

  return { hasNext, endTurn, fail, apply, runTurn, takeNext, drive, ...methods };
}
