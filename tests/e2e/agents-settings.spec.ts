/// <reference lib="dom" />
/**
 * Settings: Agents in a real browser (story 9.1): signing in with a Claude
 * subscription through the hidden terminal, end to end. The server's Claude
 * Code is the fake ACP agent, whose `--cli` runs the fake login program
 * (`tests/fixtures/fake-claude-login.mjs`); the browser's requests to
 * `https://claude.ai/**` are routed to that program's localhost callback, so
 * no real account or sign-in page is ever reached. Each test runs its own server.
 *
 * An API key instead (story 9.2): kept in an in-memory secret store and
 * checked by a stub, so no test touches the real keychain or reaches Anthropic.
 *
 * Install (story 9.3): the real npm installs a fake adapter packed at test
 * time from a local tarball pinned by integrity (`tests/fixtures/fake-adapter`),
 * offline, into the test's data folder; its `dist/index.js` runs the fake agent.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { packFakeAdapter, testNpmCli } from '../fixtures/fake-adapter/pack.mjs';
import { makeDataDir, removeDataDir, serverModule, startServer, type RunningServer, type StartOptions } from '../support.js';
import { send, startChat } from './chat-server.js';
import { openConnected } from './tab.js';

async function withAgentsServer(page: Page, env: Record<string, string>, extra: StartOptions, body: (server: RunningServer, loginState: string) => Promise<void>) {
  const dataDir = makeDataDir();
  const stateDir = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-login-'));
  const server = await startServer(dataDir, 0, {
    extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: join(stateDir, 'state.json'), ...env },
    ...extra,
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await body(server, join(stateDir, 'state.json'));
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

/** Every file under `dir`, read as bytes: the database, the event log's files and the logs. */
function filesUnder(dir: string): Array<{ path: string; bytes: Buffer }> {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, bytes: readFileSync(path) }));
}

test('signed out, an API key pasted on the card is saved, used by the chat, kept across a restart, and never written to the data folder', async ({ page }) => {
  const key = 'sk-ant-api03-E2E_TEST_ONLY_not_real_0123456789-abcdWXYZ';
  const dataDir = makeDataDir();
  const stateDir = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-login-'));
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-repo-'));
  // One in-memory keychain for both runs, standing in for the OS one.
  const { createMemorySecretStore, createLogger } = await serverModule();
  const secrets = createMemorySecretStore();
  // The server's log goes to the data folder, as the background server's does, so the search below covers it.
  const logFile = join(dataDir, 'logs', 'e2e.log');
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  const options: StartOptions = {
    secrets,
    log: createLogger((line) => appendFileSync(logFile, line)),
    extraAgentEnv: { FAKE_ACP_AUTH: 'claude-terminal', FAKE_LOGIN_STATE: join(stateDir, 'state.json'), FAKE_ACP_REQUIRE_API_KEY: '1' },
  };
  let server = await startServer(dataDir, 0, options);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in');

    await card(page).getByRole('button', { name: 'Use an API key instead' }).click();
    const field = card(page).getByLabel('API key');
    await expect(field).toHaveAttribute('type', 'password');
    // No browser or password manager is invited to save it (review F3): no form, and the opt-outs are set.
    await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    for (const attribute of ['data-1p-ignore', 'data-lpignore', 'data-bwignore']) await expect(field).toHaveAttribute(attribute);
    await expect(card(page).locator('form')).toHaveCount(0);
    // A malformed key is refused in plain words, not echoed, and the field is cleared.
    await field.fill('not-a-key-e2e');
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-api-key-error')).toHaveText("That doesn't look like an Anthropic API key.");
    await expect(field).toHaveValue('');

    // Enter saves, as a form would.
    await field.fill(key);
    await field.press('Enter');
    await expect(card(page).getByTestId('agent-api-key-saved')).toHaveText('API key saved …WXYZ');
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in');
    await expect(card(page)).not.toContainText(key);

    // The chat's Claude Code needs the key (the fake agent refuses a prompt without one).
    await startChat(page, repo);
    await send(page, 'hello');
    await expect(page.getByTestId('message-agent')).toContainText('key received');

    // After a restart the key is read back from the keychain: the card shows its last 4 and it is in use.
    await server.close();
    server = await startServer(dataDir, 0, options);
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-api-key-saved')).toHaveText('API key saved …WXYZ');
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, signed in');

    await card(page).getByRole('button', { name: 'Remove key' }).click();
    await expect(card(page).getByRole('button', { name: 'Use an API key instead' })).toBeVisible();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in');
    expect(await secrets.get('agent-api-key/claude-code')).toBeUndefined();
  } finally {
    await server.close();
  }
  try {
    // Nothing in the data folder (database, event log, logs) holds the key, in any file, as bytes.
    const files = filesUnder(dataDir);
    expect(files.map(({ path }) => path)).toContain(logFile);
    expect(readFileSync(logFile, 'utf8')).toContain('agent API key saved');
    // The database (with the event log) is there to search.
    expect(files.map(({ path }) => path)).toContain(join(dataDir, 'ogden-agents.db'));
    for (const { path, bytes } of files) {
      expect(bytes.includes(Buffer.from(key)), path).toBe(false);
      expect(bytes.includes(Buffer.from('E2E_TEST_ONLY_not_real')), path).toBe(false);
    }
  } finally {
    removeDataDir(dataDir);
    removeDataDir(stateDir);
    removeDataDir(repo);
  }
});

