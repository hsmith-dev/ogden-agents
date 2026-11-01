/**
 * What a test run's program lookups are confined to (the pane launchers'
 * `OGDEN_AGENTS_TEST_PANE_PATH`, 16.5, and the editor's
 * `OGDEN_AGENTS_TEST_EDITOR_PATH`, 8.10): one folder, as the whole PATH and
 * home, so no suite ever finds or starts a real program on this computer.
 */
import { isAbsolute, relative } from 'node:path';

/** Whether `path` is inside `folder` (a folder of the same prefix is not, nor the folder itself). */
export const inside = (folder: string, path: string): boolean => {
  const from = relative(folder, path);
  return from !== '' && !from.startsWith('..') && !isAbsolute(from);
};

/** The environment of a confined lookup: `folder` as PATH and home, and on Windows what a shim needs to start. */
export const confinedEnvironment = (folder: string): Record<string, string> => ({
  PATH: folder,
  HOME: folder,
  ...(process.platform === 'win32' ? { PATHEXT: '.EXE;.CMD', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', ComSpec: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe' } : {}),
});
