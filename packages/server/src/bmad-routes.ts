/**
 * The install's and the projects' BMad routes that serve projects with BMad
 * off, so they are not guarded by a piece (story 10.2): the pieces this
 * install ships, and the routes later entries fill, pre-registered behind
 * the gate as 501 stubs that never read the body: the app-wide default for
 * new projects (10.4), a repo's detection and Not now on its offer (10.3).
 * Routes that serve a piece go through `bmadPieceRoutes` instead.
 */
import type { BmadFeatures } from '@ogden-agents/core';
import { API_ROUTES, BmadPiecesResponse } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { notImplemented } from './errors.js';
import type { Logger } from './log.js';

export interface BmadRoutesOptions {
  /** Core's BMad pieces (AD-22); without it the pieces route answers 501. */
  bmad?: BmadFeatures | undefined;
  log: Logger;
}

export function registerBmadRoutes(app: Hono, { bmad }: BmadRoutesOptions): void {
  // `GET` → `BmadPiecesResponse`: all four pieces, each available or coming soon.
  if (bmad === undefined) app.get(API_ROUTES.bmadPieces, notImplemented);
  else app.get(API_ROUTES.bmadPieces, (c) => c.json(BmadPiecesResponse.parse({ pieces: bmad.available() })));

  // Filled by entry 10.4 (the app-wide default) and 10.3 (detection and the offer).
  app.get(API_ROUTES.newProjectDefaults, notImplemented);
  app.patch(API_ROUTES.newProjectDefaults, notImplemented);
  app.get(API_ROUTES.workspaceBmadDetection, notImplemented);
  app.delete(API_ROUTES.workspaceBmadOffer, notImplemented);
}
