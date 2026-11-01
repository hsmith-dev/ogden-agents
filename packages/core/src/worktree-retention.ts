/**
 * Worktree retention and the snapshot store's cleanup (epic 27, 27.6;
 * CAP-35, AD-17 CAP-33 note's one exception, AD-37).
 *
 * The cap is the install's (Settings, Projects, Worktrees: "Keep the last N
 * worktrees", default `WORKTREE_RETENTION_DEFAULT`), counted over every
 * project's chat worktrees that are not put away. The sweep
 * ({@link WorktreeRetention.enforce}) runs one at a time: while more are
 * kept than the cap, it puts away the idle one updated longest ago, never
 * one whose chat works, waits, is busy, switches or is driven by the
 * terminal, never the chat just added, and skips one it can't put away
 * safely (the chat's refusal is reported). No startup sweep of `<data>/cw`
 * folders: only chats' rows are counted.
 *
 * The cleanup ({@link SnapshotCleanup.run}) tells the store port, per
 * project, which trees to keep: the latest `TURN_SNAPSHOTS_KEPT` turns'
 * trees of each chat and every put-away copy's; a project with a chat
 * working or waiting keeps everything this time. Objects younger than
 * `SNAPSHOT_GRACE_MS` are kept by the port.
 */
import {
  PutAwayCause,
  SessionId,
  TURN_SNAPSHOTS_KEPT,
  WorkspaceId,
  WorktreeRetentionSetting,
  type PutAwayWorktree,
  type Session,
  type SessionTurnChangesRecordedEvent,
} from '@ogden-agents/shared';
import { isChatWorktreePath } from './chat-worktrees.js';
import type { Chat } from './chat/types.js';
import type { Entities } from './entities.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { VcsSnapshotPruned, VcsSnapshotStorePort } from './vcs-port.js';
import type { WorktreeRetention } from './where-work-runs.js';
import { listedPutAway, type WorktreePutAwayStore } from './worktree-put-away-store.js';
import { workspaceFolder } from './workspace-root.js';

/** How old an unreferenced snapshot object must be before the cleanup removes it: a turn's start snapshot is in flight until its turn ends. */
export const SNAPSHOT_GRACE_MS = 24 * 60 * 60 * 1000;

export interface WorktreeRetentionOptions {
  entities: Pick<Entities, 'listWorkspaces' | 'listSessions' | 'getWorkspace' | 'getSession'>;
  store: WorktreePutAwayStore;
  chat: Pick<Chat, 'putAwayWorktree' | 'restoreWorktree' | 'worktreeIdle'>;
  /** Ogden's data folder: only a chat whose copy is a real `<data>/cw/<8>` is counted. */
  dataDir: string;
  /** Told of a copy the sweep skipped (a refusal) or a sweep that failed: the session id and an error code, for the log. */
  onSkipped?: ((sessionId: SessionId, error: unknown) => void) | undefined;
}

/** {@link WorktreeRetention} with the chat just added spared. */
export interface WorktreeRetentionSweep extends WorktreeRetention {
  /** The sweep, sparing `spare` (the chat whose worktree was just made or restored). */
  enforce(options?: { spare?: SessionId | undefined }): Promise<PutAwayWorktree[]>;
  /** Resolves once no sweep runs (tests, shutdown). */
  settled(): Promise<void>;
}

