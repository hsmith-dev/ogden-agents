/**
 * Open in editor (AD-39; epic 8 entry 2): the project and chat are resolved
 * first, then the path is checked exactly as the Files use-case checks one
 * (relative, no refused name) and the request against `OpenInEditorRequest`,
 * then the file is located through the files port (the
 * same confinement, fences and hard-link refusal as a read) before the
 * launcher is asked anything. The editor is one the launcher listed: named,
 * or the first found. Nothing is appended or logged.
 */
import { EDITOR_NONE_FOUND_TEXT, EDITOR_UNAVAILABLE_MESSAGE, OpenInEditorRequest, type EditorsResponse, type OpenInEditorResponse } from '@ogden-agents/shared';
import type { EditorLauncherPort } from './editor-launcher-port.js';
import type { Entities } from './entities.js';
import { EditorUnavailableError, ValidationError } from './errors.js';
import { checkedWorkspacePath, type WorkspaceFiles } from './workspace-files.js';
import { resolveWorkspaceRoot } from './workspace-root.js';

export interface EditorLaunch {
  /** The editors found, and the default. */
  editors(): Promise<EditorsResponse>;
  /** Opens one file at its line. {@link ValidationError}, `PathProtectedError`, `NotFoundError`, {@link EditorUnavailableError}. */
  open(workspaceId: unknown, body: unknown): Promise<OpenInEditorResponse>;
}

export interface EditorLaunchOptions {
  entities: Pick<Entities, 'getWorkspace' | 'getSession'>;
  files: Required<Pick<WorkspaceFiles, 'locate'>>;
  launcher: EditorLauncherPort;
}

export function createEditorLaunch({ entities, files, launcher }: EditorLaunchOptions): EditorLaunch {
  return {
    async editors() {
      const editors = await launcher.list();
      return { editors, defaultEditorId: editors[0]?.id ?? null };
    },
    async open(workspaceId, body) {
      // As the Files use-case: the project and the chat first (404), then the path (400 malformed, 403 a refused name), then the rest of the body.
      resolveWorkspaceRoot(entities, workspaceId, (body as { session?: unknown } | null | undefined)?.session);
      checkedWorkspacePath((body as { path?: unknown } | null | undefined)?.path, { rootAllowed: false });
      const parsed = OpenInEditorRequest.safeParse(body);
      if (!parsed.success) {
        const message = 'That is not a file Ogden can open in an editor.';
        throw new ValidationError(message, parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
      }
      const { path, line, column, editorId, session } = parsed.data;
      const absolutePath = await files.locate(workspaceId, path, session);
      const editors = await launcher.list();
      const editor = editorId === undefined ? editors[0] : editors.find((found) => found.id === editorId);
      if (editor === undefined) throw new EditorUnavailableError(editors.length === 0 ? EDITOR_NONE_FOUND_TEXT : EDITOR_UNAVAILABLE_MESSAGE);
      if ((await launcher.open(editor.id, absolutePath, line, column)) !== 'opened') throw new EditorUnavailableError(EDITOR_UNAVAILABLE_MESSAGE);
      return { editorId: editor.id, editorName: editor.name };
    },
  };
}
