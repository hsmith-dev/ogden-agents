/**
 * Epic 12 (Grok) on the installed package: a Claude Code chat and a Grok chat
 * at once in one Simple project, the fake agent playing both (the fake's Grok
 * personality through the server's Grok hook; its checked binary is planted as
 * Install leaves it and never run). Grok is an xAI API access token only (user
 * decision, 2026-10-05) and starts only in a project the user trusted: its
 * token reaches only its own process, Ask and Skip all are its modes (never
 * Auto) and fixed once the chat has started, a command waits for its card, a
 * chat continues after a restart, and a Simple project's Grok chat gets nothing
 * BMad. No real Grok, xAI, keychain or network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, requestQuit } from '../support.js';
import { startChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, FAKE_XAI_KEY, waitForExit, type BmadServer, type Launched } from './installed.js';

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

test('Grok beside Claude Code in a trusted Simple project: own token only, a card that holds a command, Ask and Skip all fixed at start, a restart', async ({ page }) => {
  test.setTimeout(300_000);
  const server = bmadServer('journey-grok', { grok: true, env: { [PROBE]: 'planted-secret' } });
  servers.push(server);
  const repo = server.addRepo({ bmad: false, prefix: 'grok-repo-' });
  let launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const claude = await startChat(page, repo.path);
  const wsId = claude.wsId;
  let grokUrl = '';

  await test.step('the picker offers Grok, which says to trust the project first; after Trust a Grok chat starts', async () => {
    await page.goto(`${launched.url}/w/${wsId}`);
    await page.getByTestId('agent-picker').click();
    const grokOption = page.getByTestId('agent-option').filter({ hasText: 'Grok' });
    await expect(grokOption).toHaveCount(1);
    await expect(grokOption).toContainText('trust the project');
    expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    await page.goto(`${launched.url}/w/${wsId}`);
    await page.getByTestId('agent-picker').click();
    const trusted = page.getByTestId('agent-option').filter({ hasText: 'Grok' });
    await expect(trusted).not.toHaveAttribute('aria-disabled', 'true');
    await trusted.click();
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/s\/ses_/);
    grokUrl = page.url();
    await expect(page.getByTestId('session-agent')).toHaveText('Grok');
    await say(page, 'Grok', 'whoami');
    await expect(replies(page).last()).toContainText('agent=grok');
  });

  await test.step("Grok's process gets its own token and home only, and no other agent gets the token (AD-16)", async () => {
    const own = await agentEnv(page, 'Grok');
    // Present in Grok's own process (the chat shows it masked, as every key is: AD-16).
    expect(Object.keys(own)).toContain('XAI_API_KEY');
    expect(JSON.stringify(own)).not.toContain(FAKE_XAI_KEY);
    expect(Object.keys(own)).toContain('GROK_HOME');
    expect(own.GROK_DISABLE_AUTOUPDATER).toBe('1');
    expect(Object.keys(own)).not.toContain(PROBE);
    await page.goto(claude.url);
    const other = await agentEnv(page, 'Claude Code');
    for (const name of ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY', 'GROK_HOME', PROBE]) expect(Object.keys(other), name).not.toContain(name);
    expect(JSON.stringify(other)).not.toContain(FAKE_XAI_KEY);
  });

  await test.step('a shell command waits for its card; Deny and Allow once pick the reject and allow options', async () => {
    await page.goto(grokUrl);
    await composerOf(page, 'Grok').fill('permission npm test');
    await composerOf(page, 'Grok').press('Enter');
    await expect(page.getByTestId('permission-card').getByTestId('permission-command')).toHaveText('npm test', AGENT);
    await page.getByTestId('permission-card').getByRole('button', { name: 'Deny' }).click();
    await expect(replies(page).last()).toContainText('Denied npm test. chose=reject_once', AGENT);
    await composerOf(page, 'Grok').fill('permission npm test');
    await composerOf(page, 'Grok').press('Enter');
    await page.getByTestId('permission-card').getByRole('button', { name: 'Allow once' }).click();
    await expect(replies(page).last()).toContainText('Ran npm test. chose=allow_once', AGENT);
  });

  await test.step('Grok offers Ask and Skip all, never Auto; the server refuses Auto and a change once the chat has started', async () => {
    const sesId = grokUrl.split('/').at(-1)!;
    const ids = { wsId, sesId };
    const auto = await api(page, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'auto' });
    expect(auto.status).toBe(409);
    expect(((await auto.json()) as { error: { code: string } }).error.code).toBe('mode_unavailable');
    expect((await api(page, 'PUT', API_ROUTES.developerMode, { developerMode: true })).status).toBe(200);
    const change = await api(page, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, ids), { mode: 'skip_all', confirm: true });
    expect(change.status).toBe(409);
  });

  await test.step('a Simple project: the Grok chat starts with nothing BMad', async () => {
    await page.goto(grokUrl);
    await say(page, 'Grok', 'session-start');
    await expect(replies(page).last()).toHaveAttribute('data-streaming', 'false');
    const text = (await replies(page).last().locator('p').nth(1).textContent()) ?? '';
    expect((JSON.parse(text) as { prompt: string }).prompt).not.toMatch(/bmad/i);
  });

  await test.step('after a restart the Grok chat continues its session in the mode it started in, and no token is in the log', async () => {
    await quit(page, launched);
    launched = await server.launch();
    await landConnected(page, launched.launchUrl);
    await expectConnected(page);
    await page.goto(grokUrl.replace(/^https?:\/\/[^/]+/, launched.url));
    await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT);
    await say(page, 'Grok', 'context');
    await expect(replies(page).last()).toContainText('via=resumed');
    await say(page, 'Grok', 'mode');
    await expect(replies(page).last()).toContainText('mode=ask');
    expect(readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8')).not.toContain(FAKE_XAI_KEY);
  });
});
