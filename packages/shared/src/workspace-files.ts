/**
 * The Workbench's Files panel (AD-36, E8-R1, E8-R2; epic v2 developer
 * experience, entry 1): the wire contract for listing one folder of a
 * project and reading one file of it, read-only. A file's content is only
 * ever in a `GET` response: never in an event, the database or a log line.
 */
import { z } from 'zod';
import { EditorId } from './editors.js';
import { SessionId } from './ids.js';

/** The most bytes of a file the viewer reads: a longer one answers `too_large` with no content. */
export const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;

/** The most entries of one folder listed: the rest are left out and the answer says `truncated`. */
export const MAX_WORKSPACE_FOLDER_ENTRIES = 5000;

/** How much of a file's start is looked at for a NUL byte, which marks it binary. */
export const WORKSPACE_BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * A path inside the project as the client sends it: relative, segments
 * joined by `/`, never absolute, never `..`, `.` or an empty segment, and no
 * `\`, `:` (so no drive letter) or NUL anywhere.
 */
export const WorkspaceRelativePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) => !path.startsWith('/') && !/[\\:\0]/.test(path) && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'A path inside the project, with forward slashes.',
  );
export type WorkspaceRelativePath = z.infer<typeof WorkspaceRelativePath>;

/** One row of a folder: a folder or a file (a link is shown as what it leads to), and whether Ogden refuses to open it. */
export const WorkspaceFileEntry = z.object({
  name: z.string().min(1),
  /** The entry's workspace-relative path, `/`-joined. */
  path: z.string().min(1),
  kind: z.enum(['folder', 'file']),
  /** `.git` (or any folder named `*.git`), a credential folder, a link that leads out of the project or into one of those, or a hard-linked file outside `node_modules`: never listed or read. */
  protected: z.boolean(),
  /** Why a protected row is refused, when it is not the plain protected reason: `hard_link` for a file with more than one link outside `node_modules`. */
  protectedReason: z.enum(['hard_link']).optional(),
});
export type WorkspaceFileEntry = z.infer<typeof WorkspaceFileEntry>;

/** `GET /api/v1/workspaces/:wsId/files?path=`: one folder's entries, folders first, then files, each by name. */
export const WorkspaceFolderResponse = z.object({
  /** The folder listed, `''` for the project's root. */
  path: z.string(),
  entries: z.array(WorkspaceFileEntry),
  /** Whether the folder had more than {@link MAX_WORKSPACE_FOLDER_ENTRIES} entries, so some are not listed. */
  truncated: z.boolean(),
});
export type WorkspaceFolderResponse = z.infer<typeof WorkspaceFolderResponse>;

/** A text file's content; `masked` when it is an environment file whose values were replaced. */
export const WorkspaceTextFile = z.object({ kind: z.literal('text'), path: z.string().min(1), content: z.string(), size: z.number().int().nonnegative(), masked: z.boolean() });
/** A file with a NUL byte near its start: not shown. */
export const WorkspaceBinaryFile = z.object({ kind: z.literal('binary'), path: z.string().min(1), size: z.number().int().nonnegative() });
/** A file over the limit: not read. */
export const WorkspaceTooLargeFile = z.object({ kind: z.literal('too_large'), path: z.string().min(1), size: z.number().int().nonnegative(), limit: z.number().int().positive() });

/** `GET /api/v1/workspaces/:wsId/files/content?path=`: one file, read-only. */
export const WorkspaceFileResponse = z.discriminatedUnion('kind', [WorkspaceTextFile, WorkspaceBinaryFile, WorkspaceTooLargeFile]);
export type WorkspaceFileResponse = z.infer<typeof WorkspaceFileResponse>;

/** The Workbench tab's title and its one panel (so far). */
export const WORKBENCH_PAGE_TITLE = 'Workbench';
export const WORKBENCH_FILES_LABEL = 'Files';

/** A protected row, selected: said instead of its content, which is never asked for. */
export const WORKSPACE_FILE_PROTECTED_TEXT = "Protected. Ogden doesn't open this file.";
/** A binary file. */
export const WORKSPACE_FILE_BINARY_TEXT = "This file isn't text, so Ogden doesn't show it.";
/** A file over {@link MAX_WORKSPACE_FILE_BYTES}. */
export const WORKSPACE_FILE_TOO_LARGE_TEXT = "This file is over 1 MB, so Ogden doesn't show it.";
/** A file that couldn't be read (the fallback when the server gives no message). */
export const WORKSPACE_FILE_READ_FAILED = "Ogden couldn't open this file";
/** A folder that couldn't be listed (the fallback when the server gives no message). */
export const WORKSPACE_FOLDER_READ_FAILED = "Ogden couldn't open this folder";
/** A file with nothing in it. */
export const WORKSPACE_FILE_EMPTY_TEXT = 'This file is empty.';
/** A folder with nothing in it. */
export const WORKSPACE_FOLDER_EMPTY_TEXT = 'This folder is empty.';
/** A folder with more entries than are listed. */
export const WORKSPACE_FOLDER_TRUNCATED_TEXT = 'This folder has more files than Ogden lists.';
/** Before any file is picked. */
export const WORKSPACE_FILE_NONE_SELECTED_TEXT = 'Pick a file to see it here.';
/** Over an environment file whose values are hidden. */
export const WORKSPACE_FILE_MASKED_TEXT = 'Values in this file are hidden.';
/** A hard-linked file outside `node_modules`, selected or read: said instead of its content. */
export const WORKSPACE_FILE_HARD_LINK_TEXT = "Ogden doesn't open hard-linked files. You can open this one in your editor.";
/** The error message for a refused path (403 `path_protected`). */
export const WORKSPACE_PATH_PROTECTED_MESSAGE = WORKSPACE_FILE_PROTECTED_TEXT;
/** The error message for a hard-linked file outside `node_modules` (403 `path_protected`). */
export const WORKSPACE_PATH_HARD_LINK_MESSAGE = WORKSPACE_FILE_HARD_LINK_TEXT;
/** The error message for a missing file or folder, or a project that isn't there (404). */
export const WORKSPACE_PATH_NOT_FOUND_MESSAGE = "That isn't there any more. It may have been moved or deleted.";

// ---------------------------------------------------------------------------
// Epic 8 entry 2: the `session` root, project search (8.8 builds it) and the
// editor hand-off (8.10). Every path here is a `WorkspaceRelativePath`.
// ---------------------------------------------------------------------------

/**
 * What both files routes take as query parameters: the folder or file
 * (`path`; absent lists the root) and, for a worktree chat, its `session`,
 * which roots the request at that chat's `worktreePath` (else the project).
 * A session of another project, or an unknown one, answers 404.
 */
export const WorkspaceFilesQuery = z.object({
  path: WorkspaceRelativePath.optional(),
  session: SessionId.optional(),
});
export type WorkspaceFilesQuery = z.infer<typeof WorkspaceFilesQuery>;

/** The most matches a search answers, in either mode ("Showing the first 500 matches"). */
export const WORKSPACE_SEARCH_MAX_MATCHES = 500;
/** The longest search query, in characters. */
export const WORKSPACE_SEARCH_MAX_QUERY = 200;
/** The longest preview of one matching line, in characters (a longer line is cut around the match). */
export const WORKSPACE_SEARCH_MAX_PREVIEW = 240;
/** The most files one search looks at; past this it answers `truncated`. */
export const WORKSPACE_SEARCH_MAX_FILES = 20_000;
/** The longest one search runs, in milliseconds; past this it answers `truncated`. */
export const WORKSPACE_SEARCH_TIMEOUT_MS = 5_000;
/** Files over this many bytes (and binary files) are skipped by a text search. */
export const WORKSPACE_SEARCH_MAX_FILE_BYTES = MAX_WORKSPACE_FILE_BYTES;

/** **Text** searches file contents; **File names** matches paths. */
export const WorkspaceSearchMode = z.enum(['text', 'names']);
export type WorkspaceSearchMode = z.infer<typeof WorkspaceSearchMode>;

/** `GET …/files/search?q=&mode=&matchCase=&session=`, as the server reads it (`matchCase` is `true` or absent). */
export const WorkspaceSearchQuery = z
  .object({
    q: z.string().min(1).max(WORKSPACE_SEARCH_MAX_QUERY),
    mode: WorkspaceSearchMode.default('text'),
    matchCase: z.boolean().default(false),
    session: SessionId.optional(),
  })
  .strict();
export type WorkspaceSearchQuery = z.infer<typeof WorkspaceSearchQuery>;

/**
 * One matching line: 1-based line and column (counted in the whole line),
 * and the line's text; a line longer than {@link WORKSPACE_SEARCH_MAX_PREVIEW}
 * is cut to a window of that length around the match.
 */
export const WorkspaceSearchMatch = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string().max(WORKSPACE_SEARCH_MAX_PREVIEW),
});
export type WorkspaceSearchMatch = z.infer<typeof WorkspaceSearchMatch>;

/** One file with matches (in File names mode, `matches` is empty: the file itself is the match). */
export const WorkspaceSearchFile = z.object({
  path: WorkspaceRelativePath,
  matches: z.array(WorkspaceSearchMatch),
});
export type WorkspaceSearchFile = z.infer<typeof WorkspaceSearchFile>;

/** The search's answer, grouped by file; `truncated` when any cap (matches, files looked at, time) was hit. */
export const WorkspaceSearchResponse = z.object({
  files: z.array(WorkspaceSearchFile),
  truncated: z.boolean(),
  /** The match cap the answer was held to ({@link WORKSPACE_SEARCH_MAX_MATCHES}). */
  limit: z.number().int().positive(),
});
export type WorkspaceSearchResponse = z.infer<typeof WorkspaceSearchResponse>;

/**
 * `POST …/files/open-in-editor`: one file of the project (or of the
 * chat's worktree) handed to an editor at its line. `editorId` absent: the
 * default editor. The path is checked as the files routes check it before
 * the launcher is asked anything.
 */
export const OpenInEditorRequest = z
  .object({
    path: WorkspaceRelativePath,
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    editorId: EditorId.optional(),
    session: SessionId.optional(),
  })
  .strict();
export type OpenInEditorRequest = z.infer<typeof OpenInEditorRequest>;

/** The Workbench's Search panel. */
export const WORKBENCH_SEARCH_LABEL = 'Search';
/** Search's field, before typing. */
export const WORKSPACE_SEARCH_EMPTY_TEXT = 'Search text or file names in this project.';
/** Over the cap. */
export const WORKSPACE_SEARCH_CAPPED_TEXT = `Showing the first ${WORKSPACE_SEARCH_MAX_MATCHES} matches. Narrow the search to see more.`;
/** No match. */
export const workspaceSearchNoMatchText = (query: string): string => `No matches for "${query}" in this project.`;
/** Search isn't built on this server yet (501). */
export const WORKSPACE_SEARCH_UNAVAILABLE_TEXT = "Search isn't available here yet.";
