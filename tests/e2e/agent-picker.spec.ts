/// <reference lib="dom" />
/**
 * Epic 6, entry 6 in a real browser, against two fake agents beside Claude
 * Code (the fake ACP agent registered again under other names, for tests
 * only): a new chat preselects the project's default agent, which Workspace
 * settings changes and another tab follows without a reload; an agent that
 * is signed out stays in the picker, unavailable with its reason and a link
 * to Settings → Agents, by keyboard too; every sidebar row and the session
 * header name the chat's agent; the mode picker offers only the session
 * agent's modes. No test runs the real `claude` or any other agent.
 */
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, fakeAgentSetup, fakeSecondAgent, makeDataDir, removeDataDir, SECOND_AGENT, startServer } from '../support.js';
import { startChat, withChatServer } from './chat-server.js';
import { launchLink, openConnected, storedToken } from './tab.js';

const THIRD = { agentId: 'third-agent', displayName: 'Third Agent' } as const;

/** A first run's launch link lands on Welcome, with this tab's token. */
async function landOnWelcome(page: Page, launch: string) {
  await page.goto(launch);
  await expect(page).toHaveURL(`${new URL(launch).origin}/welcome`);
  await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
}

test("a new chat preselects the project's default, set in one tab and followed by another; a signed-out agent says why", async ({ page, browser }) => {
  const second = await fakeSecondAgent();
  const third = await fakeSecondAgent({ ...THIRD, setup: await fakeAgentSetup({ ...THIRD, installed: true, auth: 'needs_sign_in' }) });
  await withChatServer(
    page,
    async ({ server, dataDir, repo }) => {
      const claude = await startChat(page, repo);
      const chats = `/w/${claude.wsId}`;

      // A second tab on the project's Chats: Claude Code preselected (the install's default).
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const other = await context.newPage();
        await openConnected(other, chats, await launchLink(server.url, dataDir));
        await expect(other.getByTestId('agent-picker')).toHaveAttribute('data-agent', 'claude-code');

        // Workspace settings: Default agent lists every agent with its readiness.
        await page.goto(`${server.url}/w/${claude.wsId}/settings`);
        const section = page.getByTestId('default-agent-section');
        await expect(section).toBeVisible();
        await expect(page.getByTestId('default-agent-third-agent')).toHaveAttribute('aria-describedby', /default-agent-third-agent-description/);
        await expect(section).toContainText("Third Agent isn't signed in.");
        await expect(page.getByTestId('default-agent-set-up-link')).toHaveAttribute('href', '/settings/agents');
        await page.getByTestId(`default-agent-${SECOND_AGENT.agentId}`).click();
        await expect(page.getByTestId('default-agent-status')).toHaveText(`Saved: new chats start with ${SECOND_AGENT.displayName}.`);

        // The other tab follows without a reload.
        await expect(other.getByTestId('agent-picker')).toHaveAttribute('data-agent', SECOND_AGENT.agentId);
        await expect(other.getByTestId('agent-picker')).toHaveAccessibleName(`Agent for new chats: ${SECOND_AGENT.displayName}`);
      } finally {
        await context.close();
      }

      // The picker, by keyboard: the signed-out agent is reachable, unavailable, with its reason; Settings → Agents is linked.
      await page.goto(`${server.url}${chats}`);
      const picker = page.getByTestId('agent-picker');
      await expect(picker).toHaveAttribute('data-agent', SECOND_AGENT.agentId);
      await picker.focus();
      await page.keyboard.press('Enter');
      const options = page.getByTestId('agent-option');
      await expect(options).toHaveCount(3);
      const signedOut = options.filter({ hasText: THIRD.displayName });
      await expect(signedOut).toHaveAttribute('aria-disabled', 'true');
      await expect(signedOut).toContainText("Third Agent isn't signed in. Sign in in Settings → Agents.");
      await page.keyboard.press('End');
      await expect(page.getByTestId('agent-set-up-link')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(signedOut).toBeFocused();
      await page.keyboard.press('Enter');
      // Choosing it changes nothing: the menu stays, the default stays picked.
      await expect(signedOut).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(picker).toHaveAttribute('data-agent', SECOND_AGENT.agentId);

      // New chat starts with the project's default.
      await page.getByTestId('new-chat').click();
      await expect(page).toHaveURL(/\/w\/[^/]+\/s\/ses_/);
      await expect(page.getByTestId('session-agent')).toHaveText(SECOND_AGENT.displayName);
      const composer = page.getByRole('textbox', { name: `Message ${SECOND_AGENT.displayName}` });
      await composer.fill('whoami');
      await composer.press('Enter');
      await expect(page.getByTestId('message-agent').last()).toContainText(`agent=${SECOND_AGENT.agentId}`);

      // The mode picker offers only this agent's modes: Auto is there, unavailable, with the reason.
      await page.getByTestId('permission-mode-picker').click();
      await expect(page.getByTestId('permission-mode-auto')).toHaveAttribute('data-disabled', '');
      await expect(page.getByTestId('permission-mode-auto')).toContainText(`${SECOND_AGENT.displayName} doesn't offer Auto.`);
      await expect(page.getByTestId('permission-mode-ask')).not.toHaveAttribute('data-disabled', '');
      await page.keyboard.press('Escape');

      // Every sidebar row names its agent.
      const rows = page.getByTestId('status-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: SECOND_AGENT.displayName })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'Claude Code' })).toHaveCount(1);
    },
    { extra: { extraAgents: [second, third] } },
  );
});

test('the empty Chats page says why a signed-out default can\'t start a chat, and Use another agent starts one', async ({ page }) => {
  const third = await fakeSecondAgent({ ...THIRD, setup: await fakeAgentSetup({ ...THIRD, installed: true, auth: 'needs_sign_in' }) });
  await withChatServer(
    page,
    async ({ server, repo }) => {
      const claude = await startChat(page, repo);
      // A project whose default is the signed-out agent, set through the API (the settings page is covered above).
      const token = await storedToken(page);
      const patched = await fetch(`${server.url}${apiPath(API_ROUTES.workspaceSettings, { wsId: claude.wsId })}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, origin: server.url, 'content-type': 'application/json' },
        body: JSON.stringify({ defaultAgentId: THIRD.agentId }),
      });
      expect(patched.status).toBe(200);
      // Delete the one chat so the Chats page is empty and shows the composer.
      const deleted = await fetch(`${server.url}${apiPath(API_ROUTES.workspaceHistory, { wsId: claude.wsId })}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, origin: server.url },
      });
      expect(deleted.ok).toBe(true);

      await page.goto(`${server.url}/w/${claude.wsId}`);
      await expect(page.getByTestId('chats-empty')).toBeVisible();
      // One agent chooser in the empty state: Use another agent, not a picker in the composer footer.
      await expect(page.getByTestId('composer').getByTestId('agent-picker')).toHaveCount(0);
      await expect(page.getByTestId('agent-unavailable')).toContainText("Third Agent isn't signed in.");
      await expect(page.getByTestId('agent-unavailable-link')).toHaveAttribute('href', '/settings/agents');
      const start = page.getByTestId('start-chat');
      await expect(start).toHaveAttribute('aria-disabled', 'true');
      await expect(start).toHaveAttribute('aria-describedby', 'agent-unavailable');
      // aria-disabled, so still focusable: Enter says why where it landed.
      await start.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('alert')).toContainText("Third Agent isn't signed in.");
      await expect(page).toHaveURL(new RegExp(`/w/${claude.wsId}$`));

      // Use another agent: Claude Code starts a Claude Code chat in one choice.
      await page.getByTestId('start-chat-other').click();
      await page.getByTestId('start-chat-option').filter({ hasText: 'Claude Code' }).click();
      await expect(page).toHaveURL(/\/w\/[^/]+\/s\/ses_/);
      const composer = page.getByRole('textbox', { name: 'Message Claude Code' });
      await composer.fill('whoami');
      await composer.press('Enter');
      await expect(page.getByTestId('message-agent').last()).toContainText('agent=default');
    },
    { extra: { extraAgents: [third] } },
  );
});

