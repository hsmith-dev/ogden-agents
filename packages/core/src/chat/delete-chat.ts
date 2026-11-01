/**
 * Delete chat and Delete history's copies (epic 27, 27.3; CAP-35,
 * EXPERIENCE.md "Deleting the chat asks before removing the copy"; AD-17
 * CAP-33 note). A worktree chat's copy goes through `VcsPort` only, with the
 * repo's other git work serialized (`serializedByRepo`).
 *
 * The order (story 27.3 design notes): refuse (a build or planning session,
 * a chat an orchestration run names, one that works, waits, is busy or that
 * the terminal drives), then, under the repo's chain, read whether the copy
 * has uncommitted changes (a copy whose state can't be read counts as
 * changed) and whether its branch is merged, then delete the rows in one
 * transaction (a send after that finds no chat), then stop the agent and
 * the terminal, then remove the copy. A copy is removed only when it is a
 * direct child of a real `<data>/cw` (`isChatWorktreePath`, checked here and
 * again by the adapter); its branch `ogden/chat/<ses>` is deleted only when
 * merged into the checked-out branch, else kept, so committed work is never
 * lost. A removal that fails or is refused once the rows are gone is
 * reported (`onWorktreeCleanupError`, the session id and a step only) and
 * leaves the folder: the user already confirmed the delete.
 */
import { lstatSync } from 'node:fs';
import {
  DELETE_CHAT_MID_TURN_MESSAGE,
  DELETE_CHAT_NOT_DELETABLE_TEXT,
  DELETE_CHAT_REMOTE_TEXT,
  HISTORY_UNCOMMITTED_CHANGES_MESSAGE,
  UNCOMMITTED_CHANGES_MESSAGE,
  type ChatDeletedResponse,
  type Session,
  type SessionId,
  type Workspace,
} from '@ogden-agents/shared';
import { isChatWorktreePath } from '../chat-worktrees.js';
import { AgentMidTurnError, InvalidOperationError, UncommittedChangesError, WorkspaceBusyError } from '../errors.js';
import { serializedByRepo } from '../repo-serialization.js';
import { withinTimeout } from '../turn-snapshots.js';
import { vcsFolderOf, workspaceFolder } from '../workspace-root.js';
import type { Agents } from './agents.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';

/** How long a deleted chat's agent and terminal may take to exit before its copy is removed anyway. */
const STOP_BEFORE_REMOVAL_MS = 10_000;

/** A chat's own copy, as removal sees it. */
interface Copy {
  sessionId: SessionId;
  path: string;
  branch: string;
  /** Its branch is merged into the checked-out branch, so it goes too. */
  deleteBranch: boolean;
}

