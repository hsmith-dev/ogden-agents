/// <reference lib="dom" />
/**
 * Projects in a real browser (story 2.5): a project added through the folder
 * browser and another started as a new folder, the same folder opening the
 * same project, switching between them in the sidebar, and Delete
 * history, refused while a chat works and then deleting only that project's
 * chats. A second tab follows every change from the event stream without a
 * reload. Each test runs its own server with its own home folder, so the
 * folder browser starts somewhere known.
 */
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { launchLink, openConnected, sidebarOf } from './tab.js';

const WORKSPACE_URL = /\/w\/(ws_[0-9A-Z]{26})$/;

/**
 * A server whose home folder (`os.homedir()`, read per call) is a fresh temp
 * folder holding `Documents/alpha-repo`. The server runs in this process, so
 * HOME (USERPROFILE on Windows) is swapped for the test and put back after.
 */
async function withServer(page: Page, body: (server: RunningServer, home: string, dataDir: string) => Promise<void>) {
  const dataDir = makeDataDir();
  const home = realpathSync.native(makeDataDir('ogden-agents-e2e-home-'));
  mkdirSync(join(home, 'Documents', 'alpha-repo'), { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  let server: RunningServer | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    server = await startServer(dataDir);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    await body(server, home, dataDir);
  } finally {
    await server?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    removeDataDir(dataDir);
    removeDataDir(home);
  }
}

/** Opens Add project from the sidebar and waits for the folder browser. */
async function openAddProject(page: Page) {
  await sidebarOf(page).getByTestId('add-project').click();
  const dialog = page.getByTestId('add-project-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Adds `Documents/alpha-repo` through the folder browser; returns its workspace id. */
async function addAlpha(page: Page): Promise<string> {
  const dialog = await openAddProject(page);
  await dialog.getByTestId('folder-quick-picks').getByRole('button', { name: 'Documents' }).click();
  await dialog.getByTestId('folder-list').getByRole('button', { name: 'alpha-repo' }).click();
  await expect(dialog.getByTestId('folder-path')).toHaveText(/alpha-repo$/);
  await dialog.getByRole('button', { name: 'Open this folder' }).click();
  await expect(page).toHaveURL(WORKSPACE_URL);
  await expect(page.getByTestId('workspace-name')).toHaveText('alpha-repo');
  return WORKSPACE_URL.exec(page.url())![1]!;
}

test('Add project opens a folder through the browser, the same folder twice opens the same project, and a new folder becomes one', async ({ page }) => {
  await withServer(page, async (_server, home) => {
    await expect(sidebarOf(page).getByTestId('no-projects')).toBeVisible();
    // The quick picks name the home folder and the Documents in it (there is no Desktop here).
    const dialog = await openAddProject(page);
    const picks = dialog.getByTestId('folder-quick-picks').getByRole('button');
    await expect(picks).toHaveText(['Home', 'Documents']);
    await dialog.getByRole('button', { name: 'Close' }).click();

    const alpha = await addAlpha(page);
    await expect(page.getByRole('heading', { name: 'Chats', level: 1 })).toBeVisible();
    await expect(page.getByTestId('chats-empty')).toContainText('No conversations yet.');
    await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toBeFocused();
    await expect(sidebarOf(page).getByTestId('no-projects')).toHaveCount(0);

    // The same folder again is the same project (AD-2).
    await page.goto(new URL(page.url()).origin + '/');
    expect(await addAlpha(page)).toBe(alpha);

    // Start a new project folder, from the home page, in the home folder.
    await page.goto(new URL(page.url()).origin + '/');
    await page.getByTestId('workspace-empty').getByRole('button', { name: 'Start a new project folder' }).click();
    const create = page.getByTestId('add-project-dialog');
    const name = create.getByLabel('Start a new project folder here');
    await expect(name).toBeFocused();
    await expect(create.getByTestId('folder-path')).toHaveText(home);
    await name.fill('clay-and-kiln');
    await create.getByRole('button', { name: 'Start a new project folder' }).click();
    await expect(page).toHaveURL(WORKSPACE_URL);
    await expect(page.getByTestId('workspace-name')).toHaveText('clay-and-kiln');
    expect(WORKSPACE_URL.exec(page.url())![1]).not.toBe(alpha);
    expect(existsSync(join(home, 'clay-and-kiln'))).toBe(true);

    // A name that is taken is refused in the dialog.
    const again = await openAddProject(page);
    await again.getByTestId('folder-quick-picks').getByRole('button', { name: 'Home' }).click();
    await again.getByLabel('Start a new project folder here').fill('clay-and-kiln');
    await again.getByRole('button', { name: 'Start a new project folder' }).click();
    await expect(again.getByTestId('add-project-error')).toHaveText('A folder with that name already exists.');
  });
});

test('Add project, then New chat: the app opens the new chat with the composer focused', async ({ page }) => {
  await withServer(page, async () => {
    await addAlpha(page);
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toBeFocused();
  });
});

test('the sidebar moves between projects, and Delete history is refused while a chat works, then deletes only that project’s chats', async ({ page, browser }) => {
  await withServer(page, async (server, home, dataDir) => {
    const alpha = await addAlpha(page);
    mkdirSync(join(home, 'beta-repo'));
    const dialog = await openAddProject(page);
    await dialog.getByTestId('folder-list').getByRole('button', { name: 'beta-repo' }).click();
    await dialog.getByRole('button', { name: 'Open this folder' }).click();
    await expect(page.getByTestId('workspace-name')).toHaveText('beta-repo');
    const beta = WORKSPACE_URL.exec(page.url())![1]!;

    // Switch (backlog story 13: no drop-down, the sidebar is the one place): the current project is
    // marked; the other's name opens its Chats list, though it has no chats yet.
    const sidebar = sidebarOf(page);
    await expect(page.getByTestId('workspace-switcher')).toHaveCount(0);
    const names = sidebar.getByTestId('workspace-link');
    await expect(names).toHaveText(['alpha-repo', 'beta-repo']);
    const projectLink = (name: string) => sidebar.getByRole('group', { name }).getByRole('link', { name, exact: true });
    await expect(projectLink('beta-repo')).toHaveAttribute('aria-current', /^(page|true)$/);
    await expect(projectLink('alpha-repo')).not.toHaveAttribute('aria-current');
    await projectLink('alpha-repo').click();
    await expect(page).toHaveURL(new RegExp(`/w/${alpha}$`));
    await expect(projectLink('alpha-repo')).toHaveAttribute('aria-current', /^(page|true)$/);
    await expect(projectLink('beta-repo')).not.toHaveAttribute('aria-current');

    // A second tab on alpha's Chats list follows along without a reload.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      await openConnected(other, `/w/${alpha}`, await launchLink(server.url, dataDir));
      await expect(other.getByTestId('chats-empty')).toBeVisible();

      await page.getByTestId('new-chat').click();
      await expect(page).toHaveURL(new RegExp(`/w/${alpha}/s/ses_[0-9A-Z]{26}$`));
      const sesId = /s\/(ses_[0-9A-Z]{26})$/.exec(page.url())![1]!;
      await expect(other.getByTestId('chat-row')).toHaveCount(1);

      // One chat in beta too, which Delete history on alpha must keep.
      // Keyboard: Tab to the name, Enter opens it.
      await projectLink('beta-repo').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/w/${beta}$`));
      await page.getByTestId('new-chat').click();
      await expect(page).toHaveURL(new RegExp(`/w/${beta}/s/`));

      // Delete history on alpha, while its chat is working: refused, shown in the dialog.
      // The gear beside alpha's name opens its settings, from beta's page.
      await sidebar.getByRole('link', { name: 'alpha-repo settings' }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${alpha}/settings$`));
      await expect(projectLink('alpha-repo')).toHaveAttribute('aria-current', 'true');
      await expect(page.getByRole('heading', { name: 'Workspace settings', level: 1 })).toBeVisible();
      server.core.entities.setSessionState(sesId as never, 'working');
      await page.getByTestId('delete-history').click();
      const confirm = page.getByTestId('delete-history-confirm');
      await expect(confirm).toContainText("Deletes every chat in alpha-repo. This can't be undone.");
      await confirm.getByRole('button', { name: 'Delete history' }).click();
      await expect(confirm.getByRole('alert')).toContainText('still working or waiting');
      await expect(other.getByTestId('chat-row')).toHaveCount(1);

      // Once it is idle, it goes through; the other tab's list empties, beta keeps its chat.
      server.core.entities.setSessionState(sesId as never, 'idle');
      await confirm.getByRole('button', { name: 'Delete history' }).click();
      await expect(confirm).toHaveCount(0);
      await expect(page.getByTestId('history-deleted')).toBeVisible();
      await expect(other.getByTestId('chats-empty')).toBeVisible();
      await page.goto(`${server.url}/w/${beta}`);
      await expect(page.getByTestId('chat-row')).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
});
