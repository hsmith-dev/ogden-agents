/// <reference lib="dom" />
/**
 * Epic 12, 12.3 in a real browser, against a generic agent (the fake ACP
 * agent behind a descriptor and quirks, registered for tests only) that
 * needs the project trusted and takes its permission mode only when a chat
 * starts: the picker offers Trust and the prompt allows the project, a
 * changed `.mcp.json` asks again before the next chat, the mode chosen before
 * the first message reaches the agent and is then shown as fixed for the chat.
 * No test runs a real agent.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, fakeFixedModeAgent } from '../support.js';
import { startChat, withChatServer } from './chat-server.js';
import { storedToken } from './tab.js';

const AGENT = { agentId: 'fixed-agent', displayName: 'Fixed Agent' } as const;

test('an agent that needs the project trusted: the picker offers Trust, a changed .mcp.json asks again, and its mode is fixed once the chat starts', async ({ page }) => {
  const fixed = await fakeFixedModeAgent(AGENT);
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const claude = await startChat(page, repo);
      await page.goto(`${server.url}/w/${claude.wsId}`);
      const picker = page.getByTestId('agent-picker');
      await picker.click();
      const option = page.getByTestId('agent-option').filter({ hasText: AGENT.displayName });
      // Needing the project trusted is fixed in place: choosable, with its reason, and a Trust item.
      await expect(option).toContainText(`${AGENT.displayName} uses this project's own agent settings`);
      await expect(option).not.toHaveAttribute('aria-disabled', 'true');
      await page.getByTestId('agent-trust-project').click();
      await expect(picker).toHaveAttribute('data-agent', AGENT.agentId);
      const prompt = page.getByTestId('script-trust-prompt');
      await expect(prompt).toContainText(`Trust this project for ${AGENT.displayName}?`);
      await expect(prompt).toContainText('agent settings, hooks and MCP servers');
      // Until trusted New chat is unavailable and says why.
      await expect(page.getByTestId('new-chat')).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('agent-unavailable')).toContainText("uses this project's own agent settings");
      await page.getByTestId('script-trust-allow').click();
      await expect(prompt).toBeHidden();
      await expect(page.getByTestId('agent-unavailable')).toHaveCount(0);

      // The project's MCP servers change after the user trusted it: asked again, before the next chat.
      writeFileSync(join(repo, '.mcp.json'), '{"mcpServers":{"planted":{"command":"node"}}}\n');
      await page.reload();
      await expect(page.getByTestId('agent-picker')).toBeVisible();
      await page.getByTestId('agent-picker').click();
      await page.getByTestId('agent-trust-project').click();
      await expect(page.getByTestId('script-trust-prompt')).toHaveAttribute('data-changed', 'true');
      await page.getByTestId('script-trust-allow').click();
      await expect(page.getByTestId('script-trust-prompt')).toBeHidden();

      // Trusted, New chat opens the draft with it (epic 26).
      await page.getByTestId('new-chat').click();
      await expect(page).toHaveURL(new RegExp(`/w/${claude.wsId}/new\\?agent=${AGENT.agentId}$`));
      await expect(page.getByTestId('agent-unavailable')).toHaveCount(0);

      // A chat with it, made by the API (the draft has no mode choice before its first message yet, epic 27):
      // Auto chosen before the first message reaches the agent, then shown as fixed.
      const origin = new URL(page.url()).origin;
      const token = await storedToken(page);
      const created = await fetch(`${origin}${apiPath(API_ROUTES.workspaceSessions, { wsId: claude.wsId })}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'chat', agentId: AGENT.agentId }),
      });
      expect(created.status).toBe(201);
      const { session } = (await created.json()) as { session: { id: string } };
      await page.goto(`${origin}/w/${claude.wsId}/s/${session.id}`);
      await expect(page.getByTestId('session-agent')).toHaveText(AGENT.displayName);
      await page.getByTestId('permission-mode-picker').click();
      await page.getByTestId('permission-mode-auto').click();
      await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-mode', 'auto');
      const composer = page.getByRole('textbox', { name: `Message ${AGENT.displayName}` });
      await composer.fill('mode');
      await composer.press('Enter');
      await expect(page.getByTestId('message-agent').last()).toContainText('mode=auto');

      await expect(page.getByTestId('permission-mode-picker')).toHaveAttribute('data-fixed', 'true');
      await page.getByTestId('permission-mode-picker').click();
      await expect(page.getByTestId('permission-mode-menu')).toContainText('fixed for this chat');
      await expect(page.getByTestId('permission-mode-ask')).toHaveAttribute('data-disabled', '');
      await expect(page.getByTestId('permission-mode-ask')).toContainText(`${AGENT.displayName} sets its permission mode when a chat starts, so this chat stays in Auto.`);
      await page.keyboard.press('Escape');
    },
    { extra: { extraAgents: [fixed] } },
  );
});
