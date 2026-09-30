/**
 * The workspace routes (story 2.5; 2.8 fills the caution level): one
 * workspace, its history deletion, and the server-side folder browser for
 * Add project. Under `/api/v1`, behind the gate (AD-15). Routes call core and
 * never write themselves (AD-11); the folder browser only reads the disk and
 * creates the one folder asked for (`folders.ts`). The settings routes read
 * and set the caution level through core's permissions (2.8); a PATCH is
 * state-changing, so the gate has checked its Origin. Without permissions
 * (an app wired without core) they answer 501 without reading the body.
 */
import { NotFoundError, ValidationError, WorkspaceBusyError, type Chat, type Permissions } from '@ogden-agents/core';
import {
  API_ROUTES,
  CreateFolderRequest,
  CreateFolderResponse,
  FolderListing,
  FolderListingQuery,
  HistoryDeletedResponse,
  UpdateWorkspaceSettingsRequest,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ids, readBody } from './chat-routes.js';
import { apiError, notImplemented } from './errors.js';
import { createFolder, FolderError, listFolder } from './folders.js';
import type { Logger } from './log.js';

/** Largest request body these routes read (a folder path and name). */
const MAX_BODY_BYTES = 64 * 1024;

const NOT_FOUND = 'There is no such project.';

export interface WorkspaceRoutesOptions {
  /** The chat use-case, for the workspaces it opens; without it the workspace routes answer 404. */
  chat?: Chat | undefined;
  /** Core's permissions, which keep each workspace's caution level (2.8); without them the settings routes answer 501. */
  permissions?: Permissions | undefined;
  log: Logger;
}

export function registerWorkspaceRoutes(app: Hono, options: WorkspaceRoutesOptions): void {
  const { chat, permissions, log } = options;
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.'),
  });

  /** Core's and the folder browser's refusals as API errors; anything else is left for `onError` (500). */
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NOT_FOUND);
    if (error instanceof WorkspaceBusyError) {
      return apiError(c, 409, 'sessions_busy', 'A chat in this project is still working or waiting for you. Let it finish, then delete the history.');
    }
    if (error instanceof FolderError || error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
    throw error;
  };

  app.get(API_ROUTES.workspace, (c) => {
    const scope = ids(c);
    if (chat === undefined || scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      return c.json(WorkspaceResponse.parse({ workspace: chat.getWorkspace(scope.workspaceId) }));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.delete(API_ROUTES.workspaceHistory, (c) => {
    const scope = ids(c);
    if (chat === undefined || scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
    try {
      const deleted = chat.deleteHistory(scope.workspaceId);
      log.info('workspace history deleted', { workspaceId: scope.workspaceId, ...deleted });
      return c.json(HistoryDeletedResponse.parse(deleted));
    } catch (error) {
      return refusal(c, error);
    }
  });

  // `GET` and `PATCH` → `WorkspaceSettingsResponse` (caution level, 2.8).
  if (permissions === undefined) {
    app.get(API_ROUTES.workspaceSettings, notImplemented);
    app.patch(API_ROUTES.workspaceSettings, notImplemented);
  } else {
    app.get(API_ROUTES.workspaceSettings, (c) => {
      const scope = ids(c);
      if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
      try {
        return c.json(WorkspaceSettingsResponse.parse({ settings: permissions.getSettings(scope.workspaceId) }));
      } catch (error) {
        return refusal(c, error);
      }
    });

    app.patch(API_ROUTES.workspaceSettings, limit, async (c) => {
      const scope = ids(c);
      if (scope === undefined) return apiError(c, 404, 'not_found', NOT_FOUND);
      const body = await readBody(c, UpdateWorkspaceSettingsRequest);
      if (!body.ok) return body.response;
      try {
        const settings = permissions.updateSettings(scope.workspaceId, body.value);
        log.info('workspace settings saved', { workspaceId: scope.workspaceId, cautionLevel: settings.cautionLevel });
        return c.json(WorkspaceSettingsResponse.parse({ settings }));
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  app.get(API_ROUTES.folders, async (c) => {
    const query = FolderListingQuery.safeParse({ path: c.req.query('path') });
    if (!query.success) return apiError(c, 400, 'invalid_request', 'Enter the full path of the folder, starting from the top of the disk.');
    try {
      return c.json(FolderListing.parse(await listFolder(query.data.path)));
    } catch (error) {
      return refusal(c, error);
    }
  });

  app.post(API_ROUTES.folders, limit, async (c) => {
    const body = await readBody(c, CreateFolderRequest);
    if (!body.ok) return body.response;
    try {
      // Paths are the user's own content: never logged.
      return c.json(CreateFolderResponse.parse({ path: await createFolder(body.value.parent, body.value.name) }), 201);
    } catch (error) {
      return refusal(c, error);
    }
  });
}
