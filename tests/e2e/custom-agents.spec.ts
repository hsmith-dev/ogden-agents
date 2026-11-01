/// <reference lib="dom" />
/**
 * Add your own agent in a real browser (epic 21, story 21.3): the fake ACP
 * agent, started as `node <script>` (Command and Arguments), is tested before
 * it is saved, saved with a key, and shown as a card that says its limits and
 * never the key. A command that doesn't resolve and a forbidden variable name
 * are each one plain sentence, and neither leaves a card. Keys go to the
 * test server's in-memory keychain (`startServer`), never the real one.
 */
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENT, makeDataDir, removeDataDir, startServer } from '../support.js';
import { openConnected } from './tab.js';

const KEY = 'sk-e2e-custom-agent-key-7781bb';

async function withServer(page: Page, path: string, body: () => Promise<void>) {
  const dataDir = makeDataDir();
  const server = await startServer(dataDir, 0);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, path, server.launchUrl);
    await body();
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
}

const form = (page: Page) => page.getByTestId('custom-agent-form');
const cards = (page: Page) => page.getByTestId('custom-agent-card');

test('/settings/agents/new: Test lists what the fake agent says, Add agent saves it as a card, and the key is never shown', async ({ page }) => {
  test.setTimeout(60_000);
  await withServer(page, '/settings/agents/new', async () => {
    await expect(form(page)).toBeVisible();
    await form(page).getByLabel('Name', { exact: true }).fill('Fake harness');
    await form(page).getByLabel('Command', { exact: true }).fill(process.execPath);
    await form(page).getByLabel('Arguments', { exact: true }).fill(FAKE_AGENT);

    // Test before saving: it starts once, lists what it said, and keeps nothing.
    await form(page).getByTestId('custom-agent-form-test').click();
    await expect(form(page).getByTestId('custom-agent-test-lines')).toContainText('It started and says it is fake-acp-agent 1.0.0.');
    await expect(cards(page)).toHaveCount(0);

    // A forbidden variable name: the schema's sentence, and Add agent does nothing.
    await form(page).getByLabel('API key (optional)', { exact: true }).fill(KEY);
    await form(page).getByLabel('Variable name', { exact: true }).fill('PATH');
    await expect(form(page).getByTestId('custom-agent-env-help')).toHaveText('Use capital letters, digits and _ and end the name with _API_KEY, such as MY_AGENT_API_KEY.');
    await expect(form(page).getByTestId('custom-agent-save')).toHaveAttribute('aria-disabled', 'true');

    await form(page).getByLabel('Variable name', { exact: true }).fill('FAKE_HARNESS_API_KEY');
    await form(page).getByTestId('custom-agent-save').click();

    const card = cards(page);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: 'Fake harness' })).toBeVisible();
    await expect(card).toContainText('Your own agent. Ogden asks before everything it does.');
    await expect(card).toContainText('It works in Ask only.');
    await expect(card).toContainText("It can't be a worker in an orchestrated run.");
    await expect(card.getByTestId('custom-agent-key')).toHaveText('An API key is kept in your keychain as FAKE_HARNESS_API_KEY.');
    await expect(form(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings\/agents$/);
    expect(await page.content()).not.toContain(KEY);

    // Test on the card starts the saved command with its kept key.
    await card.getByTestId('custom-agent-test').click();
    await expect(card.getByTestId('custom-agent-test-lines')).toContainText('It started and says it is fake-acp-agent 1.0.0.');

    // After a reload the key is still nowhere in the page, and the agent is still there.
    await page.reload();
    await expect(cards(page)).toHaveCount(1);
    expect(await page.content()).not.toContain(KEY);
  });
});

const REFUSED_KEY = 'sk-e2e-refused-key-91c3';

test('a command that does not resolve is one plain sentence, and no card appears', async ({ page }) => {
  await withServer(page, '/settings/agents', async () => {
    await page.getByTestId('custom-agent-add').click();
    await form(page).getByLabel('Name', { exact: true }).fill('Nothing here');
    await form(page).getByLabel('Command', { exact: true }).fill('ogden-e2e-no-such-program');
    await form(page).getByLabel('API key (optional)', { exact: true }).fill(REFUSED_KEY);
    await form(page).getByLabel('Variable name', { exact: true }).fill('NOTHING_API_KEY');
    await form(page).getByTestId('custom-agent-save').click();
    const error = form(page).getByTestId('custom-agent-error');
    await expect(error).toContainText("Ogden Agents couldn't find");
    await expect(error).toContainText('ogden-e2e-no-such-program');
    // One plain sentence: no stack, no code, no dashes.
    expect(await error.textContent()).not.toMatch(/[–—]|Error:|\bat \//);
    await expect(cards(page)).toHaveCount(0);
    await expect(form(page)).toBeVisible();
    // The form stays open after the refusal, and the key typed into it is gone from the page (cleared at Save).
    await expect(form(page).getByLabel('API key (optional)', { exact: true })).toHaveValue('');
    expect(await page.content()).not.toContain(REFUSED_KEY);
  });
});
