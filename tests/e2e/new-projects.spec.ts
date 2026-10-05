/// <reference lib="dom" />
/**
 * The app-wide default for new projects in a real browser (story 10.4;
 * CAP-19, AD-22): with no preferences file a project added from the dialog
 * starts Simple and nothing is written in its folder; choosing BMad Method
 * with Planning in Settings → New projects makes the next project start with
 * Planning, and an earlier project is unchanged. Planning and Board are
 * registered as shipped for this test (no real piece ships until epic 4).
 * The home folder is a temp folder, so the folder browser starts somewhere
 * known.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { NEW_PROJECTS_SETTINGS_LABEL, type BmadPiece } from '../../packages/shared/src/bmad.ts';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer } from '../support.js';
import { openConnected, sidebarOf } from './tab.js';

const WORKSPACE_URL = /\/w\/(ws_[0-9A-Z]{26})$/;
const AVAILABLE: readonly BmadPiece[] = ['planning', 'board'];

async function withServer(page: Page, body: (server: RunningServer, home: string, dataDir: string) => Promise<void>) {
  const dataDir = makeDataDir();
  const home = realpathSync.native(makeDataDir('ogden-agents-e2e-home-'));
  for (const name of ['alpha-repo', 'beta-repo']) mkdirSync(join(home, 'Documents', name), { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  let server: RunningServer | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    server = await startServer(dataDir, 0, { availableBmadPieces: AVAILABLE });
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

/** A project's pieces, as core has them. */
const piecesOf = (server: RunningServer, wsId: string) => server.core.bmad.pieces(wsId as Parameters<RunningServer['core']['bmad']['pieces']>[0]);

/** Adds `Documents/<name>` through the sidebar's folder browser; returns its workspace id. */
async function addFromDialog(page: Page, name: string): Promise<string> {
  await sidebarOf(page).getByTestId('add-project').click();
  const dialog = page.getByTestId('add-project-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('folder-quick-picks').getByRole('button', { name: 'Documents' }).click();
  await dialog.getByTestId('folder-list').getByRole('button', { name }).click();
  await expect(dialog.getByTestId('folder-path')).toHaveText(new RegExp(`${name}$`));
  await dialog.getByRole('button', { name: 'Open this folder' }).click();
  await expect(page).toHaveURL(WORKSPACE_URL);
  return WORKSPACE_URL.exec(page.url())![1]!;
}

test('a project added from the dialog starts Simple; with BMad Method and Planning as the default, the next one starts with Planning', async ({ page }) => {
  await withServer(page, async (server, home, dataDir) => {
    const alpha = await addFromDialog(page, 'alpha-repo');
    expect(piecesOf(server, alpha)).toEqual([]);
    expect(readdirSync(join(home, 'Documents', 'alpha-repo'))).toEqual([]);
    expect(existsSync(join(dataDir, 'preferences.json'))).toBe(false);

    await sidebarOf(page).getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: NEW_PROJECTS_SETTINGS_LABEL }).click();
    await expect(page).toHaveURL(/\/settings\/new-projects$/);
    const section = page.getByTestId('new-projects-section');
    await expect(section.getByRole('radio', { name: 'Simple chats' })).toHaveAttribute('aria-checked', 'true');

    // BMad Method preselects Planning and Board (both shipped here); keep only Planning.
    await section.getByRole('radio', { name: 'BMad Method' }).click();
    await expect(section.getByRole('checkbox', { name: 'Planning' })).toHaveAttribute('aria-checked', 'true');
    await expect(section.getByRole('checkbox', { name: 'Board' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('new-projects-status')).toContainText('Saved.');
    // Checked once the save settled (every box is disabled while one is in flight): Unattended builds ships (story 5.2) but isn't preselected; Retrospectives is still coming soon.
    await expect(section.getByRole('checkbox', { name: 'Unattended builds' })).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByRole('checkbox', { name: 'Unattended builds' })).toBeEnabled();
    await expect(section.getByRole('checkbox', { name: 'Retrospectives' })).toBeDisabled();
    await section.getByRole('checkbox', { name: 'Board' }).click();
    await expect(section.getByRole('checkbox', { name: 'Board' })).toHaveAttribute('aria-checked', 'false');
    const kept = () => (existsSync(join(dataDir, 'preferences.json')) ? JSON.parse(readFileSync(join(dataDir, 'preferences.json'), 'utf8')) : undefined);
    await expect.poll(kept).toEqual({ newProjects: { bmadPieces: ['planning'] } });

    // Kept by the server: a reload shows it.
    await page.reload();
    await expect(page.getByTestId('new-projects-section').getByRole('checkbox', { name: 'Planning' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('new-projects-section').getByRole('checkbox', { name: 'Board' })).toHaveAttribute('aria-checked', 'false');

    const beta = await addFromDialog(page, 'beta-repo');
    expect(piecesOf(server, beta)).toEqual(['planning']);
    expect(piecesOf(server, alpha)).toEqual([]);
    expect(readdirSync(join(home, 'Documents', 'beta-repo'))).toEqual([]);
  });
});
