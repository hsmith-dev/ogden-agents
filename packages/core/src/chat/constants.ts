/** The chat use-case's exported constants (moved from `chat.ts`, story 3.11). */

/** The reason on sessions the server moved to `idle` because it stopped or restarted under them (AD-3). */
export const RESTARTED_REASON = 'Ogden Agents was restarted';

/** The adapter ref that holds the agent's own session id (AD-9). */
export const AGENT_SESSION_REF = 'agentSessionId';

/**
 * The adapter ref that marks where the CLI's record stood when the session's
 * terminal opened (story 3.3): its last turn's id, `start` when it had none,
 * or empty when it couldn't be read. Switching back imports the turns after it.
 */
export const TERMINAL_IMPORT_REF = 'terminalImportMark';

/**
 * The adapter ref that says a terminal opened and its turns have not been
 * imported yet (story 3.4): `1` from the CLI's start until an import ran,
 * else empty. A start after a crash imports the turns of every session that
 * has it.
 */
export const TERMINAL_IMPORT_PENDING_REF = 'terminalImportPending';

/** The most messages a session holds queued while its agent answers; the next one is refused (409). */
export const MAX_QUEUED_MESSAGES = 20;

/** How long an agent may send nothing while `working` before core checks in (user decision: 10 minutes, no timeout). */
export const DEFAULT_CHECK_IN_MS = 10 * 60_000;

/** The shortest and longest check-in delay core accepts (a timer can't wait longer than 2^31-1 ms). */
export const MIN_CHECK_IN_MS = 1_000;
export const MAX_CHECK_IN_MS = 2 ** 31 - 1;

/** `ms` as a usable check-in delay: a whole number within [{@link MIN_CHECK_IN_MS}, {@link MAX_CHECK_IN_MS}]. */
export const clampCheckInDelay = (ms: number): number =>
  Number.isFinite(ms) ? Math.min(MAX_CHECK_IN_MS, Math.max(MIN_CHECK_IN_MS, Math.round(ms))) : DEFAULT_CHECK_IN_MS;

/** The longest command or title a Deny-reason message quotes, ellipsis included. */
export const MAX_DENIED_QUOTE_LENGTH = 200;

/** The user's message that carries a Deny reason to the agent after the turn (user decision, story 2.10). */
export const deniedMessage = (what: string, reason: string): string => {
  const quoted = what.length > MAX_DENIED_QUOTE_LENGTH ? `${what.slice(0, MAX_DENIED_QUOTE_LENGTH - 1)}…` : what;
  return `I denied "${quoted}": ${reason}`;
};

/** At most one `session.message_delta` per reply in this many milliseconds (2.2 per-chunk writes). */
export const DELTA_INTERVAL_MS = 50;

/** How long Stop waits for the agent to end its turn before it drops the agent. */
export const STOP_GRACE_MS = 5_000;

/** The most recent terminal output core keeps (in memory only) for a viewer that attaches. */
export const TERMINAL_BACKLOG_CHARS = 64 * 1024;

/** How long switching back (or a close) waits for a killed terminal to report its exit. */
export const TERMINAL_EXIT_GRACE_MS = 2_000;

/** How long switching to the terminal waits for the session's agent to stop before it refuses ("still stopping"). */
export const TERMINAL_RELEASE_TIMEOUT_MS = 10_000;

/** How long a close waits for the switches in flight to end before it stops their terminals anyway. */
export const TERMINAL_CLOSE_WAIT_MS = TERMINAL_RELEASE_TIMEOUT_MS + TERMINAL_EXIT_GRACE_MS;

/** The agent's note in the chat when its CLI exited by itself with an error (story 3.4, user decision). */
export const terminalClosedNote = (agentName: string, exitCode: number | null): string =>
  exitCode === null ? `${agentName}'s terminal closed unexpectedly.` : `${agentName}'s terminal closed unexpectedly (exit code ${exitCode}).`;

/** The size a terminal opens at, until its viewer resizes it. */
export const TERMINAL_COLS = 80;
export const TERMINAL_ROWS = 24;
