/**
 * Whether a session's agent's own terminal can work here (CAP-5, E3-R7): the
 * `terminal` of `GET` session, which the driver toggle shows as its disabled
 * reason (stories 3.2, 3.7).
 *
 * The checks are core's switch refusal (switching to the terminal), in the
 * same order, so a session this calls available is one core switches:
 * `agent_unsupported` → no terminal port (`pty_unavailable`) →
 * `no_agent_session` → `node-pty` (`pty_unavailable`) → the CLI
 * (`cli_not_found`). Core exposes no such query without switching; story 3.9
 * makes the two share one function (deferred-work).
 *
 * Cheap and side-effect free: no subscription refresh, no process spawn, no
 * cache beyond the request. A reason is plain words for the user: never a
 * path, a command line, an error stack or a secret. Not being `idle` is not a
 * reason here: the UI reads the session's state.
 */
import { AGENT_SESSION_REF, type AgentPort, type TerminalPort } from '@ogden-agents/core';
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

/** Shown in place of `node-pty`'s own reason when that names a path or spans lines. */
export const PTY_LOAD_FAILED = 'the terminal module could not be loaded';

/** Anything that reads as a file path, a home folder, a stack frame or a second line. */
const NOT_PLAIN = /[/\\~\r\n]|\bat\s+\S+\s*\(/;

/** `reason` when it is plain words, else `fallback`. */
function plainOr(reason: string, fallback: string): string {
  const trimmed = reason.trim();
  return trimmed === '' || NOT_PLAIN.test(trimmed) ? fallback : trimmed;
}

export function createTerminalAvailability({ agent, terminal, env = () => ({}) }: TerminalAvailabilityOptions): TerminalAvailabilityCheck {
  return async (session) => {
    const resume = agent.terminalResume;
    if (resume === undefined) {
      return { available: false, code: 'agent_unsupported', reason: `${agent.displayName} can't pick up this session in its terminal.` };
    }
    if (terminal === undefined) return { available: false, code: 'pty_unavailable', reason: "The terminal couldn't start on this computer." };
    const ref = session.adapterRefs[AGENT_SESSION_REF];
    if (ref === undefined || ref === '') {
      return { available: false, code: 'no_agent_session', reason: `Send ${agent.displayName} a message first, then switch to the terminal.` };
    }
    const pty = await terminal.available();
    if (!pty.ok) {
      return { available: false, code: 'pty_unavailable', reason: `The terminal couldn't start on this computer: ${plainOr(pty.reason, PTY_LOAD_FAILED)}` };
    }
    const located = await resume.locate({ ...env() });
    if (!located.found) {
      return { available: false, code: 'cli_not_found', reason: plainOr(located.reason, `${agent.displayName}'s terminal couldn't be found on this computer.`) };
    }
    return { available: true };
  };
}
