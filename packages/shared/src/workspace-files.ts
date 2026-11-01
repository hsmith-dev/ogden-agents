/**
 * The Workbench's Files panel (AD-36, E8-R1, E8-R2; epic v2 developer
 * experience, entry 1): the wire contract for listing one folder of a
 * project and reading one file of it, read-only. A file's content is only
 * ever in a `GET` response: never in an event, the database or a log line.
 */
import { z } from 'zod';

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
  /** `.git`, a credential folder, or a link that leads out of the project or into one of those: never listed or read. */
  protected: z.boolean(),
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
/** The error message for a refused path (403 `path_protected`). */
export const WORKSPACE_PATH_PROTECTED_MESSAGE = WORKSPACE_FILE_PROTECTED_TEXT;
/** The error message for a missing file or folder, or a project that isn't there (404). */
export const WORKSPACE_PATH_NOT_FOUND_MESSAGE = "That isn't there any more. It may have been moved or deleted.";
