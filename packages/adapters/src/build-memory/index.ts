/**
 * `build-memory` (story 5.3): an in-memory `BuildRunnerPort` for tests and
 * the epics' lanes. It names no skill: its invocation is a plain marker the
 * fake agent ignores unless told otherwise, its halts are whatever the test
 * sets (default `other`), and its per-run results are kept by run folder
 * instead of read from disk.
 */
import type { BuildInvocationOptions, BuildRunnerPort } from '@ogden-agents/core';
import type { BlockedCode, BuildAgent, BuildRunResult } from '@ogden-agents/shared';

export interface MemoryBuildRunner extends BuildRunnerPort {
  /** Every invocation asked for, in order. */
  readonly invocations: Array<{ ref: string; options: BuildInvocationOptions }>;
  /** Maps a halt's condition to a code (exact match). */
  halts: Map<string, BlockedCode>;
  /** The per-run results by run folder. */
  results: Map<string, BuildRunResult>;
}

export function createMemoryBuildRunner(options: { agent?: BuildAgent; prefix?: string } = {}): MemoryBuildRunner {
  const prefix = options.prefix ?? '/memory-build ticket';
  const invocations: Array<{ ref: string; options: BuildInvocationOptions }> = [];
  const halts = new Map<string, BlockedCode>();
  const results = new Map<string, BuildRunResult>();
  return {
    agent: options.agent ?? 'claude-code',
    invocations,
    halts,
    results,
    invocation(ref, invocationOptions = {}) {
      invocations.push({ ref, options: invocationOptions });
      return invocationOptions.note === undefined ? `${prefix} ${ref}` : `${prefix} ${ref}\n\n${invocationOptions.note}`;
    },
    blockedCode: (condition) => halts.get(condition) ?? 'other',
    readResult: async (runFolder) => results.get(runFolder),
  };
}
