/// <reference lib="dom" />
/**
 * Handoff in a real browser (user decision 2026-10-04): a Claude Code chat
 * (the fake ACP agent standing in) runs out of usage, the error offers to
 * continue with another agent, the dialog names the provider that receives the
 * conversation and shows the brief, and on confirm the same chat continues
 * with the second agent behind a "Continued with" divider. Then the user
 * switches back from the header menu. No real agent runs.
 */
import { expect, test, type Page } from '@playwright/test';
import { fakeSecondAgent, SECOND_AGENT } from '../support.js';
import { send, startChat, withChatServer } from './chat-server.js';

const composerOf = (page: Page, name: string) => page.getByRole('textbox', { name: `Message ${name}` });

test('a chat out of usage continues with another agent, in the same chat, and back again', async ({ page }) => {
  const second = await fakeSecondAgent();
  await withChatServer(
    page,
    async ({ repo }) => {
      await startChat(page, repo);
      await send(page, 'hello');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');
      await send(page, 'usage-limit');

      // The limit is told apart from other errors, and the notice offers the handoff beside Try again.
      const error = page.getByTestId('session-error');
      await expect(error).toHaveAttribute('data-error-code', 'usage_limit');
      await expect(error).toContainText('Claude Code has reached its usage limit');
      await expect(page.getByTestId('try-again')).toBeVisible();
      await page.getByTestId('error-continue-with-another').click();

      // The dialog names who receives the conversation before anything is sent, and shows the brief to edit.
      const dialog = page.getByRole('dialog', { name: 'Continue with another agent' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('handoff-agent')).toHaveCount(1);
      await expect(dialog.getByTestId('handoff-disclosure')).toContainText(`This sends this chat's conversation to Fake Provider (${SECOND_AGENT.displayName}).`);
      const brief = dialog.getByTestId('handoff-brief');
      await expect(brief).toHaveValue(/Original goal: hello/);
      await expect(dialog.getByTestId('handoff-brief-count')).toContainText('characters');
      await dialog.getByTestId('handoff-message').fill('whoami');
      await dialog.getByTestId('handoff-confirm').click();
      await expect(dialog).toHaveCount(0);

      // The same chat: the history stays, a divider marks the switch, and the second agent answers.
      await expect(page.getByTestId('agent-changed-marker')).toHaveText(`Continued with ${SECOND_AGENT.displayName}`);
      await expect(page.getByTestId('message-agent').last()).toContainText(`agent=${SECOND_AGENT.agentId}`);
      await expect(page.getByTestId('message-user').first()).toHaveText('hello');
      await expect(composerOf(page, SECOND_AGENT.displayName)).toBeVisible();
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'idle');

      // Back to Claude Code from the header menu: it picks up its own session.
      await page.getByTestId('session-menu').click();
      await page.getByTestId('session-menu-continue').click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId('handoff-disclosure')).toContainText("This sends this chat's conversation to Anthropic (Claude Code).");
      await expect(dialog.getByTestId('handoff-disclosure')).toContainText('picks up its own earlier session');
      await dialog.getByTestId('handoff-message').fill('whoami');
      await dialog.getByTestId('handoff-confirm').click();
      await expect(page.getByTestId('agent-changed-marker')).toHaveCount(2);
      await expect(page.getByTestId('agent-changed-marker').last()).toHaveText('Continued with Claude Code');
      await expect(page.getByTestId('message-agent').last()).toContainText('agent=default');
      await expect(composerOf(page, 'Claude Code')).toBeVisible();
    },
    { extra: { extraAgents: [second] } },
  );
});

test('the header menu says why a chat can’t be handed over while its agent works', async ({ page }) => {
  const second = await fakeSecondAgent();
  await withChatServer(
    page,
    async ({ repo }) => {
      await startChat(page, repo);
      await send(page, 'hold');
      await expect(page.getByTestId('session-state')).toHaveAttribute('data-state', 'working');
      await page.getByTestId('session-menu').click();
      await expect(page.getByTestId('session-menu-continue')).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('session-menu-continue-reason')).toHaveText('Claude Code is working. Stop it first.');
      // Choosing it anyway (the keyboard reaches it) opens nothing.
      await page.getByTestId('session-menu-continue').focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
    { extra: { extraAgents: [second] } },
  );
});
