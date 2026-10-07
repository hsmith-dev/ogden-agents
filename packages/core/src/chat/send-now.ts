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
    const before = turn.steering;
    const attempt = (async () => {
      try {
        // Serialize transcript boundaries for multiple messages sent right away.
        await before;
        const started = entry === undefined ? undefined : await entry.agent.catch(() => undefined);
        // Stopped, taken by the next turn, or removed meanwhile: nothing more to do here.
        if (ctx.closing || busy.get(sessionId) !== turn || turn.failed || turn.stopping || !turn.queue.includes(item)) return;
        // No prompt out yet (the agent is still starting, or between turns): tried again once it is (review).
        if (turn.prompting !== true) {
          turn.whenPrompting = () => deliver(sessionId, turn, item);
          return;
        }
        // A card waits: it is never answered for the user; the message goes first after the turn.
        if (waiting(sessionId)) return;
        if (started?.steer === undefined) {
          interrupt(sessionId, turn, item);
          return;
        }
        entry!.steeringEvents = [];
        let outcome: 'injected' | 'no_turn' | 'refused' | 'unanswered';
        try {
          outcome = (await Promise.race([started.steer(item.text), timeout(), entry!.gone.then(() => undefined)])) ?? 'unanswered';
        } catch {
          outcome = 'refused';
        }
        if (ctx.closing) return;
        if (outcome === 'injected') {
          // The agent has it, whatever happened meanwhile (a Stop included): the transcript says so (review).
          const at = turn.queue.indexOf(item);
          if (at !== -1) turn.queue.splice(at, 1);
          // The reply so far is closed: what the agent says next answers this message.
          const current = live.get(sessionId);
          if (current !== undefined) finishReply(sessionId, current);
          flushSession(sessionId);
          sessionEvents.completeMessage(sessionId, { messageId: item.messageId, role: 'user', content: item.text, delivery: 'injected' });
          return;
        }
        if (busy.get(sessionId) !== turn || turn.failed || !turn.queue.includes(item)) return;
        // The turn had just ended: it goes next. Not answered in time: the request can't be withdrawn,
        // so stopping the step could deliver it twice; it goes first after the turn instead (review).
        if (outcome === 'no_turn' || outcome === 'unanswered') return;
        interrupt(sessionId, turn, item);
      } finally {
        const held = entry?.steeringEvents;
        if (entry !== undefined) entry.steeringEvents = undefined;
        if (held !== undefined && !ctx.closing && live.get(sessionId) === entry) for (const apply of held) apply();
        item.sending = false;
      }
    })().catch((error: unknown) => internalError(sessionId, error));
    turn.steering = before === undefined ? attempt : Promise.all([before, attempt]).then(() => undefined);
  };

  /** The waiting message `messageId` of a chat the composer drives, or `MessageNotQueuedError`. */
  const queued = (workspaceId: WorkspaceId, sessionId: SessionId, messageId: string) => {
    chatDrives(workspaceId, sessionId);
    const turn = busy.get(sessionId);
    const item = turn?.queue.find((candidate) => candidate.messageId === messageId);
    if (turn === undefined || turn.failed || item === undefined || item.sending === true) throw new MessageNotQueuedError();
    return { turn, item };
  };

  const methods: Pick<Chat, 'sendMessage' | 'updateQueuedMessage' | 'removeQueuedMessage' | 'sendQueuedMessageNow'> = {
    sendMessage(workspaceId, sessionId, text, options) {
      if (options?.delivery !== 'now') return deps.sendMessage(workspaceId, sessionId, text, options);
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
