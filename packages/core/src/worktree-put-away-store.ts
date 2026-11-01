/**
 * Put-away chat worktrees and the install's cap (27.6; AD-17 CAP-33 note's
 * one exception): one row per put-away copy (its saved changes' tree, the
 * branch's commit they were taken on, how many files, why and when) and one
 * row for the cap. Each write and its event go in one transaction: a row
 * with `session.worktree_put_away`, its removal with
 * `session.worktree_restored` (the chat's `updatedAt` moved too, so the
 * copy just brought back isn't the oldest), a cap change with
 * `settings.worktree_retention_changed`. Rows hold no path.
 */
import {
  PutAwayCause,
  SETTINGS_STREAM,
  WORKTREE_RETENTION_DEFAULT,
  WorktreeRetentionKeep,
  type PutAwayWorktree,
  type SessionId,
  type WorkspaceId,
  type WorktreeRetentionSetting,
  type WorktreeSnapshotId,
} from '@ogden-agents/shared';
import { desc, eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { chatWorktreeRetention, chatWorktreesPutAway, sessions } from './db/schema.js';
import type { EventLog } from './event-log.js';
import { newId } from './ids.js';
import type { SessionEvents } from './session-events.js';

const ROW_ID = 1;

/** One put-away copy as core keeps it: what the list shows, and what Restore needs. */
export interface PutAwayRecord extends PutAwayWorktree {
  snapshotTree: string | null;
  head: string;
}

export interface WorktreePutAwayStore {
  get(sessionId: SessionId): PutAwayRecord | undefined;
  /** The project's put-away copies, newest first. */
  listByWorkspace(workspaceId: WorkspaceId): PutAwayRecord[];
  /** Every put-away copy of the install. */
  listAll(): PutAwayRecord[];
  /** Writes the row and `session.worktree_put_away` in one transaction. */
  insert(input: { sessionId: SessionId; workspaceId: WorkspaceId; branch: string; snapshotTree: string | null; head: string; files: number; cause: PutAwayCause }): PutAwayRecord;
  /** Removes the row with `session.worktree_restored` in one transaction, `alongside` (another write, such as the chat's new branch) inside it first; `undefined` when there was none. */
  remove(sessionId: SessionId, alongside?: () => void): PutAwayRecord | undefined;
  /** The install's cap (the default when never set, or when the stored value is damaged). */
  retention(): WorktreeRetentionSetting;
  /** Sets the cap; appends `settings.worktree_retention_changed` only when it changed. */
  setRetention(keep: number): { setting: WorktreeRetentionSetting; changed: boolean };
}

type Row = typeof chatWorktreesPutAway.$inferSelect;

const recordOf = (row: Row): PutAwayRecord => ({
  id: row.id as WorktreeSnapshotId,
  sessionId: row.sessionId as SessionId,
  workspaceId: row.workspaceId as WorkspaceId,
  branch: row.branch,
  files: row.files,
  cause: PutAwayCause.catch('retention').parse(row.cause),
  putAwayAt: row.putAwayAt,
  snapshotTree: row.snapshotTree,
  head: row.head,
});

/** The list's shape: no tree, no commit. */
export const listedPutAway = ({ id, sessionId, workspaceId, branch, files, cause, putAwayAt }: PutAwayRecord): PutAwayWorktree => ({ id, sessionId, workspaceId, branch, files, cause, putAwayAt });

export function createWorktreePutAwayStore({ db, events, sessionEvents, now = () => new Date().toISOString() }: { db: Database; events: EventLog; sessionEvents: Pick<SessionEvents, 'appendSessionEvent'>; now?: () => string }): WorktreePutAwayStore {
  const { orm } = db;
  const get = (sessionId: SessionId): PutAwayRecord | undefined => {
    const row = orm.select().from(chatWorktreesPutAway).where(eq(chatWorktreesPutAway.sessionId, sessionId)).get();
    return row === undefined ? undefined : recordOf(row);
  };
  const retention = (): WorktreeRetentionSetting => {
    const row = orm.select().from(chatWorktreeRetention).where(eq(chatWorktreeRetention.id, ROW_ID)).get();
    const keep = WorktreeRetentionKeep.safeParse(row?.keep);
    return { keep: keep.success ? keep.data : WORKTREE_RETENTION_DEFAULT };
  };

  return {
    get,

    listByWorkspace: (workspaceId) =>
      orm.select().from(chatWorktreesPutAway).where(eq(chatWorktreesPutAway.workspaceId, workspaceId)).orderBy(desc(chatWorktreesPutAway.putAwayAt), desc(chatWorktreesPutAway.id)).all().map(recordOf),

    listAll: () => orm.select().from(chatWorktreesPutAway).all().map(recordOf),

    insert(input) {
      return events.transaction(() => {
        const record: PutAwayRecord = { id: newId('wsn'), ...input, putAwayAt: now() };
        orm.insert(chatWorktreesPutAway).values(record).run();
        sessionEvents.appendSessionEvent(input.sessionId, {
          type: 'session.worktree_put_away',
          payload: { sessionId: input.sessionId, snapshotId: record.id, cause: input.cause, files: input.files },
        });
        return record;
      });
    },

    remove(sessionId, alongside) {
      return events.transaction(() => {
        const record = get(sessionId);
        if (record === undefined) return undefined;
        alongside?.();
        orm.delete(chatWorktreesPutAway).where(eq(chatWorktreesPutAway.id, record.id)).run();
        orm.update(sessions).set({ updatedAt: now() }).where(eq(sessions.id, sessionId)).run();
        sessionEvents.appendSessionEvent(sessionId, { type: 'session.worktree_restored', payload: { sessionId, snapshotId: record.id } });
        return record;
      });
    },

    retention,

    setRetention(keep) {
      const checked = WorktreeRetentionKeep.parse(keep);
      return events.transaction(() => {
        const previous = retention();
        if (previous.keep === checked) return { setting: previous, changed: false };
        orm.insert(chatWorktreeRetention).values({ id: ROW_ID, keep: checked }).onConflictDoUpdate({ target: chatWorktreeRetention.id, set: { keep: checked } }).run();
        events.append({ type: 'settings.worktree_retention_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { keep: checked, previous: previous.keep } });
        return { setting: { keep: checked }, changed: true };
      });
    },
  };
}
