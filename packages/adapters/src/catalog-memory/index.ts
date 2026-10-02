/**
 * `catalog-memory` (story 10.2; story 4.2 completes it): an in-memory
 * `BmadCatalogPort`, for tests and the epic's lanes (the server wires the
 * real `bmad-catalog` adapter). It reads and writes nothing on the computer:
 * each repo path it was given answers what it was told, and any other path
 * answers that it has neither `_bmad/` nor `_bmad-output/`, no skills, an
 * empty catalog and no setup, as the real adapter does for a missing folder.
 * `setup` reports each of the shared setup steps, then marks the repo
 * current with `_bmad-output` as its output folder.
 */
import type { BmadCatalogPort, BmadRepoDetection, InstalledSkill } from '@ogden-agents/core';
import {
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_STEPS,
  CatalogSkill,
  type BmadSetupProgress,
  type BmadSetupStatus,
  type Catalog,
} from '@ogden-agents/shared';

/** A {@link BmadCatalogPort} that records every path it was asked about. */
export interface MemoryBmadCatalog extends BmadCatalogPort {
  /** Every `detect` call's `repoPath`, in order. */
  readonly calls: readonly string[];
  /** Every `skills` call's `repoPath`, in order (story 4.1). */
  readonly skillCalls: readonly string[];
  /** Every `catalog` call's `repoPath`, in order (story 4.2). */
  readonly catalogCalls: readonly string[];
  /** Every `setupStatus` and `setup` call, as `[operation, repoPath]`, in order (story 4.2). */
  readonly setupCalls: ReadonlyArray<readonly ['status' | 'setup', string]>;
}

/** The version the memory catalog says Ogden Agents bundles. */
export const MEMORY_BUNDLED_BMAD_VERSION = '7.0.0';

export interface MemoryBmadCatalogOptions {
  /** Each repo path's catalog beyond its skills (modules, agents, entry action, capabilities). */
  catalogs?: Readonly<Record<string, Partial<Omit<Catalog, 'skills'>>>>;
  /** Each repo path's setup status before any `setup`; any other path is `not_set_up`. */
  setup?: Readonly<Record<string, BmadSetupStatus>>;
  /** `setup` rejects with this error (a setup that fails). */
  setupFails?: Error;
}

const notSetUp = (): BmadSetupStatus => ({
  state: 'not_set_up',
  outputFolder: null,
  bundledVersion: MEMORY_BUNDLED_BMAD_VERSION,
  installedVersion: null,
  problems: [],
});

/**
 * `repos`: what each repo path has; a missing field is `false`. `skills`:
 * each repo path's installed skills (story 4.1); any other path has none.
 * `options`: the rest of each catalog and each setup status (story 4.2).
 * Answers are async, like the real adapter's, and copies, so a caller can't
 * change them.
 */
export function createMemoryBmadCatalog(
  repos: Readonly<Record<string, Partial<BmadRepoDetection>>> = {},
  skills: Readonly<Record<string, readonly InstalledSkill[] | readonly CatalogSkill[]>> = {},
  options: MemoryBmadCatalogOptions = {},
): MemoryBmadCatalog {
  const known = new Map(Object.entries(repos));
  const installed = new Map(Object.entries(skills));
  const setups = new Map(Object.entries(options.setup ?? {}).map(([path, status]) => [path, structuredClone(status)]));
  const calls: string[] = [];
  const skillCalls: string[] = [];
  const catalogCalls: string[] = [];
  const setupCalls: Array<readonly ['status' | 'setup', string]> = [];
  const statusOf = (repoPath: string) => structuredClone(setups.get(repoPath) ?? notSetUp());
  return {
    calls,
    skillCalls,
    catalogCalls,
    setupCalls,
    skills: async (repoPath) => {
      skillCalls.push(repoPath);
      return (installed.get(repoPath) ?? []).map((skill) => ({ name: skill.name, description: skill.description }));
    },
    detect: async (repoPath) => {
      calls.push(repoPath);
      const repo = known.get(repoPath);
      return { hasBmad: repo?.hasBmad ?? false, hasOutput: repo?.hasOutput ?? false };
    },
    catalog: async (repoPath) => {
      catalogCalls.push(repoPath);
      const rest = options.catalogs?.[repoPath] ?? {};
      return structuredClone({
        modules: rest.modules ?? [],
        skills: (installed.get(repoPath) ?? []).map((skill) => CatalogSkill.parse(skill)).sort((a, b) => a.name.localeCompare(b.name)),
        agents: rest.agents ?? [],
        entryAction: rest.entryAction ?? null,
        capabilities: rest.capabilities ?? { plain_labels: false, ticket_tree: false },
      });
    },
    setupStatus: async (repoPath) => {
      setupCalls.push(['status', repoPath]);
      return statusOf(repoPath);
    },
    setup: async (repoPath, onProgress: (progress: BmadSetupProgress) => void) => {
      setupCalls.push(['setup', repoPath]);
      for (const step of BMAD_SETUP_STEPS) {
        onProgress({ step, label: BMAD_SETUP_STEP_LABELS[step] });
        // Each step after the caller's turn, as the real setup's lines arrive.
        await Promise.resolve();
      }
      if (options.setupFails !== undefined) throw options.setupFails;
      setups.set(repoPath, {
        state: 'current',
        outputFolder: '_bmad-output',
        bundledVersion: MEMORY_BUNDLED_BMAD_VERSION,
        installedVersion: MEMORY_BUNDLED_BMAD_VERSION,
        problems: [],
      });
      known.set(repoPath, { ...known.get(repoPath), hasBmad: true });
      return statusOf(repoPath);
    },
  };
}
