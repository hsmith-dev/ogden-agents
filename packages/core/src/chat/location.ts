/**
 * A chat's Location and its hand-off between this folder and its own
 * worktree (epic 27, 27.4; CAP-35, E27-R3; AD-8 CAP-33 note as amended
 * 2026-11-01, AD-37). Git only through `VcsPort` and
 * `VcsChatWorktreePort.moveChanges`, under `serializedByRepo(<project
 * folder>)`; the row only through `Entities.setSessionWorktree`, which
 * records `session.location_changed`.
 *
 * The order (story 27.4 design notes): refuse (not a chat, remote, the
 * terminal drives it, already there, its copy put away or being put away
 * or restored (27.6: `WorktreePutAwayError`), a tampered row; mid-turn: this chat or
 * any local chat in the project folder works, waits, is busy, switches or
 * is terminal-driven), then, in the repo's chain, the same checks again;
 * the chat is held like a driver switch (`switching`: no message is taken)
 * and its agent released, so its next start's cwd is the new folder
 * (`resumes`: it has its own agent session to reopen there).
 *
 * Both folders are held for the move's length (`movingFolders`): no other
 * chat working there starts a turn or switches to its terminal.
 *
 * To its own worktree: the copy `<data>/cw/<8>` is made on
 * `ogden/chat/<ses>` (the kept branch when it has one), every uncommitted
 * change of the project folder moves into it (user decision 2026-11-01: the
 * chat's can't be told from the user's), then the row. Back: the changes
 * move into the project folder, then the row, then the copy is removed as
 * Delete chat removes one (its branch kept when it has commits) only when
 * nothing was left behind and it reads clean; else it is left and reported.
 * Once the changes are in the target they are never undone (the adapter's
 * `leftBehind` is reported, never thrown). A conflict, or a failure whose
 * target reads as before, after a copy was made removes the new copy (a
 * reused branch kept), and the source keeps its changes; a failure that
 * left the new copy half-written leaves it and reports. A row write that
 * fails after the move: to a worktree, the copy's changes (only the moved
 * ones) move back, best effort, else the copy is left and reported; back,
 * both folders are left as they are and reported (the project folder is
 * never moved into the copy). Both folders' snapshot trees go to
 * `onHandOffSnapshot` (the log) on every outcome, a thrown one's too, never
 * a path.
 */
import { lstatSync } from 'node:fs';
import {
  chatWorktreeBranch,
  inOwnWorktree,
  isChatWorktreeBranchOf,
  localPlaceOf,
  DELETE_CHAT_TERMINAL_TEXT,
  handOffAlreadyThereText,
  HANDOFF_CHAT_ONLY_TEXT,
  HANDOFF_CONFLICT_MESSAGE,
  HANDOFF_FAILED_TEXT,
  HANDOFF_FOLDER_BUSY_TEXT,
  HANDOFF_MID_TURN_MESSAGE,
  HANDOFF_PUT_AWAY_TEXT,
  HANDOFF_REMOTE_TEXT,
  type ChatLocation,
  type Session,
  type SessionId,
  type SessionLocation,
  type Workspace,
} from '@ogden-agents/shared';
import { isRealFolder } from '../build-worktrees.js';
import { isChatWorktreePath } from '../chat-worktrees.js';
import { AgentMidTurnError, CoreError, HandOffConflictError, InvalidOperationError, WorktreePutAwayError } from '../errors.js';
import { serializedByRepo } from '../repo-serialization.js';
import { VcsError, type VcsFolder, type VcsMoveChanges } from '../vcs-port.js';
import { localFolderOf, vcsFolderOf, workspaceFolder } from '../workspace-root.js';
import type { Agents } from './agents.js';
import type { ChatContext } from './context.js';
import { readyCopy, releasePort, stopSetup } from './copy-port.js';
import { isSameOrInside } from './folder-hold.js';
import type { Chat } from './types.js';
import { addChatWorktree, removeUnusedWorktree } from './workspaces.js';

/** The 409 `agent_mid_turn` message when this chat works (another chat in the project folder: `HANDOFF_FOLDER_BUSY_TEXT`). */
const MID_TURN_MESSAGE = HANDOFF_MID_TURN_MESSAGE;

const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Both snapshot trees of a move's answer, or of a thrown `VcsError`'s details; `undefined` when there are none. */
function snapshotsOf(from: unknown): { from: string; to: string } | undefined {
  const value = from instanceof VcsError ? from.details.snapshots : typeof from === 'object' && from !== null && 'result' in from ? (from as VcsMoveChanges).snapshots : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const { from: source, to: target } = value as { from?: unknown; to?: unknown };
  return typeof source === 'string' && typeof target === 'string' && TREE.test(source) && TREE.test(target) ? { from: source, to: target } : undefined;
}

