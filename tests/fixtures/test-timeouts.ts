/**
 * The one place the unit tests' time limits live: Vitest's config reads the defaults, and a test that does real
 * process, git, worktree or server work names a tier instead of writing a number. Plain Node, no imports.
 *
 * Why the limits differ. A test that spawns processes takes ~1.4 s on a quiet machine and 3 to 20 times that on a CI runner
 * running other test files beside it (Windows spawns slowest; main run 37458461174 had whole files taking 69 s there).
 * So CI gets a longer limit, and Windows the longest. Locally the limit stays short (5 s) so a slow test still shows.
 * Every limit is finite: a genuinely hung test still fails, at most 45 s later on CI.
 *
 * A limit is for a hang, never a measurement. Tests must not assert on elapsed time: wait for the event (a barrier), not a delay.
 */

const onCi = Boolean(process.env.CI) && process.env.CI !== 'false';
const onWindows = process.platform === 'win32';

/** Vitest's `testTimeout`, for an ordinary test (the default tier). */
export const TEST_TIMEOUT_MS = onWindows ? (onCi ? 30_000 : 20_000) : onCi ? 15_000 : 5_000;

/** Vitest's `hookTimeout` (before/after hooks: starting servers and fixture repos). */
export const HOOK_TIMEOUT_MS = onCi ? 30_000 : onWindows ? 20_000 : 10_000;

/**
 * For one test that does a whole flow: several servers, fixture repos and worktrees, a build, a review and an approve.
 * Pass it as the test's last argument: `it('...', async () => {...}, FULL_FLOW_TEST_TIMEOUT_MS)`.
 */
export const FULL_FLOW_TEST_TIMEOUT_MS = onCi ? 45_000 : 30_000;
