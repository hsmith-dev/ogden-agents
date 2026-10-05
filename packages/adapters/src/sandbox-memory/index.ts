/**
 * `sandbox-memory` (story 5.3): in-memory `SandboxPort`s for tests and the
 * epics' lanes. `createFixedSandbox` always gives one answer (tests and the
 * `OGDEN_AGENTS_TEST_SANDBOX` hook); `createMemorySandbox` answers what it
 * is set to now and records each check's request. Neither probes or runs
 * anything on the computer.
 */
import type { SandboxCheck, SandboxCheckRequest, SandboxPort } from '@ogden-agents/core';
import type { SandboxStatus } from '@ogden-agents/shared';

/** The status a fixed `check` says (plain words from its own reason; the platform is not probed). */
export function statusOf(check: SandboxCheck, platform: SandboxStatus['platform'] = 'other'): SandboxStatus {
  return check.available
    ? { platform, available: true, kind: check.kind, summary: `Builds run inside the ${check.kind} sandbox.`, probes: [], choices: [], installHint: null }
    : { platform, available: false, kind: null, summary: check.reason, probes: [], choices: [...(check.choices ?? ['other_agent', 'install_docker', 'attended'])], installHint: null };
}

/** A sandbox port that always answers `check` (tests and the test hook). */
export function createFixedSandbox(check: SandboxCheck): SandboxPort {
  return { check: async () => check, status: async () => statusOf(check) };
}

export interface MemorySandbox extends SandboxPort {
  /** Every check's request, in order. */
  readonly checks: SandboxCheckRequest[];
  /** Sets what the next checks answer. */
  set(check: SandboxCheck): void;
}

export function createMemorySandbox(initial: SandboxCheck = { available: true, kind: 'seatbelt' }): MemorySandbox {
  let answer = initial;
  const checks: SandboxCheckRequest[] = [];
  return {
    checks,
    set: (check) => void (answer = check),
    async check(request = {}) {
      checks.push(request);
      return answer;
    },
    async status(request = {}) {
      checks.push(request);
      return statusOf(answer);
    },
  };
}
