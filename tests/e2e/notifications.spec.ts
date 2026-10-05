/// <reference lib="dom" />
/**
 * Attention notifications in a real browser (backlog story 8). The browser's
 * Notification and AudioContext are replaced by recorders in an init script,
 * so nothing shows on the machine and nothing plays. Notifications are turned
 * on from Settings, Notifications (the permission asked from the switch);
 * then a permission request in a chat makes exactly one notification and one
 * chime across two open tabs (the Web Lock leader speaks for both), with text
 * that names only the project, the chat and the kind.
 */
import { basename } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';
import { launchLink, openConnected, sidebarOf } from './tab.js';

declare global {
  interface Window {
    __shown: { title: string; body: string; tag: string }[];
    __chimes: number;
    __asked: number;
  }
}

/** Records instead of showing or playing, in every page of the context. */
async function recordAttention(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__shown = [];
    window.__chimes = 0;
    window.__asked = 0;
    let permission: NotificationPermission = 'default';
    class RecordingNotification {
      static get permission() {
        return permission;
      }
      static async requestPermission() {
        window.__asked += 1;
        permission = 'granted';
        return permission;
      }
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions) {
        window.__shown.push({ title, body: options.body ?? '', tag: options.tag ?? '' });
      }
      close() {}
    }
    // Permission granted in an earlier page of this context carries over, as in a browser.
    if (localStorage.getItem('ogden-agents.notifications')?.includes('"desktop":true')) permission = 'granted';
    Object.defineProperty(window, 'Notification', { value: RecordingNotification, configurable: true });
    class RecordingAudio {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        window.__chimes += 0.5;
        return { type: 'sine', frequency: { setValueAtTime() {} }, connect: (node: unknown) => node, start() {}, stop() {} };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node: unknown) => node };
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: RecordingAudio, configurable: true });
  });
}

const shown = (page: Page) => page.evaluate(() => window.__shown);
const chimes = (page: Page) => page.evaluate(() => window.__chimes);

test('a permission request makes one safe notification and one chime across two tabs; clicking settings never asks unprompted', async ({ page, context }) => {
  await recordAttention(context);
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const chat = await startChat(page, repo);

    // Settings, Notifications: nothing is asked until the switch is pressed.
    await page.goto(`${server.url}/settings/notifications`);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    expect(await page.evaluate(() => window.__asked)).toBe(0);
    await page.getByRole('switch', { name: 'Desktop notifications' }).click();
    await expect(page.getByRole('switch', { name: 'Desktop notifications' })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => window.__asked)).toBe(1);
    // A test browser's focus is not the user's: notify even with Ogden in front.
    await page.getByRole('switch', { name: "Only when Ogden Agents isn't in front" }).click();
    await expect(page.getByRole('switch', { name: "Only when Ogden Agents isn't in front" })).toHaveAttribute('aria-checked', 'false');

    // A second tab of the same browser follows the settings.
    const second = await context.newPage();
    await openConnected(second, '/settings/notifications', await launchLink(server.url, dataDir));
    await expect(second.getByRole('switch', { name: 'Desktop notifications' })).toHaveAttribute('aria-checked', 'true');
    await second.goto(`${server.url}/`);
    await expect(sidebarOf(second).getByTestId('server-status')).toHaveAttribute('data-status', 'connected');

    await page.goto(chat.url);
    await send(page, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    await expect(sidebarOf(second).getByTestId('needs-you-item')).toBeVisible();

    await expect.poll(async () => (await shown(page)).length + (await shown(second)).length).toBe(1);
    const all = [...(await shown(page)), ...(await shown(second))];
    expect(all[0]).toEqual({ title: 'Approval needed', body: `${basename(repo)}: Chat`, tag: expect.any(String) });
    expect(JSON.stringify(all)).not.toMatch(/npm|run /);
    await expect.poll(async () => (await chimes(page)) + (await chimes(second))).toBe(1);

    // No repeat: the other tab reloads (and may take the lead) but the need is the same, already there when it caught up.
    const before = (await shown(page)).length;
    await second.reload();
    await expect(sidebarOf(second).getByTestId('needs-you-item')).toBeVisible();
    await page.waitForTimeout(500);
    expect((await shown(page)).length).toBe(before);
    expect(await shown(second)).toEqual([]);
    await second.close();
  });
});
