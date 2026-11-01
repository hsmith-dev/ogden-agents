/**
 * Reading a project's files for the Workbench (AD-36, E8-R1, E8-R2): list one
 * folder, read one file, read-only and confined to the project. The
 * `workspace-files-node` adapter implements it; core names no file system
 * call (AD-1).
 */
import type { WorkspaceFileResponse, WorkspaceFolderResponse } from '@ogden-agents/shared';

/**
 * Why a path was not listed or read: `protected` (a refused name, a real
 * path out of the project or into a fence, or, with `reason: 'hard_link'`, a
 * regular file with more than one link outside `node_modules`) or `not_found`.
 */
export interface WorkspacePathRefusal {
  refused: 'protected' | 'not_found';
  reason?: 'hard_link';
}

export interface WorkspaceFilesPort {
  /**
   * The folder at `path` (workspace-relative, already checked against
   * `WorkspaceRelativePath`; `''` for the root) inside the project whose
   * real path is `root`.
   */
  list(root: string, path: string): Promise<WorkspaceFolderResponse | WorkspacePathRefusal>;
  /** The file at `path` (workspace-relative, already checked) inside the project whose real path is `root`. */
  read(root: string, path: string): Promise<WorkspaceFileResponse | WorkspacePathRefusal>;
}

/** Whether a port's answer is a refusal. */
export function isWorkspacePathRefusal(value: object): value is WorkspacePathRefusal {
  return 'refused' in value;
}
