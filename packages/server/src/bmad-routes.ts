/**
 * The install's and the projects' BMad routes that serve projects with BMad
 * off, so they are not guarded by a piece (story 10.2): the pieces this
 * install ships, and the app-wide default for new projects (story 10.4;
 * 501 without core's store, never reading the body). A repo's detection and
 * Not now on its offer (10.3) live in `bmad-detection-routes.ts`.
 * Routes that serve a piece go through `bmadPieceRoutes` instead.
 */
import { CoreError, FeatureUnavailableError, ValidationError, type BmadFeatures, type NewProjectDefaultsStore } from '@ogden-agents/core';
import { API_ROUTES, BmadPiecesResponse, FEATURE_UNAVAILABLE_MESSAGE, NEW_PROJECTS_SAVE_FAILED, NewProjectDefaultsResponse, UpdateNewProjectDefaultsRequest } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, notImplemented } from './errors.js';
import type { Logger } from './log.js';
import { readBody } from './request-input.js';

/** Largest new-projects default body read (all four pieces fit in well under 100 bytes). */
const MAX_DEFAULTS_BODY_BYTES = 1024;

export interface BmadRoutesOptions {
  /** Core's BMad pieces (AD-22); without it the pieces route answers 501. */
  bmad?: BmadFeatures | undefined;
  /** Core's app-wide default for new projects (10.4); without it those routes answer 501 and read no body. */
  newProjectDefaults?: NewProjectDefaultsStore | undefined;
  log: Logger;
}

export function registerBmadRoutes(app: Hono, { bmad, newProjectDefaults, log }: BmadRoutesOptions): void {
  // `GET` → `BmadPiecesResponse`: all four pieces, each available or coming soon.
  if (bmad === undefined) app.get(API_ROUTES.bmadPieces, notImplemented);
  else app.get(API_ROUTES.bmadPieces, (c) => c.json(BmadPiecesResponse.parse({ pieces: bmad.available() })));

  // The app-wide default for new projects (10.4): not guarded by a piece, it serves Simple projects too.
  if (newProjectDefaults === undefined) {
    app.get(API_ROUTES.newProjectDefaults, notImplemented);
    app.patch(API_ROUTES.newProjectDefaults, notImplemented);
  } else {
    app.get(API_ROUTES.newProjectDefaults, (c) => c.json(NewProjectDefaultsResponse.parse({ defaults: newProjectDefaults.get() })));
    app.patch(
      API_ROUTES.newProjectDefaults,
      bodyLimit({ maxSize: MAX_DEFAULTS_BODY_BYTES, onError: (c) => apiError(c, 413, 'invalid_request', 'The request is too large.') }),
      async (c) => {
        const body = await readBody(c, UpdateNewProjectDefaultsRequest);
        if (!body.ok) return body.response;
        try {
          const defaults = newProjectDefaults.set(body.value);
          log.info('new project defaults saved', { pieceCount: defaults.bmadPieces.length });
          return c.json(NewProjectDefaultsResponse.parse({ defaults }));
        } catch (error) {
          if (error instanceof FeatureUnavailableError) return apiError(c, 409, 'feature_unavailable', FEATURE_UNAVAILABLE_MESSAGE);
          if (error instanceof ValidationError) return apiError(c, 400, 'invalid_request', error.message);
          log.error('saving new project defaults failed', { code: (error as NodeJS.ErrnoException).code ?? (error instanceof CoreError ? error.code : 'unexpected') });
          return apiError(c, 500, 'internal_error', NEW_PROJECTS_SAVE_FAILED);
        }
      },
    );
  }

  // Detection and the offer (10.3) are registered by `bmad-detection-routes.ts`.
}
