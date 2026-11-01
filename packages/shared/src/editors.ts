/**
 * Open in editor (AD-39, CAP-34; epic v2 developer experience, entry 2's
 * contract, 8.10 builds the launcher): the editors Ogden found on this
 * computer and the answer to opening one file at its line. The fixed list
 * of editors (and how each is started) lives in the `editor-launcher-*`
 * adapter, never here: an editor's id is only ever one the server listed.
 */
import { z } from 'zod';

/** An editor's id as the launcher lists it (`vscode`, `cursor`): a lower-case slug, never free text. */
export const EditorId = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9-]*$/, 'An editor id.');
export type EditorId = z.infer<typeof EditorId>;

/** One editor found on this computer. */
export const EditorInfo = z.object({
  id: EditorId,
  /** Its plain name (`VS Code`), for the menu and the toast. */
  name: z.string().min(1).max(60),
});
export type EditorInfo = z.infer<typeof EditorInfo>;

/** `GET /api/v1/editors`: the editors found, in the launcher's order; the first is the default. */
export const EditorsResponse = z.object({
  editors: z.array(EditorInfo),
  /** The editor a file opens in when none is named: the first found, `null` with none. */
  defaultEditorId: EditorId.nullable(),
});
export type EditorsResponse = z.infer<typeof EditorsResponse>;

/** `POST …/files/open-in-editor` → this: the editor the file was handed to. */
export const OpenInEditorResponse = z.object({ editorId: EditorId, editorName: z.string().min(1).max(60) });
export type OpenInEditorResponse = z.infer<typeof OpenInEditorResponse>;

/** Open in editor with no editor found (disabled with this reason). */
export const EDITOR_NONE_FOUND_TEXT = 'No editor found on this computer. Ogden looks for VS Code, Cursor, Zed and JetBrains.';
/** The 409 `editor_unavailable` message when the editor named isn't found or didn't start. */
export const EDITOR_UNAVAILABLE_MESSAGE = "Ogden couldn't open that editor. Check that it's still installed.";
/** The toast after a file was handed to an editor. */
export const editorOpenedText = (editorName: string): string => `Opened in ${editorName}`;
/** The button. */
export const OPEN_IN_EDITOR_LABEL = 'Open in editor';
