/// <reference lib="dom" />
/**
 * The tracer's BMad Method switch in a real browser (story 10.1; CAP-19,
 * AD-22): a project starts with Planning off; flipping it in one tab shows
 * the new state in a second open tab without a reload, through
 * `workspace.settings_changed`; and it is kept across a server restart.
 */
import { BMAD_COMING_SOON_LABEL, WORKSPACE_SETTINGS_BMAD_ANCHOR, type BmadPiece } from '../../packages/shared/src/bmad.ts';
import { expect, test } from '@playwright/test';
import { startServer } from '../support.js';
import { startChat, withChatServer } from './chat-server.js';
import { launchLink, openConnected } from './tab.js';

/** Planning registered as shipped for this test: no real piece ships until epic 4 (story 10.2). */
const AVAILABLE: readonly BmadPiece[] = ['planning'];

test('flipping Planning in one tab shows in another without a reload, and survives a restart', async ({ page, browser }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const { wsId } = await startChat(page, repo);
    const settings = `/w/${wsId}/settings`;
    await page.goto(`${server.url}${settings}`);
    const planning = page.getByRole('switch', { name: 'Planning' });
    await expect(planning).toHaveAttribute('aria-checked', 'false');

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      await openConnected(other, settings, await launchLink(server.url, dataDir));
      const otherPlanning = other.getByRole('switch', { name: 'Planning' });
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'false');

      await planning.click();
      await expect(planning).toHaveAttribute('aria-checked', 'true');
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'true');

      await otherPlanning.click();
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'false');
      await expect(planning).toHaveAttribute('aria-checked', 'false');
      await planning.click();
      await expect(otherPlanning).toHaveAttribute('aria-checked', 'true');
    } finally {
      await context.close();
    }

    await server.close();
    const restarted = await startServer(dataDir, 0, { availableBmadPieces: AVAILABLE });
    try {
      await openConnected(page, settings, restarted.launchUrl);
      await expect(page.getByRole('switch', { name: 'Planning' })).toHaveAttribute('aria-checked', 'true');
    } finally {
      await restarted.close();
    }
  }, { extra: { availableBmadPieces: AVAILABLE } });
});

test('with no piece shipped, Planning is greyed, marked Coming soon and cannot be turned on', async ({ page }) => {
  await withChatServer(page, async ({ server, repo }) => {
    const { wsId } = await startChat(page, repo);
    await page.goto(`${server.url}/w/${wsId}/settings#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`);
    const planning = page.getByRole('switch', { name: 'Planning' });
    await expect(planning).toHaveAttribute('aria-checked', 'false');
    await expect(planning).toBeDisabled();
    await expect(page.getByTestId('bmad-planning-coming-soon')).toHaveText(BMAD_COMING_SOON_LABEL);
  });
});
