/// <reference lib="dom" />
/**
 * Settings: Agents in a real browser (story 9.1): signing in with a Claude
 * subscription through the hidden terminal, end to end. The server's Claude
 * Code is the fake ACP agent, whose `--cli` runs the fake login program
 * (`tests/fixtures/fake-claude-login.mjs`); the browser's requests to
 * `https://claude.ai/**` are routed to that program's localhost callback, so
 * no real account or sign-in page is ever reached. Each test runs its own server.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { makeDataDir, removeDataDir, startServer, type RunningServer, type StartOptions } from '../support.js';
import { openConnected } from './tab.js';

async function withAgentsServer(page: Page, env: Record<string, string>, extra: StartOptions, body: (server: RunningServer) => Promise<void>) {
  const dataDir = makeDataDir();
  const stateDir = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-login-'));
  const server = await startServer(dataDir, 0, {
    extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: join(stateDir, 'state.json'), ...env },
    ...extra,
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await body(server);
  } finally {
    await server.close();
    removeDataDir(dataDir);
    removeDataDir(stateDir);
  }
}

/** Sends the browser's visits to the Claude sign-in page straight to the fake login's localhost callback. */
async function routeSignInPage(context: BrowserContext) {
  await context.route('https://claude.ai/**', (route) => {
    const callback = new URL(route.request().url()).searchParams.get('redirect_uri');
    return callback === null ? route.abort() : route.fulfill({ status: 302, headers: { location: callback } });
  });
}

const card = (page: Page) => page.getByTestId('agent-card-claude-code');

test('Sign in with your account opens the sign-in tab, and the card reaches Installed, signed in', async ({ page, context }) => {
  await routeSignInPage(context);
  // The CLI's own browser opening suppressed: the page opens the tab itself.
  await withAgentsServer(page, {}, { claudeCliBrowser: 'true' }, async () => {
    // Reached from the sidebar's Settings menu.
    await page.goto(new URL('/', page.url()).href);
    await page.locator('aside[data-slot="sidebar"]').getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Agents' }).click();
    await expect(page).toHaveURL(/\/settings\/agents$/);
    await expect(card(page).getByRole('heading', { name: 'Claude Code', level: 2 })).toBeVisible();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in');

    const opened = context.waitForEvent('page');
    await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
    const tab = await opened;
    await expect(card(page)).toContainText('Finish signing in in the tab that just opened.');
    await expect(card(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(tab.getByText('Login successful.')).toBeVisible();
    // The new tab can't reach back into Ogden Agents.
    expect(await tab.evaluate(() => window.opener)).toBeNull();

    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in');
    await expect(card(page)).toHaveAttribute('data-auth', 'signed_in');
    await tab.close();
  });
});

test('when the CLI opens its own tab the card offers a link, a pasted code finishes signing in, and Cancel stops it', async ({ page, context }) => {
  await withAgentsServer(page, { FAKE_LOGIN_MODE: 'code', FAKE_LOGIN_CODE: 'e2e-code-42' }, {}, async () => {
    await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
    await expect(card(page)).toContainText('Finish signing in in the tab that just opened.');
    const link = card(page).getByRole('link', { name: 'Open the sign-in page' });
    await expect(link).toHaveAttribute('href', /^https:\/\/claude\.ai\/oauth\/authorize\?/);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    expect(context.pages()).toHaveLength(1);

    // A malformed code is refused in plain words and not echoed.
    const field = card(page).getByLabel('Paste the code');
    await field.fill('not a code!');
    await card(page).getByRole('button', { name: 'Send' }).click();
    await expect(card(page).getByTestId('agent-request-error')).toContainText("doesn't look like a sign-in code");
    await expect(card(page).getByTestId('agent-request-error')).not.toContainText('not a code!');

    await field.fill('e2e-code-42');
    await card(page).getByRole('button', { name: 'Send' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in');
  });

  await withAgentsServer(page, { FAKE_LOGIN_MODE: 'hang' }, {}, async () => {
    await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
    await expect(card(page)).toHaveAttribute('data-auth', 'signing_in');
    await card(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in');
  });
});

test('a failed sign-in says so in plain words and offers Try again', async ({ page }) => {
  await withAgentsServer(page, { FAKE_LOGIN_MODE: 'fail' }, {}, async () => {
    await card(page).getByRole('button', { name: 'Sign in with your account' }).click();
    await expect(card(page).getByTestId('agent-sign-in-failed')).toContainText("Claude Code couldn't finish signing in. Try again.");
    await expect(card(page).getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test('when node-pty cannot load, the card shows the reason and the rest of the app works', async ({ page }) => {
  const loadPty = async () => ({ ok: false as const, reason: 'no prebuilt terminal for this platform', detail: 'Error: injected load failure' });
  await withAgentsServer(page, {}, { loadPty }, async () => {
    await expect(card(page)).toContainText("Sign-in isn't available on this computer: no prebuilt terminal for this platform");
    await card(page).getByRole('button', { name: 'Try again' }).click();
    await expect(card(page).getByTestId('agent-sign-in-failed')).toContainText("Sign-in isn't available on this computer");
    // The rest of the app is unaffected.
    await page.goto(new URL('/settings/tools', page.url()).href);
    await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
  });
});
