/**
 * Permission requests (CAP-4; story 2.3 stub, replaced by 2.6): what core
 * answers when an agent asks to run a tool call. The tool call does not run
 * until {@link Permissions.request} resolves.
 *
 * Story 2.6 turns this into cards: `permission.requested` and
 * `permission.resolved` appended through the session-event helper (E2-R7),
 * always-allow rules stored and enforced here, and the caution level (2.8).
 */
import type { SessionId } from '@ogden-agents/shared';
import type { AgentPermissionDecision, AgentPermissionRequest } from './agent-port.js';

export interface Permissions {
  /** Decides one request from the session's agent. Never rejects: a failure is a deny. */
  request(sessionId: SessionId, request: AgentPermissionRequest): Promise<AgentPermissionDecision>;
}

/**
 * The stub until permission cards ship: denies every request and appends
 * nothing, so nothing an agent asks to run, runs without a person.
 */
export function createDecliningPermissions(): Permissions {
  return {
    request: async () => ({ outcome: 'deny' }),
  };
}
