/**
 * Opening a file in the user's editor (AD-39; epic 8 entry 2's contract,
 * 8.10 builds the `editor-launcher-*` adapter): a short, fixed list of
 * editors found on `PATH`, each started with `file:line` as arguments, no
 * shell, AD-16's allowlisted environment. Core names no editor and no
 * command (AD-1); it only hands over a path the files port located.
 */
import type { EditorId, EditorInfo } from '@ogden-agents/shared';

export interface EditorLauncherPort {
  /** The editors found on this computer, in the launcher's order (the first is the default). */
  list(): Promise<EditorInfo[]>;
  /**
   * Opens `absolutePath` (a real path the files port located, never client
   * input) in `editorId` at `line` and `column`. `unavailable` when that
   * editor isn't found (any more) or didn't start; nothing else is tried.
   */
  open(editorId: EditorId, absolutePath: string, line?: number, column?: number): Promise<'opened' | 'unavailable'>;
}
