/// <reference lib="dom" />
/**
 * A 0.2.0 user upgrades, in a real browser (story 10.7; E10-R7, CAP-19,
 * AD-5): this version starts on a data folder as 0.2.0 left it
 * (`fixtures/data-folder-0.2.0.ts`). The launch link lands on Projects, not
 * Welcome, and Settings → Welcome never asks "Simple chats or BMad Method?";
 * both projects and their chats are there with their transcripts; settings
 * show the caution level, the kept rule and every BMad piece off, with the
 * repo note and the default line; the `_bmad/` project's offer shows exactly
 * once and is gone after Not now and a reload; and no repo, `onboarding.json`
 * or `preferences.json` is written. The server starts with `firstRun` so the
 * fixture's own `onboarding.json` is the one read.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BMAD_NEW_PROJECTS_LINK, BMAD_OFFER_NOT_NOW, BMAD_OFFER_TEXT, BMAD_PIECES, BMAD_REPO_HAS_BMAD_TEXT } from '../../packages/shared/src/bmad.ts';
import { createDataFolder020 } from '../fixtures/data-folder-0.2.0.js';
import { startServer } from '../support.js';
import { openConnected, sidebarOf } from './tab.js';

/** Opens the project's chats page and waits until its detection has been answered. */
async function openChats(page: Page, origin: string, wsId: string): Promise<void> {
  const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${wsId}/bmad/detection`) && response.request().method() === 'GET');
  await page.goto(`${origin}/w/${wsId}`);
  expect((await detected).status()).toBe(200);
  await expect(page.getByTestId('workspace-name')).toBeVisible();
}

/** Opens the project's settings and waits for its BMad section to load. */
async function openSettings(page: Page, origin: string, wsId: string): Promise<void> {
  await page.goto(`${origin}/w/${wsId}/settings`);
  await expect(page.getByTestId('bmad-use')).toBeVisible();
}

test('a 0.2.0 data folder: everything kept, every project Simple, no Welcome question, the offer once', async ({ page }) => {
  const data = createDataFolder020();
  try {
    const onboardingFile = join(data.dataDir, 'onboarding.json');
    const onboardingBytes = readFileSync(onboardingFile);
    const hashes = { bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() };
    const { bmad, plain } = data.workspaceIds;
    const lastSeq = data.events.at(-1)!.seq;

    const server = await startServer(data.dataDir, 0, { firstRun: true });
    try {
      const origin = server.url;
      await page.setViewportSize({ width: 1440, height: 900 });
      // Projects, not Welcome: the folder has projects and its Welcome was done.
      await openConnected(page, '/', server.launchUrl);
      await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
      await expect(page).toHaveURL(`${origin}/`);
      await expect(page.getByTestId('welcome-page')).toHaveCount(0);
      const sidebar = sidebarOf(page);
      await expect(sidebar).toContainText(data.repos.bmad.path.split(/[\\/]/).at(-1)!);
      await expect(sidebar).toContainText(data.repos.plain.path.split(/[\\/]/).at(-1)!);

      // Both chats, with their transcripts.
      await openChats(page, origin, bmad);
      await expect(page.getByTestId('chat-row')).toHaveCount(1);
      await page.getByTestId('chat-row').click();
      const transcript = page.getByTestId('transcript');
      await expect(transcript).toContainText('Say hello');
      await expect(transcript).toContainText('Ran npm install stripe.');
      await expect(transcript).toContainText('Denied npm test.');
      await expect(transcript).toContainText('Thanks, carry on');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
      await openChats(page, origin, plain);
      await expect(page.getByTestId('chat-row')).toHaveCount(1);
      await page.getByTestId('chat-row').click();
      await expect(page.getByTestId('transcript')).toContainText('And add a footer');
      await expect(page.getByTestId('transcript')).toContainText('Waiting, done.');

      // Settings: the caution level and rule kept, every piece off; the note and the default line.
      await openSettings(page, origin, bmad);
      await expect(page.getByTestId('caution-level').getByRole('radio', { name: 'Ask for commands' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('rule-row')).toHaveCount(1);
      await expect(page.getByTestId('rule-row')).toContainText('npm install');
      await expect(page.getByTestId('bmad-use')).toHaveAttribute('aria-checked', 'false');
      for (const piece of BMAD_PIECES) await expect(page.getByTestId(`bmad-${piece}`)).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('bmad-offer-slot')).toHaveText(BMAD_REPO_HAS_BMAD_TEXT);
      const defaultLine = page.getByTestId('bmad-default-slot');
      await expect(defaultLine).toContainText('New projects start as Simple chats.');
      await expect(defaultLine.getByRole('link', { name: BMAD_NEW_PROJECTS_LINK })).toHaveAttribute('href', '/settings/new-projects');
      await openSettings(page, origin, plain);
      await expect(page.getByTestId('caution-level').getByRole('radio', { name: 'Ask every time' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('rules-empty')).toBeVisible();
      await expect(page.getByTestId('bmad-use')).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('bmad-default-slot')).toContainText('New projects start as Simple chats.');
      await expect(page.getByTestId('bmad-offer-slot')).toHaveCount(0);
      // The default line's link opens Settings → New projects, which shows Simple chats.
      await page.getByTestId('bmad-default-slot').getByRole('link', { name: BMAD_NEW_PROJECTS_LINK }).click();
      await expect(page).toHaveURL(`${origin}/settings/new-projects`);
      await expect(page.getByTestId('new-projects-mode').getByRole('radio', { name: 'Simple chats' })).toHaveAttribute('aria-checked', 'true');

      // The offer: exactly once on the _bmad/ project (every piece is Coming soon here), none on the plain one.
      const offer = page.getByTestId('bmad-offer');
      await openChats(page, origin, plain);
      await expect(offer).toHaveCount(0);
      await openChats(page, origin, bmad);
      await expect(offer).toHaveCount(1);
      await expect(offer).toContainText(BMAD_OFFER_TEXT);
      await offer.getByRole('button', { name: BMAD_OFFER_NOT_NOW }).click();
      await expect(offer).toHaveCount(0);
      const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${bmad}/bmad/detection`));
      await page.reload();
      expect((await detected).status()).toBe(200);
      await expect(page.getByTestId('workspace-name')).toBeVisible();
      await expect(offer).toHaveCount(0);
      // The settings note is context, not the offer: Not now leaves it.
      await openSettings(page, origin, bmad);
      await expect(page.getByTestId('bmad-offer-slot')).toHaveText(BMAD_REPO_HAS_BMAD_TEXT);

      // Starting appended its `server.started` and named each older chat from its first message (backlog story 12);
      // browsing appended nothing but the Not now.
      expect(server.core.events.readAfter(lastSeq).map((event) => event.type)).toEqual(['session.renamed', 'session.renamed', 'server.started', 'workspace.bmad_offer_dismissed']);

      // Settings → Welcome: an existing user with projects is never asked the first-project question.
      await sidebar.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('menuitem', { name: 'Welcome' }).click();
      await expect(page).toHaveURL(/\/welcome$/);
      // The agent step: an API key (kept in memory, its check a stub) makes the agent ready, and Welcome moves on.
      const card = page.getByTestId('agent-card-claude-code');
      await card.getByRole('button', { name: 'Use an API key instead' }).click();
      await card.getByLabel('API key').fill('sk-ant-api03-E2E_TEST_ONLY_not_real_0123456789-abcdWXYZ');
      await card.getByLabel('API key').press('Enter');
      await expect(page.getByTestId('welcome-headline')).toHaveText('Add a project to get started.');
      await expect(page.getByTestId('welcome-page').getByRole('button', { name: 'Add project' })).toBeVisible();
      await expect(page.getByTestId('first-project-question')).toHaveCount(0);
    } finally {
      await server.close();
    }

    expect({ bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() }).toEqual(hashes);
    expect(existsSync(join(data.repos.plain.path, '_bmad'))).toBe(false);
    expect(readFileSync(onboardingFile).equals(onboardingBytes)).toBe(true);
    expect(existsSync(join(data.dataDir, 'preferences.json'))).toBe(false);
  } finally {
    data.remove();
  }
});