export function createWorktreeRetention({ entities, store, chat, dataDir, onSkipped }: WorktreeRetentionOptions): WorktreeRetentionSweep {
  const skipped = (sessionId: SessionId, error: unknown): void => {
    try {
      onSkipped?.(sessionId, error);
    } catch {
      // The log never stops the sweep.
    }
  };

  /** Every chat of the install whose own worktree is kept (not put away). */
  const kept = (): Session[] => {
    const putAway = new Set(store.listAll().map((record) => record.sessionId));
    return entities
      .listWorkspaces()
      .flatMap((workspace) => entities.listSessions(workspace.id))
      .filter((session) => session.kind === 'chat' && session.machineId === null && session.worktreePath !== null && session.branch !== null && !putAway.has(session.id) && isChatWorktreePath(dataDir, session.worktreePath));
  };

  const sweep = async (spare: SessionId | undefined): Promise<PutAwayWorktree[]> => {
    const done: PutAwayWorktree[] = [];
    const tried = new Set<SessionId>();
    for (;;) {
      const { keep } = store.retention();
      const copies = kept();
      if (copies.length <= keep) return done;
      // Oldest first: the one updated longest ago.
      const next = copies
        .filter((session) => session.id !== spare && !tried.has(session.id) && chat.worktreeIdle(session.id))
        .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? -1 : 1))[0];
      if (next === undefined) return done;
      tried.add(next.id);
      try {
        done.push(await chat.putAwayWorktree(next.id, 'retention'));
      } catch (error) {
        skipped(next.id, error);
      }
    }
  };

  let chain: Promise<unknown> = Promise.resolve();
  const enforce = (options: { spare?: SessionId | undefined } = {}): Promise<PutAwayWorktree[]> => {
    const result = chain.then(() => sweep(options.spare));
    chain = result.catch(() => undefined);
    return result;
  };

  return {
    async setting() {
      return store.retention();
    },

    async setSetting(body) {
      const parsed = WorktreeRetentionSetting.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError('Keep between 1 and 100 worktrees.', parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
      }
      const { setting, changed } = store.setRetention(parsed.data.keep);
      // A lower cap applies at once; the sweep runs on its own, the answer doesn't wait for it.
      if (changed) void enforce().catch(() => undefined);
      return setting;
    },

    async listPutAway(workspaceId) {
      const id = WorkspaceId.safeParse(workspaceId);
      if (!id.success || entities.getWorkspace(id.data) === undefined) throw new NotFoundError('workspace', 'requested');
      return { worktrees: store.listByWorkspace(id.data).map(listedPutAway) };
    },

    putAway: (sessionId, cause) => chat.putAwayWorktree(SessionId.parse(sessionId), PutAwayCause.parse(cause)),

    async restore(workspaceId, sessionId) {
      const ws = WorkspaceId.safeParse(workspaceId);
      const ses = SessionId.safeParse(sessionId);
      if (!ws.success || !ses.success || entities.getWorkspace(ws.data) === undefined) throw new NotFoundError('session', 'requested');
      return chat.restoreWorktree(ws.data, ses.data);
    },

    enforce,

    async settled() {
      await chain;
    },
  };
}

export interface SnapshotCleanupOptions {
  entities: Pick<Entities, 'listWorkspaces' | 'listSessions' | 'listSessionEvents'>;
  store: Pick<WorktreePutAwayStore, 'listByWorkspace' | 'listAll'>;
  port: VcsSnapshotStorePort;
  /** How old an unreferenced object must be. Default {@link SNAPSHOT_GRACE_MS}. */
  graceMs?: number | undefined;
}

export interface SnapshotCleanup {
  /** One cleanup of the store: what it removed. */
  run(): Promise<VcsSnapshotPruned>;
}

/** A chat's turns whose snapshots are kept: its latest {@link TURN_SNAPSHOTS_KEPT}, oldest first. */
export function keptTurns(entities: Pick<Entities, 'listSessionEvents'>, sessionId: SessionId): SessionTurnChangesRecordedEvent[] {
  return entities
    .listSessionEvents(sessionId, ['session.turn_changes_recorded'])
    .filter((event): event is SessionTurnChangesRecordedEvent => event.type === 'session.turn_changes_recorded')
    .slice(-TURN_SNAPSHOTS_KEPT);
}

export function createSnapshotCleanup({ entities, store, port, graceMs = SNAPSHOT_GRACE_MS }: SnapshotCleanupOptions): SnapshotCleanup {
  return {
    async run() {
      const entries = entities.listWorkspaces().map((workspace) => {
        const sessions = entities.listSessions(workspace.id);
        // A chat working or waiting may be between its two snapshots: its project keeps everything this time.
        if (sessions.some((session) => session.state === 'working' || session.state === 'waiting')) return { folder: workspaceFolder(workspace), keep: null };
        const keep = new Set<string>();
        for (const session of sessions) {
          for (const turn of keptTurns(entities, session.id)) {
            keep.add(turn.payload.startTree);
            keep.add(turn.payload.endTree);
          }
        }
        for (const record of store.listByWorkspace(workspace.id)) if (record.snapshotTree !== null) keep.add(record.snapshotTree);
        return { folder: workspaceFolder(workspace), keep: [...keep] };
      });
      // Every put-away copy's tree of the install: a store holding one is never removed whole (its repo may have moved).
      const protect = store.listAll().flatMap((record) => (record.snapshotTree === null ? [] : [record.snapshotTree]));
      return port.pruneSnapshots(entries, { olderThanMs: graceMs, protect });
    },
  };
}
