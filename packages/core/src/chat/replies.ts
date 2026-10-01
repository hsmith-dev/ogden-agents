/** Coalesced reply deltas (2.2 per-chunk writes), moved from `chat.ts` (story 3.11). */
import type { SessionId } from '@ogden-agents/shared';
import { DELTA_INTERVAL_MS } from './constants.js';
import type { ChatContext } from './context.js';
import type { Live } from './types.js';

export function createReplies(ctx: ChatContext) {
  const { sessionEvents, live, internalError, later } = ctx;

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
    if (ctx.closing || entry.pendingDelta === '') return;
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

  return { flushDelta, stopDeltaTimer, tickDelta, flushSession, finishReply };
}

export type Replies = ReturnType<typeof createReplies>;
