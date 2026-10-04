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

/**
 * Anything that reads as a file path (a slash, a backslash, a drive letter),
 * a home folder, a stack frame, a second line, or a setting (`NAME=value`,
 * which could be a secret).
 */
const NOT_PLAIN = /[/\\~\r\n=]|\b[A-Za-z]:|\bat\s+\S+\s*\(/;

/** The longest reason shown; a longer one is cut, ending in `...`. */
export const MAX_TERMINAL_REASON_CHARS = 200;

/** `reason` when it is plain words (cut to {@link MAX_TERMINAL_REASON_CHARS}), else `fallback`. */
export function plainTerminalReason(reason: string, fallback: string): string {
  const trimmed = reason.trim();
  if (trimmed === '' || NOT_PLAIN.test(trimmed)) return fallback;
  return trimmed.length > MAX_TERMINAL_REASON_CHARS ? `${trimmed.slice(0, MAX_TERMINAL_REASON_CHARS - 3)}...` : trimmed;
}

/** Each refusal's words (EXPERIENCE.md), by `SessionTerminal` code. */
export const terminalUnavailableReason = {
  agentUnsupported: (agentName: string) => `${agentName} can't pick up this session in its terminal.`,
  noTerminalPort: () => "The terminal couldn't start on this computer.",
  ptyUnavailable: (reason: string) => `The terminal couldn't start on this computer: ${plainTerminalReason(reason, PTY_LOAD_FAILED)}`,
  noAgentSession: (agentName: string) => `Send ${agentName} a message first, then switch to the terminal.`,
  cliNotFound: (agentName: string, reason: string) => plainTerminalReason(reason, `${agentName}'s terminal couldn't be found on this computer.`),
  /** Opening it took too long (story 3.4): a check, the lookup or the spawn hung. */
  tooSlow: (agentName: string) => `${agentName}'s terminal took too long to start. Try again.`,
};
