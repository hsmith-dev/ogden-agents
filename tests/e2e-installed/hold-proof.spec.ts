/**
 * Proof that the permission hold check detects a missing hold (story 2.13),
 * as `bypass.spec.ts` proves the gate checks: a second background server from
 * the same install, on its own data folder, runs an agent that runs `npm test`
 * without asking (`fake-acp-agent-no-hold.mjs`). `expectHeld` must fail
 * there, and for exactly that reason ("ran without a decision"); any other
 * failure means the fixture is broken, and fails here too. The server is
 * quit at the end.
 */
import { expect, test } from '@playwright/test';
import type { Install } from '../../scripts/installed-package.mjs';
import { requestQuit } from '../support.js';
import { send, startChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { extraFolder, FAKE_AGENT_NO_HOLD, launch, ownInstall, stopOwnServer, waitForExit, type Launched } from './installed.js';
import { expectHeld, RAN_WITHOUT_DECISION } from './permission-hold.js';

let install: Install;
let server: Launched;

test.beforeAll(async () => {
  install = ownInstall('hold-proof', FAKE_AGENT_NO_HOLD);
  server = await launch(install);
});

test.afterAll(async () => {
  if (install !== undefined) await stopOwnServer(install);
});

test('without the hold, the hold check fails because npm test ran without a decision', async ({ page }) => {
  await landConnected(page, server.launchUrl);
  await expectConnected(page);
  await startChat(page, extraFolder('hold-proof-repo'));
  await send(page, 'permission');

  let failure: unknown;
  await expectHeld(page).catch((error: unknown) => (failure = error));
  expect(failure, 'the hold check passed against an agent that never asks').toBeInstanceOf(Error);
  expect((failure as Error).message, 'the hold check failed, but not because the command ran').toBe(RAN_WITHOUT_DECISION);
  // The fixture really ran the command, with no card on the way.
  await expect(page.getByTestId('message-agent')).toContainText('Ran npm test.');
  await expect(page.getByTestId('permission-card')).toHaveCount(0);

  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(server.url, token)).status).toBe(202);
  await waitForExit(server.pid);
});
