/**
 * Putting a chat's worktree away and Restore (epic 27, 27.6; CAP-35,
 * AD-17 CAP-33 note's one exception, user decision 2026-11-01). Git is only
 * `VcsChatWorktreePort`'s (the snapshot, Restore) and `VcsPort`'s (the
 * folder's removal, 27.3's guards), with the repo's other git work
 * serialized (`serializedByRepo`).
 *
 * The order (safety, story 27.6 design notes): refuse a chat that isn't
 * idle (working, waiting, busy, switching, driven by the terminal, held);
 * hold it (`puttingAway`: no message starts and no switch); stop its agent
 * and terminal (bounded wait); then, under the repo's chain, check again,
 * save its uncommitted changes (`saveForPutAway`, which refuses an unsafe
 * copy: nothing is removed then), write the record with its event in one
 * transaction, and only then remove the folder through
 * `VcsPort.removeWorktree` of a path `isChatWorktreePath` accepts, keeping
 * the branch. A removal that fails leaves the copy "half put away": the
 * record stays, and Restore re-applies the snapshot in place.
 *
 * Restore holds the chat the same way, asks the port to bring the copy back
 * (it refuses, changing nothing, when the branch is gone, has moved and
 * there are saved changes, or something else is at the path), then removes
 * the record with `session.worktree_restored`.
 */
