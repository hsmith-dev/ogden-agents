/** The chat use-case's exported constants (moved from `chat.ts`, story 3.11). */

/** The reason on sessions the server moved to `idle` because it stopped or restarted under them (AD-3). */
export const RESTARTED_REASON = 'Ogden Agents was restarted';

/** The adapter ref that holds the agent's own session id (AD-9). */
export const AGENT_SESSION_REF = 'agentSessionId';

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

/** The size a terminal opens at, until its viewer resizes it. */
export const TERMINAL_COLS = 80;
export const TERMINAL_ROWS = 24;
