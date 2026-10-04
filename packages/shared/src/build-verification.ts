import { z } from 'zod';
import { IsoUtcTimestamp } from './time.js';

/**
 * Verification of a build run (AD-17; story 5.3 freezes it, 5.8 runs all
 * three checks before a run shows as ready for review, user decision
 * 2026-10-01; 11.2 reports each check's detail and adds Check again and a
 * per-project test command). The re-run runs the project's own (and so the
 * agent's) code, so it always runs inside the run's sandbox with no network,
 * never on the server unsandboxed (E5-R9, security review). No UI text here
 * holds an em or en dash.
 */

/** The three checks, in the order the review page shows them. */
export const VERIFICATION_CHECKS = ['plan_built', 'tests_pass', 'code_changed'] as const;
export const VerificationCheckId = z.enum(VERIFICATION_CHECKS);
export type VerificationCheckId = z.infer<typeof VerificationCheckId>;

export const VERIFICATION_CHECK_LABELS: Readonly<Record<VerificationCheckId, string>> = {
  plan_built: 'Plan marked built',
  tests_pass: 'Tests pass when re-run',
  code_changed: 'Code changed',
};

/** One check's result: `not_run` when an earlier step stopped it (a run that never reached built). */
export const CHECK_RESULTS = ['pass', 'fail', 'not_run'] as const;
export const CheckResult = z.enum(CHECK_RESULTS);
export type CheckResult = z.infer<typeof CheckResult>;

/** The most test output a verification keeps, from the end (11.2's Show details). */
export const MAX_TEST_OUTPUT_TAIL_BYTES = 16 * 1024;

export const VerificationCheck = z.object({
  id: VerificationCheckId,
  result: CheckResult,
  /** Plain words: why it failed ("3 tests failed when re-run"), or `null`. */
  detail: z.string().max(500).nullable(),
});
export type VerificationCheck = z.infer<typeof VerificationCheck>;

/**
 * A run's verification: exactly the three checks, in order. `verified`
 * only when all three pass; the run's outcome follows it.
 */
export const VerificationResult = z
  .object({
    outcome: z.enum(['verified', 'failed']),
    checks: z.array(VerificationCheck).length(VERIFICATION_CHECKS.length),
    /** The test command the re-run used (the project's override, else the detected one), or `null` when none was found. */
    testCommand: z.string().max(500).nullable(),
    /** The tail of the re-run's output (masked, at most {@link MAX_TEST_OUTPUT_TAIL_BYTES}), or `null`. */
    testOutputTail: z.string().max(MAX_TEST_OUTPUT_TAIL_BYTES).nullable(),
    checkedAt: IsoUtcTimestamp,
  })
  .refine((result) => result.checks.every((check, index) => check.id === VERIFICATION_CHECKS[index]), 'The checks are plan_built, tests_pass and code_changed, in that order.')
  .refine((result) => (result.outcome === 'verified') === result.checks.every((check) => check.result === 'pass'), 'A run is verified only when every check passes.');
export type VerificationResult = z.infer<typeof VerificationResult>;

/** `POST …/runs/:runId/check-again` (11.2): re-runs 5.8's verification on the run's worktree. No fields. */
export const CheckAgainRequest = z.object({}).strict();
export type CheckAgainRequest = z.infer<typeof CheckAgainRequest>;

// ---- Plain sentences (EXPERIENCE.md Run `failed` verification) ----

/** A test re-run's failure, as the failing check's detail. */
export function testsFailedDetail(failed: number): string {
  return failed === 1 ? '1 test failed when re-run' : `${failed} tests failed when re-run`;
}
export const TESTS_FAILED_DETAIL = 'The tests failed when re-run';
export const NO_TEST_COMMAND_DETAIL = 'No test command found';
export const TESTS_TIMED_OUT_DETAIL = 'The tests took too long when re-run';
export const PLAN_NOT_BUILT_DETAIL = "The plan doesn't say built";
export const NO_CODE_CHANGES_DETAIL = 'The branch has no changes';
export const CHECK_AGAIN_LABEL = 'Check again';
