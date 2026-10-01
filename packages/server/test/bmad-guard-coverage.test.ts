/**
 * Every route serving a BMad piece goes through the guard (AD-22; story
 * 10.6). Over the fully wired server app, each server route (`/api`, `/ws`,
 * `/launcher`) is classified, by default-deny: a route inside a workspace (`/api/v1/workspaces/:wsId/…`)
 * serves a piece unless it is listed below as one that serves projects with
 * BMad off, and a server route anywhere whose path names BMad or a piece serves one
 * unless it is one of the four routes that serve projects with BMad off. Each
 * route that serves a piece must have been registered through
 * `bmadPieceRoutes` (`guardedRouteKeys`), or this test fails naming it.
 *
 * Epic 4.2's verify ("10.6's guard-coverage test passes") consumes this.
 */
import { openCore, type Core } from '@ogden-agents/core';
import { API_BASE, API_ROUTES, TEST_ROUTES } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { bmadPieceRoutes, guardedRouteKeys } from '../src/bmad-pieces.js';
import { createLogger } from '../src/log.js';
import { isServerPath } from '../src/paths.js';
import { fullTestApp, tempDataDir } from './helpers.js';

/**
 * The routes inside a workspace that serve no piece: chats, settings,
 * history, sessions, permissions, and BMad detection and the offer (which
 * serve projects with BMad off). A new workspace route that serves no piece
 * is added here; one that serves a piece is registered through
 * `bmadPieceRoutes` instead.
 */
const WORKSPACE_ROUTES_WITHOUT_A_PIECE: readonly string[] = [
  `GET ${API_ROUTES.workspace}`,
  `DELETE ${API_ROUTES.workspaceHistory}`,
  `GET ${API_ROUTES.workspaceSettings}`,
  `PATCH ${API_ROUTES.workspaceSettings}`,
  `GET ${API_ROUTES.workspaceSessions}`,
  `POST ${API_ROUTES.workspaceSessions}`,
  `GET ${API_ROUTES.workspaceSession}`,
  `POST ${API_ROUTES.sessionMessages}`,
  `POST ${API_ROUTES.sessionCancel}`,
  `POST ${API_ROUTES.sessionDriver}`,
  `POST ${API_ROUTES.sessionPermission}`,
  `GET ${API_ROUTES.permissionRules}`,
  `DELETE ${API_ROUTES.permissionRule}`,
  `GET ${API_ROUTES.workspaceBmadDetection}`,
  `DELETE ${API_ROUTES.workspaceBmadOffer}`,
];

/** The BMad-named routes that serve projects with BMad off (story 10.2): never guarded, by design. */
const UNGUARDED_BY_DESIGN: readonly string[] = [
  `GET ${API_ROUTES.bmadPieces}`,
  `GET ${API_ROUTES.newProjectDefaults}`,
  `PATCH ${API_ROUTES.newProjectDefaults}`,
  `GET ${API_ROUTES.workspaceBmadDetection}`,
  `DELETE ${API_ROUTES.workspaceBmadOffer}`,
];

/** Path segments that name BMad Method or one of its pieces. */
const BMAD_SEGMENTS = new Set(['bmad', 'plan', 'planning', 'board', 'tickets', 'builds', 'runs', 'retrospectives', 'catalog']);

const WORKSPACE_SCOPE = `${API_BASE}/workspaces/:wsId/`;

const namesBmad = (path: string): boolean =>
  path
    .toLowerCase()
    .split('/')
    .some((segment) => segment.includes('bmad') || BMAD_SEGMENTS.has(segment));

/** Every server route on `app` (`/api`, `/ws`, `/launcher`), as unique sorted `METHOD path` keys. */
function serverRouteKeys(app: Hono): string[] {
  return [...new Set(app.routes.filter((route) => isServerPath(route.path)).map((route) => `${route.method} ${route.path}`))].sort();
}

/** Whether the route `key` (`METHOD path`) serves a BMad piece, by the rules above. */
function servesAPiece(key: string): boolean {
  const path = key.slice(key.indexOf(' ') + 1);
  if (path.startsWith(WORKSPACE_SCOPE) && !WORKSPACE_ROUTES_WITHOUT_A_PIECE.includes(key)) return true;
  return namesBmad(path) && !UNGUARDED_BY_DESIGN.includes(key);
}

