/**
 * A project's BMad detection and Not now on its offer (story 10.3; 10.2
 * pre-registered both as 501 stubs). They serve projects with BMad off, so
 * no piece guards them; they sit behind the gate like every route (AD-15),
 * and the `DELETE` is state-changing, so the gate has checked its Origin.
 *
 * - `GET …/bmad/detection` → `BmadDetectionResponse`: core asks the
 *   read-only `BmadCatalogPort.detect` about the workspace's stored real
 *   path (never request input) and adds the per-project Not now.
 * - `DELETE …/bmad/offer` → 204: core keeps Not now and appends
 *   `workspace.bmad_offer_dismissed` once; a repeat is 204 too.
 *
 * Neither reads the request body. An unknown or malformed `:wsId` is 404
 * `not_found`. Without core's detection (an app wired without core) both
 * answer 501.
 */
import { NotFoundError, type BmadDetectionUseCases } from '@ogden-agents/core';
import { API_ROUTES, BMAD_PROJECT_NOT_FOUND_MESSAGE, BmadDetectionResponse } from '@ogden-agents/shared';
import type { Context, Hono } from 'hono';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { ids } from './request-input.js';

export interface BmadDetectionRoutesOptions {
  /** Core's detection and Not now; without it both routes answer 501. */
  bmadDetection?: BmadDetectionUseCases | undefined;
  log: Logger;
}

const notFound = (c: Context) => apiError(c, 404, 'not_found', BMAD_PROJECT_NOT_FOUND_MESSAGE);

export function registerBmadDetectionRoutes(app: Hono, { bmadDetection, log }: BmadDetectionRoutesOptions): void {
  if (bmadDetection === undefined) {
    app.get(API_ROUTES.workspaceBmadDetection, notImplemented);
    app.delete(API_ROUTES.workspaceBmadOffer, notImplemented);
    return;
  }

  app.get(API_ROUTES.workspaceBmadDetection, async (c) => {
    const scope = ids(c);
    if (scope === undefined || scope.sessionId !== undefined) return notFound(c);
    try {
      const detection = await bmadDetection.detect(scope.workspaceId);
      return c.json(BmadDetectionResponse.parse({ detection }));
    } catch (error) {
      if (error instanceof NotFoundError) return notFound(c);
      throw error;
    }
  });

  app.delete(API_ROUTES.workspaceBmadOffer, (c) => {
    const scope = ids(c);
    if (scope === undefined || scope.sessionId !== undefined) return notFound(c);
    try {
      bmadDetection.dismissOffer(scope.workspaceId);
    } catch (error) {
      if (error instanceof NotFoundError) return notFound(c);
      throw error;
    }
    log.info('bmad offer dismissed', { workspaceId: scope.workspaceId });
    return c.body(null, 204);
  });
}
