/**
 * The UI routes story 2.3 registers for later lanes (Welcome 9.5, Settings:
 * Agents 9.1, a workspace's Chats list and settings 2.5 and 2.8): each is
 * reachable in the shell and renders its own level-1 heading, so its lane
 * fills one file and never edits the router.
 */
import { expect, test } from '@playwright/test';
import { openConnected } from './tab.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const ROUTES: ReadonlyArray<readonly [path: string, heading: string, testId: string]> = [
  ['/welcome', 'Welcome', 'welcome-page'],
  ['/settings/agents', 'Agents', 'agents-settings-page'],
  [`/w/${wsId}`, 'Chats', 'workspace-chats-page'],
  [`/w/${wsId}/settings`, 'Workspace settings', 'workspace-settings-page'],
];

for (const [path, heading, testId] of ROUTES) {
  test(`${path} renders its own heading inside the shell`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByTestId(testId)).toBeAttached();
    await expect(page.getByTestId('not-found')).toHaveCount(0);
    await expect(page.getByTestId('workspace-area')).toBeVisible();
  });
}
