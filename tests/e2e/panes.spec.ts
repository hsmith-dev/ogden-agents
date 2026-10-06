/// <reference lib="dom" />
/**
 * Terminal panes in a real browser (epic 16, story 16.2): with Developer mode
 * on, a project's Terminals page opens a pane running the fake shell
 * (`tests/fixtures/fake-pane-shell.mjs`, the `paneShell` start option) in the
 * server's real terminal, shown with xterm under the unchanged
 * Content-Security-Policy. No test runs the user's shell or a CLI. Skipped
 * only where node-pty can't load (never on CI).
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, ROOT } from '../support.js';
import { APPEARANCE_KEY, ptyLoads, setDeveloperMode, withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const FAKE_SHELL = join(ROOT, 'tests', 'fixtures', 'fake-pane-shell.mjs');
/** What zod's check for `eval` (made on every page, and caught) reports under `script-src 'self'`. */
const ZOD_EVAL_PROBE = 'script-src eval';

async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __violations: string[] }).__violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? []);
}

/** Opens the project at `repo` through the REST API, with the connected tab's own token. */
async function openProject(page: Page, repo: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo }),
  });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** An absolute URL on the page's own server. */
const at = (page: Page, path: string) => new URL(path, page.url()).href;

const setBrowserDeveloperMode = (page: Page, on: boolean) =>
  page.evaluate(({ key, on }) => localStorage.setItem(key, JSON.stringify({ theme: 'system', density: 'comfortable', developerMode: on })), { key: APPEARANCE_KEY, on });

test('Terminals is a Developer mode surface: hidden without it, and a pane opens, takes typing, survives a reload and closes with it', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  const violations = await recordViolations(page);
  await withChatServer(
    page,
    async ({ repo }) => {
      const wsId = await openProject(page, repo);
      // Simple by default (AD-21): no Terminals tab, and the page says why it is empty.
      await page.goto(at(page, `/w/${wsId}`));
      await expect(page.getByTestId('workspace-tab-chats')).toBeVisible();
      await expect(page.getByTestId('workspace-tab-terminals')).toHaveCount(0);
      await page.goto(at(page, `/w/${wsId}/terminals`));
      await expect(page.getByTestId('terminals-developer-mode')).toContainText('Developer mode');
      await expect(page.getByTestId('terminals-new')).toHaveCount(0);

      // Developer mode is the server's; the browser's copy only paints first.
      await setBrowserDeveloperMode(page, true);
      await setDeveloperMode(page, true);
      await page.goto(at(page, `/w/${wsId}`));
      await page.getByTestId('workspace-tab-terminals').click();
      await expect(page).toHaveURL(new RegExp(`/w/${wsId}/terminals$`));
      await expect(page.getByTestId('terminals-empty')).toBeVisible();

      await page.getByTestId('terminals-new').click();
      const terminal = page.getByTestId('pane-terminal');
      await expect(terminal).toHaveAttribute('data-link', 'connected');
      await expect(page.getByTestId('pane-title')).toHaveText('Terminal 1');
      await expect(terminal.locator('.xterm-rows')).toContainText('fake-shell-ready');
      // Focus went into the terminal; typing reaches the program and its answer shows.
      await expect(terminal.locator('textarea')).toBeFocused();
      await page.keyboard.type('echo e2e-pane');
      await page.keyboard.press('Enter');
      await expect(terminal.locator('.xterm-rows')).toContainText('echo:echo e2e-pane');
      // Starting is over: no status line.
      await expect(page.getByTestId('pane')).toHaveAttribute('data-state', 'running');

      // A reload comes back to the same pane with its screen replayed from the server's mirror.
      await page.reload();
      await expect(page.getByTestId('pane-terminal')).toHaveAttribute('data-link', 'connected');
      await expect(page.getByTestId('pane-terminal').locator('.xterm-rows')).toContainText('echo:echo e2e-pane');

      // Closing it stops it, and the page says there is none.
      await page.getByTestId('pane-close').click();
      await expect(page.getByTestId('pane')).toHaveCount(0);
      await expect(page.getByTestId('terminals-empty')).toBeVisible();

      expect((await violations()).filter((v) => !v.startsWith(ZOD_EVAL_PROBE))).toEqual([]);
    },
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] } } },
  );
});

