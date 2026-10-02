/**
 * The port for BMad Method's catalog in a project's repo (AD-1, AD-12). Story
 * 10.2 freezes its first operation, {@link BmadCatalogPort.detect}; epic 4
 * extends the port with the catalog itself (modules, skills, help), built
 * only for workspaces with Planning on (AD-22). Reading a repo's files is
 * tool-specific, so it sits behind a core port and core names no file.
 */
import type { BmadDetection, CatalogSkill } from '@ogden-agents/shared';

/** What {@link BmadCatalogPort.detect} finds in a repo: the detection without the per-project offer answer core keeps. */
export type BmadRepoDetection = Omit<BmadDetection, 'offerDismissed'>;

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
  skills(repoPath: string): Promise<CatalogSkill[]>;
}