/** The routes on `app` that serve a BMad piece. */
function bmadRouteKeys(app: Hono): string[] {
  return serverRouteKeys(app).filter(servesAPiece);
}

/** The routes on `app` that serve a BMad piece but were not registered through `bmadPieceRoutes`. */
function findUnguardedBmadRoutes(app: Hono): string[] {
  const guarded = new Set(guardedRouteKeys(app));
  return bmadRouteKeys(app).filter((key) => !guarded.has(key));
}

const HOW_TO_FIX =
  "A route serves a BMad piece but skips core's guard (AD-22). Register it through `bmadPieceRoutes` (packages/server/src/bmad-pieces.ts); " +
  'if it serves no piece, add it to WORKSPACE_ROUTES_WITHOUT_A_PIECE in packages/server/test/bmad-guard-coverage.test.ts. Unguarded';

const cores: Core[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
});

function openTestCore(): Core {
  const core = openCore(tempDataDir());
  cores.push(core);
  return core;
}

const BOARD = `${API_BASE}/workspaces/:wsId/board`;
const CATALOG = `${API_BASE}/bmad/catalog`;
const ok = (c: { json: (body: unknown) => Response }) => c.json({ ok: true });

describe('every route serving a BMad piece is guarded (AD-22, story 10.6)', () => {
  it('the fully wired app, with the probe, has none unguarded, and the probe counts as one and is guarded', () => {
    const app = fullTestApp(openTestCore(), { bmadProbe: true });
    expect(findUnguardedBmadRoutes(app), HOW_TO_FIX).toEqual([]);
    expect(bmadRouteKeys(app)).toEqual([`GET ${TEST_ROUTES.bmadProbe}`]);
    expect(guardedRouteKeys(app)).toContain(`GET ${TEST_ROUTES.bmadProbe}`);
  });

  it('every listed piece-less and by-design route is a route the app has (the lists stay current)', () => {
    const routes = serverRouteKeys(fullTestApp(openTestCore()));
    for (const key of [...WORKSPACE_ROUTES_WITHOUT_A_PIECE, ...UNGUARDED_BY_DESIGN]) expect(routes, key).toContain(key);
  });

  it('a workspace route serving a piece registered without the helper fails, naming it', () => {
    const app = fullTestApp(openTestCore());
    app.get(BOARD, ok);
    expect(findUnguardedBmadRoutes(app)).toEqual([`GET ${BOARD}`]);
  });

  it('a BMad-named install-wide route that is neither guarded nor listed fails, naming it', () => {
    const app = fullTestApp(openTestCore());
    app.get(CATALOG, ok);
    expect(findUnguardedBmadRoutes(app)).toEqual([`GET ${CATALOG}`]);
  });

  it('a new workspace route that is neither guarded nor listed fails (default-deny)', () => {
    const app = fullTestApp(openTestCore());
    app.post(`${API_BASE}/workspaces/:wsId/notes`, ok);
    expect(findUnguardedBmadRoutes(app)).toEqual([`POST ${API_BASE}/workspaces/:wsId/notes`]);
  });

  it('a BMad-named socket route that is not guarded fails, naming it', () => {
    const app = fullTestApp(openTestCore());
    app.get('/ws/workspaces/:wsId/runs', ok);
    expect(findUnguardedBmadRoutes(app)).toEqual(['GET /ws/workspaces/:wsId/runs']);
  });

  it('the same workspace route registered through bmadPieceRoutes passes', () => {
    const core = openTestCore();
    const app = fullTestApp(core);
    bmadPieceRoutes(app, { bmad: core.bmad, log: createLogger(() => {}) }).get('board', BOARD, (c) => c.json({ ok: true }));
    expect(bmadRouteKeys(app)).toEqual([`GET ${BOARD}`]);
    expect(findUnguardedBmadRoutes(app), HOW_TO_FIX).toEqual([]);
  });
});
