/**
 * The ignored files a chat's copy would lose (user decision 2026-11-01):
 * Move to this folder and Delete chat remove the copy, and git doesn't keep
 * ignored files (a `.env`), so their confirmation lists them first. Only a
 * local chat's own copy (a direct child of a real `<data>/cw` on its own
 * branch, a real folder, not put away) is read, through
 * `VcsWorkingTreePort.ignoredFiles` (names only, never contents,
 * rebuildable folders left out); any other chat answers none. A copy whose
 * names can't be read answers `listed: false`, never a throw.
 */
import { inOwnWorktree, IGNORED_FILES_SHOWN, isChatWorktreeBranchOf, type CopyIgnoredFilesResponse } from '@ogden-agents/shared';
import { isRealFolder } from '../build-worktrees.js';
import { isChatWorktreePath } from '../chat-worktrees.js';
import { vcsFolderOf } from '../workspace-root.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';

const NONE: CopyIgnoredFilesResponse = { files: [], more: 0, listed: true };

export function createCopyIgnoredFiles(ctx: ChatContext): Pick<Chat, 'copyIgnoredFiles'> {
  return {
    async copyIgnoredFiles(workspaceId, sessionId) {
      const workspace = ctx.getWorkspace(workspaceId);
      const session = ctx.getSession(workspaceId, sessionId);
      if (!inOwnWorktree(session)) return NONE;
      if (!isChatWorktreeBranchOf(session.id, session.branch) || !isChatWorktreePath(ctx.options.dataDir, session.worktreePath)) return NONE;
      // Put away (27.6): the folder is gone, nothing of it left to lose.
      if (ctx.options.worktreePutAway?.get(session.id) !== undefined) return NONE;
      if (!isRealFolder(session.worktreePath)) return NONE;
      const port = ctx.options.vcsWorkingTree;
      if (port?.ignoredFiles === undefined) return { files: [], more: 0, listed: false };
      try {
        const { files, more } = await port.ignoredFiles(vcsFolderOf(workspace, session), { limit: IGNORED_FILES_SHOWN });
        return { files: files.slice(0, IGNORED_FILES_SHOWN), more: more + Math.max(0, files.length - IGNORED_FILES_SHOWN), listed: true };
      } catch {
        return { files: [], more: 0, listed: false };
      }
    },
  };
}
