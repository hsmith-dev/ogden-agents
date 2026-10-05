/**
 * Epic 12 (Codex) on the installed package: a Claude Code chat and a Codex
 * chat at once in one Simple project, the fake agent playing both (the fake's
 * Codex personality through the server's Codex hook; its pinned adapter is
 * planted as Install leaves it and never run). Codex is OpenAI API key only
 * (user decision, 2026-10-05): its key reaches only its own process, Ask and
 * Skip all are its modes (never Auto), a command waits for its card (Deny is
 * `decline`), a chat continues after a restart, and a Simple project's Codex
 * chat gets nothing BMad. No real Codex, OpenAI, keychain or network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, requestQuit } from '../support.js';
import { startChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, FAKE_OPENAI_KEY, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];
test.afterAll(async () => {
  for (const server of servers) await server.remove();
});

const AGENT = { timeout: 60_000 };
const PROBE = 'OGDEN_E2E_SECRET_PROBE';
const state = (page: Page) => page.getByTestId('session-state');
const replies = (page: Page) => page.getByTestId('message-agent');
const composerOf = (page: Page, agent: string) => page.getByRole('textbox', { name: `Message ${agent}` });

async function api(page: Page, method: string, path: string, body?: unknown): Promise<Response> {
  const origin = new URL(page.url()).origin;
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token; connect it first');
  return fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function say(page: Page, agent: string, text: string) {
  await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT);
  await composerOf(page, agent).fill(text);
  await composerOf(page, agent).press('Enter');
  await expect(composerOf(page, agent)).toHaveValue('', AGENT);
  await expect(page.getByTestId('message-user').last()).toHaveText(text, AGENT);
  await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT);
  await expect(replies(page)).toHaveCount(await page.getByTestId('message-user').count(), AGENT);
}

async function agentEnv(page: Page, agent: string): Promise<Record<string, string>> {
  await say(page, agent, 'session-start');
  await expect(replies(page).last()).toHaveAttribute('data-streaming', 'false');
  const text = await replies(page).last().locator('p').nth(1).textContent();
  return (JSON.parse(text ?? '') as { env: Record<string, string> }).env;
}

async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('Codex beside Claude Code in a Simple project: own key only, a card that holds a command, Ask and Skip all, a restart', async ({ page }) => {
  test.setTimeout(300_000);
  const server = bmadServer('journey-codex', { codex: true, env: { [PROBE]: 'planted-secret' } });
  servers.push(server);
  const repo = server.addRepo({ bmad: false, prefix: 'codex-repo-' });
  let launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const claude = await startChat(page, repo.path);
  const wsId = claude.wsId;
  let codexUrl = '';

  await test.step('the picker offers Codex, ready with its key, and a Codex chat starts', async () => {
    await page.goto(`${launched.url}/w/${wsId}`);
    await page.getByTestId('agent-picker').click();
    const codexOption = page.getByTestId('agent-option').filter({ hasText: 'Codex' });
    await expect(codexOption).toHaveCount(1);
    await expect(codexOption).not.toHaveAttribute('aria-disabled', 'true');
    await expect(codexOption).toContainText('Installed, using your API key');
    await codexOption.click();
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/s\/ses_/);
    codexUrl = page.url();
    await expect(page.getByTestId('session-agent')).toHaveText('Codex');
    await say(page, 'Codex', 'whoami');
    await expect(replies(page).last()).toContainText('agent=codex');
  });

  await test.step("Codex's process gets its own key and home only, and no other agent gets the key (AD-16)", async () => {
    const own = await agentEnv(page, 'Codex');
    // Present in Codex's own process (the chat shows it masked, as every key is: AD-16).
    expect(Object.keys(own)).toContain('CODEX_API_KEY');
    expect(JSON.stringify(own)).not.toContain(FAKE_OPENAI_KEY);
    expect(Object.keys(own)).toContain('CODEX_HOME');
    expect(Object.keys(own)).not.toContain('CODEX_PATH');
    expect(Object.keys(own)).not.toContain(PROBE);
    await page.goto(claude.url);
    const other = await agentEnv(page, 'Claude Code');
    for (const name of ['CODEX_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME', PROBE]) expect(Object.keys(other), name).not.toContain(name);
    expect(JSON.stringify(other)).not.toContain(FAKE_OPENAI_KEY);
  });

  await test.step('a shell command waits for its card; Deny sends decline, Allow once sends allow_once', async () => {
    await page.goto(codexUrl);
    await composerOf(page, 'Codex').fill('permission npm test');
    await composerOf(page, 'Codex').press('Enter');
    await expect(page.getByTestId('permission-card').getByTestId('permission-command')).toHaveText('npm test', AGENT);
    await page.getByTestId('permission-card').getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).last()).toContainText('Denied npm test. chose=decline', AGENT);
    await composerOf(page, 'Codex').fill('permission npm test');
    await composerOf(page, 'Codex').press('Enter');
    await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(replies(page).last()).toContainText('Ran npm test. chose=allow_once', AGENT);
  });

  await test.step('Codex offers Ask and Skip all, never Auto, and the server refuses Auto', async () => {
    const chat = codexUrl.split('/');
    const sesId = chat.at(-1)!;
    const auto = await api(page, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId }), { mode: 'auto' });
    expect(auto.status).toBe(409);
    expect(((await auto.json()) as { error: { code: string } }).error.code).toBe('mode_unavailable');
  });

  await test.step('a Simple project: the Codex chat starts with nothing BMad', async () => {
    await page.goto(codexUrl);
    await say(page, 'Codex', 'session-start');
    await expect(replies(page).last()).toHaveAttribute('data-streaming', 'false');
    const text = (await replies(page).last().locator('p').nth(1).textContent()) ?? '';
    expect((JSON.parse(text) as { prompt: string }).prompt).not.toMatch(/bmad/i);
  });

  await test.step('after a restart the Codex chat continues its session, and no key is in the log', async () => {
    await quit(page, launched);
    launched = await server.launch();
    await landConnected(page, launched.launchUrl);
    await expectConnected(page);
    await page.goto(codexUrl.replace(/^https?:\/\/[^/]+/, launched.url));
    await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT);
    await say(page, 'Codex', 'context');
    await expect(replies(page).last()).toContainText('via=resumed');
    expect(readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8')).not.toContain(FAKE_OPENAI_KEY);
  });
});
