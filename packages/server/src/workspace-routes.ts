/**
 * The workspace routes (story 2.3 stubs; story 2.5 fills them, then 2.8 the
 * caution level): one workspace, its history deletion and settings, and the
 * server-side folder browser for Add project. Under `/api/v1`, behind the
 * gate (AD-15). Until their lane ships each answers 501 `not_implemented`
 * without reading the body.
 */
import type { Chat } from '@ogden-agents/core';
import { API_ROUTES } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface WorkspaceRoutesOptions {
  /** The chat use-case, for the workspaces it opens (2.5). */
  chat?: Chat | undefined;
  log: Logger;
}

export function registerWorkspaceRoutes(app: Hono, options: WorkspaceRoutesOptions): void {
  // `GET` → `WorkspaceResponse` (2.5).
  app.get(API_ROUTES.workspace, notImplemented);
  // `DELETE` → `HistoryDeletedResponse` (2.5).
  app.delete(API_ROUTES.workspaceHistory, notImplemented);
  // `GET` and `PATCH` → `WorkspaceSettingsResponse` (2.5, caution level 2.8).
  app.get(API_ROUTES.workspaceSettings, notImplemented);
  app.patch(API_ROUTES.workspaceSettings, notImplemented);
  // `GET ?path=` → `FolderListing`; `POST CreateFolderRequest` → 201 `CreateFolderResponse` (2.5).
  app.get(API_ROUTES.folders, notImplemented);
  app.post(API_ROUTES.folders, notImplemented);
}
