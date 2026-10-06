/**
 * Where terminal panes are kept between runs (epic 16, story 16.7; E16-R8;
 * AD-11): the panes (id, project, launcher, name) and each project's layout,
 * in SQLite through core. Never a program's output, the arguments a user
 * typed or a secret. Running programs do not survive a stop; what comes back
 * is the shape, each pane stopped.
 */
import { PaneLauncherId, PaneLayout, PaneTitle, type PaneId, type WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { terminalLayouts, terminalPanes } from './db/schema.js';

export interface StoredPane {
  id: PaneId;
  workspaceId: WorkspaceId;
  launcherId: string;
  title: string;
  /** Milliseconds since 1970. */
  createdAt: number;
  /** The user's opt in to notifications for this pane (story 16.8). */
  notify: boolean;
}

export interface PaneStore {
  /** Every stored pane, oldest first, and each project's stored layout (a layout that no longer parses is left out). */
  load(): { panes: StoredPane[]; layouts: Map<WorkspaceId, PaneLayout> };
  savePane(pane: StoredPane): void;
  renamePane(paneId: PaneId, title: string): void;
  setNotify(paneId: PaneId, notify: boolean): void;
  deletePane(paneId: PaneId): void;
  saveLayout(workspaceId: WorkspaceId, layout: PaneLayout): void;
  deleteLayout(workspaceId: WorkspaceId): void;
}

export function createPaneStore({ db }: { db: Database }): PaneStore {
  const { orm } = db;
  return {
    load() {
      const panes = orm
        .select()
        .from(terminalPanes)
        .all()
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
        // A row that is not what core writes (a damaged or edited file) is left out.
        .filter((row) => PaneTitle.safeParse(row.title).success && PaneLauncherId.safeParse(row.launcherId).success)
        .map((row): StoredPane => ({ id: row.id as PaneId, workspaceId: row.workspaceId as WorkspaceId, launcherId: row.launcherId, title: row.title, createdAt: row.createdAt, notify: row.notify }));
      const layouts = new Map<WorkspaceId, PaneLayout>();
      for (const row of orm.select().from(terminalLayouts).all()) {
        try {
          const parsed = PaneLayout.safeParse(JSON.parse(row.layout));
          if (parsed.success) layouts.set(row.workspaceId as WorkspaceId, parsed.data);
        } catch {
          // A damaged layout is rebuilt from the panes.
        }
      }
      return { panes, layouts };
    },
    savePane: (pane) => void orm.insert(terminalPanes).values(pane).onConflictDoNothing().run(),
    renamePane: (paneId, title) => void orm.update(terminalPanes).set({ title }).where(eq(terminalPanes.id, paneId)).run(),
    setNotify: (paneId, notify) => void orm.update(terminalPanes).set({ notify }).where(eq(terminalPanes.id, paneId)).run(),
    deletePane: (paneId) => void orm.delete(terminalPanes).where(eq(terminalPanes.id, paneId)).run(),
    saveLayout: (workspaceId, layout) =>
      void orm.insert(terminalLayouts).values({ workspaceId, layout: JSON.stringify(layout) }).onConflictDoUpdate({ target: terminalLayouts.workspaceId, set: { layout: JSON.stringify(layout) } }).run(),
    deleteLayout: (workspaceId) => void orm.delete(terminalLayouts).where(eq(terminalLayouts.workspaceId, workspaceId)).run(),
  };
}
