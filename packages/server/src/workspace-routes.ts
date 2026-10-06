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
import {
  ConfirmationRequiredError,
  DeveloperModeRequiredError,
  FeatureOffError,
  FeatureUnavailableError,
  NotFoundError,
  UnknownAgentError,
  ValidationError,
  WorkspaceBusyError,
  type BmadFeatures,
  type BuildsUseCases,
  type Chat,
  type Permissions,
} from '@ogden-agents/core';
import {
  API_ROUTES,
  CreateFolderRequest,
  CreateFolderResponse,
  FEATURE_OFF_MESSAGE,
  FEATURE_UNAVAILABLE_MESSAGE,
  FolderListing,
  FolderListingQuery,
  HistoryDeletedResponse,
  TEST_ROUTES,
  UpdateWorkspaceSettingsRequest,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
} from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { bmadPieceRoutes } from './bmad-pieces.js';
import { ids, readBody } from './request-input.js';
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
  /** Core's BMad pieces guard (AD-22), for the test-only probe route (registered through `bmadPieceRoutes`). */
  bmad?: BmadFeatures | undefined;
  /**
   * Registers `TEST_ROUTES.bmadProbe` (story 10.1). Only `start()` sets it,
   * and only when its test hook is allowed (`test-hooks.ts` `testBmadProbe`).
   */
  bmadProbe?: boolean;
  /** The builds, so a project whose Unattended builds piece is turned back on starts its queued runs (story 5.8 review). */
  builds?: Pick<BuildsUseCases, 'dispatchQueued'> | undefined;
  log: Logger;
}

export function registerWorkspaceRoutes(app: Hono, options: WorkspaceRoutesOptions): void {
  const { chat, permissions, bmad, bmadProbe, builds, log } = options;
  const limit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => apiError(c, 413, 'invalid_request', 'That request is too large.'),
  });

  /** Core's and the folder browser's refusals as API errors; anything else is left for `onError` (500). */
  const refusal = (c: Context, error: unknown): Response => {
    if (error instanceof NotFoundError) return apiError(c, 404, 'not_found', NOT_FOUND);
    if (error instanceof FeatureOffError) return apiError(c, 409, 'feature_off', FEATURE_OFF_MESSAGE);
    // Turning on a piece this install doesn't ship yet (story 10.2): nothing was stored.
    if (error instanceof FeatureUnavailableError) return apiError(c, 409, 'feature_unavailable', FEATURE_UNAVAILABLE_MESSAGE);
    // A default agent this install doesn't have (epic 6, entry 6): nothing was stored.
    if (error instanceof UnknownAgentError) return apiError(c, 400, 'agent_unknown', error.message);
    // Skip all as the default (default permission mode): the server is the gate; nothing was stored.
    if (error instanceof DeveloperModeRequiredError) return apiError(c, 403, 'developer_mode_required', error.message);
    if (error instanceof ConfirmationRequiredError) return apiError(c, 400, 'confirmation_required', error.message);
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
        log.info('workspace settings saved', {
          workspaceId: scope.workspaceId,
          cautionLevel: settings.cautionLevel,
          bmadPieces: settings.bmadPieces.join(','),
          defaultAgentId: settings.defaultAgentId ?? 'install default',
          defaultPermissionMode: settings.defaultPermissionMode ?? 'ask',
        });
        // Runs queued while the builds piece was off start now it is on (the queue also drains when another run ends).
        if (settings.bmadPieces.includes('builds')) void builds?.dispatchQueued().catch(() => undefined);
        return c.json(WorkspaceSettingsResponse.parse({ settings }));
      } catch (error) {
        return refusal(c, error);
      }
    });
  }

  // Tests only (story 10.1): a route serving the `planning` piece, registered
  // through the one helper (story 10.2), so core's guard is the check (AD-22).
  if (bmadProbe === true && bmad !== undefined) {
    bmadPieceRoutes(app, { bmad, log }).get('planning', TEST_ROUTES.bmadProbe, (c) => c.json({ piece: 'planning' }));
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
