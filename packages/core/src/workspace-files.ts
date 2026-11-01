/**
 * The Workbench's Files use-case (AD-36, E8-R1, E8-R2): lists one folder and
 * reads one file of a project, read-only, through {@link WorkspaceFilesPort}.
 * It checks the client's path (relative, `/`-joined, no `..`, `\`, `:` or
 * NUL) and refuses `.git` and the credential folders by name before the
 * port is asked anything; the port checks the same names again on the real
 * path, with the home and data-folder fences. Nothing is written, no event
 * is appended, and neither a path nor a file's content is logged.
 */
import { WorkspaceId, WorkspaceRelativePath, WORKSPACE_PATH_PROTECTED_MESSAGE, type WorkspaceFileResponse, type WorkspaceFolderResponse } from '@ogden-agents/shared';
import { CREDENTIAL_FOLDERS } from './build-names.js';
import type { Entities } from './entities.js';
import { NotFoundError, PathProtectedError, ValidationError } from './errors.js';
import { isWorkspacePathRefusal, type WorkspaceFilesPort, type WorkspacePathRefusal } from './workspace-files-port.js';

/** The project's agent folder stays readable (its instructions and skills): the one credential folder name not refused inside a project. */
const READABLE_IN_PROJECT = '.claude';

/**
 * A segment as the refusal compares it: NFKC-normalized and case-folded
 * (upper then lower, so the long s `ſ` folds to `s`), with trailing dots and
 * spaces stripped (Windows ignores them, and macOS folds case).
 */
export function foldSegment(segment: string): string {
  return segment.normalize('NFKC').toUpperCase().toLowerCase().replace(/[. ]+$/, '');
}

/** The credential folders as folded segment runs (`Library/Keychains` is two), but `.claude`. */
const REFUSED_RUNS: readonly (readonly string[])[] = CREDENTIAL_FOLDERS.filter((folder) => folder !== READABLE_IN_PROJECT).map((folder) => folder.split(/[\\/]/).map(foldSegment));

/**
 * Whether a workspace-relative path (its segments) names what Ogden never
 * opens: any `.git` segment, or any credential folder (a run of segments for
 * `Library/Keychains`-style entries) but `.claude`, compared folded.
 */
export function isRefusedWorkspacePath(segments: readonly string[]): boolean {
  const folded = segments.map(foldSegment);
  if (folded.includes('.git')) return true;
  return REFUSED_RUNS.some((run) => {
    for (let start = 0; start + run.length <= folded.length; start++) {
      if (run.every((part, offset) => folded[start + offset] === part)) return true;
    }
    return false;
  });
}

export interface WorkspaceFiles {
  /** The folder at `path` (absent or `''`: the root). {@link ValidationError}, {@link PathProtectedError} or {@link NotFoundError} (never naming the path). */
  list(workspaceId: unknown, path: unknown): Promise<WorkspaceFolderResponse>;
  /** The file at `path`. The same refusals. */
  read(workspaceId: unknown, path: unknown): Promise<WorkspaceFileResponse>;
}

export interface WorkspaceFilesOptions {
  entities: Pick<Entities, 'getWorkspace'>;
  port: WorkspaceFilesPort;
}

export function createWorkspaceFiles({ entities, port }: WorkspaceFilesOptions): WorkspaceFiles {
  /** The workspace's real path, or {@link NotFoundError}. */
  const rootOf = (workspaceId: unknown): string => {
    const id = WorkspaceId.safeParse(workspaceId);
    const workspace = id.success ? entities.getWorkspace(id.data) : undefined;
    if (workspace === undefined) throw new NotFoundError('workspace', 'requested');
    return workspace.realPath ?? workspace.path;
  };
  /** The checked path, or {@link ValidationError} / {@link PathProtectedError}. */
  const checked = (path: unknown, { rootAllowed }: { rootAllowed: boolean }): string => {
    if (rootAllowed && (path === undefined || path === '')) return '';
    const parsed = WorkspaceRelativePath.safeParse(path);
    if (!parsed.success) {
      const message = 'That is not a path inside the project.';
      throw new ValidationError(message, [{ path: ['path'], message }]);
    }
    if (isRefusedWorkspacePath(parsed.data.split('/'))) throw new PathProtectedError(WORKSPACE_PATH_PROTECTED_MESSAGE);
    return parsed.data;
  };
  const answer = <T extends object>(result: T | WorkspacePathRefusal): T => {
    if (!isWorkspacePathRefusal(result)) return result;
    if (result.refused === 'protected') throw new PathProtectedError(WORKSPACE_PATH_PROTECTED_MESSAGE);
    throw new NotFoundError('path', 'requested');
  };
  return {
    async list(workspaceId, path) {
      const root = rootOf(workspaceId);
      return answer(await port.list(root, checked(path, { rootAllowed: true })));
    },
    async read(workspaceId, path) {
      const root = rootOf(workspaceId);
      return answer(await port.read(root, checked(path, { rootAllowed: false })));
    },
  };
}
