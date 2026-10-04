/// <reference lib="dom" />
/**
 * Epic 10's journey against the installed package, in Chromium (story 10.9):
 * BMad Method optional per project, on servers of their own from the same
 * install, started by the installed `ogden` launcher in background mode, each
 * with its own data folder (Welcome done), home folder and the fake agent.
 * Repos are fake repos (`fixtures/fake-bmad-repo.ts`) whose whole file tree
 * is hashed before and after.
 *
 * Test 1, no BMad hook (what a user of this version sees):
 * - What 0.4.0 ships (epic 10 retro A3): Planning and Board can be turned
 *   on and the main switch works; Unattended builds and Retrospectives are
 *   greyed, Coming soon; Settings → New projects' BMad Method can be picked.
 *   Turning Board on asks to trust the project's scripts; Cancel leaves it
 *   off.
 * - A simple project (a plain repo with its own `.claude/skills`): the header
 *   shows Chats only; two chats, each sent `session-start`, start with no MCP
 *   server, no `_meta`, exactly the user's text and nothing "bmad" in their
 *   environment.
 * - The offer on a repo with `_bmad/`: Not now hides it after a reload and
 *   after a server restart.
 * - Quit: no repo changed.
 *
 * Test 2, with `builds` registered as available (its switch can be turned on)
 * and the guarded probe route (`OGDEN_AGENTS_TEST_BMAD_AVAILABLE`,
 * `OGDEN_AGENTS_TEST_BMAD_PROBE`):
 * - Planning on and off in one tab shows in a second browser context; the
 *   probe is refused with 409 `feature_off` while it is off, served once on.
 *   With `requireBmadFeature`'s check removed, this test fails at the first
 *   409.
 * - Settings → New projects → BMad Method, Planning only: the next project
 *   added starts with Planning, an earlier one is unchanged.
 * - Quit: no repo changed.
 *
 * No real agent, account, keychain or network. Each server is quit at the end
 * of its test, and its folders removed.
 */
import { realpathSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  BMAD_COMING_SOON_LABEL,
  BMAD_OFFER_NOT_NOW,
  BMAD_OFFER_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BMAD_USE_LABEL,
  FEATURE_OFF_MESSAGE,
  NEW_PROJECTS_SETTINGS_LABEL,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
} from '../../packages/shared/src/bmad.ts';
import { apiPath, TEST_ROUTES } from '../../packages/shared/src/api.ts';
import { API_ROUTES, launchLink, requestQuit } from '../support.js';
import { send } from '../e2e/chat-server.js';
import { expectConnected, landConnected, sidebarOf, storedToken } from '../e2e/tab.js';
import { bmadServer, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

/** The trust dialog's title (`SCRIPT_TRUST_TITLE`; `planning-setup.ts` has imports this runner can't load). */
const SCRIPT_TRUST_TITLE = "Run this project's BMad Method scripts?";

/** The pieces 0.4.0 ships (`SHIPPED_BMAD_PIECES` in the server; epic 4). */
const SHIPPED: readonly string[] = ['planning', 'board'];

const OWN_SKILL = '.claude/skills/x/SKILL.md';
const OWN_SKILL_TEXT = "---\nname: x\ndescription: The repo's own skill.\n---\n\nDo the thing.\n";

const state = (page: Page) => page.getByTestId('session-state');
const replies = (page: Page) => page.getByTestId('message-agent');
const switchIn = (page: Page, label: string) => page.getByRole('switch', { name: label, exact: true });

/** A request to the server with the tab's own token, as the page makes it. */
async function api(page: Page, method: string, path: string, body?: unknown): Promise<Response> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  return fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Adds the project at `path` through the REST API (no pieces given: the app-wide default applies); its id. */
async function addProject(page: Page, path: string): Promise<string> {
  const response = await api(page, 'POST', API_ROUTES.workspaces, { path });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** A project's BMad pieces, as the server reports them. */
async function piecesOf(page: Page, wsId: string): Promise<string[]> {
  const response = await api(page, 'GET', apiPath(API_ROUTES.workspaceSettings, { wsId }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { settings: { bmadPieces: string[] } }).settings.bmadPieces;
}

/** The guarded probe route's status and body. */
async function probe(page: Page, wsId: string): Promise<{ status: number; body: unknown }> {
  const response = await api(page, 'GET', apiPath(TEST_ROUTES.bmadProbe, { wsId }));
  return { status: response.status, body: await response.json() };
}

/** Opens the project's chats page and waits until its detection has been answered. */
async function openChats(page: Page, origin: string, wsId: string): Promise<void> {
  const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${wsId}/bmad/detection`) && response.request().method() === 'GET');
  await page.goto(`${origin}/w/${wsId}`);
  expect((await detected).status()).toBe(200);
  await expect(page.getByTestId('workspace-name')).toBeVisible();
}

/** The header's project tabs: exactly Chats, marked as the current page. */
async function expectChatsTabOnly(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Project sections' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
}

/** Opens Settings → New projects from the sidebar. */
async function openNewProjects(page: Page) {
  await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: NEW_PROJECTS_SETTINGS_LABEL }).click();
  await expect(page).toHaveURL(/\/settings\/new-projects$/);
}

/** What the fake agent's `session-start` reports (story 10.6). */
interface SessionStart {
  via: string;
  cwd: string;
  mcpServers: unknown;
  meta: unknown;
  prompt: string;
  env: Record<string, string>;
}

/** Sends `session-start` in the open chat and reads the agent's one-line JSON reply. */
async function sessionStart(page: Page): Promise<SessionStart> {
  await send(page, 'session-start');
  await expect(replies(page)).toHaveCount(1);
  await expect(state(page)).toHaveAttribute('data-state', 'idle');
  await expect(replies(page).last()).toHaveAttribute('data-streaming', 'false');
  // The agent's message: its name, then its text.
  const text = await replies(page).last().locator('p').nth(1).textContent();
  return JSON.parse(text ?? '') as SessionStart;
}

/** What a simple project's session must start with: nothing BMad from Ogden. */
function expectSimpleStart(start: SessionStart, cwd: string) {
  expect(start.via).toBe('new');
  expect(start.cwd).toBe(cwd);
  expect(start.mcpServers).toEqual([]);
  expect(start.meta).toBeNull();
  expect(start.prompt).toBe('session-start');
  expect(Object.keys(start.env).length).toBeGreaterThan(0);
  expect(Object.entries(start.env).filter(([name, value]) => /bmad/i.test(name) || /bmad/i.test(value))).toEqual([]);
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('what 0.4.0 ships, Board asking for trust, a simple project, and the offer, on the installed package', async ({ page }) => {
  // Two launches and two chats on a server of its own.
  test.setTimeout(240_000);
  // No hook: what a user of this version sees (Planning and Board shipped, the rest Coming soon).
  const server = bmadServer('journey-simple');
  servers.push(server);
  // No "bmad" in the simple repo's name, so the environment check can't match it by accident.
  const plain = server.addRepo({ bmad: false, files: { [OWN_SKILL]: OWN_SKILL_TEXT }, prefix: 'simple-repo-' });
  const withBmad = server.addRepo({ prefix: 'offered-repo-' });
  const hashes = { plain: plain.hash(), withBmad: withBmad.hash() };

  let launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const plainId = await addProject(page, plain.path);
  const withBmadId = await addProject(page, withBmad.path);

  await test.step('what 0.4.0 ships: Planning and Board can be turned on, the other pieces are Coming soon; New projects too', async () => {
    expect(await piecesOf(page, plainId)).toEqual([]);
    await page.goto(`${launched.url}/w/${plainId}/settings#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`);
    for (const piece of BMAD_PIECES) {
      const control = switchIn(page, BMAD_PIECE_INFO[piece].label);
      await expect(control).toHaveAttribute('aria-checked', 'false');
      if (SHIPPED.includes(piece)) {
        await expect(control).toBeEnabled();
        await expect(page.getByTestId(`bmad-${piece}-coming-soon`)).toHaveCount(0);
      } else {
        await expect(control).toBeDisabled();
        await expect(page.getByTestId(`bmad-${piece}-coming-soon`)).toHaveText(BMAD_COMING_SOON_LABEL);
      }
    }
    await expect(switchIn(page, BMAD_USE_LABEL)).toBeEnabled();
    await expect(page.getByTestId('bmad-use-coming-soon')).toHaveCount(0);

    // Board runs the project's own BMad Method scripts, so turning it on asks first (epic 10 retro A3, story 4.2).
    // Cancel leaves it off; the planning journey allows it on a repo set up from a local fixture.
    const board = switchIn(page, BMAD_PIECE_INFO.board.label);
    await board.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText(SCRIPT_TRUST_TITLE);
    await page.getByTestId('script-trust-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(board).toHaveAttribute('aria-checked', 'false');
    expect(await piecesOf(page, plainId)).toEqual([]);

    await openNewProjects(page);
    const section = page.getByTestId('new-projects-section');
    await expect(section.getByRole('radio', { name: 'Simple chats' })).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByRole('radio', { name: 'BMad Method' })).toBeEnabled();
    await expect(page.getByTestId('new-projects-bmad-coming-soon')).toHaveCount(0);
  });

  await test.step('a simple project: Chats only, and two chats start with nothing BMad', async () => {
    const cwd = realpathSync.native(plain.path);
    await openChats(page, launched.url, plainId);
    await expect(page.getByTestId('bmad-offer')).toHaveCount(0);
    await expectChatsTabOnly(page);

    // The first chat, from the empty chats page.
    const first = await sessionStart(page);
    await expect(page).toHaveURL(new RegExp(`/w/${plainId}/s/ses_`));
    await expectChatsTabOnly(page);
    expectSimpleStart(first, cwd);

    // The second, from the chats list.
    await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Chats' }).click();
    await expect(page.getByTestId('chat-list')).toBeVisible();
    await expectChatsTabOnly(page);
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(new RegExp(`/w/${plainId}/s/ses_`));
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expectChatsTabOnly(page);
    const second = await sessionStart(page);
    expectSimpleStart(second, cwd);
    expect(await piecesOf(page, plainId)).toEqual([]);
  });

  await test.step('the offer on a repo with _bmad/: Not now hides it after a reload and a restart', async () => {
    const offer = page.getByTestId('bmad-offer');
    await openChats(page, launched.url, withBmadId);
    await expect(offer).toContainText(BMAD_OFFER_TEXT);
    const answered = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${withBmadId}/bmad/offer`) && response.request().method() === 'DELETE');
    await offer.getByRole('button', { name: BMAD_OFFER_NOT_NOW }).click();
    await expect(offer).toHaveCount(0);
    expect((await answered).status()).toBe(204);

    const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${withBmadId}/bmad/detection`));
    await page.reload();
    expect((await detected).status()).toBe(200);
    await expect(page.getByTestId('workspace-name')).toBeVisible();
    await expect(offer).toHaveCount(0);

    await quit(page, launched);
    const before = launched.pid;
    launched = await server.restart();
    expect(launched.pid).not.toBe(before);
    await landConnected(page, launched.launchUrl);
    await openChats(page, launched.url, withBmadId);
    await expect(offer).toHaveCount(0);
  });

  await test.step('quit: no repo changed', async () => {
    await quit(page, launched);
    expect({ plain: plain.hash(), withBmad: withBmad.hash() }).toEqual(hashes);
  });
});

