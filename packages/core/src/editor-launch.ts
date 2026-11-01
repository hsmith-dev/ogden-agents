/**
 * Open in editor (AD-39; epic 8 entry 2): the project and chat are resolved
 * first, then the path is checked exactly as the Files use-case checks one
 * (relative, no refused name) and the request against `OpenInEditorRequest`,
 * then the file is located through the files port (the
 * same confinement, fences and hard-link refusal as a read) before the
 * launcher is asked anything. The editor is one the launcher listed: named,
 * or the default (the one chosen in Settings while it is found, else the
 * first found). Nothing is appended or logged.
 */
import { EDITOR_NONE_FOUND_TEXT, EDITOR_UNAVAILABLE_MESSAGE, OpenInEditorRequest, SessionId, SetEditorRequest, type EditorId, type EditorInfo, type EditorsResponse, type OpenInEditorResponse } from '@ogden-agents/shared';
import type { EditorLauncherPort } from './editor-launcher-port.js';
import type { Entities } from './entities.js';
import { EditorUnavailableError, issuesOf, ValidationError } from './errors.js';
import { checkedWorkspacePath, type WorkspaceFiles } from './workspace-files.js';
import { namedSession, resolveWorkspaceRoot } from './workspace-root.js';

export interface EditorLaunch {
  /** The editors found, the default and the kept choice. */
  editors(): Promise<EditorsResponse>;
  /** Keeps the editor files open in (`SetEditorRequest`). {@link ValidationError}; {@link EditorUnavailableError} for one not found now. */
  setChoice(body: unknown): Promise<EditorsResponse>;
  /** Opens one file at its line. {@link ValidationError}, `PathProtectedError`, `NotFoundError`, {@link EditorUnavailableError}. */
  open(workspaceId: unknown, body: unknown): Promise<OpenInEditorResponse>;
}

export interface EditorLaunchOptions {
  entities: Pick<Entities, 'getWorkspace' | 'getSession'>;
  files: Required<Pick<WorkspaceFiles, 'locate'>>;
  launcher: EditorLauncherPort;
  /** Where the chosen editor is kept (`editor-choice.ts`); absent, nothing is kept and the first found is the default. */
  choice?: { get(): EditorId | null; set(editorId: EditorId | null): void } | undefined;
}

/** The default among `editors`: the chosen one while it is found, else the first. */
const defaultOf = (editors: readonly EditorInfo[], chosen: EditorId | null): EditorInfo | undefined => editors.find((editor) => editor.id === chosen) ?? editors[0];

export function createEditorLaunch({ entities, files, launcher, choice }: EditorLaunchOptions): EditorLaunch {
  const chosen = (): EditorId | null => choice?.get() ?? null;
  const answer = (editors: EditorInfo[], kept: EditorId | null): EditorsResponse => ({ editors, defaultEditorId: defaultOf(editors, kept)?.id ?? null, chosenEditorId: kept });
  return {
    async editors() {
      return answer(await launcher.list(), chosen());
    },
    async setChoice(body) {
      const parsed = SetEditorRequest.safeParse(body);
      if (!parsed.success) throw new ValidationError('That is not an editor Ogden can open files in.', issuesOf(parsed.error));
      const editors = await launcher.list();
      const { editorId } = parsed.data;
      if (editorId !== null && !editors.some((editor) => editor.id === editorId)) throw new EditorUnavailableError(editors.length === 0 ? EDITOR_NONE_FOUND_TEXT : EDITOR_UNAVAILABLE_MESSAGE);
      if (choice === undefined) return answer(editors, null);
      choice.set(editorId);
      return answer(editors, editorId);
    },
    async open(workspaceId, body) {
      // As the Files use-case: the project and the chat first (404), then the path (400 malformed, 403 a refused name), then the rest of the body.
      // The project first (404), then a malformed chat id is 400 as the files routes answer it, then an unknown or foreign chat 404.
      const named = namedSession(body);
      resolveWorkspaceRoot(entities, workspaceId);
      if (named !== undefined && !SessionId.safeParse(named).success) throw new ValidationError('That is not a chat of this project.', [{ path: ['session'], message: 'A chat id.' }]);
      resolveWorkspaceRoot(entities, workspaceId, named);
      checkedWorkspacePath((body as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const parsed = OpenInEditorRequest.safeParse(body);
      if (!parsed.success) {
        const message = 'That is not a file Ogden can open in an editor.';
        throw new ValidationError(message, issuesOf(parsed.error));
      }
      const { path, line, column, editorId, session } = parsed.data;
      const absolutePath = await files.locate(workspaceId, path, session);
      const editors = await launcher.list();
      const editor = editorId === undefined ? defaultOf(editors, chosen()) : editors.find((found) => found.id === editorId);
      if (editor === undefined) throw new EditorUnavailableError(editors.length === 0 ? EDITOR_NONE_FOUND_TEXT : EDITOR_UNAVAILABLE_MESSAGE);
      if ((await launcher.open(editor.id, absolutePath, line, column)) !== 'opened') throw new EditorUnavailableError(EDITOR_UNAVAILABLE_MESSAGE);
      return { editorId: editor.id, editorName: editor.name };
    },
  };
}