import {
  DELETE_CHAT_MID_TURN_MESSAGE,
  RESTORE_FAILED_MESSAGE,
  RESTORE_PATH_TAKEN_TEXT,
  restoreBranchMissingText,
  restoreBranchMovedText,
  type PutAwayCause,
  type PutAwayWorktree,
  type Session,
  type SessionId,
  type SessionLocationResponse,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { isChatWorktreePath } from '../chat-worktrees.js';
import { AgentMidTurnError, InvalidOperationError, NotFoundError, RestoreFailedError } from '../errors.js';
import { serializedByRepo } from '../repo-serialization.js';
import { withinTimeout } from '../turn-snapshots.js';
import { workspaceFolder } from '../workspace-root.js';
import { listedPutAway } from '../worktree-put-away-store.js';
import type { Agents } from './agents.js';
import type { ChatContext } from './context.js';
import type { Chat } from './types.js';

/** How long a put-away waits for the chat's agent and terminal to exit before it gives up, removing nothing. */
const STOP_BEFORE_PUT_AWAY_MS = 10_000;

/** The refusal of a chat that isn't a worktree chat Ogden can put away. */
const NOT_A_WORKTREE_CHAT = "Only a chat in its own worktree can be put away.";
/** The refusal of a chat already put away. */
const ALREADY_PUT_AWAY = "This chat's copy is already put away.";
/** The refusal of a put-away whose snapshot failed or was refused: nothing was removed. */
const NOT_SAVED = "This chat's copy couldn't be saved, so it was kept.";
/** The refusal of Restore for a chat with nothing put away. */
const NOTHING_PUT_AWAY = "This chat's copy isn't put away.";
/** The refusal of a put-away or a Restore while the chat works, or is held by another. */
const NOT_IDLE = 'This chat can be put away or restored once its agent has finished.';

export function createPutAway(ctx: ChatContext, deps: Pick<Agents, 'drop'> & { stopTerminal: (sessionId: SessionId) => Promise<void> }) {
  const { entities, live, busy, switching, droppedAgents, puttingAway } = ctx;
  const stopMs = ctx.options.stopBeforeRemovalMs ?? STOP_BEFORE_PUT_AWAY_MS;

  const report = (sessionId: SessionId, step: 'outside_data' | 'remove', error?: unknown): void => {
    try {
      ctx.options.onWorktreeCleanupError?.(sessionId, step, error);
    } catch {
      // The log never changes the outcome.
    }
  };

  /** Whether the chat is idle now: nothing runs or waits in it, nothing switches or holds it, and the chat (not the terminal) drives. */
  const idle = (session: Session): boolean =>
    !busy.has(session.id) &&
    !switching.has(session.id) &&
    !puttingAway.has(session.id) &&
    session.state !== 'working' &&
    session.state !== 'waiting' &&
    session.driver !== 'terminal';

  /** The session as a local chat worktree Ogden owns, or a refusal. */
  const ownCopy = (session: Session | undefined): Session & { worktreePath: string; branch: string } => {
    if (session === undefined) throw new NotFoundError('session', 'requested');
    if (session.kind !== 'chat' || session.machineId !== null || session.worktreePath === null || session.branch === null || !isChatWorktreePath(ctx.options.dataDir, session.worktreePath)) {
      throw new InvalidOperationError(NOT_A_WORKTREE_CHAT);
    }
    return session as Session & { worktreePath: string; branch: string };
  };

  /** Waits (bounded) for the chat's agent and terminal to exit; whether they did. */
  const stopLive = async (sessionId: SessionId): Promise<boolean> => {
    const entry = live.get(sessionId);
    if (entry !== undefined) deps.drop(sessionId, entry);
    const terminalStopped = deps.stopTerminal(sessionId).catch(() => undefined);
    return (await withinTimeout(Promise.all([droppedAgents.get(sessionId), terminalStopped]).then(() => true), stopMs)) === true;
  };

  const added = (sessionId: SessionId): void => {
    try {
      ctx.options.onChatWorktreeAdded?.(sessionId);
    } catch {
      // The sweep never changes the answer.
    }
  };

  /** Every put-away and Restore in progress, so a stop waits for them (bounded, by the server). */
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    inflight.add(work);
    void work.then(
      () => inflight.delete(work),
      () => inflight.delete(work),
    );
    return work;
  };

  /** Saves the copy for a put-away; a refusal or failure is `InvalidOperationError` and removes nothing (the sweep logs it). */
  const save = async (port: NonNullable<typeof ctx.options.vcsChatWorktree>, repoPath: string, session: Session & { worktreePath: string; branch: string }) => {
    try {
      return await port.saveForPutAway(repoPath, session.worktreePath, session.branch);
    } catch {
      throw new InvalidOperationError(NOT_SAVED);
    }
  };

  const methods: Pick<Chat, 'putAwayWorktree' | 'restoreWorktree' | 'worktreeIdle' | 'worktreeOpsSettled'> = {
    async worktreeOpsSettled() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },

    worktreeIdle(sessionId) {
      const session = entities.getSession(sessionId);
      return session !== undefined && !ctx.closing && idle(session) && ctx.options.worktreePutAway?.get(sessionId) === undefined;
    },

    putAwayWorktree: (sessionId, cause) => track(putAwayNow(sessionId, cause)),

    restoreWorktree: (workspaceId, sessionId) => track(restoreNow(workspaceId, sessionId)),
  };

  async function putAwayNow(sessionId: SessionId, cause: PutAwayCause): Promise<PutAwayWorktree> {
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    const store = ctx.options.worktreePutAway;
    const port = ctx.options.vcsChatWorktree;
    const vcs = ctx.options.vcs;
    if (store === undefined || port === undefined || vcs === undefined) throw new InvalidOperationError(NOT_SAVED);
    const first = ownCopy(entities.getSession(sessionId));
    if (store.get(sessionId) !== undefined) throw new InvalidOperationError(ALREADY_PUT_AWAY);
    if (!idle(first)) throw new AgentMidTurnError(DELETE_CHAT_MID_TURN_MESSAGE);
    const workspace = ctx.getWorkspace(first.workspaceId);
    const repoPath = workspaceFolder(workspace);
    // Held from here, in the same step as the check: no message starts and no switch.
    puttingAway.add(sessionId);
    try {
      // A copy that can't be put away safely (mid-merge, a nested repository) is found before its agent is stopped.
      await serializedByRepo(repoPath, () => save(port, repoPath, first));
      if (!(await stopLive(sessionId))) throw new AgentMidTurnError(NOT_IDLE);
      return await serializedByRepo(repoPath, async () => {
        // Checked again under the repo's chain: nothing may have started or changed the copy since.
        const session = ownCopy(entities.getSession(sessionId));
        if (busy.has(sessionId) || switching.has(sessionId) || session.state === 'working' || session.state === 'waiting' || session.driver === 'terminal') throw new AgentMidTurnError(NOT_IDLE);
        if (session.worktreePath !== first.worktreePath || session.branch !== first.branch) throw new AgentMidTurnError(NOT_IDLE);
        if (store.get(sessionId) !== undefined) throw new InvalidOperationError(ALREADY_PUT_AWAY);
        // The authoritative save, with the agent stopped. A failed or refused snapshot removes nothing.
        const saved = await save(port, repoPath, session);
        const record = store.insert({ sessionId, workspaceId: session.workspaceId, branch: session.branch, snapshotTree: saved.snapshotTree, head: saved.head, files: saved.files, cause });
        // Saved again just before the removal: a write since (an editor, a process outside Ogden) keeps the folder, half put away.
        let unchanged: boolean;
        try {
          unchanged = (await port.saveForPutAway(repoPath, session.worktreePath, session.branch)).snapshotTree === saved.snapshotTree;
        } catch {
          unchanged = false;
        }
        if (!unchanged) report(sessionId, 'remove');
        // Checked again just before: `<data>/cw` could have become a link since.
        else if (!isChatWorktreePath(ctx.options.dataDir, session.worktreePath)) report(sessionId, 'outside_data');
        else {
          try {
            await vcs.removeWorktree(repoPath, session.worktreePath, {});
          } catch (error) {
            // Half put away: the record stays, Restore repairs the copy in place.
            report(sessionId, 'remove', error);
          }
        }
        return listedPutAway(record);
      });
    } finally {
      puttingAway.delete(sessionId);
    }
  }

  async function restoreNow(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionLocationResponse> {
    if (ctx.closing) throw new InvalidOperationError('Ogden Agents is stopping.');
    const store = ctx.options.worktreePutAway;
    const port = ctx.options.vcsChatWorktree;
    const first = ctx.getSession(workspaceId, sessionId);
    const record = store?.get(sessionId);
    if (store === undefined || port === undefined || record === undefined) throw new InvalidOperationError(NOTHING_PUT_AWAY);
    const copy = ownCopy(first);
    if (!idle(first)) throw new AgentMidTurnError(NOT_IDLE);
    const repoPath = workspaceFolder(ctx.getWorkspace(workspaceId));
    puttingAway.add(sessionId);
    try {
      await serializedByRepo(repoPath, async () => {
        const current = store.get(sessionId);
        if (current === undefined || current.id !== record.id) throw new InvalidOperationError(NOTHING_PUT_AWAY);
        if (!isChatWorktreePath(ctx.options.dataDir, copy.worktreePath)) throw new InvalidOperationError(NOT_A_WORKTREE_CHAT);
        let result;
        try {
          result = await port.restore(repoPath, { path: copy.worktreePath, branch: current.branch, head: current.head, snapshotTree: current.snapshotTree });
        } catch {
          // git couldn't (the branch checked out elsewhere, the saved changes gone, the check failed): the record is kept.
          throw new RestoreFailedError(RESTORE_FAILED_MESSAGE, 'failed');
        }
        if (result === 'branch_missing') throw new RestoreFailedError(restoreBranchMissingText(current.branch), 'branch_missing', current.branch);
        if (result === 'branch_moved') throw new RestoreFailedError(restoreBranchMovedText(current.branch), 'branch_moved', current.branch);
        if (result === 'path_taken') throw new RestoreFailedError(RESTORE_PATH_TAKEN_TEXT, 'path_taken');
        // The copy is back (the port verified it): the record goes with its event.
        store.remove(sessionId);
      });
    } finally {
      puttingAway.delete(sessionId);
    }
    added(sessionId);
    return { location: { kind: 'worktree', branch: copy.branch, port: null, putAway: false } };
  }

  return methods;
}