test('not installed, Install shows its size, then its progress, then Installed, needs sign-in, and a chat runs the installed adapter', async ({ page }) => {
  const work = mkdtempSync(join(tmpdir(), 'ogden-agents-e2e-install-'));
  try {
    const npmCli = testNpmCli();
    const { pins, version } = packFakeAdapter(join(work, 'fixture'), { npmCli });
    const { spawnNpm, createLogger } = await serverModule();
    // npm's home is an empty temp folder that must stay empty: nothing is written outside the data folder.
    const home = join(work, 'home');
    mkdirSync(home);
    const repo = join(work, 'repo');
    mkdirSync(repo);
    const lines: string[] = [];
    // The real npm, held a moment after it exits, so the page shows the install under way.
    const heldNpm: typeof spawnNpm = (input) => {
      const run = spawnNpm(input);
      return { kill: run.kill, exited: run.exited.then(async (result) => (await new Promise((resolve) => setTimeout(resolve, 1500)), result)) };
    };
    const extra: StartOptions = {
      claudeAdapterPath: undefined,
      claudeExecutable: null,
      claudeInstall: { devAdapter: false, pins, npmCli, runNpm: heldNpm, env: { ...process.env, HOME: home, USERPROFILE: home } },
      log: createLogger((line) => lines.push(line)),
    };
    await withAgentsServer(page, {}, { ...extra, subscriptionMaxAgeMs: 0 }, async (_server, loginState) => {
      await expect(card(page)).toHaveAttribute('data-install', 'not_installed');
      await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
      // No claude on this computer: the adapter comes with the SDK's own.
      await expect(card(page).getByTestId('agent-install-size')).toHaveText('about 250 MB');

      await card(page).getByRole('button', { name: 'Install' }).click();
      await expect(card(page)).toHaveAttribute('data-install', 'installing');
      await expect(card(page).getByTestId('agent-state')).toContainText('Installing Claude Code');
      await expect(card(page).getByTestId('agent-install-progress')).toBeVisible();

      await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in', { timeout: 30_000 });
      await expect(card(page)).toHaveAttribute('data-install', 'installed');
      await expect(card(page).getByTestId('agent-install-size')).toHaveCount(0);

      // Signed in (a new chat needs it, 6.3), a chat runs through the adapter just installed in the data folder, without a restart.
      writeFileSync(loginState, JSON.stringify({ loggedIn: true }));
      await startChat(page, repo);
      await send(page, 'hello');
      await expect(page.getByTestId('message-agent')).toContainText('Hello from the fake agent.');
      expect(lines.join('')).toContain(`adapter-${version}-bundled`);
      expect(readdirSync(home)).toEqual([]);
    });
  } finally {
    removeDataDir(work);
  }
});
