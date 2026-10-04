/// <reference lib="dom" />
/**
 * The tracer's BMad Method switch in a real browser (story 10.1; CAP-19,
 * AD-22): a project starts with Planning off; flipping it in one tab shows
 * the new state in a second open tab without a reload, through
 * `workspace.settings_changed`; and it is kept across a server restart.
 * Story 10.5 adds the designed section: the dependency rule with its status
 * line, Coming soon pieces, and the main switch, followed by a second tab.
 */
import {
  BMAD_COMING_SOON_LABEL,
  BMAD_FILES_STAY_TEXT,
  BMAD_PIECE_INFO,
  BMAD_USE_LABEL,
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  type BmadPiece,
} from '../../packages/shared/src/bmad.ts';
import { expect, test } from '@playwright/test';
import { startServer } from '../support.js';
import { startChat, withChatServer } from './chat-server.js';
import { launchLink, openConnected } from './tab.js';

/** What this install ships (Planning and Board since story 4.2): the restart keeps the same list. */
const AVAILABLE: readonly BmadPiece[] = ['planning', 'board'];

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

test('Unattended builds and Retrospectives are greyed, marked Coming soon and cannot be turned on; Planning and Board can (story 4.2)', async ({ page }) => {
  await withChatServer(page, async ({ server, repo }) => {
    const { wsId } = await startChat(page, repo);
    await page.goto(`${server.url}/w/${wsId}/settings#${WORKSPACE_SETTINGS_BMAD_ANCHOR}`);
    for (const piece of ['builds', 'retrospectives'] as const) {
      const control = page.getByRole('switch', { name: BMAD_PIECE_INFO[piece].label, exact: true });
      await expect(control).toHaveAttribute('aria-checked', 'false');
      await expect(control).toBeDisabled();
      await expect(page.getByTestId(`bmad-${piece}-coming-soon`)).toHaveText(BMAD_COMING_SOON_LABEL);
    }
    // Epic 4 ships Planning and Board (story 4.2): neither is Coming soon, and the main switch works.
    for (const piece of ['planning', 'board'] as const) {
      await expect(page.getByRole('switch', { name: BMAD_PIECE_INFO[piece].label, exact: true })).toBeEnabled();
      await expect(page.getByTestId(`bmad-${piece}-coming-soon`)).toHaveCount(0);
    }
    await expect(page.getByRole('switch', { name: BMAD_USE_LABEL })).toBeEnabled();
    await expect(page.getByTestId('bmad-use-coming-soon')).toHaveCount(0);
    // Opened at the anchor: the section's heading has focus.
    await expect(page.getByRole('heading', { name: 'BMad Method' })).toBeFocused();
  });
});

const SHIPPED: readonly BmadPiece[] = ['planning', 'board', 'builds'];

test('the BMad Method section: the rule as the user picks, Coming soon, and the main switch, followed by a second tab', async ({ page, browser }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const { wsId } = await startChat(page, repo);
    const settings = `/w/${wsId}/settings`;
    await page.goto(`${server.url}${settings}`);
    const switchIn = (tab: typeof page, label: string) => tab.getByRole('switch', { name: label, exact: true });
    const builds = switchIn(page, BMAD_PIECE_INFO.builds.label);
    const board = switchIn(page, BMAD_PIECE_INFO.board.label);
    const use = switchIn(page, BMAD_USE_LABEL);
    await expect(use).toHaveAttribute('aria-checked', 'false');

    // Retrospectives isn't shipped: greyed, Coming soon, can't be turned on; its description says so.
    const retros = switchIn(page, BMAD_PIECE_INFO.retrospectives.label);
    await expect(retros).toBeDisabled();
    await expect(page.getByTestId('bmad-retrospectives-coming-soon')).toHaveText(BMAD_COMING_SOON_LABEL);
    await expect(retros).toHaveAccessibleDescription(new RegExp(BMAD_COMING_SOON_LABEL));

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const other = await context.newPage();
      await openConnected(other, settings, await launchLink(server.url, dataDir));
      const otherBoard = switchIn(other, BMAD_PIECE_INFO.board.label);
      const otherBuilds = switchIn(other, BMAD_PIECE_INFO.builds.label);
      const otherUse = switchIn(other, BMAD_USE_LABEL);
      await expect(otherBoard).toHaveAttribute('aria-checked', 'false');

      // Unattended builds on: Board turns on too, and the status line says so. Both run the project's
      // scripts, so this untrusted project asks first (story 4.2); allowed once, it never asks again.
      await builds.click();
      await page.getByTestId('script-trust-confirm').click();
      await expect(builds).toHaveAttribute('aria-checked', 'true');
      await expect(board).toHaveAttribute('aria-checked', 'true');
      await expect(use).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('bmad-status')).toContainText('Board was turned on too, because the feature you chose needs it.');
      await expect(otherBuilds).toHaveAttribute('aria-checked', 'true');
      await expect(otherBoard).toHaveAttribute('aria-checked', 'true');
      await expect(other.getByTestId('bmad-status')).toHaveText('');

      // Board off: Unattended builds goes too.
      await board.click();
      await expect(board).toHaveAttribute('aria-checked', 'false');
      await expect(builds).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('bmad-status')).toContainText('Unattended builds was turned off too');
      await expect(page.getByTestId('bmad-status')).toContainText(BMAD_FILES_STAY_TEXT);
      await expect(otherBuilds).toHaveAttribute('aria-checked', 'false');

      // Main switch on, then off: Planning and Board, then nothing, with the files-stay line.
      await use.click();
      await expect(switchIn(page, BMAD_PIECE_INFO.planning.label)).toHaveAttribute('aria-checked', 'true');
      await expect(board).toHaveAttribute('aria-checked', 'true');
      await expect(otherUse).toHaveAttribute('aria-checked', 'true');
      await use.click();
      await expect(use).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('bmad-status')).toContainText(BMAD_FILES_STAY_TEXT);
      await expect(otherUse).toHaveAttribute('aria-checked', 'false');
      await expect(otherBoard).toHaveAttribute('aria-checked', 'false');
      await expect(other.getByTestId('bmad-status')).toHaveText('');
    } finally {
      await context.close();
    }
  }, { extra: { availableBmadPieces: SHIPPED } });
});
