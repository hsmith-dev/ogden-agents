/**
 * The port for BMad Method's catalog in a project's repo (AD-1, AD-12). Story
 * 10.2 freezes its first operation, {@link BmadCatalogPort.detect}; story 4.1
 * adds the installed skills, and story 4.2 freezes the rest of epic 4's
 * port: the catalog itself (modules, skills, agents; entry 4.4 fills it),
 * built only for workspaces with Planning on (AD-22), and BMad Method's
 * setup status and setup (entry 4.3). Reading a repo's files is
 * tool-specific, so it sits behind a core port and core names no file.
 */
import type { BmadDetection, BmadSetupProgress, BmadSetupStatus, Catalog, CatalogSkill } from '@ogden-agents/shared';

/** What {@link BmadCatalogPort.detect} finds in a repo: the detection without the per-project offer answer core keeps. */
export type BmadRepoDetection = Omit<BmadDetection, 'offerDismissed'>;

/** One installed skill as its `SKILL.md` frontmatter gives it (story 4.1): the catalog adds the fork metadata. */
export type InstalledSkill = Pick<CatalogSkill, 'name' | 'description'>;

export interface BmadCatalogPort {
  /**
   * Whether the repo at `repoPath` (the workspace's real path) already has
   * BMad Method: `hasBmad` when `_bmad/` exists there as a folder,
   * `hasOutput` when `_bmad-output/` does.
   *
   * Read-only (AD-22, E10-R5): it checks only that those two entries exist
   * and are folders. It never creates, writes, renames or deletes anything,
   * never reads a file's contents, and never lists or follows into either
   * folder. A missing or unreadable repo, or a missing folder, answers
   * `false` for it; it rejects only on a bug, never for the repo's state.
   */
  detect(repoPath: string): Promise<BmadRepoDetection>;
  /**
   * The skills installed in the repo at `repoPath` (the workspace's real
   * path; story 4.1), from each skill's `SKILL.md` frontmatter, sorted by
   * name, each name once. Read-only, and only inside the repo: a skill whose
   * file resolves outside it, or whose name isn't a skill name, is left out.
   * A missing folder answers no skills. Core asks it only for a workspace
   * with Planning on (AD-22).
   */
  skills(repoPath: string): Promise<InstalledSkill[]>;
  /**
   * The repo's catalog (story 4.2's contract; entry 4.4 builds it from
   * `bmod.toml`, `SKILL.md`, `roster.toml` and the fork's metadata): its
   * modules, skills (sorted by name, each once) and agents, the entry action
   * and its capabilities (AD-14). Read-only and only inside the repo, like
   * {@link skills}. Core asks it only for a workspace with Planning on (AD-22).
   */
  catalog(repoPath: string): Promise<Catalog>;
  /**
   * Where the repo's BMad Method setup stands against the bundled fork
   * (entry 4.3: `setup.py --status`). Read-only: it runs only the bundled
   * setup script, never the project's own code.
   */
  setupStatus(repoPath: string): Promise<BmadSetupStatus>;
  /**
   * Sets up (or upgrades) BMad Method in the repo from the bundled fork
   * (entry 4.3, AD-13, AD-21), telling `onProgress` each step as it begins,
   * and resolves with the status after it. It writes BMad Method's own
   * files only (`_bmad/` and the agent's skill folders). Core asks it only
   * for a workspace with Planning or Board on, and only when the user asked.
   */
  setup(repoPath: string, onProgress: (progress: BmadSetupProgress) => void): Promise<BmadSetupStatus>;
}
