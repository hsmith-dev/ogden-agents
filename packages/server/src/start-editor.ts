/**
 * Open in editor's launcher (AD-39; story 8.10): a test's own, or the
 * `editor-launcher-node` adapter. In a test run it looks only inside the
 * folder `OGDEN_AGENTS_TEST_EDITOR_PATH` names, as its whole PATH and home
 * (`''`: it finds nothing), so no suite ever finds or starts a real editor.
 * The same server path serves the desktop app (its webview has no IPC).
 */
import { createEditorLauncherNode, nodeEditorSystem } from '@ogden-agents/adapters';
import type { EditorLauncherPort } from '@ogden-agents/core';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import type { StartOptions } from './start-types.js';
import type { TestHooks } from './test-hooks.js';

/** Whether `path` is inside `folder` (a folder of the same prefix is not). */
const inside = (folder: string, path: string): boolean => {
  const from = relative(folder, path);
  return from !== '' && !from.startsWith('..') && !isAbsolute(from);
};

/** Whether `path`, by its real path (links followed), is inside `folder` (already a real path): a link out of the folder is not. */
const reallyInside = (folder: string, path: string): boolean => {
  if (!inside(folder, path)) return false;
  try {
    return inside(folder, realpathSync.native(path));
  } catch {
    return false;
  }
};

export function createServerEditorLauncher(options: Pick<StartOptions, 'editorLauncher'>, hooks: Pick<TestHooks, 'editorPath'>): EditorLauncherPort {
  if (options.editorLauncher !== undefined) return options.editorLauncher;
  const folder = hooks.editorPath;
  if (folder === undefined) return createEditorLauncherNode();
  return createEditorLauncherNode({
    system: {
      ...nodeEditorSystem,
      // Only a file inside the test's folder, by its real path, is ever looked at or started (`''`: nothing is).
      runnable: (path: string) => folder !== '' && reallyInside(folder, path) && nodeEditorSystem.runnable(path),
      env: {
        PATH: folder,
        HOME: folder,
        ...(process.platform === 'win32' ? { PATHEXT: '.EXE;.CMD', SystemRoot: nodeEditorSystem.env.SystemRoot ?? 'C:\\Windows', ComSpec: nodeEditorSystem.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe' } : {}),
      },
    },
  });
}
