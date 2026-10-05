/// <reference lib="dom" />
/**
 * The live status sidebar in a real browser (story 2.11): two projects at
 * once, one chat working and one waiting on a permission request. A tab
 * opened fresh from the launcher shows both groups with their states,
 * "Needs you" names the request and its project, and the tab title counts
 * it. Answering the request clears Needs you and the title. Each test runs
 * its own server with the fake agent.
 */
import { basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { send, startChat as startChatIn, withChatServer } from './chat-server.js';
import { landConnected, launchLink, openConnected, sidebarOf } from './tab.js';

/** The live announcer's polite batch (live-announcer.tsx). */
const POLITE_INTERVAL_MS = 5000;

/** Starts a chat in `repo` and sends it `message`. */
async function startChat(page: Page, repo: string, message: string) {
  await startChatIn(page, repo);
  await send(page, message);
}

/** The workspace group named by the repo's folder, in the sidebar column. */
const groupOf = (page: Page, repo: string) => sidebarOf(page).getByRole('group', { name: basename(repo) });

test('two busy projects: both groups show their states, Needs you names the request, and the title counts it', async ({ page, context }) => {
  await withChatServer(page, async ({ server, dataDir, tempFolder }) => {
    const working = tempFolder('ogden-agents-e2e-working-');
    const asking = tempFolder('ogden-agents-e2e-asking-');

    await startChat(page, asking, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    // The open session announces its own card; the shell stays silent about it, even once Needs you shows it.
    await expect(sidebarOf(page).getByTestId('needs-you-item')).toBeVisible();
    await expect(page.getByTestId('needs-you-announcement')).toHaveText('');
    // `hold` keeps working until the server closes.
    await startChat(page, working, 'hold');
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'working');

    // Reopen from the launcher: a new tab replays the backlog.
    await page.close();
    const tab = await context.newPage();
    await tab.setViewportSize({ width: 1440, height: 900 });
    // The tab's own clock, so the 5 s polite batch is stepped, not waited for.
    await tab.clock.install();
    await landConnected(tab, await launchLink(server.url, dataDir));

    await expect(groupOf(tab, working).getByTestId('status-row')).toHaveAttribute('data-session-state', 'working');
    await expect(groupOf(tab, working).getByTestId('status-row')).toHaveAccessibleName('Chat, Claude Code, working');
    await expect(groupOf(tab, asking).getByTestId('status-row')).toHaveAttribute('data-session-state', 'waiting');
    const needsYou = sidebarOf(tab).getByTestId('needs-you');
    await expect(needsYou.getByTestId('needs-you-item')).toHaveText(`Waiting for you${basename(asking)}: Claude Code wants to run npm test`);
    await expect(tab).toHaveTitle('(1) Ogden Agents');
    await expect(needsYou.getByTestId('needs-you-item')).toHaveAttribute('href', /\/w\/ws_[0-9A-Z]{26}\/s\/ses_[0-9A-Z]{26}$/);

    // Answer the request from another tab. This tab (on the home page) sees the chat go working, then
    // idle: its first announcements after the backlog. The backlog itself was never announced.
    const other = await context.newPage();
    await openConnected(other, new URL(await needsYou.getByTestId('needs-you-item').evaluate((a) => (a as HTMLAnchorElement).href)).pathname, await launchLink(server.url, dataDir));
    await other.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(other.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    await other.close();

    await expect(groupOf(tab, asking).getByTestId('status-row')).toHaveAttribute('data-session-state', 'idle');
    await expect(sidebarOf(tab).getByTestId('needs-you')).toHaveCount(0);
    await expect(tab).toHaveTitle('Ogden Agents');
    await tab.clock.runFor(POLITE_INTERVAL_MS);
    await expect(tab.getByTestId('sidebar-announcement')).toHaveText(`${basename(asking)}: Chat is idle`);
    // Neither the working chat from the backlog nor the request that was already waiting was said.
    await expect(tab.getByTestId('needs-you-announcement')).toHaveText('');
  });
});

test('a request in another project is announced once, and the rail shows it as a counted button', async ({ page, context }) => {
  await withChatServer(page, async ({ server, dataDir, tempFolder }) => {
    const asking = tempFolder('ogden-agents-e2e-asking-');
    const other = tempFolder('ogden-agents-e2e-other-');
    await startChat(page, other, 'hello');
    const otherChat = page.url();
    await startChat(page, asking, 'hello');
    await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
    const askingChat = page.url();

    // Watch from the other chat while a second tab asks from the asking one: the request is in a session not on screen.
    await page.goto(otherChat);
    await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
    const second = await context.newPage();
    await openConnected(second, new URL(askingChat).pathname, await launchLink(server.url, dataDir));
    await send(second, 'permission');
    await expect(second.getByTestId('permission-card')).toBeVisible();
    await second.close();

    await expect(page.getByTestId('needs-you-announcement')).toHaveText('Claude Code is waiting for you: run npm test');
    await expect(sidebarOf(page).getByTestId('needs-you-item')).toHaveText(`Waiting for you${basename(asking)}: Claude Code wants to run npm test`);
    // Nothing takes focus: not the sidebar, not Needs you.
    expect(await page.evaluate(() => document.activeElement?.closest('[data-slot="sidebar"]') ?? null)).toBeNull();

    // The rail (768 to 1023 px): a counted Needs you button and glyph rows, each with an accessible name.
    await page.setViewportSize({ width: 900, height: 800 });
    const rail = sidebarOf(page).getByTestId('needs-you-rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAccessibleName('Needs you, 1');
    await expect(groupOf(page, asking).getByRole('link', { name: 'Chat, Claude Code, waiting for you' })).toBeVisible();
    // Each project is a folder icon in the rail, named and opening it (backlog story 2: the drop-down never showed in the rail).
    const railProject = groupOf(page, other).getByRole('link', { name: basename(other), exact: true });
    await expect(railProject).toBeVisible();
    expect((await railProject.boundingBox())!.width).toBeLessThanOrEqual(56);
    await railProject.click();
    await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}$/);
    await rail.click();
    await expect(page).toHaveURL(askingChat);
    await expect(page.getByTestId('permission-card')).toBeVisible();
  });
});

test('below md, a row in the sheet opens its session and closes the sheet', async ({ page }) => {
  await withChatServer(page, async ({ server, tempFolder }) => {
    const repo = tempFolder('ogden-agents-e2e-sheet-');
    await startChat(page, repo, 'hello');
    const chat = page.url();
    await page.goto(`${server.url}/`);

    await page.setViewportSize({ width: 390, height: 844 });
    // A drawer link moves within the app; the page is never loaded again (a mark on the window survives).
    const markWindow = () => page.evaluate(() => Object.assign(window, { sameDocument: true }));
    const sameDocument = () => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
    await markWindow();
    await page.getByTestId('sidebar-trigger').click();
    const sheet = page.getByRole('dialog', { name: 'Projects and sessions' });
    await sheet.getByRole('group', { name: basename(repo) }).getByTestId('status-row').click();
    await expect(page).toHaveURL(chat);
    await expect(sheet).toBeHidden();
    expect(await sameDocument()).toBe(true);

    // Backlog story 2: the drawer is the way to projects below md. A clear menu button opens it from
    // the keyboard; focus goes into it; Escape closes it and gives focus back to the button.
    const trigger = page.getByRole('button', { name: 'Open projects and sessions' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    // The project's name in the drawer opens its Chats list and closes the drawer; it is then marked current.
    await trigger.click();
    const project = sheet.getByRole('group', { name: basename(repo) }).getByRole('link', { name: basename(repo), exact: true });
    await project.click();
    await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}$/);
    expect(await sameDocument()).toBe(true);
    await expect(sheet).toBeHidden();
    await trigger.click();
    await expect(project).toHaveAttribute('aria-current', 'page');
    // A link to the page already shown closes the drawer too, and focus comes back to the menu button, not to nothing.
    await project.click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    // Its settings, from the gear beside the name.
    await sheet.getByRole('link', { name: `${basename(repo)} settings` }).click();
    await expect(page).toHaveURL(/\/w\/ws_[0-9A-Z]{26}\/settings$/);
    await expect(sheet).toBeHidden();
  });
});

test('while keyboard focus is in the sidebar a row changes state in place; the new order applies once focus leaves', async ({ page, context }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const older = await startChatIn(page, repo);
    const newer = await startChatIn(page, repo);
    const rows = groupOf(page, repo).getByTestId('status-row');
    // Each row is its session's link.
    const order = () => rows.evaluateAll((all) => all.map((row) => row.getAttribute('href')?.split('/s/')[1]));
    const row = (chat: { sesId: string }) => groupOf(page, repo).locator(`[data-testid="status-row"][href$="/s/${chat.sesId}"]`);
    // Both idle: most recently changed first.
    await expect.poll(order).toEqual([newer.sesId, older.sesId]);

    // Tab onto the older chat's row: keyboard focus, and the pointer never touches the sidebar.
    await row(newer).focus();
    await page.keyboard.press('Tab');
    await expect(row(older)).toBeFocused();

    // Another tab sets the older chat working (`hold` keeps it working until the server closes).
    const other = await context.newPage();
    await openConnected(other, new URL(older.url).pathname, await launchLink(server.url, dataDir));
    await send(other, 'hold');
    await expect(other.getByTestId('session-state')).toHaveAttribute('data-state', 'working');

    // It updates in place: working, but still below the idle one.
    await expect(row(older)).toHaveAttribute('data-session-state', 'working');
    expect(await order()).toEqual([newer.sesId, older.sesId]);
    await expect(row(older)).toBeFocused();

    // Focus leaves the sidebar: active first.
    await page.getByRole('textbox', { name: 'Message Claude Code' }).focus();
    await expect.poll(order).toEqual([older.sesId, newer.sesId]);
    await other.close();
  });
});

