/**
 * The build runner port (AD-1, AD-5, AD-12; story 5.2's tracer, completed
 * and frozen by story 5.3 for 5.4 and 5.7): what makes a run's `build`
 * session build one named ticket, how the session's per-run JSON result is
 * read back, and which of Ogden Agents' blocked codes a halt is. Core names
 * no skill and never reads a halt's words itself (AD-12); the
 * `buildrunner-acp` adapter is the only place that does.
 */
import type { BlockedCode, BuildAgent, BuildRunResult, RunId } from '@ogden-agents/shared';

export interface BuildInvocationOptions {
  /** The user's note to the agent (Reject and retry, Retry; 5.9), carried in the first message. */
  note?: string | undefined;
  /** Resume a ticket from its plan's status (Retry, a checkpoint pause; 5.4, 5.8) rather than start it. */
  resume?: boolean | undefined;
}

export interface BuildRunnerPort {
  /** The agent this runner builds with (Claude Code in v1; epic 6 adds runners, not core). */
  readonly agent: BuildAgent;
  /** The first message a run's `build` session is sent, for ticket `ref`. */
  invocation(ref: string, options?: BuildInvocationOptions): string;
  /**
   * Ogden Agents' blocked code for a halt, from the blocking condition the
   * skill wrote (the plan's `blocked_reason`). Every known halt has one;
   * anything else is `other`. Never throws.
   */
  blockedCode(condition: string): BlockedCode;
  /**
   * The per-run JSON result in `runFolder` (the run's folder in Ogden
   * Agents' data folder) for `expected`'s run and ticket, or `undefined`
   * when there is none, it isn't a regular file of bounded size, it doesn't
   * parse as `BuildRunResult`, or it names another run or ticket. Never
   * throws for a missing or bad file.
   */
  readResult(runFolder: string, expected: { runId: RunId; ticketRef: string }): Promise<BuildRunResult | undefined>;
}
