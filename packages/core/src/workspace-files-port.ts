/**
 * Reading a project's files for the Workbench (AD-36, E8-R1, E8-R2): list one
 * folder, read one file, read-only and confined to the project. The
 * `workspace-files-node` adapter implements it; core names no file system
 * call (AD-1).
 *
 * Epic 8 entry 2: every call may name the root's kind. A `chat_worktree`
 * root is a worktree chat's own copy in Ogden's data directory (AD-8 CAP-33
 * note): the data-folder fence is lifted for it alone, and everything is
 * still confined to that root. Absent, the kind is `project`, as in 8.1.
 * `search` (8.8) and `locate` (for the editor launcher, AD-39) are optional:
 * a port without one has no such use-case, and its route answers 501.
 */
import type { WorkspaceFileResponse, WorkspaceFolderResponse, WorkspaceSearchFile, WorkspaceSearchMode } from '@ogden-agents/shared';

/** Which kind of folder a request is rooted at. */
export type WorkspaceRootKind = 'project' | 'chat_worktree';

/** A request's root: the workspace's real path, or a worktree chat's `worktreePath`. */
export interface WorkspaceRoot {
  path: string;
  kind: WorkspaceRootKind;
}

/**
 * Why a path was not listed or read: `protected` (a refused name, a real
 * path out of the project or into a fence, or, with `reason: 'hard_link'`, a
 * regular file with more than one link outside `node_modules`) or `not_found`.
 */
export interface WorkspacePathRefusal {
  refused: 'protected' | 'not_found';
  reason?: 'hard_link';
}

/** What the port is asked to search for (already checked against `WorkspaceSearchQuery`). */
export interface WorkspaceSearchPortQuery {
  q: string;
  mode: WorkspaceSearchMode;
  matchCase: boolean;
  /** `q` is a regular expression (already known to compile with `u`, and `i` unless `matchCase`); absent or false, a literal. */
  regex?: boolean;
  /** Aborted when the client goes away: the search stops and answers what it has, `truncated`. */
  signal?: AbortSignal;
}

/**
 * A port's search answer. The port honours the shared caps it can (files
 * looked at, time, file size, `.gitignore`, protected paths); the use-case
 * also clamps the matches to `WORKSPACE_SEARCH_MAX_MATCHES` and each
 * preview to `WORKSPACE_SEARCH_MAX_PREVIEW`.
 */
export interface WorkspaceSearchPortResult {
  files: WorkspaceSearchFile[];
  truncated: boolean;
}

export interface WorkspaceFilesPort {
  /**
   * The folder at `path` (workspace-relative, already checked against
   * `WorkspaceRelativePath`; `''` for the root) inside the folder whose
   * real path is `root`.
   */
  list(root: string, path: string, kind?: WorkspaceRootKind): Promise<WorkspaceFolderResponse | WorkspacePathRefusal>;
  /** The file at `path` (workspace-relative, already checked) inside the folder whose real path is `root`. */
  read(root: string, path: string, kind?: WorkspaceRootKind): Promise<WorkspaceFileResponse | WorkspacePathRefusal>;
  /** Project search (8.8): absent until it is built, and its route answers 501. */
  search?(root: string, query: WorkspaceSearchPortQuery, kind?: WorkspaceRootKind): Promise<WorkspaceSearchPortResult>;
  /**
   * The absolute real path of the file at `path` (checked exactly as
   * {@link read} checks it: confined, no refused name, no fence, no hard
   * link outside `node_modules`), for the editor launcher only (AD-39).
   * Never sent to a client.
   */
  locate?(root: string, path: string, kind?: WorkspaceRootKind): Promise<{ realPath: string } | WorkspacePathRefusal>;
}

/** Whether a port's answer is a refusal. */
export function isWorkspacePathRefusal(value: object): value is WorkspacePathRefusal {
  return 'refused' in value;
}
