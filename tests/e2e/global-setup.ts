import type { FullConfig } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer } from '../support.js';

/**
 * Starts one server for the run. Tests read `E2E_URL` and `E2E_DATA_DIR`, and
 * open each connected tab with a fresh launch link (see `tab.ts`): a tab's
 * token lives in that tab's sessionStorage (AD-15 as amended), so there is no
 * signed-in browser state to save and share.
 */
export default async function globalSetup(_config: FullConfig) {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir);

  process.env.E2E_URL = server.url;
  process.env.E2E_DATA_DIR = dataDir;

  return async () => {
    await server.close();
    removeDataDir(dataDir);
  };
}
