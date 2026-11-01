/**
 * A hand-off's hold on the folders it moves changes between (27.4, review
 * pass 1 row 8): while a chat's changes move, no other chat working in the
 * project folder (or the copy) starts a turn or switches to its terminal,
 * so nothing it writes is swept into the move or makes the source check
 * fail. `sendMessage`, send-now and the terminal switch refuse with
 * `SessionNotIdleError` beside their own `switching` checks.
 */
import { sep } from 'node:path';
import type { Session, Workspace } from '@ogden-agents/shared';
import { SessionNotIdleError } from '../errors.js';
import { localFolderOf } from '../workspace-root.js';
import type { ChatContext } from './context.js';

/** The refusal's plain sentence. */
export const FOLDER_MOVING_MESSAGE = "This chat's folder is being moved. Try again in a moment.";

/** Whether `folder` is `outer` or inside it (a project in a subfolder of the same repo). */
export const isSameOrInside = (folder: string, outer: string): boolean => folder === outer || folder.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`);

/** Throws `SessionNotIdleError` when a hand-off holds the folder `session` works in now (or one it is inside). */
export function refuseWhileFolderMoves(ctx: Pick<ChatContext, 'movingFolders'>, workspace: Workspace, session: Session): void {
  // A build runs in its own run folder, a remote chat on its machine: neither is held.
  if (ctx.movingFolders.size === 0) return;
  const folder = localFolderOf(workspace, session);
  if (folder === undefined) return;
  for (const held of ctx.movingFolders) if (isSameOrInside(folder, held)) throw new SessionNotIdleError(FOLDER_MOVING_MESSAGE);
}
