/**
 * Every route serving a BMad piece goes through the guard (AD-22; story
 * 10.6). Over the fully wired server app, each server route (`/api`, `/ws`,
 * `/launcher`) is classified, by default-deny: a route inside a workspace (`/api/v1/workspaces/:wsId/…`)
 * serves a piece unless it is listed below as one that serves projects with
 * BMad off, and a server route anywhere whose path names BMad or a piece serves one
 * unless it is one of the routes listed as unguarded by design (they serve
 * projects with BMad off, or the whole install). Each
 * route that serves a piece must have been registered through
 * `bmadPieceRoutes` (`guardedRouteKeys`), or this test fails naming it.
 *
 * Epic 4.2's verify ("10.6's guard-coverage test passes") consumes this.
 */
import { openCore, type Core } from '@ogden-agents/core';
import { API_BASE, API_ROUTES, TEST_ROUTES } from '@ogden-agents/shared';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { bmadPieceRoutes, guardedRouteKeys, trustedRouteKeys } from '../src/bmad-pieces.js';
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
  `PUT ${API_ROUTES.sessionPermissionMode}`,
  `GET ${API_ROUTES.sessionHandoff}`,
  `POST ${API_ROUTES.sessionHandoff}`,
  `POST ${API_ROUTES.sessionPermission}`,
  `GET ${API_ROUTES.permissionRules}`,
  `DELETE ${API_ROUTES.permissionRule}`,
  `GET ${API_ROUTES.workspaceBmadDetection}`,
  `DELETE ${API_ROUTES.workspaceBmadOffer}`,
  // The script trust (story 4.2): asked before or right after a script-running piece is turned on, never revoked by turning one off.
  `PUT ${API_ROUTES.workspaceBmadScriptTrust}`,
];

/** The BMad-named routes that serve projects with BMad off (story 10.2) or the whole install (story 4.14): never guarded, by design. */
const UNGUARDED_BY_DESIGN: readonly string[] = [
  `GET ${API_ROUTES.bmadPieces}`,
  // The pinned upstream BMad Method's status and download (story 4.14): one for the install, never a workspace's piece.
  `GET ${API_ROUTES.bmadSource}`,
  `POST ${API_ROUTES.bmadSource}`,
  `GET ${API_ROUTES.newProjectDefaults}`,
  `PATCH ${API_ROUTES.newProjectDefaults}`,
  `GET ${API_ROUTES.workspaceBmadDetection}`,
  `DELETE ${API_ROUTES.workspaceBmadOffer}`,
  `PUT ${API_ROUTES.workspaceBmadScriptTrust}`,
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

/** The routes that serve a piece in the fully wired app (stories 4.1 and 4.2), sorted as `guardedRouteKeys` lists them. */
const PIECE_ROUTES: readonly string[] = [
  `GET ${API_ROUTES.workspaceCatalog}`,
  `POST ${API_ROUTES.workspacePlanningSessions}`,
  `GET ${API_ROUTES.workspaceTickets}`,
  `GET ${API_ROUTES.workspaceTicket}`,
  `PUT ${API_ROUTES.workspaceTicketStatus}`,
  `GET ${API_ROUTES.workspaceBmadSetup}`,
  `POST ${API_ROUTES.workspaceBmadSetup}`,
  // A document a planning session wrote (story 4.7): no trust, it reads one file and runs nothing.
  `GET ${API_ROUTES.workspaceDocument}`,
].sort();

/** The routes that run the project's own scripts, so they check its trust too (story 4.2): every `board` route, never setup. */
const TRUSTED_ROUTES: readonly string[] = [`GET ${API_ROUTES.workspaceTickets}`, `GET ${API_ROUTES.workspaceTicket}`, `PUT ${API_ROUTES.workspaceTicketStatus}`].sort();

const BOARD = `${API_BASE}/workspaces/:wsId/board`;
const CATALOG = `${API_BASE}/bmad/catalog`;
const ok = (c: { json: (body: unknown) => Response }) => c.json({ ok: true });

describe('every route serving a BMad piece is guarded (AD-22, story 10.6)', () => {
  it('the fully wired app, with the probe, has none unguarded, and the probe counts as one and is guarded', () => {
    const app = fullTestApp(openTestCore(), { bmadProbe: true });
    expect(findUnguardedBmadRoutes(app), HOW_TO_FIX).toEqual([]);
    expect(bmadRouteKeys(app)).toEqual(PIECE_ROUTES.concat(`GET ${TEST_ROUTES.bmadProbe}`).sort());
    expect(guardedRouteKeys(app)).toContain(`GET ${TEST_ROUTES.bmadProbe}`);
  });

  it("epic 4's Plan and Board routes (stories 4.1 and 4.2) are registered through bmadPieceRoutes", () => {
    const app = fullTestApp(openTestCore());
    expect(guardedRouteKeys(app)).toEqual(PIECE_ROUTES);
    expect(findUnguardedBmadRoutes(app), HOW_TO_FIX).toEqual([]);
  });

  it('every route that runs tickets.py checks the script trust, and setup does not (story 4.2)', () => {
    const app = fullTestApp(openTestCore(), { bmadProbe: true });
    expect(trustedRouteKeys(app)).toEqual(TRUSTED_ROUTES);
    expect(trustedRouteKeys(app)).not.toContain(`GET ${API_ROUTES.workspaceBmadSetup}`);
    expect(trustedRouteKeys(app)).not.toContain(`POST ${API_ROUTES.workspaceBmadSetup}`);
    expect(trustedRouteKeys(app)).not.toContain(`GET ${API_ROUTES.workspaceDocument}`);
    // The probe serves Planning, which runs no project script.
    expect(trustedRouteKeys(app)).not.toContain(`GET ${TEST_ROUTES.bmadProbe}`);
  });

  it('a board route registered without the script trust fails at registration (story 4.2)', () => {
    const core = openTestCore();
    const app = fullTestApp(core);
    const log = createLogger(() => {});
    expect(() => bmadPieceRoutes(app, { bmad: core.bmad, log }).get('board', BOARD, ok)).toThrow(/script trust/);
    // A route explicitly running no project script needs none.
    bmadPieceRoutes(app, { bmad: core.bmad, log }).get('board', BOARD, ok, { projectScripts: false });
    expect(trustedRouteKeys(app)).toEqual(TRUSTED_ROUTES);
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
    bmadPieceRoutes(app, { bmad: core.bmad, scriptTrust: core.bmadScriptTrust, log: createLogger(() => {}) }).get('board', BOARD, (c) => c.json({ ok: true }));
    expect(bmadRouteKeys(app)).toEqual(PIECE_ROUTES.concat(`GET ${BOARD}`).sort());
    expect(findUnguardedBmadRoutes(app), HOW_TO_FIX).toEqual([]);
  });
});
