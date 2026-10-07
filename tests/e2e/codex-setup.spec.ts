/// <reference lib="dom" />
/**
 * Epic 12 entry 6 in a real browser: Settings: Agents installs Codex from a
 * local fixture (npm's runner stubbed), says why there is no sign in, takes
 * an OpenAI API key (checked by a stub, never OpenAI), shows Key saved, and
 * removes it; a Codex chat then answers beside Claude Code through the fake
 * agent's Codex personality. Codex is API key only (user decision,
 * 2026-10-05). No test reaches OpenAI, runs the real Codex or touches the keychain.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_CODEX, makeDataDir, removeDataDir, serverModule, startServer } from '../support.js';
import { openConnected } from './tab.js';

const KEY = `sk-proj-${'E'.repeat(40)}2468`;
const NOTICE = "Codex uses your own OpenAI API key. Signing in with a ChatGPT account isn't supported here, because OpenAI's terms don't allow other apps to use subscription sign-in.";

const PINS = {
  packageJson: { name: 'fixture', dependencies: { '@agentclientprotocol/codex-acp': '2.1.1' } },
  lock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/@agentclientprotocol/codex-acp': { version: '2.1.1', integrity: 'sha512-fixture' } } },
};

/** Codex's real setup and chat ports on `dataDir`: npm stubbed to lay down the fixture adapter, the chat the fake. */
async function fixtureCodex(dataDir: string) {
  const { createCodexAgent, createCodexSetup, installedCodex } = await serverModule();
  const fake = { command: process.execPath, args: [FAKE_CODEX] };
  const runNpm = (input: { cwd: string }) => {
    const root = join(input.cwd, 'node_modules', '@agentclientprotocol', 'codex-acp');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@agentclientprotocol/codex-acp', version: '2.1.1' }));
    writeFileSync(join(root, 'dist', 'index.js'), '');
    return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
  };
  return {
    agent: createCodexAgent({ dataDir, server: () => (installedCodex(dataDir, PINS) === undefined ? undefined : fake) }),
    setup: createCodexSetup({ dataDir, install: { pins: PINS, runNpm, npmCli: FAKE_CODEX }, apiKey: { verify: async () => 'ok' } }),
  };
}

const card = (page: Page) => page.getByTestId('agent-card-codex');

test('Install, the reason there is no sign in, Add an API key and Remove key from Settings: Agents', async ({ page }) => {
  test.setTimeout(120_000);
  const dataDir = makeDataDir();
  const server = await startServer(dataDir, 0, { codex: await fixtureCodex(dataDir) });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
    await expect(card(page).getByTestId('agent-notice')).toHaveText(NOTICE);
    await card(page).getByRole('button', { name: 'Install' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs an API key', { timeout: 60_000 });
    await expect(card(page).getByTestId('agent-version')).toHaveText('Version 2.1.1');
    // No sign in is offered, and the reason stays on the card.
    await expect(card(page).getByRole('button', { name: /Sign in/ })).toHaveCount(0);
    await expect(card(page).getByTestId('agent-notice')).toHaveText(NOTICE);

    await card(page).getByRole('button', { name: 'Add an API key' }).click();
    await card(page).getByLabel('API key').fill(KEY);
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, using your API key');
    await expect(card(page).getByTestId('agent-api-key-saved')).toContainText('2468');
    await expect(card(page)).not.toContainText(KEY);

    await card(page).getByRole('button', { name: 'Remove key' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('needs an API key');
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('Link a command instead of installing, refuse a bad one in plain words, and switch back', async ({ page }) => {
  test.setTimeout(120_000);
  const dataDir = makeDataDir();
  // Only the setup port: Codex's own install never runs here, so a chat would spawn through the real adapter
  // reading the linked command from Settings, had one been started.
  const { setup } = await fixtureCodex(dataDir);
  const server = await startServer(dataDir, 0, { codex: { setup } });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');

    await card(page).getByRole('button', { name: 'Link a command you already manage' }).click();
    await card(page).getByLabel('Command to run').fill('/no/such/codex-acp');
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-linked-command-error')).toContainText("couldn't find");
    // Nothing was linked: the card is unchanged and still offers Ogden's own install.
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');

    const linked = `"${process.execPath}" "${FAKE_CODEX}"`;
    await card(page).getByLabel('Command to run').fill(linked);
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Using your own Codex install');
    await expect(card(page).getByTestId('agent-linked-command-saved')).toContainText(linked);
    // Linking is offered whether or not Codex is installed here, and replaces the Install button.
    await expect(card(page).getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);

    await card(page).getByRole('button', { name: "Use Ogden Agents' install instead" }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
    await expect(card(page).getByRole('button', { name: 'Link a command you already manage' })).toBeVisible();
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});
