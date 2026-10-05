/**
 * Send now or wait (2026-10-04): a message sent while the agent works can go
 * right away instead of waiting for the turn to end, and the messages that
 * wait are a list the user changes (edit, move, remove, send right away).
 *
 * A message sent right away is queued ahead of every waiting one
 * (`session.message_queued` with `now`), then:
 * - into the running turn when the agent can take it there (its session has
 *   `steer`): once the agent took it, the reply so far is closed and the
 *   message completes (`delivery: 'injected'`); what the agent says next is a
 *   new reply in the same turn;
 * - else, or when that failed, the current step is stopped
 *   (`session.turn_interrupted`) and the queue, that message first, goes on
 *   after it: nothing waiting is dropped.
 * A permission card waiting for an answer is never answered for the user:
 * sending right away is refused while one waits, and a card that appears
 * while the message is on its way leaves it first in line instead.
 */
import type { QueueChangeCause, SessionId, WorkspaceId } from '@ogden-agents/shared';
import { AnswerFirstError, DriverIsTerminalError, InvalidOperationError, MessageNotQueuedError, QueueFullError, SessionBusyError, SessionNotIdleError, ValidationError } from '../errors.js';
import { MAX_QUEUED_MESSAGES, STEER_TIMEOUT_MS } from './constants.js';
import type { ChatContext } from './context.js';
import type { Replies } from './replies.js';
import type { Chat, QueuedItem, Turn } from './types.js';

type Turns = { sendMessage: Chat['sendMessage']; stop(sessionId: SessionId, turn: Turn, options: { keepQueue: boolean }): void };

