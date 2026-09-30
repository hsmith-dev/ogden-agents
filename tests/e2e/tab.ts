/**
 * Opening connected tabs in the browser tests (AD-15 as amended). A tab gets
 * its token only by opening a launch link, as the launcher does it: here the
 * launch link comes from the shared server's handshake, with its launcher
 * token, exactly as `npx ogden-agents` asks for one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** The shared server's base URL (set by global-setup.ts). */
export function sharedUrl(): string {
  const value = process.env.E2E_URL;
  if (value === undefined) throw new Error('E2E_URL is not set; run through `pnpm e2e`');
  return value;
}

/** A fresh single-use launch link from the server at `url` whose data folder is `dataDir`. */
export async function launchLink(url = sharedUrl(), dataDir = process.env.E2E_DATA_DIR): Promise<string> {
  if (dataDir === undefined) throw new Error('E2E_DATA_DIR is not set; run through `pnpm e2e`');
  const token = readFileSync(join(dataDir, 'launcher.token'), 'utf8').trim();
  const response = await fetch(`${url}/launcher/hello?launch=1`, { headers: { 'x-ogden-launcher-token': token } });
  if (!response.ok) throw new Error(`the launcher handshake returned ${response.status}`);
  return ((await response.json()) as { launchUrl: string }).launchUrl;
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
