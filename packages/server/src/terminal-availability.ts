/**
 * Whether a session's agent's own terminal can work here (CAP-5, E3-R7): the
 * `terminal` of `GET` session, which the driver toggle shows as its disabled
 * reason. Story 3.2's stub: `agent_unsupported` for an agent without
 * `terminalResume`, else available; story 3.7 owns this file and adds the
 * session, `node-pty` and CLI checks (never in the adapter).
 *
 * A reason is plain words for the user: never a path, a command line or a
 * secret. Not being `idle` is not a reason here: the UI reads the session's state.
 */
import type { AgentPort } from '@ogden-agents/core';
import type { Session, SessionTerminal } from '@ogden-agents/shared';

/** The terminal of one session, as `GET` session reports it. */
export type TerminalAvailabilityCheck = (session: Session) => Promise<SessionTerminal>;

export interface TerminalAvailabilityOptions {
  /** The chat's agent: whether its CLI can resume its sessions. */
  agent: Pick<AgentPort, 'displayName' | 'terminalResume'>;
}

export function createTerminalAvailability({ agent }: TerminalAvailabilityOptions): TerminalAvailabilityCheck {
  return async () =>
    agent.terminalResume === undefined
      ? { available: false, code: 'agent_unsupported', reason: `${agent.displayName} can't be opened in its own terminal.` }
      : { available: true };
}
