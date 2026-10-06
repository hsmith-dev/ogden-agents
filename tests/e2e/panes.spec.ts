/// <reference lib="dom" />
/**
 * Terminal panes in a real browser (epic 16, story 16.2): with Developer mode
 * on, a project's Terminals page opens a pane running the fake shell
 * (`tests/fixtures/fake-pane-shell.mjs`, the `paneShell` start option) in the
 * server's real terminal, shown with xterm under the unchanged
 * Content-Security-Policy. No test runs the user's shell or a CLI. Skipped
 * only where node-pty can't load (never on CI).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, ROOT, startServer } from '../support.js';
import { APPEARANCE_KEY, ptyLoads, setDeveloperMode, withChatServer } from './chat-server.js';
import { addFakeCli, makeFakeCliFolder } from '../fixtures/fake-cli-folder.js';
import { openConnected, storedToken } from './tab.js';

const FAKE_SHELL = join(ROOT, 'tests', 'fixtures', 'fake-pane-shell.mjs');
/** Programs detection finds: none. A test that is not about detection never looks at the real computer, so it never runs a real CLI. */
const NO_PROGRAMS = {
  list: async () => [],
  detect: async () => [],
  get: () => undefined,
  command: async () => ({ ok: false as const, code: 'unknown_launcher' as const, reason: 'No programs in this test.' }),
};
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
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] }, paneLaunchers: NO_PROGRAMS } },
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
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] }, paneLaunchers: NO_PROGRAMS } },
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
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] }, paneLaunchers: NO_PROGRAMS } },
  );
});

test('programs: detection shows found and not found with the install page, Detect looks again, and a found program starts in a pane with its typed arguments', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  // Detection sees only a folder of fake programs (a test hook that needs a test run and a temp data folder).
  const folder = makeFakeCliFolder(['claude', 'copilot']);
  const before = { path: process.env.OGDEN_AGENTS_TEST_PANE_PATH, env: process.env.NODE_ENV };
  process.env.OGDEN_AGENTS_TEST_PANE_PATH = folder;
  process.env.NODE_ENV = 'test';
  try {
    await withChatServer(
      page,
      async ({ repo }) => {
        const wsId = await openProject(page, repo);
        await setBrowserDeveloperMode(page, true);
        await setDeveloperMode(page, true);
        await page.goto(at(page, `/w/${wsId}/terminals`));
        await page.getByTestId('launchers').locator('summary').click();
        const row = (id: string) => page.locator(`[data-testid="launcher"][data-launcher="${id}"]`);
        await expect(row('claude-code')).toHaveAttribute('data-state', 'found');
        await expect(row('copilot')).toContainText('own interactive use only');
        await expect(row('codex')).toHaveAttribute('data-state', 'not_found');
        await expect(row('codex')).toContainText('Install it yourself, then press Detect.');
        await expect(row('codex').getByTestId('launcher-install-link')).toHaveAttribute('href', 'https://github.com/openai/codex');
        // Gemini is offered only when installed.
        await expect(row('gemini')).toHaveCount(0);

        // The user installs it themselves; Detect finds it.
        addFakeCli(folder, 'codex');
        await expect(row('codex')).toHaveAttribute('data-state', 'not_found');
        await page.getByTestId('launchers-detect').click();
        await expect(row('codex')).toHaveAttribute('data-state', 'found');

        // Start it with the arguments typed in its own field.
        await row('codex').getByTestId('launcher-args').fill('--model big');
        await row('codex').getByTestId('launcher-start').click();
        await expect(page.getByTestId('pane-title')).toHaveText('Codex 1');
        const terminal = page.getByTestId('pane-terminal');
        await expect(terminal.locator('.xterm-rows')).toContainText('fake-shell-ready');
        await page.keyboard.type('args');
        await page.keyboard.press('Enter');
        await expect(terminal.locator('.xterm-rows')).toContainText('args=["--model","big"]');

        // Status is a guess: quiet reads idle, a permission style question reads needs attention, and it shows in Needs you and the tab title.
        const chip = page.getByTestId('pane-status-chip');
        await expect(chip).toHaveText('Idle');
        await page.keyboard.type('perm');
        await page.keyboard.press('Enter');
        await expect(chip).toHaveText('Needs attention');
        await expect(page.getByTestId('terminal-tab').first()).toContainText('Needs attention');
        await expect(page.getByTestId('needs-you-item')).toContainText('Codex 1 may need you');
        await expect(page).toHaveTitle(/^\(1\)/);
        // Answering it makes it working, then idle again; the row goes.
        await page.keyboard.type('y');
        await page.keyboard.press('Enter');
        await expect(chip).toHaveText('Idle');
        await expect(page.getByTestId('needs-you-item')).toHaveCount(0);
      },
    );
  } finally {
    if (before.path === undefined) delete process.env.OGDEN_AGENTS_TEST_PANE_PATH;
    else process.env.OGDEN_AGENTS_TEST_PANE_PATH = before.path;
    if (before.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before.env;
  }
});

