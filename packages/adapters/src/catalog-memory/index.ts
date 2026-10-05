/**
 * `catalog-memory` (story 10.2; story 4.2 completes it): an in-memory
 * `BmadCatalogPort`, for tests and the epic's lanes (the server wires the
 * real `bmad-catalog` adapter). It reads and writes nothing on the computer:
 * each repo path it was given answers what it was told, and any other path
 * answers that it has neither `_bmad/` nor `_bmad-output/`, no skills, an
 * empty catalog and no setup, as the real adapter does for a missing folder.
 * `setup` reports each of the shared setup steps, then marks the repo
 * current with `_bmad-output` as its output folder; a repo that already has
 * `_bmad/` (or a status other than `not_set_up`) is refused with
 * `BmadAlreadySetUpError` (story 4.3), as the real adapter refuses it.
 * Entry 4.11: each repo lacks the capabilities `missing` names (none by
 * default, so every board and catalog works; a repo whose catalog sets
 * `capabilities` lacks those set `false`), and `setup` with `upgrade` runs
 * only in a repo with `_bmad/` (or a status other than `not_set_up`), then
 * clears its missing capabilities and applies its `afterUpgrade` catalog.
 */
import type { z } from 'zod';
import { BmadAlreadySetUpError, BmadSetupError, type BmadCatalogPort, type BmadRepoDetection, type InstalledSkill } from '@ogden-agents/core';
import {
  BMAD_CAPABILITIES,
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_STEPS,
  CatalogSkill,
  MAX_DOCUMENT_BYTES,
  type BmadCapabilities,
  type BmadCapability,
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
  /** Every `readDocument` call, as `[repoPath, outputFolder, path]`, in order (story 4.7). */
  readonly documentCalls: ReadonlyArray<readonly [string, string, string]>;
  /** Every `missingCapabilities` call, as `[repoPath, wanted]`, in order (entry 4.11). */
  readonly capabilityCalls: ReadonlyArray<readonly [string, readonly BmadCapability[]]>;
  /** Every `setup` call's options, in order (entry 4.11: `{ upgrade: true }` for an upgrade, `{}` otherwise). */
  readonly setupOptions: ReadonlyArray<{ upgrade?: boolean; skillFolders?: readonly string[] }>;
  /** Sets what `scriptsFingerprint` answers for `repoPath` from now on (story 4.13: the project's scripts changed). */
  setScriptsFingerprint(repoPath: string, fingerprint: string | undefined): void;
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
  /**
   * Each repo path's documents (story 4.7), by repo-relative path: what
   * `readDocument` answers for a path inside the output folder it is asked
   * with (`null` for any other, as the real adapter answers a missing file).
   */
  documents?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Each repo path's missing capabilities (entry 4.11, AD-14) until an
   * upgrade; a repo not named lacks those its catalog's `capabilities` sets
   * `false`, else none.
   */
  missing?: Readonly<Record<string, readonly BmadCapability[]>>;
  /** Each repo path's `scriptsFingerprint` (story 4.13); any other path has no scripts (`'none'`). */
  scripts?: Readonly<Record<string, string | undefined>>;
  /** Each repo path's catalog after an upgrade (merged over `catalogs`), such as the entry action it now has. */
  afterUpgrade?: Readonly<Record<string, Partial<Omit<Catalog, 'skills' | 'capabilities'>>>>;
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
  skills: Readonly<Record<string, readonly InstalledSkill[] | ReadonlyArray<z.input<typeof CatalogSkill>>>> = {},
  options: MemoryBmadCatalogOptions = {},
): MemoryBmadCatalog {
  const known = new Map(Object.entries(repos));
  const installed = new Map(Object.entries(skills));
  const setups = new Map(Object.entries(options.setup ?? {}).map(([path, status]) => [path, structuredClone(status)]));
  const calls: string[] = [];
  const skillCalls: string[] = [];
  const catalogCalls: string[] = [];
  const setupCalls: Array<readonly ['status' | 'setup', string]> = [];
  const documentCalls: Array<readonly [string, string, string]> = [];
  const capabilityCalls: Array<readonly [string, readonly BmadCapability[]]> = [];
  const setupOptions: Array<{ upgrade?: boolean; skillFolders?: readonly string[] }> = [];
  const catalogs = new Map(Object.entries(options.catalogs ?? {}).map(([path, rest]) => [path, structuredClone(rest)]));
  const missing = new Map(Object.entries(options.missing ?? {}).map(([path, list]) => [path, new Set(list)]));
  /** What the repo lacks now: its `missing`, else what its catalog's capabilities set `false`. */
  const missingOf = (repoPath: string): Set<BmadCapability> => {
    const named = missing.get(repoPath);
    if (named !== undefined) return named;
    const capabilities = catalogs.get(repoPath)?.capabilities;
    return new Set(capabilities === undefined ? [] : BMAD_CAPABILITIES.filter((capability) => !capabilities[capability]));
  };
  const capabilitiesOf = (repoPath: string): BmadCapabilities => {
    const lacks = missingOf(repoPath);
    return { plain_labels: !lacks.has('plain_labels'), ticket_tree: !lacks.has('ticket_tree') };
  };
  const statusOf = (repoPath: string) => structuredClone(setups.get(repoPath) ?? notSetUp());
  const scripts = new Map<string, string | undefined>(Object.entries(options.scripts ?? {}));
  return {
    calls,
    skillCalls,
    catalogCalls,
    setupCalls,
    documentCalls,
    capabilityCalls,
    setupOptions,
    missingCapabilities: async (repoPath, wanted) => {
      capabilityCalls.push([repoPath, [...wanted]]);
      const lacks = missingOf(repoPath);
      return BMAD_CAPABILITIES.filter((capability) => wanted.includes(capability) && lacks.has(capability));
    },
    setScriptsFingerprint: (repoPath, fingerprint) => {
      scripts.set(repoPath, fingerprint);
    },
    scriptsFingerprint: async (repoPath) => (scripts.has(repoPath) ? scripts.get(repoPath) : 'none'),
    readDocument: async (repoPath, outputFolder, path) => {
      documentCalls.push([repoPath, outputFolder, path]);
      const folder = outputFolder.replace(/\/+$/, '');
      if (!path.startsWith(`${folder}/`) || !path.endsWith('.md')) return null;
      const content = options.documents?.[repoPath]?.[path];
      if (content === undefined) return null;
      const bytes = Buffer.from(content, 'utf8');
      return bytes.length > MAX_DOCUMENT_BYTES
        ? { content: bytes.subarray(0, MAX_DOCUMENT_BYTES).toString('utf8'), truncated: true }
        : { content, truncated: false };
    },
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
      const rest = catalogs.get(repoPath) ?? {};
      return structuredClone({
        modules: rest.modules ?? [],
        skills: (installed.get(repoPath) ?? []).map((skill) => CatalogSkill.parse(skill)).sort((a, b) => a.name.localeCompare(b.name)),
        agents: rest.agents ?? [],
        entryAction: rest.entryAction ?? null,
        capabilities: capabilitiesOf(repoPath),
      });
    },
    setupStatus: async (repoPath) => {
      setupCalls.push(['status', repoPath]);
      return statusOf(repoPath);
    },
    setup: async (repoPath, onProgress: (progress: BmadSetupProgress) => void, setupOptionsGiven = {}) => {
      setupCalls.push(['setup', repoPath]);
      const upgrade = setupOptionsGiven.upgrade === true;
      setupOptions.push({ ...(upgrade ? { upgrade: true } : {}), ...(setupOptionsGiven.skillFolders === undefined ? {} : { skillFolders: [...setupOptionsGiven.skillFolders] }) });
      const hasBmad = known.get(repoPath)?.hasBmad === true || statusOf(repoPath).state !== 'not_set_up';
      // Set up writes only where there is no `_bmad/`; Upgrade only where there is one (entry 4.11).
      if (!upgrade && hasBmad) throw new BmadAlreadySetUpError();
      if (upgrade && !hasBmad) throw new BmadSetupError('failed', { cause: 'not_set_up' });
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
      if (upgrade) {
        // Upgraded: every capability present, and the catalog as configured.
        missing.set(repoPath, new Set());
        const { capabilities: _before, ...rest } = catalogs.get(repoPath) ?? {};
        catalogs.set(repoPath, { ...rest, ...structuredClone(options.afterUpgrade?.[repoPath] ?? {}) });
      }
      return statusOf(repoPath);
    },
  };
}