test('a piece on and off with a second tab following, the guard, and the default for new projects, on the installed package', async ({ page, browser }) => {
  test.setTimeout(180_000);
  // Unattended builds registered as available (0.4.0 ships Planning and Board; the hook adds a piece no release
  // ships yet), and the route guarded by Planning.
  const server = bmadServer('journey-pieces', { available: ['builds'], probe: true });
  servers.push(server);
  const earlier = server.addRepo({ prefix: 'earlier-repo-' });
  const later = server.addRepo({ bmad: false, prefix: 'later-repo-' });
  const hashes = { earlier: earlier.hash(), later: later.hash() };

  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const earlierId = await addProject(page, earlier.path);

  await test.step('Planning on and off in one tab shows in another; the guarded route follows it', async () => {
    expect(await piecesOf(page, earlierId)).toEqual([]);
    // Off: refused by core's guard. With the guard removed, the suite fails here.
    expect(await probe(page, earlierId)).toMatchObject({ status: 409, body: { error: { code: 'feature_off', message: FEATURE_OFF_MESSAGE } } });

    const settings = `/w/${earlierId}/settings`;
    await page.goto(`${launched.url}${settings}`);
    const planning = switchIn(page, BMAD_PIECE_INFO.planning.label);
    await expect(planning).toHaveAttribute('aria-checked', 'false');
    await expect(planning).toBeEnabled();
    // Registered by the hook: Unattended builds can be turned on. Not registered: Retrospectives is still Coming soon.
    await expect(switchIn(page, BMAD_PIECE_INFO.builds.label)).toBeEnabled();
    await expect(page.getByTestId('bmad-builds-coming-soon')).toHaveCount(0);
    await expect(switchIn(page, BMAD_PIECE_INFO.retrospectives.label)).toBeDisabled();

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      await landConnected(other, await launchLink(launched.url, server.install.dataDir));
      await other.goto(`${launched.url}${settings}`);
      const otherPlanning = switchIn(other, BMAD_PIECE_INFO.planning.label);
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'false');

      await planning.click();
      await expect(planning).toHaveAttribute('aria-checked', 'true');
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'true');
      expect(await piecesOf(page, earlierId)).toEqual(['planning']);
      expect(await probe(page, earlierId)).toEqual({ status: 200, body: { piece: 'planning' } });

      await planning.click();
      await expect(planning).toHaveAttribute('aria-checked', 'false');
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'false');
      expect(await piecesOf(page, earlierId)).toEqual([]);
      expect(await probe(page, earlierId)).toMatchObject({ status: 409, body: { error: { code: 'feature_off' } } });
    } finally {
      await context.close();
    }
  });

  await test.step('New projects → BMad Method, Planning only: the next project starts with Planning, the earlier one unchanged', async () => {
    await openNewProjects(page);
    const section = page.getByTestId('new-projects-section');
    await expect(section.getByRole('radio', { name: 'Simple chats' })).toHaveAttribute('aria-checked', 'true');
    await section.getByRole('radio', { name: 'BMad Method' }).click();
    await expect(section.getByRole('checkbox', { name: 'Planning' })).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByRole('checkbox', { name: 'Board' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('new-projects-status')).toContainText('Saved.');
    await section.getByRole('checkbox', { name: 'Board' }).click();
    await expect(section.getByRole('checkbox', { name: 'Board' })).toHaveAttribute('aria-checked', 'false');
    await expect
      .poll(async () => ((await (await api(page, 'GET', API_ROUTES.newProjectDefaults)).json()) as { defaults: unknown }).defaults)
      .toEqual({ bmadPieces: ['planning'] });

    const laterId = await addProject(page, later.path);
    expect(await piecesOf(page, laterId)).toEqual(['planning']);
    expect(await piecesOf(page, earlierId)).toEqual([]);
  });

  await test.step('quit: no repo changed', async () => {
    await quit(page, launched);
    expect({ earlier: earlier.hash(), later: later.hash() }).toEqual(hashes);
  });
});
