/**
 * The Workbench's Files use-case (AD-36, E8-R1, E8-R2): lists one folder and
 * reads one file of a project, read-only, through {@link WorkspaceFilesPort}.
 * It checks the client's path (relative, `/`-joined, no `..`, `\`, `:` or
 * NUL) and refuses `.git` (and `*.git`) and the credential folders by name before the
 * port is asked anything; the port checks the same names again on the real
 * path, with the home and data-folder fences. Nothing is written, no event
 * is appended, and neither a path nor a file's content is logged.
 *
 * Epic 8 entry 2: each call may name a chat (`session`), which roots it at
 * that chat's worktree when it has one (a foreign or unknown chat is
 * {@link NotFoundError}); `search` exists only when the port can search,
 * and `locate` only when it can locate (the editor launcher's).
 *
 * 8.7: `exists` (built on `locate`, so only when the port can locate)
 * answers which candidate paths are files the viewer would open, for links
 * from an agent's reply or a markdown file. It answers nothing else.
 */
import {
  MAX_WORKSPACE_FILE_LINKS,
  WorkspaceRelativePath,
  WorkspaceSearchQuery,
  WORKSPACE_PATH_HARD_LINK_MESSAGE,
  WORKSPACE_PATH_PROTECTED_MESSAGE,
  WORKSPACE_SEARCH_INVALID_REGEX_TEXT,
  WORKSPACE_SEARCH_MAX_MATCHES,
  WORKSPACE_SEARCH_MAX_PREVIEW,
  type WorkspaceFileResponse,
  type WorkspaceFolderResponse,
  type WorkspaceSearchFile,
  type WorkspaceSearchResponse,
} from '@ogden-agents/shared';
import { CREDENTIAL_FOLDERS } from './build-names.js';
import type { Entities } from './entities.js';
import { NotFoundError, PathProtectedError, ValidationError } from './errors.js';
import { isWorkspacePathRefusal, type WorkspaceFilesPort, type WorkspacePathRefusal, type WorkspaceRoot } from './workspace-files-port.js';
import { resolveWorkspaceRoot } from './workspace-root.js';

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
 * opens: any segment `.git` or ending in `.git` (a bare repository such as
 * `repo.git`, git internals like the project's own `.git`; a path check
 * can't tell a folder from a file, so a file so named is refused too), or
 * any credential folder (a run of segments for `Library/Keychains`-style
 * entries) but `.claude`, compared folded.
 */
export function isRefusedWorkspacePath(segments: readonly string[]): boolean {
  const folded = segments.map(foldSegment);
  if (folded.some((segment) => segment.endsWith('.git'))) return true;
  return REFUSED_RUNS.some((run) => {
    for (let start = 0; start + run.length <= folded.length; start++) {
      if (run.every((part, offset) => folded[start + offset] === part)) return true;
    }
    return false;
  });
}

export interface WorkspaceFiles {
  /** The folder at `path` (absent or `''`: the root). {@link ValidationError}, {@link PathProtectedError} or {@link NotFoundError} (never naming the path). */
  list(workspaceId: unknown, path: unknown, session?: unknown): Promise<WorkspaceFolderResponse>;
  /** The file at `path`. The same refusals. */
  read(workspaceId: unknown, path: unknown, session?: unknown): Promise<WorkspaceFileResponse>;
  /**
   * Project search (8.8): `query` checked against `WorkspaceSearchQuery`
   * ({@link ValidationError}), the answer clamped to
   * `WORKSPACE_SEARCH_MAX_MATCHES` matches (`truncated` past it) and each
   * preview to `WORKSPACE_SEARCH_MAX_PREVIEW`. A `regex` query that doesn't
   * compile is {@link ValidationError} with the shared sentence. `signal`
   * (the client's request) stops the search when it goes away. Absent when
   * the port can't search.
   */
  search?(workspaceId: unknown, query: unknown, signal?: AbortSignal): Promise<WorkspaceSearchResponse>;
  /** The absolute real path of an allowed file, for the editor launcher only; the same refusals as {@link read}. Absent when the port can't locate. */
  locate?(workspaceId: unknown, path: unknown, session?: unknown): Promise<string>;
  /**
   * Which of `paths` (an array of at most `MAX_WORKSPACE_FILE_LINKS`
   * `WorkspaceRelativePath`s, else {@link ValidationError}) are files
   * {@link read} would open, each once, in the order asked: a refused name,
   * a refusal of the port's (outside the root, a fence, a hard link), a
   * folder or a missing path is absent. The root is resolved first, so an
   * unknown workspace or session is {@link NotFoundError} whatever the paths.
   * Absent when the port can't locate.
   */
  exists?(workspaceId: unknown, paths: unknown, session?: unknown): Promise<string[]>;
}

export interface WorkspaceFilesOptions {
  entities: Pick<Entities, 'getWorkspace' | 'getSession'>;
  port: WorkspaceFilesPort;
}

/**
 * The client's path, checked: {@link ValidationError} unless it is a
 * `WorkspaceRelativePath`, {@link PathProtectedError} for a refused name.
 * `rootAllowed`: absent or `''` is the root (`''`).
 */
export function checkedWorkspacePath(path: unknown, { rootAllowed }: { rootAllowed: boolean }): string {
  if (rootAllowed && (path === undefined || path === '')) return '';
  const parsed = WorkspaceRelativePath.safeParse(path);
  if (!parsed.success) {
    const message = 'That is not a path inside the project.';
    throw new ValidationError(message, [{ path: ['path'], message }]);
  }
  if (isRefusedWorkspacePath(parsed.data.split('/'))) throw new PathProtectedError(WORKSPACE_PATH_PROTECTED_MESSAGE);
  return parsed.data;
}

/** A port's answer, or its refusal as {@link PathProtectedError} / {@link NotFoundError} (never naming the path). */
export function workspaceAnswer<T extends object>(result: T | WorkspacePathRefusal): T {
  if (!isWorkspacePathRefusal(result)) return result;
  if (result.refused === 'protected') throw new PathProtectedError(result.reason === 'hard_link' ? WORKSPACE_PATH_HARD_LINK_MESSAGE : WORKSPACE_PATH_PROTECTED_MESSAGE);
  throw new NotFoundError('path', 'requested');
}

/** Context kept before a match in a cut preview. */
const PREVIEW_LEAD = 80;

/**
 * A line longer than {@link WORKSPACE_SEARCH_MAX_PREVIEW} cut to a window
 * around the match at 1-based `column` (some context before it), so the
 * match stays in the preview; `column` itself still counts in the whole line.
 */
export function previewAround(line: string, column: number): string {
  if (line.length <= WORKSPACE_SEARCH_MAX_PREVIEW) return line;
  const start = Math.max(0, Math.min(column - 1 - PREVIEW_LEAD, line.length - WORKSPACE_SEARCH_MAX_PREVIEW));
  return line.slice(start, start + WORKSPACE_SEARCH_MAX_PREVIEW);
}

/** `files` held to {@link WORKSPACE_SEARCH_MAX_MATCHES} matches (a File names hit counts as one) and previews cut to {@link WORKSPACE_SEARCH_MAX_PREVIEW} around their match. */
export function clampSearchFiles(files: readonly WorkspaceSearchFile[]): { files: WorkspaceSearchFile[]; truncated: boolean } {
  const kept: WorkspaceSearchFile[] = [];
  let left = WORKSPACE_SEARCH_MAX_MATCHES;
  let truncated = false;
  for (const file of files) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    if (file.matches.length === 0) {
      kept.push({ path: file.path, matches: [] });
      left -= 1;
      continue;
    }
    const matches = file.matches.slice(0, left).map((match) => (match.preview.length > WORKSPACE_SEARCH_MAX_PREVIEW ? { ...match, preview: previewAround(match.preview, match.column) } : match));
    if (matches.length < file.matches.length) truncated = true;
    kept.push({ path: file.path, matches });
    left -= matches.length;
  }
  return { files: kept, truncated };
}

