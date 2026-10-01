/**
 * The agents' permission requests (moved from `chat.ts`, story 3.11): the
 * handler each agent session is given, and a request made after a Stop.
 */
import { DEFAULT_CAUTION_LEVEL, type Session, type SessionId } from '@ogden-agents/shared';
import type { AgentPermissionDecision, AgentPermissionRequest } from '../agent-port.js';
import type { CheckIn } from './check-in.js';
import { deniedMessage } from './constants.js';
import type { ChatContext } from './context.js';
import type { Replies } from './replies.js';
import { toolKind } from './tool-calls.js';

export function createPermissionRequests(ctx: ChatContext, deps: Pick<Replies, 'flushSession'> & Pick<CheckIn, 'armQuiet'>) {
  const { sessionEvents, permissions, busy, internalError, nextUlid } = ctx;
  const { flushSession, armQuiet } = deps;

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

  /** The handler for the session's agent: what it asks goes to {@link Permissions}. */
  const onPermissionRequestFor = (session: Session) => async (request: AgentPermissionRequest): Promise<AgentPermissionDecision> => {
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

  return { recordStoppedRequest, onPermissionRequestFor };
}

export type PermissionRequests = ReturnType<typeof createPermissionRequests>;