test('a program that ends shows it, and Restart starts it again in the same pane', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  await withChatServer(
    page,
    async ({ repo }) => {
      const wsId = await openProject(page, repo);
      await setBrowserDeveloperMode(page, true);
      await setDeveloperMode(page, true);
      await page.goto(at(page, `/w/${wsId}/terminals`));
      await page.getByTestId('terminals-new').click();
      const terminal = page.getByTestId('pane-terminal');
      await expect(terminal.locator('.xterm-rows')).toContainText('fake-shell-ready');
      await page.keyboard.type('exit 2');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('pane-status')).toHaveText('The program in this terminal ended with code 2.');
      await page.getByTestId('pane-restart').click();
      await expect(page.getByTestId('pane')).toHaveAttribute('data-state', 'running');
      await expect(terminal.locator('.xterm-rows')).toContainText('fake-shell-ready');
      await expect(page.getByTestId('pane-title')).toHaveText('Terminal 1');
    },
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] } } },
  );
});

test('with Developer mode turned off the server refuses a pane request, whatever the page shows', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const wsId = await openProject(page, repo);
    const origin = new URL(page.url()).origin;
    const token = await storedToken(page);
    const response = await fetch(`${origin}${apiPath(API_ROUTES.workspacePanes, { wsId })}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('developer_mode_required');
  });
});

test('a project gets tabs and splits: split a terminal, move the divider and focus by keyboard, add a tab, rename it, and the layout survives a reload', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  await withChatServer(
    page,
    async ({ repo }) => {
      const wsId = await openProject(page, repo);
      await setBrowserDeveloperMode(page, true);
      await setDeveloperMode(page, true);
      await page.goto(at(page, `/w/${wsId}/terminals`));
      await page.getByTestId('terminals-new').click();
      await expect(page.getByTestId('pane')).toHaveCount(1);
      await expect(page.getByTestId('pane-terminal').locator('.xterm-rows')).toContainText('fake-shell-ready');

      // Split beside: two panes in one tab, with a divider between them.
      await page.getByTestId('pane-split-row').click();
      await expect(page.getByTestId('pane')).toHaveCount(2);
      await expect(page.getByTestId('layout-divider')).toHaveCount(1);
      await expect(page.getByTestId('terminal-tab')).toHaveCount(1);
      const panes = page.getByTestId('pane');
      const first = await panes.nth(0).boundingBox();
      const second = await panes.nth(1).boundingBox();
      expect(first !== null && second !== null && first.x + first.width <= second.x + 1).toBe(true);

      // The divider moves with the arrow keys, 5 percent each.
      const divider = page.getByTestId('layout-divider');
      await divider.focus();
      await divider.press('ArrowRight');
      await expect(divider).toHaveAttribute('aria-valuenow', '55');

      // Focus moves between panes with Alt+Shift+Arrow, and the arrow never reaches the program.
      await expect(panes.nth(1).locator('.xterm-rows')).toContainText('fake-shell-ready');
      await panes.nth(0).locator('textarea').focus();
      await page.keyboard.press('Alt+Shift+ArrowRight');
      await expect(panes.nth(1).locator('textarea')).toBeFocused();
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await expect(panes.nth(0).locator('textarea')).toBeFocused();

      // A new terminal is a tab of its own, which can be renamed.
      await page.getByTestId('terminals-new').click();
      await expect(page.getByTestId('terminal-tab')).toHaveCount(2);
      await expect(page.getByTestId('pane')).toHaveCount(1);
      await page.getByTestId('terminal-tab').nth(1).dblclick();
      await page.getByTestId('tab-title-input').fill('Servers');
      await page.getByTestId('tab-title-input').press('Enter');
      await expect(page.getByTestId('terminal-tab').nth(1)).toHaveText('Servers');

      // Reload: the same tabs and split come back (replayed from the server).
      await page.reload();
      await expect(page.getByTestId('terminal-tab')).toHaveText(['Terminal 1', 'Servers']);
      await page.getByTestId('terminal-tab').nth(0).click();
      await expect(page.getByTestId('pane')).toHaveCount(2);
      await expect(page.getByTestId('layout-divider')).toHaveAttribute('aria-valuenow', '55');

      // Closing a pane gives its space to the other.
      await page.getByTestId('pane-close').first().click();
      await expect(page.getByTestId('pane')).toHaveCount(1);
      await expect(page.getByTestId('layout-divider')).toHaveCount(0);
    },
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] } } },
  );
});
