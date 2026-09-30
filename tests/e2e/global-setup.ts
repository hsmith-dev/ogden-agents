import { join } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer } from './server.js';

/**
 * Starts one server for the run and signs a browser in through its launch
 * link (AD-15), saving the session cookie for every test. Tests read
 * `E2E_URL` and `E2E_STATE`.
 */
export default async function globalSetup(_config: FullConfig) {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(server.launchUrl);
  if (response === null || !response.ok() || new URL(page.url()).pathname !== '/') {
    throw new Error(`signing in through the launch link failed: ${response?.status()} at ${page.url()}`);
  }
  const state = join(dataDir, 'storage-state.json');
  await context.storageState({ path: state });
  await browser.close();

  process.env.E2E_URL = server.url;
  process.env.E2E_STATE = state;

  return async () => {
    await server.close();
    removeDataDir(dataDir);
  };
}