export function createChatDeletion(ctx: ChatContext, deps: Pick<Agents, 'drop'> & { stopTerminal: (sessionId: SessionId) => Promise<void> }) {
  const { entities, live, busy, switching, droppedAgents, getWorkspace, getSession } = ctx;
  const stopBeforeRemovalMs = ctx.options.stopBeforeRemovalMs ?? STOP_BEFORE_REMOVAL_MS;
  const { drop, stopTerminal } = deps;

  const report = (sessionId: SessionId, step: 'outside_data' | 'remove', error?: unknown): void => {
    try {
      ctx.options.onWorktreeCleanupError?.(sessionId, step, error);
    } catch {
      // The log never fails a delete.
    }
  };

  /** Whether the session has a worktree that is Ogden's to remove: a direct child of a real `<data>/cw`. */
  const ownsCopy = (session: Session): session is Session & { worktreePath: string; branch: string } =>
    session.worktreePath !== null && session.branch !== null && isChatWorktreePath(ctx.options.dataDir, session.worktreePath);

  /**
   * Whether the copy has uncommitted changes (staged, unstaged or untracked); one that can't be read counts as changed,
   * one that is gone has none, unless it was put away with saved changes (27.6): those are its changes.
   */
  const hasChanges = async (workspace: Workspace, session: Session & { worktreePath: string }): Promise<boolean> => {
    const putAway = ctx.options.worktreePutAway?.get(session.id);
    if (putAway !== undefined && putAway.files > 0) return true;
    try {
      lstatSync(session.worktreePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return true;
    }
    const port = ctx.options.vcsWorkingTree;
    if (port === undefined) return true;
    try {
      const folder = vcsFolderOf(workspace, session);
      for (const view of ['unstaged', 'staged'] as const) {
        const changed = await port.changedFiles(folder, { view });
        if (changed.files.length > 0 || changed.truncated) return true;
      }
      return false;
    } catch {
      return true;
    }
  };

  /** Whether the branch is merged into the checked-out branch (no commits of its own); anything unclear keeps it. */
  const isMerged = async (repoPath: string, branch: string): Promise<boolean> => {
    try {
      return (await ctx.options.vcs?.isMerged(repoPath, branch)) === true;
    } catch {
      return false;
    }
  };

  /** Plans the copy's removal: refused without `discard` when it has uncommitted changes. */
  const planCopy = async (workspace: Workspace, session: Session & { worktreePath: string; branch: string }, discard: boolean, message: string): Promise<Copy> => {
    if (!discard && (await hasChanges(workspace, session))) throw new UncommittedChangesError(message);
    return { sessionId: session.id, path: session.worktreePath, branch: session.branch, deleteBranch: await isMerged(workspaceFolder(workspace), session.branch) };
  };

  /** Ends the deleted chat's live agent and terminal (the rows are gone: nothing restarts them). */
  const stopLive = (sessionId: SessionId): void => {
    const entry = live.get(sessionId);
    if (entry !== undefined) drop(sessionId, entry);
  };

  /** Removes the copy once its agent and terminal exited (bounded); a failure is reported and leaves it. */
  const removeCopy = async (repoPath: string, copy: Copy, terminalStopped: Promise<void>): Promise<{ removed: boolean; branchKept: boolean }> => {
    // Windows: a folder an agent still has as its cwd can't be removed; one still running there keeps its copy (reported).
    const exited = await withinTimeout(Promise.all([droppedAgents.get(copy.sessionId), terminalStopped]).then(() => true), stopBeforeRemovalMs);
    if (exited !== true) {
      report(copy.sessionId, 'remove');
      return { removed: false, branchKept: true };
    }
    const vcs = ctx.options.vcs;
    // Checked again just before: `<data>/cw` could have become a link since.
    if (!isChatWorktreePath(ctx.options.dataDir, copy.path)) {
      report(copy.sessionId, 'outside_data');
      return { removed: false, branchKept: true };
    }
    if (vcs === undefined) {
      report(copy.sessionId, 'remove');
      return { removed: false, branchKept: true };
    }
    try {
      const result = await vcs.removeWorktree(repoPath, copy.path, copy.deleteBranch ? { deleteBranch: copy.branch, mergedOnly: true, keepUnmerged: true } : {});
      return { removed: true, branchKept: !copy.deleteBranch || result?.branchKept === true };
    } catch (error) {
      report(copy.sessionId, 'remove', error);
      return { removed: false, branchKept: true };
    }
  };

  /** Throws unless the chat may be deleted now: a plain local chat, idle (or in error or done), not busy, not driven by or switching to its terminal. */
  const requireDeletable = (session: Session): void => {
    if (session.kind !== 'chat') throw new InvalidOperationError(DELETE_CHAT_NOT_DELETABLE_TEXT);
    if (session.machineId !== null) throw new InvalidOperationError(DELETE_CHAT_REMOTE_TEXT);
    if (busy.has(session.id) || switching.has(session.id) || ctx.puttingAway.has(session.id) || session.state === 'working' || session.state === 'waiting' || session.driver === 'terminal') {
      throw new AgentMidTurnError(DELETE_CHAT_MID_TURN_MESSAGE);
    }
  };

  const methods: Pick<Chat, 'deleteChat' | 'deleteHistory'> = {
    async deleteChat(workspaceId, sessionId, options = {}) {
      const discard = options.discardUncommitted === true;
      const workspace = getWorkspace(workspaceId);
      const repoPath = workspaceFolder(workspace);
      requireDeletable(getSession(workspaceId, sessionId));
      const run = async (): Promise<ChatDeletedResponse> => {
        const before = getSession(workspaceId, sessionId);
        requireDeletable(before);
        const copy = ownsCopy(before) ? await planCopy(workspace, before, discard, UNCOMMITTED_CHANGES_MESSAGE) : undefined;
        // Git was read: a turn may have started since. Checked again in the same step as the rows go.
        const session = getSession(workspaceId, sessionId);
        requireDeletable(session);
        // A whole turn may have run during the reads: its new work was never checked, so nothing is deleted.
        if (session.worktreePath !== before.worktreePath || session.updatedAt !== before.updatedAt || session.state !== before.state) throw new AgentMidTurnError(DELETE_CHAT_MID_TURN_MESSAGE);
        const branchKept = session.branch !== null && copy?.deleteBranch !== true;
        entities.deleteChatSession(sessionId, { worktreeRemoved: copy !== undefined, branchKept });
        stopLive(sessionId);
        const terminalStopped = stopTerminal(sessionId).catch(() => undefined);
        if (copy === undefined) {
          // A tampered row (a copy outside `<data>/cw`, or `<data>/cw` a link): its rows are gone, nothing outside is touched.
          if (session.worktreePath !== null) report(sessionId, 'outside_data');
          return { sessionId, worktreeRemoved: false, branchKept };
        }
        const removed = await removeCopy(repoPath, copy, terminalStopped);
        return { sessionId, worktreeRemoved: removed.removed, branchKept: removed.branchKept };
      };
      // A plain chat touches no git; a worktree chat's copy is read and removed with the repo's other git work serialized.
      return hasWorktree(workspaceId, sessionId) ? serializedByRepo(repoPath, run) : run();
    },

    async deleteHistory(workspaceId, options = {}) {
      const discard = options.discardUncommitted === true;
      const workspace = getWorkspace(workspaceId);
      const repoPath = workspaceFolder(workspace);
      /** The sessions, or `WorkspaceBusyError` while one is busy or a worktree chat's terminal still works in its copy. */
      const current = (): Session[] => {
        const sessions = entities.listSessions(workspaceId);
        // A turn can be starting before its state reads `working`: the busy set covers that gap.
        if (sessions.some((session) => busy.has(session.id) || (session.worktreePath !== null && (session.driver === 'terminal' || switching.has(session.id) || ctx.puttingAway.has(session.id))))) throw new WorkspaceBusyError(workspaceId);
        return sessions;
      };
      const finish = (sessions: readonly Session[]) => {
        const { deletedEvents, deletedSessions, deletedRuns } = entities.deleteWorkspaceHistory(workspaceId);
        const stopped = new Map<SessionId, Promise<void>>();
        for (const session of sessions) {
          stopLive(session.id);
          stopped.set(session.id, stopTerminal(session.id).catch(() => undefined));
        }
        return { counts: { deletedEvents, deletedSessions, deletedRuns }, stopped };
      };
      const first = current();
      if (!first.some((session) => session.worktreePath !== null)) return finish(first).counts;
      return serializedByRepo(repoPath, async () => {
        const planned = new Map<SessionId, Copy>();
        const read = new Map<SessionId, Session>();
        for (const session of current()) {
          if (!ownsCopy(session)) continue;
          read.set(session.id, session);
          planned.set(session.id, await planCopy(workspace, session, discard, HISTORY_UNCOMMITTED_CHANGES_MESSAGE));
        }
        // Git was read: checked again in the same step as the rows go. A copy made meanwhile is changed until read.
        const sessions = current();
        for (const session of sessions) {
          // A turn ran in a copy during the reads: its new work was never checked.
          const before = read.get(session.id);
          if (before !== undefined && (session.updatedAt !== before.updatedAt || session.state !== before.state || session.worktreePath !== before.worktreePath)) throw new WorkspaceBusyError(workspaceId);
          if (!ownsCopy(session) || planned.has(session.id)) continue;
          if (!discard) throw new UncommittedChangesError(HISTORY_UNCOMMITTED_CHANGES_MESSAGE);
          planned.set(session.id, { sessionId: session.id, path: session.worktreePath, branch: session.branch, deleteBranch: false });
        }
        const { counts, stopped } = finish(sessions);
        for (const session of sessions) {
          if (session.worktreePath !== null && !planned.has(session.id)) report(session.id, 'outside_data');
        }
        for (const copy of planned.values()) {
          if (sessions.some((session) => session.id === copy.sessionId)) await removeCopy(repoPath, copy, stopped.get(copy.sessionId) ?? Promise.resolve());
        }
        return counts;
      });
    },
  };

  /** Whether the chat has a worktree at all (the repo chain is taken only then). */
  const hasWorktree = (workspaceId: Parameters<Chat['deleteChat']>[0], sessionId: SessionId): boolean => getSession(workspaceId, sessionId).worktreePath !== null;

  return methods;
}
