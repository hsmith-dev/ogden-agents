/**
 * Where chats' own worktrees live (epic 27, 27.1; AD-8 CAP-33 note, CAP-35).
 *
 * A chat started in a worktree works in `<data>/cw/<8>`: short for Windows'
 * path limits, beside builds' `<data>/w`, outside the repo, one folder per
 * chat. `<data>/cw` is a real folder (never a link or junction), owner
 * only; the only writer of a chat's `worktreePath` makes it here.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { isRealFolder, RUN_SHORT_ID } from './build-worktrees.js';

/** The folder of every chat's worktree, inside Ogden Agents' data folder: `<data>/cw/<id>`. */
export const CHAT_WORKTREES_DIR = 'cw';

/** `<dataDir>/cw`. */
export function chatWorktreesRootOf(dataDir: string): string {
  return join(dataDir, CHAT_WORKTREES_DIR);
}

/**
 * Makes `<dataDir>/cw` (owner only) and returns it. Throws when it is there
 * but isn't a real folder (a link would put worktrees somewhere else).
 */
export function ensureChatWorktreesRoot(dataDir: string): string {
  const root = chatWorktreesRootOf(dataDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!isRealFolder(root)) throw new Error("Ogden Agents' chat worktrees folder isn't a real folder.");
  return root;
}

/** The real path of `path`, or its resolved path when it can't be resolved. */
function realOf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Whether `path` is one of Ogden's chat worktree folders: a direct child `<dataDir>/cw/<8>`, with `<dataDir>/cw` a real folder. */
export function isChatWorktreePath(dataDir: string, path: string): boolean {
  const root = chatWorktreesRootOf(dataDir);
  if (!isRealFolder(root)) return false;
  return RUN_SHORT_ID.test(basename(path)) && realOf(dirname(path)) === realOf(root);
}
