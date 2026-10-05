import { BMAD_COMING_SOON_REASON, BMAD_PIECES, type BmadPiece, type BmadPieceAvailability } from '@ogden-agents/shared';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { visibleWorkspaceTabs, WORKSPACE_TAB_SLOTS, WorkspaceTabsView, type WorkspaceTabId, type WorkspaceTabSlot } from '../src/shell/workspace-tabs';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const availability = (...available: BmadPiece[]): BmadPieceAvailability[] =>
  BMAD_PIECES.map((piece) => (available.includes(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON }));

/** The slots as story 4.1 fills them: Plan and Board have their pages. */
const PLAN_FILLED: readonly WorkspaceTabSlot[] = WORKSPACE_TAB_SLOTS;

/** The slots before story 4.1: only Chats has a page. */
const UNFILLED: readonly WorkspaceTabSlot[] = WORKSPACE_TAB_SLOTS.map((slot) => (slot.piece === undefined ? slot : { id: slot.id, label: slot.label, key: slot.key, piece: slot.piece }));

const ids = (pieces: readonly BmadPiece[] | undefined, available: BmadPieceAvailability[] | undefined, slots = WORKSPACE_TAB_SLOTS) =>
  visibleWorkspaceTabs(pieces, available, slots).map((tab) => tab.id);

/** Renders `node` inside a router at `path` that knows the chats and session routes, so the links get their hrefs. */
async function renderAt(path: string, node: ReactNode): Promise<string> {
  const root = createRootRoute({ component: () => <>{node}</> });
  const chats = createRoute({ getParentRoute: () => root, path: '/w/$wsId' });
  const session = createRoute({ getParentRoute: () => root, path: '/w/$wsId/s/$sesId' });
  const plan = createRoute({ getParentRoute: () => root, path: '/w/$wsId/plan' });
  const board = createRoute({ getParentRoute: () => root, path: '/w/$wsId/board' });
  const router = createRouter({ routeTree: root.addChildren([chats, session, plan, board]), history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

const render = (path: string, pieces: readonly BmadPiece[] | undefined, available: BmadPieceAvailability[] | undefined, slots = WORKSPACE_TAB_SLOTS, active: WorkspaceTabId = 'chats') =>
  renderAt(path, <WorkspaceTabsView wsId={WS} tabs={visibleWorkspaceTabs(pieces, available, slots)} active={active} />);

const tabLabels = (html: string) => [...html.matchAll(/data-testid="workspace-tab-([a-z]+)"/g)].map((match) => match[1]);

describe('workspace tabs (E10-R6, story 10.6)', () => {
  it('has the slots Chats, Plan, Board, Runs in order; Chats, Plan and Board have pages (story 4.1)', () => {
    expect(WORKSPACE_TAB_SLOTS.map((slot) => [slot.id, slot.piece])).toEqual([
      ['chats', undefined],
      ['plan', 'planning'],
      ['board', 'board'],
      ['runs', 'builds'],
    ]);
    // Story 4.6: g c, g p, g b, g r.
    expect(WORKSPACE_TAB_SLOTS.map((slot) => slot.key)).toEqual(['c', 'p', 'b', 'r']);
    expect(WORKSPACE_TAB_SLOTS.filter((slot) => slot.to !== undefined).map((slot) => [slot.id, slot.to])).toEqual([
      ['chats', '/w/$wsId'],
      ['plan', '/w/$wsId/plan'],
      ['board', '/w/$wsId/board'],
    ]);
  });

  it('a simple project (no pieces) shows Chats only, current, on the chats and session pages', async () => {
    expect(ids([], availability())).toEqual(['chats']);
    for (const path of [`/w/${WS}`, `/w/${WS}/s/ses_1`]) {
      const html = await render(path, [], availability());
      expect(html).toContain('<nav aria-label="Project sections"');
      expect(tabLabels(html)).toEqual(['chats']);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/w/${WS}"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="/w/${WS}"`));
      expect(html).toContain('>Chats</a>');
    }
  });

  it('a piece on and available, with its slot unfilled, still shows Chats only', async () => {
    expect(ids(['planning', 'board'], availability('planning', 'board'), UNFILLED)).toEqual(['chats']);
    expect(tabLabels(await render(`/w/${WS}`, ['planning'], availability('planning'), UNFILLED))).toEqual(['chats']);
  });

  it('Planning off but Board on shows Chats and Board only (story 4.1)', async () => {
    expect(ids(['board'], availability('planning', 'board'))).toEqual(['chats', 'board']);
    expect(ids(['planning', 'board'], availability('planning', 'board'))).toEqual(['chats', 'plan', 'board']);
    expect(ids(['planning', 'board'], availability('board'))).toEqual(['chats', 'board']);
    const html = await render(`/w/${WS}/board`, ['board'], availability('planning', 'board'), WORKSPACE_TAB_SLOTS, 'board');
    expect(tabLabels(html)).toEqual(['chats', 'board']);
    expect(html).toContain(`href="/w/${WS}/board"`);
  });

  it('a filled slot shows when its piece is on and available, and not otherwise', async () => {
    expect(ids(['planning'], availability('planning'), PLAN_FILLED)).toEqual(['chats', 'plan']);
    expect(ids([], availability('planning'), PLAN_FILLED)).toEqual(['chats']);
    expect(ids(['planning'], availability(), PLAN_FILLED)).toEqual(['chats']);
    const html = await render(`/w/${WS}`, ['planning'], availability('planning'), PLAN_FILLED);
    expect(tabLabels(html)).toEqual(['chats', 'plan']);
    expect(html).toContain(`href="/w/${WS}/plan"`);
    // Only the active tab is current, even where the router would match Chats too.
    const onPlan = await render(`/w/${WS}/plan`, ['planning'], availability('planning'), PLAN_FILLED, 'plan');
    expect(onPlan.match(/aria-current="page"/g)).toHaveLength(1);
    expect(onPlan).toMatch(/aria-current="page"[^>]*data-testid="workspace-tab-plan"|data-testid="workspace-tab-plan"[^>]*aria-current="page"/);
  });

  it('while settings or the available pieces load or fail, shows Chats only', async () => {
    for (const [pieces, available] of [
      [undefined, availability('planning')],
      [['planning'], undefined],
      [undefined, undefined],
    ] as const) {
      expect(ids(pieces, available, PLAN_FILLED)).toEqual(['chats']);
      expect(tabLabels(await render(`/w/${WS}`, pieces, available, PLAN_FILLED))).toEqual(['chats']);
    }
  });
});
