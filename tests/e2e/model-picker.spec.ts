/// <reference lib="dom" />
/**
 * Story 11 in a real browser: a chat's model picker in the composer lists the
 * agent's models once it has started, a switch applies to the next message
 * and survives a reload, a model the agent refuses is explained with a way to
 * pick another, and the app's default model in Settings → Agents starts new
 * chats on it. The agent is the fake ACP agent (its models are `fake-*`); no
 * test runs a real agent.
 */
import { expect, test, type Page } from '@playwright/test';
import { send, startChat, withChatServer } from './chat-server.js';

const picker = (page: Page) => page.getByTestId('model-picker');

async function choose(page: Page, model: string) {
  await picker(page).click();
  await page.locator(`[data-testid="model-picker-option"][data-model="${model}"]`).click();
}

test("a chat switches its model for the next message, keeps it on reload, and a refused model offers another", async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    await startChat(page, repo);
    // Before the agent has started, the picker says when its models appear.
    await picker(page).click();
    await expect(page.getByTestId('model-picker-empty')).toBeVisible();
    await page.keyboard.press('Escape');

    await send(page, 'model');
    await expect(page.getByTestId('message-agent').last()).toContainText('model=fake-default');
    await expect(picker(page)).toContainText("default");

    await choose(page, 'fake-large');
    await expect(picker(page)).toHaveAttribute('data-model', 'fake-large');
    await expect(page.getByTestId('session-model')).toHaveText('Fake Large');
    await send(page, 'model');
    await expect(page.getByTestId('message-agent').last()).toContainText('model=fake-large');

    await page.reload();
    await expect(picker(page)).toHaveAttribute('data-model', 'fake-large');

    // A model the user's plan lacks: the agent's own words, the chat back on its default, and a way to pick another.
    await choose(page, 'fake-locked');
    await send(page, 'model');
    await expect(page.getByTestId('message-agent').last()).toContainText('model=fake-default');
    const refused = page.getByTestId('model-refused');
    await expect(refused).toContainText("Your plan doesn't include Fake Locked.");
    await expect(picker(page)).toHaveAttribute('data-model', '');
    await page.getByTestId('model-refused-choose').click();
    await page.locator('[data-testid="model-picker-option"][data-model="fake-small"]').click();
    await expect(picker(page)).toHaveAttribute('data-model', 'fake-small');
    await expect(refused).toHaveCount(0);
  });
});

test("the app's default model in Settings → Agents starts new chats on it", async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    // The agent lists its models once it has started in a chat.
    await send(page, 'hello');
    await expect(page.getByTestId('message-agent').last()).toContainText('Hello');
    await page.goto(new URL('/settings/agents', chat.url).toString());
    const section = page.getByTestId('app-models-section');
    await expect(section).toBeVisible();
    const menu = section.locator('button[data-testid^="app-models-"]').first();
    await menu.click();
    await page.locator('[data-model="fake-small"]').first().click();
    await expect(page.getByTestId('app-models-status')).toContainText('Fake Small');

    await startChat(page, repo);
    await expect(picker(page)).toHaveAttribute('data-model', 'fake-small');
    await send(page, 'model');
    await expect(page.getByTestId('message-agent').last()).toContainText('model=fake-small');
  });
});
