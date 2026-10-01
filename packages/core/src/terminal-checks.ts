/**
 * The checks that say whether a session's agent's own terminal can open
 * (E3-R7), in one list (story 3.9), shared by core's switch refusal
 * (`chat/terminal.ts`, 409 `terminal_unavailable`) and the server's
 * availability check (`GET` session's `terminal`), so their order cannot
 * drift. The words are {@link terminalUnavailableReason}'s (story 3.4).
 *
 * Two stages, because core checks that the session is idle between them:
 * {@link checkTerminalSupport} (`agent_unsupported` → no terminal port,
 * `pty_unavailable`), then {@link checkTerminalReady} (`no_agent_session` →
 * `node-pty`, `pty_unavailable` → the CLI, `cli_not_found`).
 */
import type { SessionTerminal } from '@ogden-agents/shared';
import type { AgentPort, AgentTerminalResume } from './agent-port.js';
import type { TerminalPort } from './terminal-port.js';
import { terminalUnavailableReason } from './terminal-reasons.js';

/** A terminal that can't open here: its code and plain reason. */
export type TerminalUnavailable = Extract<SessionTerminal, { available: false }>;

/** What the first stage found: the agent's resume and the terminal port. */
export interface TerminalSupport {
  resume: AgentTerminalResume;
  terminal: TerminalPort;
}

/** Stage one: the agent can resume its sessions in its CLI, and there is a terminal port. */
export function checkTerminalSupport(agent: Pick<AgentPort, 'displayName' | 'terminalResume'>, terminal: TerminalPort | undefined): TerminalSupport | TerminalUnavailable {
  const resume = agent.terminalResume;
  if (resume === undefined) return { available: false, code: 'agent_unsupported', reason: terminalUnavailableReason.agentUnsupported(agent.displayName) };
  if (terminal === undefined) return { available: false, code: 'pty_unavailable', reason: terminalUnavailableReason.noTerminalPort() };
  return { resume, terminal };
}

export interface TerminalReadyInput {
  agent: Pick<AgentPort, 'displayName'>;
  support: TerminalSupport;
  /** The session's agent session id; `undefined` when it never reached an agent. */
  agentSessionId: string | undefined;
  /** The agent's environment for the CLI lookup. */
  env: () => Readonly<Record<string, string>>;
  /** Runs each async check: core bounds it by its deadline; the server passes the promise as it is. */
  step: <T>(promise: Promise<T>) => Promise<T>;
}

/** Stage two: the session reached an agent, `node-pty` loads, the CLI is here. `undefined` when all pass. */
export async function checkTerminalReady({ agent, support, agentSessionId, env, step }: TerminalReadyInput): Promise<TerminalUnavailable | undefined> {
  if (agentSessionId === undefined) return { available: false, code: 'no_agent_session', reason: terminalUnavailableReason.noAgentSession(agent.displayName) };
  const pty = await step(support.terminal.available());
  // `node-pty`'s own reason can name a path: only plain words reach the user (3.7's filter, shared).
  if (!pty.ok) return { available: false, code: 'pty_unavailable', reason: terminalUnavailableReason.ptyUnavailable(pty.reason) };
  const located = await step(support.resume.locate(env()));
  if (!located.found) return { available: false, code: 'cli_not_found', reason: terminalUnavailableReason.cliNotFound(agent.displayName, located.reason) };
  return undefined;
}
