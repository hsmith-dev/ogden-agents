/// <reference lib="dom" />
/**
 * Epic 12 entry 8 in a real browser: Settings: Agents installs Grok from a
 * local fixture (npm's runner stubbed, its fixture binary unpacked and
 * checked by SHA-256 and never run), says why there is no sign in in every
 * state, takes an xAI API access token (checked by a stub, never xAI), shows
 * it saved, and removes it. Grok is an xAI API access token only (user
 * decision, 2026-10-05). No test reaches xAI, runs the real Grok or touches the keychain.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_GROK, makeDataDir, removeDataDir, serverModule, startServer } from '../support.js';
import { openConnected } from './tab.js';

const KEY = `xai-${'E'.repeat(60)}2468`;
const NOTICE = "Grok works with your own xAI API access token only. Signing in with an account isn't supported here.";
const PLATFORM = `${process.platform}-${process.arch}`;
const BINARY = 'fixture grok binary';

const PINS = {
  packageJson: { name: 'fixture', dependencies: { '@xai-official/grok': '1.0.49' } },
  lock: {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/@xai-official/grok': { version: '1.0.49', integrity: 'sha512-fixture' },
      [`node_modules/@xai-official/grok-${PLATFORM}`]: { version: '1.0.49', integrity: 'sha512-fixture', optional: true },
    },
  },
};

/** Grok's real setup and chat ports on `dataDir`: npm stubbed to lay down the fixture package and binary, the chat the fake. */
async function fixtureGrok(dataDir: string) {
  const { createGrokAgent, createGrokSetup, installedGrok } = await serverModule();
  const fake = { command: process.execPath, args: [FAKE_GROK] };
  const runNpm = (input: { cwd: string }) => {
    const root = join(input.cwd, 'node_modules', '@xai-official', 'grok');
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@xai-official/grok', version: '1.0.49' }));
    writeFileSync(join(root, 'bin', 'grok'), '');
    const platform = join(input.cwd, 'node_modules', '@xai-official', `grok-${PLATFORM}`, 'bin');
    mkdirSync(platform, { recursive: true });
    writeFileSync(join(platform, process.platform === 'win32' ? 'grok.exe.br' : 'grok.br'), brotliCompressSync(Buffer.from(BINARY)));
    return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
  };
  return {
    agent: createGrokAgent({ dataDir, server: () => (installedGrok(dataDir, PINS) === undefined ? undefined : fake) }),
    setup: createGrokSetup({
      dataDir,
      install: { pins: PINS, runNpm, npmCli: FAKE_GROK, binarySha256: { [PLATFORM]: createHash('sha256').update(BINARY).digest('hex') } as never, tokenProbe: async () => true },
      apiKey: { verify: async () => 'ok' },
    }),
  };
}

const card = (page: Page) => page.getByTestId('agent-card-grok');

test('Install, the reason there is no sign in, Add an xAI API access token and Remove token from Settings: Agents', async ({ page }) => {
  test.setTimeout(120_000);
  const dataDir = makeDataDir();
  const server = await startServer(dataDir, 0, { grok: await fixtureGrok(dataDir) });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
    await expect(card(page).getByTestId('agent-notice')).toHaveText(NOTICE);
    await card(page).getByRole('button', { name: 'Install' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, needs an xAI API access token', { timeout: 60_000 });
    await expect(card(page).getByTestId('agent-version')).toHaveText('Version 1.0.49');
    // No sign in is offered, and the reason stays on the card.
    await expect(card(page).getByRole('button', { name: /Sign in/ })).toHaveCount(0);
    await expect(card(page).getByTestId('agent-notice')).toHaveText(NOTICE);

    await card(page).getByRole('button', { name: 'Add an xAI API access token' }).click();
    await card(page).getByLabel('xAI API access token').fill(KEY);
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Installed, using your xAI API access token');
    await expect(card(page).getByTestId('agent-api-key-saved')).toContainText('2468');
    await expect(card(page)).not.toContainText(KEY);
    await expect(card(page).getByTestId('agent-notice')).toHaveText(NOTICE);

    await card(page).getByRole('button', { name: 'Remove token' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('needs an xAI API access token');
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});

test('Link a command instead of installing, refuse a bad one in plain words, and switch back', async ({ page }) => {
  test.setTimeout(120_000);
  const dataDir = makeDataDir();
  // Only the setup port: Grok's own install never runs here, so a chat would spawn through the real adapter
  // reading the linked command from Settings, had one been started.
  const { setup } = await fixtureGrok(dataDir);
  const server = await startServer(dataDir, 0, { grok: { setup } });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConnected(page, '/settings/agents', server.launchUrl);
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');

    await card(page).getByRole('button', { name: 'Link a command you already manage' }).click();
    await card(page).getByLabel('Command to run').fill('/no/such/grok');
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-linked-command-error')).toContainText("couldn't find");
    // Nothing was linked: the card is unchanged and still offers Ogden's own install.
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');

    const linked = `"${process.execPath}" "${FAKE_GROK}"`;
    await card(page).getByLabel('Command to run').fill(linked);
    await card(page).getByRole('button', { name: 'Save' }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Using your own Grok install');
    await expect(card(page).getByTestId('agent-linked-command-saved')).toContainText(linked);
    // Linking is offered whether or not Grok is installed here, and replaces the Install button.
    await expect(card(page).getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);

    await card(page).getByRole('button', { name: "Use Ogden Agents' install instead" }).click();
    await expect(card(page).getByTestId('agent-state')).toContainText('Not installed');
    await expect(card(page).getByRole('button', { name: 'Link a command you already manage' })).toBeVisible();
  } finally {
    await server.close();
    removeDataDir(dataDir);
  }
});