/** A thrown move's `details.targetClean`: `false` when the target may be half-written. */
function targetCleanOf(error: unknown): boolean | undefined {
  const value = error instanceof VcsError ? error.details.targetClean : undefined;
  return typeof value === 'boolean' ? value : undefined;
}

export function createChatLocation(ctx: ChatContext, deps: Pick<Agents, 'releaseAgent' | 'storedAgentSessionId'>) {
  const { entities, busy, switching, getWorkspace, getSession } = ctx;
  const { releaseAgent, storedAgentSessionId } = deps;

  const report = (sessionId: SessionId, error?: unknown): void => {
    try {
      ctx.options.onWorktreeCleanupError?.(sessionId, 'remove', error);
    } catch {
      // The log never changes the answer.
    }
  };

  /** Both folders' snapshot trees to the log, from an answer or a thrown error's details; the log never changes the answer. */
  const logSnapshots = (sessionId: SessionId, from: VcsMoveChanges | unknown): void => {
    const snapshots = snapshotsOf(from);
    if (snapshots === undefined) return;
    try {
      ctx.options.onHandOffSnapshot?.(sessionId, snapshots);
    } catch {
      // The log never changes the answer.
    }
  };

  /** Whether a session holds its folder now: it works, waits, is busy, switches or the terminal drives it. */
  const holds = (session: Session): boolean =>
    busy.has(session.id) || switching.has(session.id) || session.state === 'working' || session.state === 'waiting' || session.driver === 'terminal';

  /** Throws unless the chat can move to `to` now (no await: the state as it is). */
  const requireMovable = (workspace: Workspace, session: Session, to: ChatLocation): void => {
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    if (session.kind !== 'chat') throw new InvalidOperationError(HANDOFF_CHAT_ONLY_TEXT);
    if (session.machineId !== null) throw new InvalidOperationError(HANDOFF_REMOTE_TEXT);
    if (session.driver === 'terminal') throw new InvalidOperationError(DELETE_CHAT_TERMINAL_TEXT);
    if (localPlaceOf(session) === to) throw new InvalidOperationError(handOffAlreadyThereText(to));
    // A copy put away, or being put away or restored (27.6): nothing to move until Restore brings it back.
    if (ctx.puttingAway.has(session.id) || ctx.options.worktreePutAway?.get(session.id) !== undefined) throw new WorktreePutAwayError(HANDOFF_PUT_AWAY_TEXT);
    // A row naming a copy outside `<data>/cw` (or `<data>/cw` a link, or the copy itself one): nothing is written anywhere.
    if (
      session.worktreePath !== null &&
      (session.branch === null || !isChatWorktreeBranchOf(session.id, session.branch) || !isChatWorktreePath(ctx.options.dataDir, session.worktreePath) || !isRealFolder(session.worktreePath))
    ) {
      throw new InvalidOperationError(HANDOFF_FAILED_TEXT);
    }
    if (holds(session)) throw new AgentMidTurnError(MID_TURN_MESSAGE);
    // Any local chat working in the project folder: its changes move too (or the folder takes these).
    // A project in a subfolder of the same folder counts too: its chats' edits are in the folder that moves.
    const project = workspaceFolder(workspace);
    const others = entities
      .listWorkspaces()
      .filter((other) => isSameOrInside(workspaceFolder(other), project))
      .flatMap((other) =>
        entities.listSessions(other.id).filter((one) => {
          const folder = localFolderOf(other, one);
          return one.id !== session.id && folder !== undefined && isSameOrInside(folder, project);
        }),
      );
    if (others.some(holds)) throw new AgentMidTurnError(HANDOFF_FOLDER_BUSY_TEXT);
  };

  /** A failure of git becomes the plain 409; anything of core's own stays as it is. */
  const failed = (error: unknown): unknown => (error instanceof CoreError && !(error instanceof VcsError) ? error : new InvalidOperationError(HANDOFF_FAILED_TEXT));

  /** Whether the copy reads clean (nothing staged, unstaged or untracked); one that can't be read is not. */
  const readsClean = async (folder: VcsFolder): Promise<boolean> => {
    const port = ctx.options.vcsWorkingTree;
    if (port === undefined) return false;
    try {
      lstatSync(folder.path);
      for (const view of ['unstaged', 'staged'] as const) {
        const changed = await port.changedFiles(folder, { view });
        if (changed.files.length > 0 || changed.truncated) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  /** Removes a copy moved out of, as Delete chat does: its branch deleted only when merged (no commits of its own). */
  const removeMovedCopy = async (repoPath: string, session: Session, path: string, branch: string): Promise<void> => {
    const vcs = ctx.options.vcs!;
    if (!(await readsClean({ path, worktree: { repoPath, branch } }))) {
      report(session.id);
      return;
    }
    // Checked again just before: `<data>/cw` could have become a link since.
    if (!isChatWorktreePath(ctx.options.dataDir, path)) {
      report(session.id);
      return;
    }
    try {
      const merged = await vcs.isMerged(repoPath, branch).catch(() => false);
      await vcs.removeWorktree(repoPath, path, merged ? { deleteBranch: branch, mergedOnly: true, keepUnmerged: true } : {});
    } catch (error) {
      report(session.id, error);
    }
  };

  /** Moves the copy's changes (only the moved ones) back after the row couldn't be written; `true` when all are back and the copy holds none. */
  const moveBack = async (sessionId: SessionId, repoPath: string, from: VcsFolder, to: VcsFolder): Promise<boolean> => {
    try {
      const back = await ctx.options.vcsChatWorktree!.moveChanges(repoPath, { from, to });
      logSnapshots(sessionId, back);
      return back.result === 'moved' && back.leftBehind === 0;
    } catch (error) {
      logSnapshots(sessionId, error);
      return false;
    }
  };

  /** Some of the moved changes are still in the source too (it couldn't be cleaned, or changed meanwhile): reported, never thrown. */
  const reportLeftBehind = (sessionId: SessionId, moved: VcsMoveChanges): void => {
    if (moved.leftBehind > 0) report(sessionId, new VcsError('Some moved changes are still in the folder they left.', { step: 'move', leftBehind: moved.leftBehind }));
  };

  const toWorktree = async (workspace: Workspace, session: Session, resumes: boolean, hold: (folder: string) => void): Promise<void> => {
    const repoPath = workspaceFolder(workspace);
    const port = ctx.options.vcsChatWorktree!;
    const branch = chatWorktreeBranch(session.id);
    // A branch kept from an earlier copy (it has commits): the copy is made on it again. Unread, nothing is made (a
    // new branch of the same name would fail, and its cleanup must never reach the kept one).
    const branchRevision = ctx.options.vcs!.branchRevision;
    if (branchRevision === undefined) throw new InvalidOperationError(HANDOFF_FAILED_TEXT);
    let kept: boolean;
    try {
      kept = (await branchRevision(repoPath, branch)) !== undefined;
    } catch {
      throw new InvalidOperationError(HANDOFF_FAILED_TEXT);
    }
    const copy = await addChatWorktree(ctx, repoPath, session.id, { existingBranch: kept, mergedOnly: true });
    // The new copy is held too, and checked a real folder of `<data>/cw`.
    hold(copy.worktreePath);
    if (!isChatWorktreePath(ctx.options.dataDir, copy.worktreePath) || !isRealFolder(copy.worktreePath)) {
      await removeUnusedWorktree(ctx, repoPath, copy, { keepBranch: kept, mergedOnly: true });
      throw new InvalidOperationError(HANDOFF_FAILED_TEXT);
    }
    const project: VcsFolder = { path: repoPath };
    const folder: VcsFolder = { path: copy.worktreePath, worktree: { repoPath, branch } };
    let moved: VcsMoveChanges;
    try {
      moved = await port.moveChanges(repoPath, { from: project, to: folder });
    } catch (error) {
      logSnapshots(session.id, error);
      // A copy git may have half-written holds nothing that isn't still in the project folder, but it isn't deleted: it is left and reported.
      if (targetCleanOf(error) === false) report(session.id, error);
      else await removeUnusedWorktree(ctx, repoPath, copy, { keepBranch: kept, mergedOnly: true });
      throw failed(error);
    }
    logSnapshots(session.id, moved);
    if (moved.result === 'conflict') {
      await removeUnusedWorktree(ctx, repoPath, copy, { keepBranch: kept, mergedOnly: true });
      throw new HandOffConflictError(HANDOFF_CONFLICT_MESSAGE, moved.files);
    }
    reportLeftBehind(session.id, moved);
    try {
      entities.setSessionWorktree(session.id, { worktreePath: copy.worktreePath, branch, files: moved.files, resumes });
    } catch (error) {
      // The copy holds only the moved changes: they go back, and then the copy.
      if (await moveBack(session.id, repoPath, folder, project)) await removeUnusedWorktree(ctx, repoPath, copy, { keepBranch: kept, mergedOnly: true });
      else report(session.id);
      throw error;
    }
    // Its own port (27.7), then the server's setup in the copy; neither fails the hand-off.
    await readyCopy(ctx, session.id, { workspaceId: workspace.id, worktreePath: copy.worktreePath });
  };

  const toThisFolder = async (workspace: Workspace, session: Session & { worktreePath: string; branch: string }, resumes: boolean): Promise<void> => {
    const repoPath = workspaceFolder(workspace);
    const port = ctx.options.vcsChatWorktree!;
    const project: VcsFolder = { path: repoPath };
    const folder = vcsFolderOf(workspace, session);
    // Its setup run (27.7) stops first: nothing writes in the copy while its changes move out and it is removed.
    if (!(await stopSetup(ctx, session.id))) throw new AgentMidTurnError(MID_TURN_MESSAGE);
    let moved: VcsMoveChanges;
    try {
      moved = await port.moveChanges(repoPath, { from: folder, to: project });
    } catch (error) {
      logSnapshots(session.id, error);
      // The copy still holds every change; a project folder git may have half-written is reported.
      if (targetCleanOf(error) === false) report(session.id, error);
      throw failed(error);
    }
    logSnapshots(session.id, moved);
    if (moved.result === 'conflict') throw new HandOffConflictError(HANDOFF_CONFLICT_MESSAGE, moved.files);
    reportLeftBehind(session.id, moved);
    try {
      entities.setSessionWorktree(session.id, { worktreePath: null, branch: null, files: moved.files, resumes });
    } catch (error) {
      // Never moved back: the project folder holds the user's own changes too, which must not go into the copy. Both are left.
      report(session.id, error);
      throw error;
    }
    // Working in this folder: its port goes back (27.7).
    await releasePort(ctx, session.id);
    if (moved.leftBehind > 0) {
      report(session.id);
      return;
    }
    await removeMovedCopy(repoPath, session, session.worktreePath, session.branch);
  };

  const methods: Pick<Chat, 'chatLocation' | 'moveChat'> = {
    chatLocation(workspaceId, sessionId): SessionLocation {
      const session = getSession(workspaceId, sessionId);
      // `chatPlaceOf`'s order: the machine, then its own worktree (`inOwnWorktree`: a local chat's path with its branch), else this folder.
      if (session.machineId !== null) return { kind: 'remote', machineId: session.machineId };
      if (inOwnWorktree(session)) {
        const putAway = ctx.options.worktreePutAway?.get(session.id) !== undefined;
        // The setup run is the server's (`createChatLocations` adds it); the chat knows none.
        return { kind: 'worktree', branch: session.branch, port: putAway ? null : (ctx.options.worktreePorts?.portOf(session.id) ?? null), setup: null, putAway };
      }
      return { kind: 'this_folder' };
    },

    async moveChat(workspaceId, sessionId, to) {
      const workspace = getWorkspace(workspaceId);
      const repoPath = workspaceFolder(workspace);
      requireMovable(workspace, getSession(workspaceId, sessionId), to);
      if (ctx.options.vcs === undefined || ctx.options.vcsChatWorktree === undefined) throw new InvalidOperationError(HANDOFF_FAILED_TEXT);
      await serializedByRepo(repoPath, async () => {
        // Git work before this one may have taken a while: checked again as the chain starts.
        const session = getSession(workspaceId, sessionId);
        requireMovable(workspace, session, to);
        // Held like a driver switch: no message is taken until the move is done; nor by another chat in either folder.
        switching.add(sessionId);
        const held = new Set<string>();
        const hold = (folder: string): void => {
          if (ctx.movingFolders.has(folder)) return;
          ctx.movingFolders.add(folder);
          held.add(folder);
        };
        hold(repoPath);
        if (session.worktreePath !== null) hold(session.worktreePath);
        try {
          // The agent stops first: its next start is in the new folder.
          await releaseAgent(sessionId);
          const resumes = storedAgentSessionId(sessionId) !== undefined;
          if (to === 'worktree') await toWorktree(workspace, session, resumes, hold);
          else if (inOwnWorktree(session)) await toThisFolder(workspace, session, resumes);
          // `requireMovable` let only a chat in its own worktree move to this folder.
          else throw new InvalidOperationError(HANDOFF_FAILED_TEXT);
        } finally {
          switching.delete(sessionId);
          for (const folder of held) ctx.movingFolders.delete(folder);
        }
      });
      return ctx.withAgentId(getSession(workspaceId, sessionId));
    },
  };

  return methods;
}
