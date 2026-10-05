/**
 * Whether a session's agent's own terminal can work here (CAP-5, E3-R7): the
 * `terminal` of `GET` session, which the driver toggle shows as its disabled
 * reason (stories 3.2, 3.7).
 *
 * The checks are core's switch refusal (switching to the terminal), the
 * same list (`checkTerminalSupport`, then `checkTerminalReady`; story 3.9),
 * so a session this calls available is one core switches:
 * `agent_unsupported` → no terminal port (`pty_unavailable`) →
 * `no_agent_session` → `node-pty` (`pty_unavailable`) → the CLI
 * (`cli_not_found`). The words and their filtering are core's
 * (`terminalUnavailableReason`, story 3.4), shared with its refusal.
 *
 * Cheap and side-effect free: no subscription refresh, no process spawn, no
 * cache beyond the request. A reason is plain words for the user: never a
 * path, a command line, an error stack or a secret. Not being `idle` is not a
 * reason here: the UI reads the session's state.
 */
import { AGENT_SESSION_REF, checkTerminalReady, checkTerminalSupport, PTY_LOAD_FAILED, type AgentPort, type TerminalPort } from '@ogden-agents/core';
import type { Session, SessionTerminal } from '@ogden-agents/shared';

/** The terminal of one session, as `GET` session reports it. */
export type TerminalAvailabilityCheck = (session: Session) => Promise<SessionTerminal>;

type TerminalAgent = Pick<AgentPort, 'displayName' | 'terminalResume'>;

export interface TerminalAvailabilityOptions {
  /**
   * The session's agent (epic 6: each session has its own): whether its CLI
   * can resume its sessions, and whether it is here (`locate`: never a
   * wrapper that refreshes sign-in). A function is asked per session.
   */
  agent: TerminalAgent | ((session: Session) => TerminalAgent);
  /** The terminal port the chat itself uses; `undefined` when there is none. */
  terminal?: TerminalPort;
  /** The session's agent environment, read without refreshing anything. */
  env?: (session: Session) => Readonly<Record<string, string>>;
}

/** Re-exported for the callers that named it here (story 3.7); core owns it (story 3.4). */
export { PTY_LOAD_FAILED };

export function createTerminalAvailability({ agent: agentOption, terminal, env = () => ({}) }: TerminalAvailabilityOptions): TerminalAvailabilityCheck {
  return async (session) => {
    const agent = typeof agentOption === 'function' ? agentOption(session) : agentOption;
    const support = checkTerminalSupport(agent, terminal);
    if ('available' in support) return support;
    const ref = session.adapterRefs[AGENT_SESSION_REF];
    const agentSessionId = ref === undefined || ref === '' ? undefined : ref;
    // No deadline here: each check's promise is awaited as it is.
    const unavailable = await checkTerminalReady({ agent, support, agentSessionId, env: () => ({ ...env(session) }), step: (promise) => promise });
    return unavailable ?? { available: true };
  };
}
