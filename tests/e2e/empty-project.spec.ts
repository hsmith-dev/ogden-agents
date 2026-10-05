/// <reference lib="dom" />
/**
 * An empty project starts a chat in one click (backlog story 2), in a real
 * browser against the fake agent: the empty Chats page names the agent and
 * has Start a chat as its one primary action, by keyboard too, and the chat
 * opens in Ask with its composer focused; the sidebar offers Start a chat
 * for a project with no chats only, at desktop width and in the phone sheet.
 * No test runs the real `claude`.
 */
import { basename } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_ROUTES } from '../support.js';
import { withChatServer } from './chat-server.js';
import { sidebarOf, storedToken } from './tab.js';

/** Adds the folder `repo` as a project through the REST API, with no chat in it. */
async function addProject(page: Page, repo: string): Promise<string> {
  const origin = new URL(page.url()).origin;
  const response = await fetch(`${origin}${API_ROUTES.workspaces}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await storedToken(page)}`, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ path: repo }),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

const groupOf = (page: Page, repo: string) => sidebarOf(page).getByRole('group', { name: basename(repo) });

test("the empty Chats page starts a chat with the project's default agent in one keypress, in Ask", async ({ page }) => {
  await withChatServer(page, async ({ server, repo }) => {
    const wsId = await addProject(page, repo);
    await page.goto(`${server.url}/w/${wsId}`);
    const empty = page.getByTestId('chats-empty');
    await expect(empty).toContainText('No conversations yet.');
    await expect(empty).toContainText('Start a chat with Claude Code to work on this project, or write your first message below.');
    // One agent: no second chooser.
    await expect(page.getByTestId('start-chat-other')).toHaveCount(0);
    await expect(page.getByTestId('composer').getByTestId('agent-picker')).toHaveCount(0);

    const start = page.getByRole('button', { name: 'Start a chat', exact: true });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${wsId}/s/ses_[0-9A-Z]{26}$`));
    await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'ask');
    await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toBeFocused();

    // The project now has its chat: the page lists it, the sidebar shows its row and no Start a chat.
    await page.goto(`${server.url}/w/${wsId}`);
    await expect(page.getByTestId('chat-row')).toHaveCount(1);
    await expect(groupOf(page, repo).getByTestId('status-row')).toHaveCount(1);
    await expect(groupOf(page, repo).getByTestId('sidebar-start-chat')).toHaveCount(0);
  });
});

test('the sidebar offers Start a chat for a project with no chats, at desktop width and in the phone sheet', async ({ page }) => {
  await withChatServer(page, async ({ server, tempFolder }) => {
    const first = tempFolder('ogden-agents-e2e-empty-a-');
    const second = tempFolder('ogden-agents-e2e-empty-b-');
    const firstId = await addProject(page, first);
    const secondId = await addProject(page, second);
    await page.goto(`${server.url}/`);

    // Each empty project has its own entry, named with the project.
    const entry = groupOf(page, first).getByTestId('sidebar-start-chat');
    await expect(entry).toHaveAccessibleName(`Start a chat in ${basename(first)}`);
    await expect(groupOf(page, second).getByTestId('sidebar-start-chat')).toHaveAccessibleName(`Start a chat in ${basename(second)}`);

    // By keyboard.
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/${firstId}/s/ses_[0-9A-Z]{26}$`));
    await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'ask');
    await expect(groupOf(page, first).getByTestId('sidebar-start-chat')).toHaveCount(0);
    await expect(groupOf(page, first).getByTestId('status-row')).toHaveCount(1);

    // Below md, in the sheet: the chat opens and the sheet closes.
    await page.goto(`${server.url}/`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('sidebar-trigger').click();
    const sheet = page.getByRole('dialog', { name: 'Projects and sessions' });
    await sheet.getByRole('group', { name: basename(second) }).getByRole('button', { name: `Start a chat in ${basename(second)}` }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${secondId}/s/ses_[0-9A-Z]{26}$`));
    await expect(sheet).toBeHidden();
  });
});
