/**
 * `catalog-memory` (story 10.2): an in-memory `BmadCatalogPort`, for tests
 * (the server wires the real `bmad-catalog` adapter, story 10.3). It reads nothing on the computer: each repo path it was
 * given answers what it was told, any other path answers that it has
 * neither `_bmad/` nor `_bmad-output/`, as the real adapter does for a
 * missing folder.
 */
import type { BmadCatalogPort, BmadRepoDetection } from '@ogden-agents/core';
import type { CatalogSkill } from '@ogden-agents/shared';

/** A {@link BmadCatalogPort} that records every path `detect` was asked about. */
export interface MemoryBmadCatalog extends BmadCatalogPort {
  /** Every `detect` call's `repoPath`, in order. */
  readonly calls: readonly string[];
  /** Every `skills` call's `repoPath`, in order (story 4.1). */
  readonly skillCalls: readonly string[];
}

/**
 * `repos`: what each repo path has; a missing field is `false`. `skills`:
 * each repo path's installed skills (story 4.1); any other path has none.
 * Answers are async, like the real adapter's, and copies, so a caller can't
 * change them.
 */
export function createMemoryBmadCatalog(
  repos: Readonly<Record<string, Partial<BmadRepoDetection>>> = {},
  skills: Readonly<Record<string, readonly CatalogSkill[]>> = {},
): MemoryBmadCatalog {
  const known = new Map(Object.entries(repos));
  const installed = new Map(Object.entries(skills));
  const calls: string[] = [];
  const skillCalls: string[] = [];
  return {
    calls,
    skillCalls,
    skills: async (repoPath) => {
      skillCalls.push(repoPath);
      return (installed.get(repoPath) ?? []).map((skill) => ({ ...skill }));
    },
    detect: async (repoPath) => {
      calls.push(repoPath);
      const repo = known.get(repoPath);
      return { hasBmad: repo?.hasBmad ?? false, hasOutput: repo?.hasOutput ?? false };
    },
  };
}
