/** The quiet agent (2.2 hung agent: a check-in, never a timeout), moved from `chat.ts` (story 3.11). */
import type { SessionId } from '@ogden-agents/shared';
import type { ChatContext } from './context.js';
import type { Replies } from './replies.js';
import type { Turn } from './types.js';

export function createCheckIn(ctx: ChatContext, deps: Pick<Replies, 'flushDelta'>) {
  const { entities, sessionEvents, checkInDelayMs, live, busy, internalError, later } = ctx;
  const { flushDelta } = deps;

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
    if (turn === undefined || turn.stopping || turn.failed || ctx.closing) return;
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
    if (ctx.closing || busy.get(sessionId) !== turn || turn.stopping || turn.failed) return;
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

  return { clearQuiet, clearTurnTimers, armQuiet, checkIn };
}

export type CheckIn = ReturnType<typeof createCheckIn>;