test('Terminals settings: hide the surface, and turning Developer mode off with a terminal running asks, then keeps or stops it', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  await withChatServer(
    page,
    async ({ repo }) => {
      const wsId = await openProject(page, repo);
      await setBrowserDeveloperMode(page, true);
      await setDeveloperMode(page, true);
      await page.goto(at(page, `/w/${wsId}/terminals`));
      await page.getByTestId('terminals-new').click();
      await expect(page.getByTestId('pane-terminal').locator('.xterm-rows')).toContainText('fake-shell-ready');

      // Settings, Terminals: the limits, the opt ins off, and hiding takes the tab away.
      await page.goto(at(page, '/settings/terminals'));
      await expect(page.getByTestId('terminals-limits')).toHaveText('A project can have 8 terminals open at once, and Ogden Agents 16.');
      await expect(page.getByTestId('terminals-proxies')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('terminals-ssh')).toHaveAttribute('aria-checked', 'false');
      await page.getByTestId('terminals-hidden').click();
      await page.goto(at(page, `/w/${wsId}`));
      await expect(page.getByTestId('workspace-tab-terminals')).toHaveCount(0);
      await page.goto(at(page, '/settings/terminals'));
      await page.getByTestId('terminals-hidden').click();
      await page.goto(at(page, `/w/${wsId}`));
      await expect(page.getByTestId('workspace-tab-terminals')).toBeVisible();

      // Developer mode off with the terminal running: the page asks; Keep leaves it, and it is there again when Developer mode is back on.
      await page.goto(at(page, '/settings/appearance'));
      await page.getByTestId('developer-mode').click();
      await expect(page.getByTestId('terminals-running-dialog')).toContainText('A terminal is still running');
      await page.getByTestId('terminals-keep').click();
      await expect(page.getByTestId('developer-mode')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('workspace-tab-terminals')).toHaveCount(0);
      await page.getByTestId('developer-mode').click();
      await expect(page.getByTestId('developer-mode')).toHaveAttribute('aria-checked', 'true');
      await page.goto(at(page, `/w/${wsId}/terminals`));
      await expect(page.getByTestId('pane')).toHaveCount(1);
      await expect(page.getByTestId('pane-terminal').locator('.xterm-rows')).toContainText('fake-shell-ready');
    },
    { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] }, paneLaunchers: NO_PROGRAMS } },
  );
});

/** Every file under `dir`, read as bytes (the database and its write ahead log included). */
function filesUnder(dir: string): Buffer[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return statSync(path).isFile() ? [readFileSync(path)] : [];
  });
}

