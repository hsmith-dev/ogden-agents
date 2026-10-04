/**
 * The port for BMad Method's catalog in a project's repo (AD-1, AD-12). Story
 * 10.2 freezes its first operation, {@link BmadCatalogPort.detect}; story 4.1
 * adds the installed skills, and story 4.2 freezes the rest of epic 4's
 * port: the catalog itself (modules, skills, agents; entry 4.4 fills it),
 * built only for workspaces with Planning on (AD-22), and BMad Method's
 * setup status and setup (entry 4.3). Reading a repo's files is
 * tool-specific, so it sits behind a core port and core names no file.
 */
import type { BmadCapability, BmadDetection, BmadSetupProgress, BmadSetupStatus, Catalog, CatalogSkill } from '@ogden-agents/shared';

/** What {@link BmadCatalogPort.detect} finds in a repo: the detection without the per-project offer answer core keeps. */
export type BmadRepoDetection = Omit<BmadDetection, 'offerDismissed'>;

/** One installed skill as its `SKILL.md` frontmatter gives it (story 4.1): the catalog adds Ogden Agents' label mapping (AD-12). */
export type InstalledSkill = Pick<CatalogSkill, 'name' | 'description'>;

/** How {@link BmadCatalogPort.setup} runs (entry 4.11). */
export interface BmadSetupRunOptions {
  /**
   * Upgrade this project: the repo already has a real `_bmad/` folder, and
   * setup adds what is missing and repairs BMad Method's scripts (upstream
   * `setup.py`'s own repair, keeping the config's values, `custom/` and
   * leftovers), and copies each pinned skill the project lacks in either
   * skills folder, never touching one it has. Refused, nothing written, when
   * `_bmad`, `.claude` or `.claude/skills` is a link or a file, or the
   * existing config's output folder isn't a repo-relative path through real
   * folders. Without it, setup runs only in a project with no `_bmad` entry.
   */
  upgrade?: boolean;
}

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
   * `bmod.toml`, `SKILL.md`, `roster.toml` and Ogden Agents' label mapping): its
   * modules, skills (sorted by name, each once) and agents, the entry action
   * and its capabilities (AD-14). Read-only and only inside the repo, like
   * {@link skills}. Core asks it only for a workspace with Planning on (AD-22).
   */
  catalog(repoPath: string): Promise<Catalog>;
  /**
   * Where the repo's BMad Method setup stands against the pinned upstream
   * version (entry 4.3: `setup.py --status`, AD-13). Read-only: it runs only
   * the verified pinned setup script, never the project's own code.
   */
  setupStatus(repoPath: string): Promise<BmadSetupStatus>;
  /**
   * Sets up (or upgrades) BMad Method in the repo from the verified pinned copy
   * (entry 4.3, AD-13, AD-21), telling `onProgress` each step as it begins,
   * and resolves with the status after it. It writes BMad Method's own
   * files only (`_bmad/` and the agent's skill folders). Core asks it only
   * for a workspace with Planning or Board on, and only when the user asked.
   */
  setup(repoPath: string, onProgress: (progress: BmadSetupProgress) => void, options?: BmadSetupRunOptions): Promise<BmadSetupStatus>;
  /**
   * Which of `wanted` the repo's BMad Method lacks (AD-14, entry 4.11),
   * judged from its files against what the verified pinned scripts need,
   * never a version string: `ticket_tree` when `_bmad/scripts/config_utils.py`
   * (through real folders, a regular file) defines `load_central_config`,
   * `plain_labels` when an installed skill is one Ogden Agents' label mapping
   * knows. In `BMAD_CAPABILITIES` order, each once. Read-only and inside the repo
   * (lstat, regular files, bounded reads), no process and no network; only
   * what `wanted` names is read (core asks only for the pieces that are on).
   * A missing or unreadable repo lacks everything; it rejects only on a bug.
   */
  missingCapabilities(repoPath: string, wanted: readonly BmadCapability[]): Promise<BmadCapability[]>;
  /**
   * A Markdown document a planning session wrote (story 4.7), read-only:
   * `path` (repo-relative, `/`-separated, ending in `.md`) inside
   * `outputFolder` (the repo-relative output folder of the setup status).
   * Read only when the file's real path lies inside both the repo's and the
   * output folder's real paths, and it is a regular file (never a FIFO or a
   * device, never through a link swapped in), at most `MAX_DOCUMENT_BYTES`
   * (a longer one is cut there, `truncated: true`). `null` when it is
   * missing, not a regular file, or its real path leaves either folder; it
   * rejects only on a bug. Core checks the path and the folder lexically
   * first and asks it only for a workspace with Planning on (AD-22).
   */
  readDocument(repoPath: string, outputFolder: string, path: string): Promise<{ content: string; truncated: boolean } | null>;
  /**
   * The contents of the project's own BMad Method scripts, the code the
   * verified `tickets.py` imports from the repo (`_bmad/scripts/`, story
   * 4.13, user decision 2026-10-04): {@link BMAD_SCRIPTS_NONE} when the repo
   * has no such folder, else a `sha256:` hash of its regular files (paths and
   * contents). `undefined` when it can't be hashed (a link, a special file, a
   * bound passed): core treats that as changed, so nothing runs. Read-only,
   * never follows a link, never rejects for the repo's state.
   */
  scriptsFingerprint(repoPath: string): Promise<string | undefined>;
}

/** {@link BmadCatalogPort.scriptsFingerprint} of a repo with no `_bmad/scripts/` folder. */
export const BMAD_SCRIPTS_NONE = 'none';