test("Welcome asks which agent when there is more than one, and the chosen one becomes the default for new projects", async ({ page }) => {
  const dataDir = makeDataDir();
  const repo = makeDataDir('ogden-agents-e2e-repo-');
  const second = await fakeSecondAgent({ setup: await fakeAgentSetup({ ...SECOND_AGENT, installed: true, auth: 'signed_in' }) });
  const server = await startServer(dataDir, 0, { firstRun: true, extraAgents: [second] });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await landOnWelcome(page, server.launchUrl);
    await expect(page.getByTestId('welcome-page')).toHaveAttribute('data-step', 'agent');
    const choice = page.getByTestId('welcome-agent-choice');
    await expect(choice).toBeVisible();
    await expect(page.getByTestId('welcome-agent-claude-code')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('agent-card-claude-code')).toBeVisible();

    // By keyboard: the radio group moves to the second agent; its card replaces Claude Code's.
    await page.getByTestId('welcome-agent-claude-code').focus();
    // Held as a person holds it: Radix checks the radio it moves focus to only while the arrow is still down.
    await page.keyboard.down('ArrowDown');
    await expect(page.getByTestId(`welcome-agent-${SECOND_AGENT.agentId}`)).toBeFocused();
    await page.keyboard.up('ArrowDown');
    await expect(page.getByTestId(`welcome-agent-${SECOND_AGENT.agentId}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`agent-card-${SECOND_AGENT.agentId}`)).toBeVisible();
    await expect(page.getByTestId('agent-card-claude-code')).toHaveCount(0);
    // Choosing a ready agent is not a sign-in finishing: the step stays, with Continue.
    await expect(page.getByTestId('welcome-page')).toHaveAttribute('data-step', 'agent');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

    // Kept as the default for new projects: a project added now gets it.
    const token = await storedToken(page);
    const headers = { authorization: `Bearer ${token}`, origin: server.url, 'content-type': 'application/json' };
    await expect
      .poll(async () => ((await (await fetch(`${server.url}${API_ROUTES.newProjectDefaults}`, { headers })).json()) as { defaults: { defaultAgentId?: string } }).defaults.defaultAgentId)
      .toBe(SECOND_AGENT.agentId);
    const added = (await (await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers, body: JSON.stringify({ path: repo }) })).json()) as { workspace: { id: string } };
    const settings = (await (await fetch(`${server.url}${apiPath(API_ROUTES.workspaceSettings, { wsId: added.workspace.id })}`, { headers })).json()) as { settings: { defaultAgentId?: string } };
    expect(settings.settings.defaultAgentId).toBe(SECOND_AGENT.agentId);
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(repo);
  }
});

test('Welcome with Claude Code alone asks no agent question', async ({ page }) => {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir, 0, { firstRun: true });
  try {
    await landOnWelcome(page, server.launchUrl);
    await expect(page.getByTestId('agent-card-claude-code')).toBeVisible();
    await expect(page.getByTestId('welcome-agent-choice')).toHaveCount(0);
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test("an agent's card shows the sign-in code its setup gives, kept in the tab only", async ({ page }) => {
  const third = await fakeSecondAgent({ ...THIRD, setup: await fakeAgentSetup({ ...THIRD, installed: true, auth: 'needs_sign_in', userCode: 'WXYZ-2468' }) });
  await withChatServer(
    page,
    async ({ server }) => {
      await page.goto(`${server.url}/settings/agents`);
      const card = page.getByTestId(`agent-card-${THIRD.agentId}`);
      await card.getByRole('button', { name: 'Sign in with your account' }).click();
      await expect(card.getByTestId('agent-sign-in-user-code')).toHaveText('Enter this code on the sign-in page: WXYZ-2468');
      await expect(card.getByTestId('agent-sign-in-link')).toBeVisible();
      // Never kept in the page's storage.
      expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }))).not.toContain('WXYZ-2468');
    },
    { extra: { extraAgents: [third] } },
  );
});
