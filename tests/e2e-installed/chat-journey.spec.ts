/// <reference lib="dom" />
/**
 * Epic 2's journey against the installed package, in Chromium (story 2.13):
 * a background server of its own (its own data folder, the same install),
 * started by the installed `ogden` launcher, with the fake agent. Land through
 * the launch link; a chat in project A asks permission while a `hold` chat in
 * project B works, and the sidebar shows both, with A in Needs you; under the
 * default caution level `npm test` runs only after Allow once; Quit and
 * relaunch, and A's chat resumes (`via=resumed`); then a fresh browser opens a
 * fresh launch link and finds both projects and A's history. It quits its
 * server at the end, so the main server is left for epic 1's journey.
 */
import { basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Install } from '../../scripts/installed-package.mjs';
import { requestQuit } from '../support.js';
import { send, startChat, type StartedChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, sidebarOf, storedToken } from '../e2e/tab.js';
import { extraFolder, FAKE_AGENT, launch, ownInstall, stopOwnServer, waitForExit, type Launched } from './installed.js';
import { expectHeld } from './permission-hold.js';

let install: Install;

test.afterAll(async () => {
  if (install !== undefined) await stopOwnServer(install);
});

/** A project's group in the sidebar column, named by its folder. */
const groupOf = (page: Page, repo: string) => sidebarOf(page).getByRole('group', { name: basename(repo) });
const state = (page: Page) => page.getByTestId('session-state');
const replies = (page: Page) => page.getByTestId('message-agent');

test('the epic 2 journey on the installed package', async ({ page, context, browser }) => {
  // Two launcher runs, a restart and two browsers.
  test.setTimeout(240_000);
  install = ownInstall('chat', FAKE_AGENT);
  const repoA = extraFolder('chat-a');
  const repoB = extraFolder('chat-b');

  let server!: Launched;
  await test.step('1. land through the launch link', async () => {
    server = await launch(install);
    expect(server.output).toContain('Starting Ogden Agents in the background...');
    await page.setViewportSize({ width: 1440, height: 900 });
    await landConnected(page, server.launchUrl);
    await expectConnected(page);
    expect(await storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  let chatA!: StartedChat;
  await test.step('2. two projects: A asks permission, B holds; the sidebar shows both, and Needs you lists A', async () => {
    chatA = await startChat(page, repoA);
    await send(page, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    await startChat(page, repoB);
    await send(page, 'hold');
    await expect(state(page)).toHaveAttribute('data-state', 'working');

    await expect(groupOf(page, repoA).getByTestId('status-row')).toHaveAttribute('data-session-state', 'waiting');
    await expect(groupOf(page, repoB).getByTestId('status-row')).toHaveAttribute('data-session-state', 'working');
    const needsYou = sidebarOf(page).getByTestId('needs-you').getByTestId('needs-you-item');
    await expect(needsYou).toHaveText(`Waiting for you${basename(repoA)}, permission: Claude Code wants to run npm test`);
    await expect(needsYou).toHaveAttribute('href', new RegExp(`/w/${chatA.wsId}/s/${chatA.sesId}$`));
  });

  await test.step('3. under the default caution level, npm test runs only after Allow once', async () => {
    await sidebarOf(page).getByTestId('needs-you-item').click();
    await expect(page).toHaveURL(chatA.url);
    await expect(page.getByTestId('permission-card')).toContainText('Ask every time');
    await expectHeld(page);
    await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(replies(page)).toContainText('Ran npm test.');
    await expect(page.getByTestId('permission-record')).toContainText('Allowed once: npm test');
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(sidebarOf(page).getByTestId('needs-you')).toHaveCount(0);
  });

  await test.step('4. Quit, relaunch, reopen A: it resumes', async () => {
    const sidebar = sidebarOf(page);
    await sidebar.getByRole('button', { name: 'Quit Ogden Agents' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Quit Ogden Agents?' });
    // B's hold is still working: the confirmation names it, and stops it.
    await expect(confirm).toContainText('1 agent is still working and will stop');
    await confirm.getByRole('button', { name: 'Quit', exact: true }).click();
    await expect(page.getByTestId('server-stopped').getByRole('heading', { name: 'Ogden Agents has stopped.' })).toBeVisible();
    await waitForExit(server.pid);

    const before = server.pid;
    server = await launch(install);
    expect(server.output).toContain('Starting Ogden Agents in the background...');
    expect(server.pid).not.toBe(before);
    // The port may differ: land on the new server's link, then open A there.
    await landConnected(page, server.launchUrl);
    await page.goto(`${server.url}/w/${chatA.wsId}/s/${chatA.sesId}`);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await expect(replies(page).first()).toContainText('Ran npm test.');
    await send(page, 'context');
    await expect(replies(page).last()).toHaveText(/via=resumed primed=0$/);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  await test.step('5. a fresh browser and a fresh launch link: both projects and A\'s history', async () => {
    await context.close();
    const again = await launch(install);
    expect(again.output).toContain('Ogden Agents is already running');
    expect(again.pid).toBe(server.pid);

    const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const tab = await fresh.newPage();
      await landConnected(tab, again.launchUrl);
      await expectConnected(tab);
      await expect(groupOf(tab, repoA)).toBeVisible();
      await expect(groupOf(tab, repoB)).toBeVisible();

      await groupOf(tab, repoA).getByTestId('status-row').click();
      await expect(tab).toHaveURL(`${server.url}/w/${chatA.wsId}/s/${chatA.sesId}`);
      await expect(tab.getByTestId('message-user')).toHaveText(['permission', 'context']);
      await expect(replies(tab).first()).toContainText('Ran npm test.');
      await expect(replies(tab).last()).toHaveText(/via=resumed primed=0$/);
      await expect(tab.getByTestId('permission-record')).toContainText('Allowed once: npm test');

      // Done: quit this server, so nothing of it is left.
      const token = await storedToken(tab);
      if (token === null) throw new Error('the fresh tab has no token');
      expect((await requestQuit(server.url, token)).status).toBe(202);
      await waitForExit(server.pid);
    } finally {
      await fresh.close();
    }
  });
});
