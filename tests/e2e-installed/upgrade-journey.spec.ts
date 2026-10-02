/// <reference lib="dom" />
/**
 * A 0.2.0 user upgrades to the installed package (story 10.7; E10-R7,
 * CAP-19, AD-5): the installed launcher starts a background server of its
 * own on a data folder as 0.2.0 left it (`fixtures/data-folder-0.2.0.ts`),
 * with the fake agent. The launch link lands on Projects (no Welcome); both
 * projects and their chats are listed; their caution levels and the kept
 * Always allow rule are there; every project is Simple (every BMad piece
 * off); the `_bmad/` project's offer shows exactly once and the plain one
 * has none; and no repo or `onboarding.json` changes and no
 * `preferences.json` appears.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BMAD_OFFER_TEXT, BMAD_PIECES } from '../../packages/shared/src/bmad.ts';
import { workspaceKeyOf } from '../fixtures/data-folder-0.2.0.js';
import { requestQuit } from '../support.js';
import { expectConnected, landConnected, sidebarOf, storedToken } from '../e2e/tab.js';
import { launch, upgradeServer, waitForExit, type UpgradeServer } from './installed.js';

let server: UpgradeServer | undefined;

test.afterAll(async () => {
  await server?.remove();
});

/** Opens the project's chats page and waits until its detection has been answered. */
async function openChats(page: Page, origin: string, wsId: string): Promise<void> {
  const detected = page.waitForResponse((response) => response.url().endsWith(`/workspaces/${wsId}/bmad/detection`) && response.request().method() === 'GET');
  await page.goto(`${origin}/w/${wsId}`);
  expect((await detected).status()).toBe(200);
  await expect(page.getByTestId('workspace-name')).toBeVisible();
}

test('the installed package on a 0.2.0 data folder: projects listed, Simple, the offer once', async ({ page }) => {
  server = upgradeServer('upgrade');
  const { data, install } = server;
  const onboardingBytes = readFileSync(join(data.dataDir, 'onboarding.json'));
  const hashes = { bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() };
  const { bmad, plain } = data.workspaceIds;

  const launched = await launch(install);
  const origin = launched.url;
  await page.setViewportSize({ width: 1440, height: 900 });

  await test.step('1. the launch link lands on Projects, not Welcome, with both projects and their chats', async () => {
    await landConnected(page, launched.launchUrl);
    await expectConnected(page);
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(`${origin}/`);
    for (const repo of [data.repos.bmad, data.repos.plain]) {
      const group = sidebarOf(page).getByRole('group', { name: basename(workspaceKeyOf(repo.path).realPath) });
      await expect(group).toBeVisible();
      await expect(group.getByTestId('status-row')).toHaveCount(1);
    }
  });

  await test.step('2. caution levels and the rule kept; every project is Simple: every BMad piece off', async () => {
    const caution = { [bmad]: 'Ask for commands', [plain]: 'Ask every time' };
    for (const wsId of [bmad, plain]) {
      await page.goto(`${origin}/w/${wsId}/settings`);
      await expect(page.getByTestId('bmad-use')).toBeVisible();
      await expect(page.getByTestId('caution-level').getByRole('radio', { name: caution[wsId] })).toHaveAttribute('aria-checked', 'true');
      if (wsId === bmad) {
        await expect(page.getByTestId('rule-row')).toHaveCount(1);
        await expect(page.getByTestId('rule-row')).toContainText('npm install');
      } else {
        await expect(page.getByTestId('rules-empty')).toBeVisible();
      }
      await expect(page.getByTestId('bmad-use')).toHaveAttribute('aria-checked', 'false');
      for (const piece of BMAD_PIECES) await expect(page.getByTestId(`bmad-${piece}`)).toHaveAttribute('aria-checked', 'false');
    }
  });

  await test.step("3. the _bmad/ project's offer shows exactly once; the plain one has none", async () => {
    const offer = page.getByTestId('bmad-offer');
    await openChats(page, origin, plain);
    await expect(offer).toHaveCount(0);
    await openChats(page, origin, bmad);
    await expect(offer).toHaveCount(1);
    await expect(offer).toContainText(BMAD_OFFER_TEXT);
  });

  await test.step('4. quit: no repo or onboarding.json changed, and no preferences.json', async () => {
    const token = await storedToken(page);
    expect((await requestQuit(origin, token!)).status).toBe(202);
    await waitForExit(launched.pid);
    expect({ bmad: data.repos.bmad.hash(), plain: data.repos.plain.hash() }).toEqual(hashes);
    expect(existsSync(join(data.repos.plain.path, '_bmad'))).toBe(false);
    expect(readFileSync(join(data.dataDir, 'onboarding.json')).equals(onboardingBytes)).toBe(true);
    expect(existsSync(join(data.dataDir, 'preferences.json'))).toBe(false);
  });
});
