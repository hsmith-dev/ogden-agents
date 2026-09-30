/**
 * Opening connected tabs in the browser tests (AD-15 as amended). A tab gets
 * its token only by opening a launch link, as the launcher does it: here the
 * launch link comes from the shared server's handshake, with its launcher
 * token, exactly as `npx ogden-agents` asks for one.
 */
import { expect, type Page } from '@playwright/test';
import { launchLink as handshakeLink } from '../support.js';

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
  const base = new URL(launch).origin;
  await page.goto(launch);
  await expect(page).toHaveURL(`${base}/`);
  // The boot script's code exchange has stored this tab's token.
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ogden-agents.tab-token'))).toMatch(/^[A-Za-z0-9_-]{43}$/);
  if (path !== '/') await page.goto(base + path);
}
