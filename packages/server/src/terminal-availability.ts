/**
 * Whether a session's agent's own terminal can work here (CAP-5, E3-R7): the
 * `terminal` of `GET` session, which the driver toggle shows as its disabled
 * reason (stories 3.2, 3.7).
 *
 * The checks are core's switch refusal (switching to the terminal), in the
 * same order, so a session this calls available is one core switches:
 * `agent_unsupported` → no terminal port (`pty_unavailable`) →
 * `no_agent_session` → `node-pty` (`pty_unavailable`) → the CLI
 * (`cli_not_found`). The words and their filtering are core's
 * ({@link terminalUnavailableReason}, story 3.4), shared with its refusal.
 *
 * Cheap and side-effect free: no subscription refresh, no process spawn, no
 * cache beyond the request. A reason is plain words for the user: never a
 * path, a command line, an error stack or a secret. Not being `idle` is not a
 * reason here: the UI reads the session's state.
 */
import { AGENT_SESSION_REF, PTY_LOAD_FAILED, terminalUnavailableReason, type AgentPort, type TerminalPort } from '@ogden-agents/core';
import type { Session, SessionTerminal } from '@ogden-agents/shared';

/** The terminal of one session, as `GET` session reports it. */
export type TerminalAvailabilityCheck = (session: Session) => Promise<SessionTerminal>;

export interface TerminalAvailabilityOptions {
  /** The chat's agent: whether its CLI can resume its sessions, and whether it is here (`locate`: never a wrapper that refreshes sign-in). */
  agent: Pick<AgentPort, 'displayName' | 'terminalResume'>;
  /** The terminal port the chat itself uses; `undefined` when there is none. */
  terminal?: TerminalPort;
  /** The chat's agent environment, read without refreshing anything. */
  env?: () => Readonly<Record<string, string>>;
}

/** Re-exported for the callers that named it here (story 3.7); core owns it (story 3.4). */
export { PTY_LOAD_FAILED };

export function createTerminalAvailability({ agent, terminal, env = () => ({}) }: TerminalAvailabilityOptions): TerminalAvailabilityCheck {
  return async (session) => {
    const resume = agent.terminalResume;
    if (resume === undefined) {
      return { available: false, code: 'agent_unsupported', reason: terminalUnavailableReason.agentUnsupported(agent.displayName) };
    }
    if (terminal === undefined) return { available: false, code: 'pty_unavailable', reason: terminalUnavailableReason.noTerminalPort() };
    const ref = session.adapterRefs[AGENT_SESSION_REF];
    if (ref === undefined || ref === '') {
      return { available: false, code: 'no_agent_session', reason: terminalUnavailableReason.noAgentSession(agent.displayName) };
    }
    const pty = await terminal.available();
    if (!pty.ok) {
      return { available: false, code: 'pty_unavailable', reason: terminalUnavailableReason.ptyUnavailable(pty.reason) };
    }
    const located = await resume.locate({ ...env() });
    if (!located.found) {
      return { available: false, code: 'cli_not_found', reason: terminalUnavailableReason.cliNotFound(agent.displayName, located.reason) };
    }
    return { available: true };
  };
}