test('the layout, names and opt in survive a server restart as stopped terminals that Start again; nothing a terminal printed or was typed is stored, and no server secret reaches it', async ({ page }) => {
  test.skip(!process.env.CI && !(await ptyLoads()), 'node-pty cannot load on this computer');
  const SECRET_VALUE = 'sk-e2e-planted-secret-4417';
  const TYPED = 'typed-marker-7731';
  const before = process.env.OGDEN_E2E_PLANTED_API_KEY;
  process.env.OGDEN_E2E_PLANTED_API_KEY = SECRET_VALUE;
  try {
    await withChatServer(
      page,
      async ({ server, dataDir, repo }) => {
        const wsId = await openProject(page, repo);
        await setBrowserDeveloperMode(page, true);
        await setDeveloperMode(page, true);
        await page.goto(at(page, `/w/${wsId}/terminals`));
        await page.getByTestId('terminals-new').click();
        await expect(page.getByTestId('pane-terminal').locator('.xterm-rows')).toContainText('fake-shell-ready');
        await page.getByTestId('pane-split-row').click();
        await expect(page.getByTestId('pane')).toHaveCount(2);
        await expect(page.getByTestId('pane').nth(1).locator('.xterm-rows')).toContainText('fake-shell-ready');
        // The second pane gets a name and the opt in; the first prints what is typed, and lists its secrets (none).
        await page.getByTestId('pane-title').nth(1).click();
        await page.getByTestId('pane-title-input').fill('Build watcher');
        await page.keyboard.press('Enter');
        await page.getByTestId('pane-notify').nth(1).click();
        await expect(page.getByTestId('pane-notify').nth(1)).toBeChecked();
        await expect(page.getByTestId('pane-title').nth(1)).toHaveText('Build watcher');
        await page.getByTestId('pane').nth(0).locator('textarea').focus();
        await page.keyboard.type(`echo ${TYPED}`);
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('pane').nth(0).locator('.xterm-rows')).toContainText(`echo:echo ${TYPED}`);
        await page.keyboard.type('secret');
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('pane').nth(0).locator('.xterm-rows')).toContainText('secret-done');
        await expect(page.getByTestId('pane').nth(0).locator('.xterm-rows')).not.toContainText('secret=');

        // Stop the server (the programs end with it) and look at everything it kept.
        await server.close();
        const everything = filesUnder(dataDir);
        for (const needle of [TYPED, `echo:echo ${TYPED}`, 'fake-shell-ready', SECRET_VALUE]) {
          expect(everything.some((bytes) => bytes.includes(needle)), `${needle} is not stored`).toBe(false);
        }

        // The next run restores both panes, stopped, in the same split, with the name and the opt in kept.
        const next = await startServer(dataDir, 0, { paneShell: { file: process.execPath, args: [FAKE_SHELL] }, paneLaunchers: NO_PROGRAMS });
        try {
          await openConnected(page, '/', next.launchUrl);
          await page.goto(at(page, `/w/${wsId}/terminals`));
          await expect(page.getByTestId('pane')).toHaveCount(2);
          await expect(page.getByTestId('layout-divider')).toHaveCount(1);
          await expect(page.getByTestId('pane').nth(1)).toContainText('Build watcher');
          await expect(page.getByTestId('pane-notify').nth(1)).toBeChecked();
          await expect(page.getByTestId('pane-notify').nth(0)).not.toBeChecked();
          await expect(page.getByTestId('pane-status-chip').first()).toHaveText('Stopped');
          await page.getByTestId('pane-restart').first().click();
          await expect(page.getByTestId('pane').first()).toHaveAttribute('data-state', 'running');
          await expect(page.getByTestId('pane').first().locator('.xterm-rows')).toContainText('fake-shell-ready');
          // The second one stays stopped until it is started.
          await expect(page.getByTestId('pane').nth(1)).toHaveAttribute('data-state', 'stopped');
        } finally {
          await next.close();
        }
      },
      { extra: { paneShell: { file: process.execPath, args: [FAKE_SHELL] }, paneLaunchers: NO_PROGRAMS } },
    );
  } finally {
    if (before === undefined) delete process.env.OGDEN_E2E_PLANTED_API_KEY;
    else process.env.OGDEN_E2E_PLANTED_API_KEY = before;
  }
});