export function createWorkspaceFiles({ entities, port }: WorkspaceFilesOptions): WorkspaceFiles {
  /** The request's root, or {@link NotFoundError}. */
  const rootOf = (workspaceId: unknown, session: unknown): WorkspaceRoot => resolveWorkspaceRoot(entities, workspaceId, session).root;
  const files: WorkspaceFiles = {
    async list(workspaceId, path, session) {
      const root = rootOf(workspaceId, session);
      const checked = checkedWorkspacePath(path, { rootAllowed: true });
      return workspaceAnswer(root.kind === 'project' ? await port.list(root.path, checked) : await port.list(root.path, checked, root.kind));
    },
    async read(workspaceId, path, session) {
      const root = rootOf(workspaceId, session);
      const checked = checkedWorkspacePath(path, { rootAllowed: false });
      return workspaceAnswer(root.kind === 'project' ? await port.read(root.path, checked) : await port.read(root.path, checked, root.kind));
    },
  };
  const search = port.search?.bind(port);
  if (search !== undefined) {
    files.search = async (workspaceId, query, signal) => {
      const parsed = WorkspaceSearchQuery.safeParse(query);
      // The workspace and the chat are checked first: an unknown one is 404 whatever the query.
      const root = rootOf(workspaceId, (query as { session?: unknown } | null | undefined)?.session);
      if (!parsed.success) {
        const message = 'That search is not one Ogden can run.';
        throw new ValidationError(message, parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
      }
      const { q, mode, matchCase, regex } = parsed.data;
      if (regex && !compiles(q, matchCase)) throw new ValidationError(WORKSPACE_SEARCH_INVALID_REGEX_TEXT, [{ path: ['q'], message: WORKSPACE_SEARCH_INVALID_REGEX_TEXT }]);
      const found = await search(root.path, { q, mode, matchCase, regex, ...(signal === undefined ? {} : { signal }) }, root.kind);
      const clamped = clampSearchFiles(found.files);
      return { files: clamped.files, truncated: found.truncated || clamped.truncated, limit: WORKSPACE_SEARCH_MAX_MATCHES };
    };
  }
  const locate = port.locate?.bind(port);
  if (locate !== undefined) {
    files.locate = async (workspaceId, path, session) => {
      const root = rootOf(workspaceId, session);
      return workspaceAnswer(await locate(root.path, checkedWorkspacePath(path, { rootAllowed: false }), root.kind)).realPath;
    };
    files.exists = async (workspaceId, paths, session) => {
      const root = rootOf(workspaceId, session);
      if (!Array.isArray(paths) || paths.length > MAX_WORKSPACE_FILE_LINKS || !paths.every((path) => WorkspaceRelativePath.safeParse(path).success)) {
        const message = `At most ${MAX_WORKSPACE_FILE_LINKS} paths inside the project.`;
        throw new ValidationError(message, [{ path: ['paths'], message }]);
      }
      const unique = [...new Set(paths as string[])].filter((path) => !isRefusedWorkspacePath(path.split('/')));
      const found = new Set<string>();
      // A few at a time: a message's paths are checked without holding many files open at once.
      for (let start = 0; start < unique.length; start += LOCATE_BATCH) {
        await Promise.all(
          unique.slice(start, start + LOCATE_BATCH).map(async (path) => {
            try {
              if (!isWorkspacePathRefusal(await locate(root.path, path, root.kind))) found.add(path);
            } catch {
              // Unreadable is absent, like any refusal.
            }
          }),
        );
      }
      return unique.filter((path) => found.has(path));
    };
  }
  return files;
}

/** Whether `pattern` compiles as a search's regular expression (`u`, and `i` unless Match case). Compiling never runs it. */
function compiles(pattern: string, matchCase: boolean): boolean {
  try {
    new RegExp(pattern, matchCase ? 'u' : 'iu');
    return true;
  } catch {
    return false;
  }
}

/** How many paths {@link WorkspaceFiles.exists} locates at once. */
const LOCATE_BATCH = 10;