test('the hold ends when the focused Needs you entry leaves: its request answered in another tab, the order applies', async ({ page, context }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const asking = await startChatIn(page, repo);
    await send(page, 'permission');
    await expect(page.getByTestId('permission-card')).toBeVisible();
    const busy = await startChatIn(page, repo);
    const rows = groupOf(page, repo).getByTestId('status-row');
    const order = () => rows.evaluateAll((all) => all.map((row) => row.getAttribute('href')?.split('/s/')[1]));
    // The waiting chat is active, so it leads.
    await expect.poll(order).toEqual([asking.sesId, busy.sesId]);

    // Keyboard focus on the Needs you entry (Tab away and back, so it is keyboard focus).
    const entry = sidebarOf(page).getByTestId('needs-you-item');
    await entry.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(entry).toBeFocused();

    // Another tab sets the other chat working: held, it stays second.
    const other = await context.newPage();
    await openConnected(other, new URL(busy.url).pathname, await launchLink(server.url, dataDir));
    await send(other, 'hold');
    await expect(groupOf(page, repo).locator(`[data-testid="status-row"][href$="/s/${busy.sesId}"]`)).toHaveAttribute('data-session-state', 'working');
    expect(await order()).toEqual([asking.sesId, busy.sesId]);

    // Answering the request there removes the focused entry: the hold ends and the working chat leads.
    await other.goto(asking.url);
    await other.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(entry).toHaveCount(0);
    await expect.poll(order).toEqual([busy.sesId, asking.sesId]);
    await other.close();
  });
});
