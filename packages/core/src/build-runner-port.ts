/**
 * The build runner port (AD-1, AD-12; story 5.2's tracer, the minimal
 * shape 5.3 freezes): the message that makes the build session's agent build
 * one named ticket. Core names no skill (AD-12); the `buildrunner-acp`
 * adapter is the only place that names it.
 */
export interface BuildRunnerPort {
  /** The registered agent this runner builds with (Claude Code in v1; core names none, E6-R2). */
  readonly agentId: string;
  /** The first (and, in the tracer, only) message a run's `build` session is sent, for ticket `ref`. */
  invocation(ref: string): string;
}
