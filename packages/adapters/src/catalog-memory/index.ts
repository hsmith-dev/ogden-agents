/**
 * `catalog-memory` (story 10.2): an in-memory `BmadCatalogPort`, for tests
 * and as the stub the server can wire until the `bmad-catalog` adapter ships
 * (entry 10.3). It reads nothing on the computer: each repo path it was
 * given answers what it was told, any other path answers that it has
 * neither `_bmad/` nor `_bmad-output/`, as the real adapter does for a
 * missing folder.
 */
import type { BmadCatalogPort, BmadRepoDetection } from '@ogden-agents/core';

/** A {@link BmadCatalogPort} that records every path `detect` was asked about. */
export interface MemoryBmadCatalog extends BmadCatalogPort {
  /** Every `detect` call's `repoPath`, in order. */
  readonly calls: readonly string[];
}

/**
 * `repos`: what each repo path has; a missing field is `false`. Answers are
 * async, like the real adapter's, and copies, so a caller can't change them.
 */
export function createMemoryBmadCatalog(repos: Readonly<Record<string, Partial<BmadRepoDetection>>> = {}): MemoryBmadCatalog {
  const known = new Map(Object.entries(repos));
  const calls: string[] = [];
  return {
    calls,
    detect: async (repoPath) => {
      calls.push(repoPath);
      const repo = known.get(repoPath);
      return { hasBmad: repo?.hasBmad ?? false, hasOutput: repo?.hasOutput ?? false };
    },
  };
}
