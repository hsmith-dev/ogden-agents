/**
 * The pinned upstream BMad Method's routes (story 4.14, AD-13):
 * install-level, behind the gate like every route, not inside a workspace
 * and not guarded by a piece (the download serves every project).
 *
 * - `GET /api/v1/bmad/source` → `BmadSourceResponse`: `missing`,
 *   `downloading` or `ready`, read from the data folder only. Never the
 *   network.
 * - `POST /api/v1/bmad/source` → `BmadSourceResponse` (`ready`): downloads,
 *   verifies and extracts it, only because the user clicked Download BMad
 *   Method (a state-changing POST, so the gate has checked its Origin);
 *   concurrent POSTs share one download. 503 `bmad_download_failed` when it
 *   didn't arrive, 502 when it isn't the pinned content; nothing is saved
 *   then.
 *
 * Without the use-case (an app wired without it) both answer 501.
 */
import { BmadDownloadError, type BmadSourceUseCases } from '@ogden-agents/core';
import { API_ROUTES, BmadSourceResponse } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface BmadSourceRoutesOptions {
  bmadSource?: BmadSourceUseCases | undefined;
  log: Logger;
}

export function registerBmadSourceRoutes(app: Hono, { bmadSource, log }: BmadSourceRoutesOptions): void {
  if (bmadSource === undefined) {
    app.get(API_ROUTES.bmadSource, notImplemented);
    app.post(API_ROUTES.bmadSource, notImplemented);
    return;
  }
  app.get(API_ROUTES.bmadSource, (c) => c.json(BmadSourceResponse.parse(bmadSource.status())));
  app.post(API_ROUTES.bmadSource, async (c) => {
    const before = bmadSource.status();
    if (before.state !== 'ready') log.info('BMad Method download requested', { commit: before.commit });
    try {
      const status = BmadSourceResponse.parse(await bmadSource.download());
      if (before.state !== 'ready') log.info('BMad Method downloaded and verified', { commit: status.commit });
      return c.json(status);
    } catch (error) {
      if (error instanceof BmadDownloadError) {
        // The detail (an HTTP status, both hashes) goes to the log only.
        log.warn('BMad Method download failed', { reason: error.reason, detail: error.detail ?? '' });
        return apiError(c, error.reason === 'integrity' ? 502 : 503, 'bmad_download_failed', error.message);
      }
      throw error;
    }
  });
}
