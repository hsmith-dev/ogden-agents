/**
 * The plain reasons the terminal is unavailable (E3-R7), shared by core's
 * switch refusal (`chat/terminal.ts`, 409 `terminal_unavailable`) and the
 * server's availability check (`GET` session's `terminal`, story 3.7), so the
 * wording and the filtering cannot drift (story 3.4; 3.7 deferred-work).
 *
 * A reason is plain words for the user: never a path, a command line, an
 * error stack or a secret. A reason that came from elsewhere (`node-pty`'s
 * load error, the CLI lookup) goes through {@link plainTerminalReason}.
 */

/** Shown in place of `node-pty`'s own reason when that names a path or spans lines. */
export const PTY_LOAD_FAILED = 'the terminal module could not be loaded';

/** Anything that reads as a file path, a home folder, a stack frame or a second line. */
const NOT_PLAIN = /[/\\~\r\n]|\bat\s+\S+\s*\(/;

/** `reason` when it is plain words, else `fallback`. */
export function plainTerminalReason(reason: string, fallback: string): string {
  const trimmed = reason.trim();
  return trimmed === '' || NOT_PLAIN.test(trimmed) ? fallback : trimmed;
}

/** Each refusal's words (EXPERIENCE.md), by `SessionTerminal` code. */
export const terminalUnavailableReason = {
  agentUnsupported: (agentName: string) => `${agentName} can't pick up this session in its terminal.`,
  noTerminalPort: () => "The terminal couldn't start on this computer.",
  ptyUnavailable: (reason: string) => `The terminal couldn't start on this computer: ${plainTerminalReason(reason, PTY_LOAD_FAILED)}`,
  noAgentSession: (agentName: string) => `Send ${agentName} a message first, then switch to the terminal.`,
  cliNotFound: (agentName: string, reason: string) => plainTerminalReason(reason, `${agentName}'s terminal couldn't be found on this computer.`),
};