export function createSendNow(ctx: ChatContext, deps: Turns & Pick<Replies, 'finishReply' | 'flushSession'>) {
  const { sessionEvents, entities, busy, live, switching, newMessageId, internalError, getSession, later } = ctx;
  const { finishReply, flushSession } = deps;

  /** Refuses what a chat the terminal drives (or one switching) can't do, as `sendMessage` does. */
  const chatDrives = (workspaceId: WorkspaceId, sessionId: SessionId) => {
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    const session = getSession(workspaceId, sessionId);
    if (switching.has(sessionId)) throw new SessionNotIdleError('This chat is switching to or from the terminal. Try again in a moment.');
    if (session.driver === 'terminal') throw new DriverIsTerminalError();
  };

  const queueChanged = (sessionId: SessionId, turn: Turn, cause: QueueChangeCause) => {
    flushSession(sessionId);
    sessionEvents.appendSessionEvent(sessionId, {
      type: 'session.queue_changed',
      payload: { sessionId, queue: turn.queue.map(({ messageId, text, now }) => ({ messageId, content: text, ...(now ? { now: true as const } : {}) })), cause },
    });
  };

  /** After the other messages sent right away, ahead of every one that waits. */
  const placeAhead = (turn: Turn, item: QueuedItem) => {
    const at = turn.queue.findIndex((queued) => queued.now !== true);
    if (at === -1) turn.queue.push(item);
    else turn.queue.splice(at, 0, item);
  };

  const waiting = (sessionId: SessionId) => entities.getSession(sessionId)?.state === 'waiting';

  /**
   * Stops the current step so `item` goes next. Nothing to stop (no prompt
   * out, a Stop already ending it) or a card waiting: it just goes first.
   */
  const interrupt = (sessionId: SessionId, turn: Turn, item: QueuedItem) => {
    if (ctx.closing || busy.get(sessionId) !== turn || turn.failed || turn.stopping || turn.prompting !== true || !turn.queue.includes(item) || waiting(sessionId)) return;
    sessionEvents.appendSessionEvent(sessionId, { type: 'session.turn_interrupted', payload: { sessionId, messageId: item.messageId } });
    deps.stop(sessionId, turn, { keepQueue: true });
  };

  /** Resolves `undefined` after {@link STEER_TIMEOUT_MS}: an agent that never answers is stopped instead. */
  const timeout = () =>
    new Promise<undefined>((resolve) => {
      later(STEER_TIMEOUT_MS, () => resolve(undefined));
    });

  /** Sends `item` (already first in line) right away: into the turn, else by stopping the step. */
  const deliver = (sessionId: SessionId, turn: Turn, item: QueuedItem) => {
    if (turn.stopping) return;
    const entry = live.get(sessionId);
    item.sending = true;
    const attempt = (async () => {
      try {
        const started = entry === undefined ? undefined : await entry.agent.catch(() => undefined);
        if (ctx.closing || busy.get(sessionId) !== turn) return;
        // No prompt out (the agent is still starting, or between turns): it goes next anyway.
        if (turn.prompting !== true) return;
        if (started?.steer === undefined || waiting(sessionId)) {
          if (started?.steer === undefined) interrupt(sessionId, turn, item);
          return;
        }
        // The reply so far is closed before the message goes: what the agent says next answers it.
        const current = live.get(sessionId);
        if (current !== undefined) finishReply(sessionId, current);
        let outcome: 'injected' | 'no_turn' | undefined;
        try {
          outcome = await Promise.race([started.steer(item.text), timeout(), entry!.gone.then(() => undefined)]);
        } catch {
          outcome = undefined;
        }
        // Stopped, removed or failed meanwhile: what the turn did with it is the Stop's ("Not sent").
        if (ctx.closing || busy.get(sessionId) !== turn || turn.failed || !turn.queue.includes(item)) return;
        if (outcome === 'injected') {
          turn.queue.splice(turn.queue.indexOf(item), 1);
          flushSession(sessionId);
          sessionEvents.completeMessage(sessionId, { messageId: item.messageId, role: 'user', content: item.text, delivery: 'injected' });
          return;
        }
        // The turn had just ended: it goes next.
        if (outcome === 'no_turn') return;
        interrupt(sessionId, turn, item);
      } finally {
        item.sending = false;
      }
    })().catch((error: unknown) => internalError(sessionId, error));
    const before = turn.steering;
    turn.steering = before === undefined ? attempt : Promise.all([before, attempt]).then(() => undefined);
  };

  /** The waiting message `messageId` of a chat the composer drives, or `MessageNotQueuedError`. */
  const queued = (workspaceId: WorkspaceId, sessionId: SessionId, messageId: string) => {
    chatDrives(workspaceId, sessionId);
    const turn = busy.get(sessionId);
    const item = turn?.queue.find((candidate) => candidate.messageId === messageId);
    if (turn === undefined || turn.failed || turn.stopping || item === undefined || item.sending === true) throw new MessageNotQueuedError();
    return { turn, item };
  };

  const methods: Pick<Chat, 'sendMessage' | 'updateQueuedMessage' | 'removeQueuedMessage' | 'sendQueuedMessageNow'> = {
    sendMessage(workspaceId, sessionId, text, options) {
      if (options?.delivery !== 'now') return deps.sendMessage(workspaceId, sessionId, text);
      chatDrives(workspaceId, sessionId);
      const turn = busy.get(sessionId);
      // Nothing running: it is sent at once either way.
      if (turn === undefined) return deps.sendMessage(workspaceId, sessionId, text);
      if (turn.failed) throw new SessionBusyError(sessionId);
      if (waiting(sessionId)) throw new AnswerFirstError();
      if (turn.queue.length >= MAX_QUEUED_MESSAGES) throw new QueueFullError(sessionId);
      const messageId = newMessageId();
      flushSession(sessionId);
      sessionEvents.appendSessionEvent(sessionId, { type: 'session.message_queued', payload: { sessionId, messageId, content: text, now: true } });
      const item: QueuedItem = { messageId, text, now: true };
      placeAhead(turn, item);
      deliver(sessionId, turn, item);
      return { messageId, queued: true };
    },

    updateQueuedMessage(workspaceId, sessionId, messageId, change) {
      if (change.content === undefined && change.position === undefined) throw new ValidationError('Choose what to change.', [{ path: [], message: 'nothing to change' }]);
      if (change.content !== undefined && change.content.trim() === '') throw new ValidationError('Write a message first.', [{ path: ['content'], message: 'empty' }]);
      const { turn, item } = queued(workspaceId, sessionId, messageId);
      if (change.content !== undefined) item.text = change.content;
      if (change.position !== undefined) {
        turn.queue.splice(turn.queue.indexOf(item), 1);
        turn.queue.splice(Math.min(Math.max(0, Math.trunc(change.position)), turn.queue.length), 0, item);
      }
      queueChanged(sessionId, turn, change.content !== undefined ? 'edited' : 'moved');
    },

    removeQueuedMessage(workspaceId, sessionId, messageId) {
      const { turn, item } = queued(workspaceId, sessionId, messageId);
      turn.queue.splice(turn.queue.indexOf(item), 1);
      queueChanged(sessionId, turn, 'removed');
    },

    sendQueuedMessageNow(workspaceId, sessionId, messageId) {
      const { turn, item } = queued(workspaceId, sessionId, messageId);
      if (waiting(sessionId)) throw new AnswerFirstError();
      turn.queue.splice(turn.queue.indexOf(item), 1);
      item.now = true;
      placeAhead(turn, item);
      queueChanged(sessionId, turn, 'sent_now');
      deliver(sessionId, turn, item);
    },
  };

  return methods;
}
