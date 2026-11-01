/**
 * `editor-launcher-memory` (epic 8 entry 2): an in-memory
 * `EditorLauncherPort` for tests and the Workbench lanes (8.10 builds the
 * real launcher). It lists the editors it was given and records every
 * `open`; an editor in `failing` answers `unavailable`. It starts nothing.
 */
import type { EditorLauncherPort } from '@ogden-agents/core';
import type { EditorId, EditorInfo } from '@ogden-agents/shared';

export interface MemoryEditorOpen {
  editorId: EditorId;
  absolutePath: string;
  line: number | undefined;
  column: number | undefined;
}

export interface MemoryEditorLauncher extends EditorLauncherPort {
  /** Every `open`, in order. */
  readonly opens: MemoryEditorOpen[];
  /** The editors listed (change it to change what is found). */
  editors: EditorInfo[];
  /** Editors whose `open` answers `unavailable`. */
  readonly failing: Set<EditorId>;
}

export function createMemoryEditorLauncher(editors: EditorInfo[] = [{ id: 'vscode', name: 'VS Code' }]): MemoryEditorLauncher {
  const launcher: MemoryEditorLauncher = {
    opens: [],
    editors,
    failing: new Set(),
    async list() {
      return [...launcher.editors];
    },
    async open(editorId, absolutePath, line, column) {
      launcher.opens.push({ editorId, absolutePath, line, column });
      return launcher.editors.some((editor) => editor.id === editorId) && !launcher.failing.has(editorId) ? 'opened' : 'unavailable';
    },
  };
  return launcher;
}
