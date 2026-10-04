/**
 * Opening connected tabs in the browser tests (AD-15 as amended). A tab gets
 * its token only by opening a launch link, as the launcher does it: here the
 * launch link comes from the shared server's handshake, with its launcher
 * token, exactly as `npx ogden-agents` asks for one.
 */
import { expect, type Page } from '@playwright/test';
import { launchLink as handshakeLink } from '../support.js';

/** Where the page's boot script keeps this tab's token (sessionStorage). */
export const TOKEN_KEY = 'ogden-agents.tab-token';

/** DESIGN.md background tokens as the browser reports them. */
export const LIGHT_BG = 'rgb(246, 247, 245)';
export const DARK_BG = 'rgb(15, 18, 16)';

/** The sidebar column (md and up), not its sheet copy. */
export const sidebarOf = (page: Page) => page.locator('aside[data-slot="sidebar"]');

/** This tab's stored token, or null. */
export const storedToken = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);

/** The sidebar's server status says connected. */
export const expectConnected = (page: Page) => expect(sidebarOf(page).getByTestId('server-status')).toHaveAttribute('data-status', 'connected');

/**
 * Opens a launch link (`/#c=<code>`) in `page` and waits until it lands on `/`
 * with the token the boot script's code exchange stored.
 */
export async function landConnected(page: Page, launch: string): Promise<void> {
  await page.goto(launch);
  await expect(page).toHaveURL(`${new URL(launch).origin}/`);
  await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
}

/** The shared server's base URL (set by global-setup.ts). */
export function sharedUrl(): string {
  const value = process.env.E2E_URL;
  if (value === undefined) throw new Error('E2E_URL is not set; run through `pnpm e2e`');
  return value;
}

/** A fresh single-use launch link from the shared server (or the one at `url` with data folder `dataDir`). */
export async function launchLink(url = sharedUrl(), dataDir = process.env.E2E_DATA_DIR): Promise<string> {
  if (dataDir === undefined) throw new Error('E2E_DATA_DIR is not set; run through `pnpm e2e`');
  return handshakeLink(url, dataDir);
}

/**
 * Connects `page` through a launch link (`/#c=<code>`: it lands on `/` and
 * exchanges the code for its token), then goes to `path` in the same tab,
 * which keeps the token.
 */
export async function openConnected(page: Page, path = '/', link?: string): Promise<void> {
  const launch = link ?? (await launchLink());
  await landConnected(page, launch);
  if (path !== '/') await page.goto(new URL(launch).origin + path);
}
