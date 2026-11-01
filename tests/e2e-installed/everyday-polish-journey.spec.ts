/// <reference lib="dom" />
/**
 * Epic 26's everyday polish against the installed package, in Chromium
 * (story 26.10), on a server of its own started by the installed `ogden`
 * launcher, with its own data folder, home folder and the fake agent:
 *
 * 1. Two chats in two projects each wait on a command: both Needs you rows
 *    read their whole request, then "project, chat"; `g y` opens each card
 *    in turn, focused, and each is answered.
 * 2. From inside a chat `g n` opens the new-chat draft with the composer
 *    focused, and its first message makes a chat that shows the reply.
 * 3. Cmd/Ctrl+K opens the palette, finds a chat in the other project by a
 *    word of its title, and Enter opens it.
 * 4. A card's "Commands starting with npm test" Always allow (AD-40) saved
 *    with `2` lets a second matching command run with no card; removed in
 *    Settings, Projects, Always allow rules, the next one asks.
 *
 * No real agent, account, keychain or network. The server is quit at the
 * end, and its folders removed.
 */
import { basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { requestQuit } from '../support.js';
import { composer, send, startChat } from '../e2e/chat-server.js';
import { blur, expectConnected, landConnected, paletteKey, sidebarOf, storedToken } from '../e2e/tab.js';
import { bmadServer, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];

test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

/** An agent's reply, a turn's end or a card: Windows runners take far longer than the default to start and answer. */
const SLOW = { timeout: 60_000 };

const replies = (page: Page) => page.getByTestId('message-agent');
const card = (page: Page) => page.getByTestId('permission-card');
const idle = (page: Page) => expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle', SLOW);
const needsYouRows = (page: Page) => sidebarOf(page).getByTestId('needs-you').getByTestId('needs-you-item');
const palette = (page: Page) => page.getByTestId('command-palette');

/** `g`, then `key`, with the cursor out of any field. */
async function goTo(page: Page, key: 'y' | 'n') {
  await blur(page);
  await page.keyboard.press('g');
  await page.keyboard.press(key);
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  // A quit while a chat is busy is refused (409 sessions_busy).
  await idle(page);
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('Needs you rows and g y, g n, Cmd/Ctrl+K and a prefix Always allow rule, on the installed package', async ({ page }) => {
  test.setTimeout(300_000);
  const server = bmadServer('journey-polish');
  servers.push(server);
  const clay = server.addRepo({ bmad: false, prefix: 'polish-clay-' });
  const press = server.addRepo({ bmad: false, prefix: 'polish-press-' });

  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);

  const one = await startChat(page, clay.path);
  await send(page, 'permission npm test', SLOW);
  await expect(card(page)).toBeVisible(SLOW);
  const two = await startChat(page, press.path);
  await send(page, 'permission npm run lint', SLOW);
  await expect(card(page)).toBeVisible(SLOW);

  await test.step('two Needs you rows read in full; g y opens each card, which is answered', async () => {
    await page.goto(new URL('/', launched.url).href);
    await expectConnected(page);
    const rows = needsYouRows(page);
    await expect(rows).toHaveCount(2, SLOW);
    const expected = [
      { what: 'Claude Code wants to run npm test', where: `${basename(clay.path)}, permission npm test` },
      { what: 'Claude Code wants to run npm run lint', where: `${basename(press.path)}, permission npm run lint` },
    ];
    for (const [index, { what, where }] of expected.entries()) {
      const row = rows.nth(index);
      await expect(row.getByTestId('needs-you-what')).toHaveText(what);
      // Not cut at the sidebar's width.
      expect(await row.getByTestId('needs-you-what').evaluate((element) => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)).toBe(false);
      await expect(row.getByTestId('needs-you-where')).toHaveText(where);
      await expect(row).toHaveAccessibleName(`${what}, in ${where}`);
    }

    for (const [chat, ran] of [
      [one, 'Ran npm test.'],
      [two, 'Ran npm run lint.'],
    ] as const) {
      await goTo(page, 'y');
      await expect(page).toHaveURL(new RegExp(`/w/${chat.wsId}/s/${chat.sesId}#permission-`), SLOW);
      await expect(card(page)).toBeFocused(SLOW);
      await card(page).getByRole('button', { name: 'Allow once' }).click();
      await expect(replies(page).last()).toContainText(ran, SLOW);
      await idle(page);
    }
    await expect(needsYouRows(page)).toHaveCount(0, SLOW);
  });

  await test.step('g n in a chat opens the draft, composer focused; its first message makes a chat', async () => {
    await goTo(page, 'n');
    await expect(page).toHaveURL(new RegExp(`/w/${two.wsId}/new$`), SLOW);
    await expect(page.getByTestId('new-chat-page')).toBeVisible(SLOW);
    await expect(composer(page)).toBeFocused();
    await send(page, 'hello', SLOW);
    await expect(page).toHaveURL(new RegExp(`/w/${two.wsId}/s/ses_[0-9A-Z]{26}$`), SLOW);
    expect(page.url()).not.toBe(two.url);
    await expect(page.getByTestId('message-user')).toHaveText('hello');
    await expect(replies(page)).toContainText('Hello from the fake agent.', SLOW);
    await idle(page);
  });

  await test.step('Cmd/Ctrl+K finds a chat in the other project and opens it', async () => {
    await blur(page);
    await page.keyboard.press(await paletteKey(page));
    await expect(palette(page)).toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.getByRole('combobox').fill('npm test');
    const chats = palette(page).getByRole('group', { name: 'Chats' });
    await expect(chats.getByRole('option')).toHaveCount(1, SLOW);
    await expect(chats.getByRole('option')).toContainText('permission npm test');
    await expect(chats.getByRole('option')).toContainText(basename(clay.path));
    await expect(chats.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${one.wsId}/s/${one.sesId}$`), SLOW);
    await expect(palette(page)).toHaveCount(0);
    await idle(page);
  });

  await test.step('a prefix rule saved with 2 lets a second matching command run with no card; removed in Settings, the next one asks', async () => {
    await send(page, 'permission npm test -- cart', SLOW);
    await expect(card(page)).toBeVisible(SLOW);
    const scope = card(page).getByRole('radiogroup', { name: 'What Always allow covers' });
    const exact = scope.getByRole('radio', { name: /^Exactly npm test -- cart in / });
    const prefix = scope.getByRole('radio', { name: /^Commands starting with npm test in / });
    await expect(exact).toHaveAttribute('aria-checked', 'true');
    await exact.focus();
    // Held down as a person would: Radix checks the radio its arrow key moves focus to (after a tick).
    await page.keyboard.down('ArrowDown');
    await expect(prefix).toBeFocused();
    await page.keyboard.up('ArrowDown');
    await expect(prefix).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('2');
    await expect(replies(page).last()).toContainText('Ran npm test -- cart.', SLOW);
    await idle(page);

    const shown = await replies(page).count();
    await send(page, 'permission npm test -- --watch', SLOW);
    await expect(replies(page)).toHaveCount(shown + 1, SLOW);
    await expect(replies(page).last()).toContainText('Ran npm test -- --watch.', SLOW);
    await expect(card(page)).toHaveCount(0);
    await idle(page);

    await page.goto(new URL('/settings/always-allow', launched.url).href);
    await expect(page.getByRole('heading', { name: 'Always allow rules', level: 1 })).toBeVisible(SLOW);
    const row = page.getByTestId('rule-row');
    await expect(row).toHaveCount(1, SLOW);
    await expect(row).toContainText(`Commands starting with npm test in ${basename(clay.path)}`);
    await row.getByRole('button', { name: /^Remove Commands starting with npm test in / }).click();
    await expect(row).toHaveCount(0, SLOW);
    // Each project's list says it is empty (both projects are listed).
    const empty = 'No Always allow rules. Ogden asks before each action.';
    await expect(page.getByTestId('rules-empty')).toHaveText([empty, empty], SLOW);

    await page.goto(one.url);
    await idle(page);
    await send(page, 'permission npm test -- --watch', SLOW);
    await expect(card(page)).toBeVisible(SLOW);
    await card(page).getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).last()).toContainText('Denied npm test -- --watch.', SLOW);
  });

  await quit(page, launched);
});
