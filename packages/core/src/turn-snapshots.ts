/**
 * A chat turn's snapshots (AD-37; story 8.4): the folder a chat works in is
 * snapshotted (a tree object in Ogden's data folder, never the repo's
 * index, refs or objects) just before each prompt goes out and once it
 * settled, and `session.turn_changes_recorded` is appended with the two
 * trees and the turn's counts, so This turn can diff between them. A build
 * (its run's worktree) and a remote chat (another machine) are never
 * snapshotted, nor is a folder in no repository. Each snapshot runs under
 * `serializedByRepo(<project folder>)`, with the worktree commit. A
 * snapshot that fails is skipped: it never fails the turn (the chat races
 * each call with {@link TURN_SNAPSHOT_TIMEOUT_MS}). No path or diff is ever
 * appended or logged here.
 */
import type { SessionId } from '@ogden-agents/shared';
import type { Entities } from './entities.js';
import { newId } from './ids.js';
import { serializedByRepo } from './repo-serialization.js';
import type { SessionEvents } from './session-events.js';
import type { VcsFolder, VcsWorkingTreePort } from './vcs-port.js';
import { shownFile } from './workspace-changes.js';
import { vcsFolderOf, workspaceFolder } from './workspace-root.js';

/** The longest a turn waits for a snapshot before going on without it. */
export const TURN_SNAPSHOT_TIMEOUT_MS = 10_000;

/** A turn's start snapshot, for its {@link TurnSnapshots.end}. */
export interface TurnSnapshotHandle {
  readonly sessionId: SessionId;
  readonly folder: VcsFolder;
  /** The project folder the snapshots are serialized on. */
  readonly repoKey: string;
  readonly startTree: string;
}

export interface TurnSnapshots {
  /** Snapshots the chat's folder before its prompt; `undefined` when it isn't snapshotted (a build, a remote chat, no repository, a failure). Never throws. */
  start(sessionId: SessionId): Promise<TurnSnapshotHandle | undefined>;
  /** Snapshots the folder again and records the turn's changes. Never throws. */
  end(handle: TurnSnapshotHandle): Promise<void>;
}

export interface TurnSnapshotsOptions {
  entities: Pick<Entities, 'getSession' | 'getWorkspace'>;
  sessionEvents: Pick<SessionEvents, 'appendSessionEvent'>;
  port: VcsWorkingTreePort;
  /** Told of a snapshot that failed (for the log: the error names no path). */
  onError?: (sessionId: SessionId, error: unknown) => void;
}

/** `promise`, or `undefined` once `ms` passed first (the work goes on and its answer is dropped). */
export function withinTimeout<T>(promise: Promise<T>, ms = TURN_SNAPSHOT_TIMEOUT_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
  });
  return Promise.race([promise.catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}

export function createTurnSnapshots({ entities, sessionEvents, port, onError }: TurnSnapshotsOptions): TurnSnapshots {
  const failed = (sessionId: SessionId, error: unknown): undefined => {
    try {
      onError?.(sessionId, error);
    } catch {
      // Logging never fails the turn.
    }
    return undefined;
  };

  return {
    async start(sessionId) {
      try {
        const session = entities.getSession(sessionId);
        if (session === undefined || session.kind === 'build' || session.machineId !== null) return undefined;
        const workspace = entities.getWorkspace(session.workspaceId);
        if (workspace === undefined) return undefined;
        const folder = vcsFolderOf(workspace, session);
        const repoKey = workspaceFolder(workspace);
        const startTree = await serializedByRepo(repoKey, () => port.snapshot(folder));
        return startTree === undefined ? undefined : { sessionId, folder, repoKey, startTree };
      } catch (error) {
        return failed(sessionId, error);
      }
    },

    async end(handle) {
      try {
        const endTree = await serializedByRepo(handle.repoKey, () => port.snapshot(handle.folder));
        if (endTree === undefined) return;
        const target = { view: 'turn' as const, startTree: handle.startTree, endTree };
        const files = handle.startTree === endTree ? [] : (await port.changedFiles(handle.folder, target)).files.filter(shownFile);
        sessionEvents.appendSessionEvent(handle.sessionId, {
          type: 'session.turn_changes_recorded',
          payload: {
            sessionId: handle.sessionId,
            turnId: newId('trn'),
            startTree: handle.startTree,
            endTree,
            files: files.length,
            additions: files.reduce((sum, file) => sum + file.additions, 0),
            deletions: files.reduce((sum, file) => sum + file.deletions, 0),
          },
        });
      } catch (error) {
        failed(handle.sessionId, error);
      }
    },
  };
}
