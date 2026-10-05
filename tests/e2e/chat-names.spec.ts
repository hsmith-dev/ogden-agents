/// <reference lib="dom" />
/**
 * Chat names in a real browser (backlog story 2), with the fake agent: the
 * first message names a chat; Rename in the header, F2 or a double click in
 * the sidebar, and Rename in the chat list's row menu rename it in place;
 * Enter saves, Esc cancels, an empty name puts the automatic one back; a
 * second tab follows a rename without a reload; a reload keeps it.
 */
import { expect, test, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';
import { launchLink, openConnected, sidebarOf } from './tab.js';

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const sidebarRow = (page: Page) => sidebarOf(page).getByTestId('status-row');

test('a chat is named by its first message and renamed from its header; a second tab follows', async ({ page, context }) => {
  await withChatServer(page, async ({ server, dataDir, repo }) => {
    const chat = await startChat(page, repo);
    await expect(heading(page)).toHaveText('New chat');
    await send(page, 'Plan the   pottery site');
    await expect(heading(page)).toHaveText('Plan the pottery site');
    await expect(sidebarRow(page)).toContainText('Plan the pottery site');

    const other = await context.newPage();
    await openConnected(other, new URL(chat.url).pathname, await launchLink(server.url, dataDir));
    await expect(heading(other)).toHaveText('Plan the pottery site');

    // Esc cancels, and focus is back on Rename.
    const rename = page.getByRole('button', { name: 'Rename Plan the pottery site' });
    await rename.click();
    const field = page.getByRole('textbox', { name: 'Chat name' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Plan the pottery site');
    await field.fill('Something else');
    await field.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(heading(page)).toHaveText('Plan the pottery site');
    await expect(rename).toBeFocused();

    // Enter saves; the name is plain text, and the other tab shows it live.
    await rename.click();
    await field.fill('<b>Pottery</b> plan');
    await field.press('Enter');
    await expect(heading(page)).toHaveText('<b>Pottery</b> plan');
    await expect(page.locator('[data-slot="page-header"]').getByTestId('chat-rename-status')).toHaveText('Chat renamed to <b>Pottery</b> plan');
    await expect(page.getByRole('button', { name: 'Rename <b>Pottery</b> plan' })).toBeFocused();
    await expect(sidebarRow(page)).toContainText('<b>Pottery</b> plan');
    await expect(heading(other)).toHaveText('<b>Pottery</b> plan');
    await expect(sidebarRow(other)).toContainText('<b>Pottery</b> plan');
    await other.close();

    await page.reload();
    await expect(heading(page)).toHaveText('<b>Pottery</b> plan');
  });
});

test('the sidebar renames with F2 and a double click; an empty name puts the automatic one back', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    await send(page, 'Fix the login bug');
    await expect(sidebarRow(page)).toContainText('Fix the login bug');

    await sidebarRow(page).focus();
    await page.keyboard.press('F2');
    const field = sidebarOf(page).getByRole('textbox', { name: 'Chat name' });
    await expect(field).toBeFocused();
    await field.fill('Login work');
    await field.press('Enter');
    await expect(sidebarRow(page)).toContainText('Login work');
    await expect(heading(page)).toHaveText('Login work');
    await expect(sidebarRow(page)).toBeFocused();

    await sidebarRow(page).dblclick();
    await expect(field).toBeFocused();
    await field.fill('   ');
    await field.press('Enter');
    await expect(sidebarRow(page)).toContainText('Fix the login bug');
    await expect(heading(page)).toHaveText('Fix the login bug');
  });
});

test('the chat list renames from the row menu', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await send(page, 'First question');
    await page.goto(new URL(chat.url).origin + `/w/${chat.wsId}`);
    const row = page.getByTestId('chat-row');
    await expect(row).toContainText('First question');
    await page.getByRole('button', { name: 'More for First question' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const field = page.getByTestId('workspace-chats-page').getByRole('textbox', { name: 'Chat name' });
    await expect(field).toBeFocused();
    await field.fill('Renamed from the list');
    await field.press('Enter');
    await expect(row).toContainText('Renamed from the list');
    await expect(row).toBeFocused();
  });
});
