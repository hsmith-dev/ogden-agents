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

/** `GET /api/v1/editors`: the editors found, in the launcher's order; the default is the chosen one when found, else the first. */
export const EditorsResponse = z.object({
  editors: z.array(EditorInfo),
  /** The editor a file opens in when none is named: the chosen one while it is found, else the first found, `null` with none. */
  defaultEditorId: EditorId.nullable(),
  /** The editor kept in Settings, Projects, Editor (found or not), `null` when none was chosen. */
  chosenEditorId: EditorId.nullable(),
});
export type EditorsResponse = z.infer<typeof EditorsResponse>;

/**
 * `PUT /api/v1/editors`: the editor files open in (Settings, Projects,
 * Editor), kept on the server so every tab agrees. `null` forgets the
 * choice (the first found is the default again). Only an editor found now
 * can be chosen (409 `editor_unavailable` otherwise).
 */
export const SetEditorRequest = z.object({ editorId: EditorId.nullable() }).strict();
export type SetEditorRequest = z.infer<typeof SetEditorRequest>;

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
/** The Settings page (Settings, Projects). */
export const EDITOR_SETTINGS_LABEL = 'Editor';
/** The radio group's label on that page. */
export const EDITOR_CHOICE_LABEL = 'Open files in';
/** The page's intro. */
export const EDITOR_SETTINGS_INTRO = 'The editor Open in editor hands a file to, at its line. Ogden only lists editors it found on this computer.';
/** Saved, on that page. */
export const editorChosenText = (editorName: string): string => `Saved: files open in ${editorName}.`;
/** The page couldn't save the choice. */
export const EDITOR_SAVE_FAILED_TEXT = "Ogden couldn't save the editor. Try again.";
/** The page couldn't load the editors. */
export const EDITOR_LOAD_FAILED_TEXT = "Ogden couldn't look for editors";
/** The button's word for a moment when a file couldn't be handed over (its reason is announced with it). */
export const EDITOR_OPEN_FAILED_LABEL = "Couldn't open";
/** The fallback reason when the request itself failed. */
export const EDITOR_OPEN_FAILED_TEXT = "Ogden couldn't open that file in your editor.";
