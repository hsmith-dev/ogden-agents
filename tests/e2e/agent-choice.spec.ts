/// <reference lib="dom" />
/**
 * Epic 6, entry 2 (the tracer) in a real browser: one project holds a Claude
 * Code chat and a chat with a second agent (the fake ACP agent registered
 * again, for tests only), picked on the Chats page. Each chat names its agent
 * in the session view, the Chats list and the status sidebar; each reaches its
 * own agent, and the mode picker offers only the modes its agent declares.
 * No test runs the real `claude`.
 */
import { expect, test } from '@playwright/test';
import { fakeSecondAgent, SECOND_AGENT } from '../support.js';
import { startChat, withChatServer } from './chat-server.js';

test('a Claude Code chat and a second agent chat side by side in one project, each named by its agent', async ({ page }) => {
  const second = await fakeSecondAgent();
  await withChatServer(
    page,
    async ({ repo }) => {
      // The first chat, Claude Code's (the default), as every chat test starts one.
      const claude = await startChat(page, repo);
      await expect(page.getByRole('textbox', { name: 'Message Claude Code' })).toBeVisible();

      // The Chats page offers both agents, Claude Code preselected; pick the second and start a chat.
      await page.goto(new URL(`/w/${claude.wsId}`, claude.url).toString());
      const picker = page.getByTestId('agent-picker');
      await expect(picker).toBeVisible();
      await expect(picker).toHaveAttribute('data-agent', 'claude-code');
      await picker.click();
      const options = page.getByTestId('agent-option');
      await expect(options).toHaveCount(2);
      await expect(options.first()).toContainText('Claude Code');
      await expect(options.nth(1)).toContainText(SECOND_AGENT.displayName);
      await expect(options.first()).toHaveAttribute('aria-checked', 'true');
      await options.nth(1).click();
      await expect(picker).toHaveAttribute('data-agent', SECOND_AGENT.agentId);
      await page.getByTestId('new-chat').click();
      await expect(page).toHaveURL(/\/w\/[^/]+\/s\/ses_/);
      const fakeUrl = page.url();
      expect(fakeUrl).not.toBe(claude.url);

      // The session view names its agent, and the chat reaches it.
      const composer = page.getByRole('textbox', { name: `Message ${SECOND_AGENT.displayName}` });
      await expect(composer).toBeVisible();
      await composer.fill('whoami');
      await composer.press('Enter');
      await expect(page.getByTestId('message-agent').last()).toContainText(`agent=${SECOND_AGENT.agentId}`);
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

      // Its mode picker offers only what its agent declares: Auto is unavailable, with the reason.
      await page.getByTestId('permission-mode-picker').click();
      const auto = page.getByTestId('permission-mode-auto');
      await expect(auto).toHaveAttribute('data-disabled', '');
      await expect(auto).toContainText(`${SECOND_AGENT.displayName} doesn't offer Auto.`);
      await page.keyboard.press('Escape');

      // The status sidebar names each chat's agent.
      const rows = page.getByTestId('status-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: SECOND_AGENT.displayName })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'Claude Code' })).toHaveCount(1);

      // The Claude Code chat still reaches Claude Code (the fake agent standing in, with no name of its own).
      await page.goto(claude.url);
      const claudeComposer = page.getByRole('textbox', { name: 'Message Claude Code' });
      await claudeComposer.fill('whoami');
      await claudeComposer.press('Enter');
      await expect(page.getByTestId('message-agent').last()).toContainText('agent=default');

      // The Chats list (newest first) names each chat's agent while there is a choice.
      await page.goto(new URL(`/w/${claude.wsId}`, claude.url).toString());
      await expect(page.getByTestId('chat-row-agent')).toHaveText([SECOND_AGENT.displayName, 'Claude Code']);
    },
    { extra: { extraAgents: [second] } },
  );
});

test('with Claude Code alone, the Chats page shows no agent picker', async ({ page }) => {
  await withChatServer(page, async ({ repo }) => {
    const chat = await startChat(page, repo);
    await page.goto(new URL(`/w/${chat.wsId}`, chat.url).toString());
    await expect(page.getByTestId('chat-list')).toBeVisible();
    await expect(page.getByTestId('agent-picker')).toHaveCount(0);
    await expect(page.getByTestId('chat-row-agent')).toHaveCount(0);
  });
});
