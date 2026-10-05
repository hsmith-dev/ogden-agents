/**
 * Verification of a build run (AD-17; story 5.8): before a run may show as
 * ready for review, core checks that the plan says built, that the project's
 * tests pass when run again by Ogden Agents itself, and that the branch
 * changed something. The tests are the agent's code, so they run only
 * inside the run's own sandbox, with no network, after the agent is gone;
 * a build the user watched has no sandbox, so its tests check is not run
 * and says so.
 *
 * The test command is the user's: the project's `AGENTS.md` (a line such as
 * `Tests: \`npm test\``, which also covers the BMad project context block it
 * holds), else its `package.json` `test` script run by the package manager
 * its lockfile names. It is read from the main checkout, never from the
 * worktree, whose files the agent can edit; a project's own override
 * (Workspace settings, 11.2) wins. No command is a failing check.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTENDED_TESTS_NOT_RUN_DETAIL,
  MAX_TEST_COMMAND_LENGTH,
  MAX_TEST_OUTPUT_TAIL_BYTES,
  NO_TEST_COMMAND_DETAIL,
  PLAN_NOT_BUILT_DETAIL,
  TESTS_FAILED_DETAIL,
  TESTS_NOT_RUNNABLE_DETAIL,
  TESTS_TIMED_OUT_DETAIL,
  testsFailedDetail,
  type CheckResult,
  type VerificationCheck,
  type VerificationResult,
} from '@ogden-agents/shared';
import type { AgentSandbox, SandboxPort } from './sandbox-port.js';

/** The most a test command's source file is read. */
const MAX_FILE_BYTES = 256 * 1024;
/** How long a test re-run may take. */
export const TEST_RERUN_TIMEOUT_MS = 10 * 60 * 1000;

