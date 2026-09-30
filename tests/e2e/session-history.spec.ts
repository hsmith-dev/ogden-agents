/// <reference lib="dom" />
/**
 * History and streaming at scale in a real browser (story 2.10 part B): a
 * chat whose events are all older than its workspace's window opens with
 * its latest page, and Show earlier pages the rest in, in order, with no gap,
 * no repeat and no reload. A reader scrolled up is not moved by new items:
 * "Jump to latest (n)" counts them and takes them there. The test runs its
 * own server with the fake agent.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, ROOT, startServer } from '../support.js';
import { landConnected, launchLink, openConnected } from './tab.js';

const FAKE_AGENT = join(ROOT, 'tests', 'fixtures', 'fake-acp-agent.mjs');

/** Messages seeded into the old chat: more than two pages of Show earlier (200 events each). */
const OLD_MESSAGES = 450;
/** Events of a newer chat in the same project: more than the window (200), so the old chat is outside it. */
const NEWER_EVENTS = 300;

const label = (i: number) => `Old message ${String(i).padStart(3, '0')}`;

async function startChat(page: Page, origin: string, repo: string): Promise<{ wsId: string; sesId: string }> {
  await page.goto(`${origin}/`);
  await page.getByLabel('Project folder').fill(repo);
  await page.getByRole('button', { name: 'Start a chat' }).click();
  await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);
  await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
  const [, wsId, sesId] = /\/w\/(ws_[0-9A-Z]{26})\/s\/(ses_[0-9A-Z]{26})$/.exec(page.url())!;
  return { wsId: wsId!, sesId: sesId! };
}

const messageTexts = (page: Page) => page.getByTestId('transcript').locator('[data-testid="message-user"], [data-testid="message-agent"]').allInnerTexts();

test('an old chat opens with its latest page; Show earlier pages the rest in order, without a reload; Jump to latest counts new items', async ({ page, context }) => {
  const dataDir = makeDataDir();
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-history-'));
  const server = await startServer(dataDir, 0, { claudeAdapterPath: FAKE_AGENT });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/', server.launchUrl);
    const old = await startChat(page, server.url, repo);
    const newer = await startChat(page, server.url, repo);
    expect(newer.wsId).toBe(old.wsId);

    // The old chat's messages, then enough of the newer chat's events to push them out of the window.
    const { events, sessionEvents } = server.core;
    events.transaction(() => {
      for (let i = 0; i < OLD_MESSAGES; i++) {
        sessionEvents.appendSessionEvent(old.sesId as never, {
          type: 'session.message_completed',
          payload: { messageId: `old-${i}`, role: i % 2 === 0 ? 'user' : 'agent', content: label(i) },
        });
      }
      for (let i = 0; i < NEWER_EVENTS; i++) {
        sessionEvents.appendSessionEvent(newer.sesId as never, {
          type: 'session.message_completed',
          payload: { messageId: `new-${i}`, role: 'agent', content: `Newer ${i}` },
        });
      }
    });

    // A fresh tab gets only the window: the old chat loads its latest page on opening.
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1440, height: 900 });
    await landConnected(tab, await launchLink(server.url, dataDir));
    await tab.goto(`${server.url}/w/${old.wsId}/s/${old.sesId}`);
    await tab.evaluate(() => {
      (window as unknown as { notReloaded: boolean }).notReloaded = true;
    });
    const transcript = tab.getByTestId('transcript');
    await expect(transcript.getByTestId('message-user').first()).toBeVisible();
    await expect(tab.getByTestId('message-agent').last()).toHaveText(new RegExp(label(OLD_MESSAGES - 1)));
    const showEarlier = tab.getByTestId('show-earlier');
    await expect(showEarlier).toBeVisible();
    // Show earlier sits at the top of the transcript.
    expect(await transcript.locator(':scope > *').first().getByTestId('show-earlier').count()).toBe(1);

    // Page back to the start, one press per page.
    let presses = 0;
    while ((await showEarlier.count()) > 0) {
      const before = (await messageTexts(tab)).length;
      await showEarlier.click();
      await expect.poll(async () => (await messageTexts(tab)).length).toBeGreaterThan(before);
      // Loaded: the button is back to Show earlier, or gone after the last page.
      await expect(tab.locator('[data-testid="show-earlier"][aria-busy="true"]')).toHaveCount(0);
      presses++;
      expect(presses).toBeLessThan(5);
    }
    expect(presses).toBe(2);
    const texts = await messageTexts(tab);
    // Every message once, oldest first: no gap, no repeat.
    expect(texts.map((text) => /Old message \d{3}/.exec(text)?.[0])).toEqual(Array.from({ length: OLD_MESSAGES }, (_, i) => label(i)));
    expect(await tab.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded)).toBe(true);

    // Scrolled up, new items do not move the view: Jump to latest counts them.
    const body = tab.locator('[data-slot="page-body"]');
    await body.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.goto(`${server.url}/w/${old.wsId}/s/${old.sesId}`);
    const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
    await composer.fill('One more thing');
    await composer.press('Enter');
    await expect(page.getByTestId('message-agent').last()).toHaveText(/Hello from the fake agent\./);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

    const jump = tab.getByTestId('jump-to-latest');
    await expect(jump).toHaveText('Jump to latest (2)');
    expect(await body.evaluate((element) => element.scrollTop)).toBe(0);
    await jump.click();
    await expect(jump).toHaveCount(0);
    await expect(tab.getByTestId('message-agent').last()).toBeInViewport();
    await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(50);
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
});