/** A file's text when it is a regular file of bounded size (never a link), else `undefined`. */
function readSmallFile(path: string): string | undefined {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** A command that is one plain line of a bounded length. */
function usable(command: string): string | undefined {
  const text = command.trim();
  return text === '' || text.length > MAX_TEST_COMMAND_LENGTH || /[\r\n\0]/.test(text) ? undefined : text;
}

/** The `AGENTS.md` line that names the project's test command: `Tests: \`npm test\`` and its close kin. */
const AGENTS_TEST_LINE = /^\s*[-*]?\s*(?:\*\*)?(?:test command|tests?|run tests|how to test)(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*`([^`\n]+)`/im;

/** The default `npm init` test script, which only fails. */
const NPM_DEFAULT_TEST = /no test specified/i;

/**
 * The test command to re-run for the project at `repoPath` (its main
 * checkout), or `undefined` when there is none. `override` is the project's
 * own setting.
 */
export function detectTestCommand(repoPath: string, override: string | null): string | undefined {
  if (override !== null) return usable(override);
  const agents = readSmallFile(join(repoPath, 'AGENTS.md'));
  const named = agents === undefined ? undefined : AGENTS_TEST_LINE.exec(agents)?.[1];
  if (named !== undefined) return usable(named);
  const manifest = readSmallFile(join(repoPath, 'package.json'));
  if (manifest === undefined) return undefined;
  try {
    const script = (JSON.parse(manifest) as { scripts?: { test?: unknown } }).scripts?.test;
    if (typeof script !== 'string' || usable(script) === undefined || NPM_DEFAULT_TEST.test(script)) return undefined;
  } catch {
    return undefined;
  }
  const has = (file: string) => lstatSync(join(repoPath, file), { throwIfNoEntry: false })?.isFile() === true;
  if (has('pnpm-lock.yaml')) return 'pnpm test';
  if (has('yarn.lock')) return 'yarn test';
  return 'npm test';
}

/** How many tests a runner's output says failed (`3 failed`, `Tests: 3 failed`, `failures: 3`), or `undefined`. */
export function failedTestCount(output: string): number | undefined {
  // A runner's own tests line first (`Tests  3 failed`, not vitest's `Test Files  1 failed` or jest's `Test Suites: 1 failed` above it).
  const line = output.split(/\r?\n/).find((each) => /^\s*(?:tests?)\b(?!\s*(?:files?|suites?))/i.test(each) && /\d+\s+failed/i.test(each));
  const found = /(\d+)\s+failed/i.exec(line ?? '') ?? /(\d+)\s+(?:tests?\s+)?(?:failed|failing|failures?)/i.exec(output) ?? /(?:failed|failures?)\s*[:=]?\s*(\d+)/i.exec(output);
  const count = found === null ? NaN : Number(found[1]);
  return Number.isInteger(count) && count > 0 ? count : undefined;
}

export interface VerifyInput {
  /** The plan's status in the run's worktree. */
  planStatus: string;
  /** The branch's changed files against its base, and why they are not acceptable (a plain sentence), `undefined` when they are. */
  files: readonly string[];
  forbiddenDetail?: string | undefined;
  /** The text for a branch with no changes. */
  emptyDetail: string;
  /** Whether the run was a build the user watched (no sandbox, so no re-run). */
  attended: boolean;
  /** The run's sandbox; `undefined` for an attended run, or an unattended one whose setup is gone (the tests check then fails, never runs unsandboxed). */
  sandbox: AgentSandbox | undefined;
  /** The worktree: the command's folder. */
  cwd: string;
  /** The environment the command gets (the allowlist and the run's object store). */
  env: Readonly<Record<string, string>>;
  /** The test command from the main checkout and the project's settings, `undefined` when none. */
  testCommand: string | undefined;
}

export interface VerifyDeps {
  sandbox: Pick<SandboxPort, 'run'>;
  /** Masks secrets in the kept output (AD-16). */
  mask: (text: string) => string;
  now?: () => Date;
}

const check = (id: VerificationCheck['id'], result: CheckResult, detail: string | null): VerificationCheck => ({ id, result, detail });

/** Runs the three checks (see the header) and returns the result. Never throws: a failed re-run is a failed check. */
export async function verifyRun(deps: VerifyDeps, input: VerifyInput): Promise<VerificationResult> {
  const attended = input.attended;
  const built = input.planStatus === 'built';
  const changed = input.files.length > 0 && input.forbiddenDetail === undefined;
  const planCheck = built ? check('plan_built', 'pass', null) : check('plan_built', 'fail', PLAN_NOT_BUILT_DETAIL);
  const codeCheck = changed ? check('code_changed', 'pass', null) : check('code_changed', 'fail', input.files.length === 0 ? input.emptyDetail : (input.forbiddenDetail ?? input.emptyDetail));

  let testsCheck: VerificationCheck;
  const testCommand = input.testCommand ?? null;
  let tail: string | null = null;
  if (!built || !changed) {
    // Nothing to run the tests on, and no reason to run the agent's code yet.
    testsCheck = check('tests_pass', 'not_run', null);
  } else if (attended) {
    testsCheck = check('tests_pass', 'not_run', ATTENDED_TESTS_NOT_RUN_DETAIL);
  } else if (input.testCommand === undefined) {
    testsCheck = check('tests_pass', 'fail', NO_TEST_COMMAND_DETAIL);
  } else if (input.sandbox === undefined) {
    testsCheck = check('tests_pass', 'fail', TESTS_NOT_RUNNABLE_DETAIL);
  } else {
    const ran = await deps.sandbox
      .run({ sandbox: input.sandbox, cwd: input.cwd, command: input.testCommand, env: input.env, timeoutMs: TEST_RERUN_TIMEOUT_MS, maxOutputBytes: MAX_TEST_OUTPUT_TAIL_BYTES })
      .catch(() => undefined);
    if (ran === undefined) {
      testsCheck = check('tests_pass', 'fail', TESTS_NOT_RUNNABLE_DETAIL);
    } else {
      tail = deps.mask(ran.output).slice(-MAX_TEST_OUTPUT_TAIL_BYTES);
      if (ran.timedOut) testsCheck = check('tests_pass', 'fail', TESTS_TIMED_OUT_DETAIL);
      else if (ran.exitCode === 0) testsCheck = check('tests_pass', 'pass', null);
      else {
        const failed = failedTestCount(ran.output);
        testsCheck = check('tests_pass', 'fail', failed === undefined ? TESTS_FAILED_DETAIL : testsFailedDetail(failed));
      }
    }
  }
  // The checks in the contract's order: plan, tests, code.
  const ordered = [planCheck, testsCheck, codeCheck];
  const verified = planCheck.result === 'pass' && codeCheck.result === 'pass' && (testsCheck.result === 'pass' || (attended && testsCheck.result === 'not_run'));
  return {
    outcome: verified ? 'verified' : 'failed',
    checks: ordered,
    testCommand,
    testOutputTail: tail,
    attended,
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
}
