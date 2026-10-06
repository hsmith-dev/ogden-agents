/// <reference lib="dom" />
/**
 * Epic 6 (every agent, entry 10) against the installed package, in Chromium,
 * on servers of their own started by the installed `ogden` launcher, with
 * the fake agent as Claude Code and its Antigravity personality as
 * Antigravity (`tests/fixtures/fake-antigravity.mjs`, through the server's
 * test hooks, honoured only under `testHooksAllowed`):
 *
 * 1. One Simple project: the picker, a Claude Code chat and an Antigravity
 *    chat at once (one holds a card while the other answers), each agent's
 *    environment (its own key only: AD-16), Antigravity's modes (Ask and
 *    Skip all, never Auto; the server refuses Auto), its protected paths
 *    (`.gemini`, `.agents`, `_bmad`) asking with a card, the project's
 *    default agent, an agent that needs a trusted project refused until it
 *    is trusted, then a restart with both chats resuming.
 * 2. Welcome asks which agent, and the answer is the default for new projects.
 * 3. Settings: Agents installs Antigravity from a local fixture archive
 *    (served on 127.0.0.1, checked against its pinned SHA-256: a tampered
 *    one installs nothing), signs in with Google through the fake, and
 *    uninstalls; a computer with no pinned archive is told so.
 * 4. With Planning on, BMad's skills reach `.agents/skills` only in a project
 *    that uses Antigravity (needs uv; CI provisions it).
 *
 * No real agent, Google account, keychain or network; every server has its
 * own HOME. Each server is quit or stopped, and its folders removed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { zip } from '../../packages/adapters/test/archives.ts';
import { apiPath } from '../../packages/shared/src/api.ts';
import { API_ROUTES, requestQuit } from '../support.js';
import { startChat } from '../e2e/chat-server.js';
import { expectConnected, landConnected, storedToken } from '../e2e/tab.js';
import { bmadServer, uvReady, waitForExit, type BmadServer, type Launched } from './installed.js';

const servers: BmadServer[] = [];
const archives: Server[] = [];

test.afterEach(async ({}, testInfo) => {
  // On a failure, the server's warnings (codes only: the log never holds a path or a secret) say what failed inside it.
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const server of servers) {
    try {
      const lines = readFileSync(join(server.install.dataDir, 'logs', 'server.log'), 'utf8').split('\n');
      console.log(lines.filter((line) => /"level":"(warn|error)"/.test(line)).join('\n'));
    } catch {
      // No log yet.
    }
  }
});

test.afterAll(async () => {
  for (const server of servers) await server.remove();
  for (const archive of archives) archive.close();
});

/** A planted secret in the server's environment: no agent or helper may receive it (AD-16). */
const PROBE = 'OGDEN_E2E_SECRET_PROBE';
/** A Claude Code API key's shape, never a real key: only Claude Code's own process may receive it. */
const FAKE_ANTHROPIC_KEY = `sk-ant-api03-${'E'.repeat(40)}`;
/** A new chat starts its agent first: on a Windows runner that has taken over 15 s (Antigravity: about 17 s, spike 6.1). */
const AGENT = { timeout: 60_000 };

const state = (page: Page) => page.getByTestId('session-state');
const replies = (page: Page) => page.getByTestId('message-agent');
const card = (page: Page) => page.getByTestId('permission-card');
const composerOf = (page: Page, agent: string) => page.getByRole('textbox', { name: `Message ${agent}` });

/** A request to the server with the tab's own token, as the page makes it. */
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

async function addProject(page: Page, path: string): Promise<string> {
  const response = await api(page, 'POST', API_ROUTES.workspaces, { path });
  if (!response.ok) throw new Error(`POST workspaces returned ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { workspace: { id: string } }).workspace.id;
}

/** Starts a chat in `wsId` with `agentId` (none: the project's default) through the REST API, as the picker does. */
async function newChat(page: Page, wsId: string, agentId?: string): Promise<Response> {
  return api(page, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { kind: 'chat', ...(agentId === undefined ? {} : { agentId }) });
}

/**
 * Sends `text` to `agent`'s chat and waits for its reply and the end of the
 * turn. Every message in these chats gets one reply, so the replies are
 * counted against the user's messages (a chat just opened may still be
 * loading its history).
 */
async function say(page: Page, agent: string, text: string) {
  await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT);
  await composerOf(page, agent).fill(text);
  await composerOf(page, agent).press('Enter');
  await expect(composerOf(page, agent)).toHaveValue('', AGENT);
  await expect(page.getByTestId('message-user').last()).toHaveText(text, AGENT);
  await expect(state(page)).toHaveAttribute('data-state', 'idle', AGENT);
  await expect(replies(page)).toHaveCount(await page.getByTestId('message-user').count(), AGENT);
}

/** The environment the chat's agent process got, from the fake's `session-start` reply. */
async function agentEnv(page: Page, agent: string): Promise<Record<string, string>> {
  await say(page, agent, 'session-start');
  await expect(replies(page).last()).toHaveAttribute('data-streaming', 'false');
  const text = await replies(page).last().locator('p').nth(1).textContent();
  return (JSON.parse(text ?? '') as { env: Record<string, string> }).env;
}

/** Quits the server as the UI does, and waits for its process to exit. */
async function quit(page: Page, launched: Launched) {
  const token = await storedToken(page);
  if (token === null) throw new Error('the page has no tab token');
  expect((await requestQuit(launched.url, token)).status).toBe(202);
  await waitForExit(launched.pid);
}

test('two agents at once in a Simple project: picker, own keys only, Antigravity modes and protected paths, the default, the trust gate, then a restart', async ({ page }) => {
  test.setTimeout(420_000);
  const server = bmadServer('journey-agents', { antigravity: true, trustAgent: true, env: { [PROBE]: 'planted-secret', ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY } });
  servers.push(server);
  // Antigravity runs only where it has a pin for this platform (every OS CI runs on has one).
  test.skip(!server.antigravity, 'no Antigravity pin for this platform');
  const repo = server.addRepo({ bmad: false, prefix: 'agents-repo-' });

  let launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);
  const claude = await startChat(page, repo.path);
  const wsId = claude.wsId;
  const chats = `${launched.url}/w/${wsId}`;
  let agyUrl = '';

  await test.step('the picker offers every agent, Claude Code preselected; the trust-needing agent says why it is unavailable', async () => {
    await page.goto(chats);
    const picker = page.getByTestId('agent-picker');
    await expect(picker).toHaveAttribute('data-agent', 'claude-code');
    await picker.click();
    const options = page.getByTestId('agent-option');
    await expect(options).toHaveCount(6);
    await expect(options.nth(0)).toContainText('Claude Code');
    await expect(options.nth(1)).toContainText('Antigravity');
    // Codex ships beside them (epic 12), not ready until it has an OpenAI API key.
    await expect(options.nth(2)).toContainText('Codex');
    // And Grok (epic 12): not ready until it has an xAI API access token, and it needs the project trusted.
    await expect(options.nth(3)).toContainText('Grok');
    // And the Local model (epic 14): no account to sign in to, ready once the server is set up.
    await expect(options.filter({ hasText: 'Local model' })).toHaveCount(1);
    const untrusted = options.filter({ hasText: 'Fake Agent' });
    // Needing the project trusted is fixed in place (epic 12, 12.3): choosable, with its reason and a Trust item.
    await expect(untrusted).not.toHaveAttribute('aria-disabled', 'true');
    await expect(untrusted).toContainText("Fake Agent uses this project's own agent settings, so trust the project before starting a Fake Agent chat.");
    await expect(page.getByTestId('agent-trust-project')).toContainText('Trust this project for Fake Agent');
    await options.nth(1).click();
    await expect(picker).toHaveAttribute('data-agent', 'antigravity');
    await page.getByTestId('new-chat').click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/s\/ses_/);
    agyUrl = page.url();
    await expect(page.getByTestId('session-agent')).toHaveText('Antigravity');
    await say(page, 'Antigravity', 'whoami');
    await expect(replies(page).last()).toContainText('agent=antigravity');
  });

  await test.step('both at once: Antigravity holds a shell command on its card while Claude Code answers', async () => {
    await composerOf(page, 'Antigravity').fill('permission npm test');
    await composerOf(page, 'Antigravity').press('Enter');
    await expect(card(page).getByTestId('permission-command')).toHaveText('npm test', AGENT);
    await expect(state(page)).toHaveAttribute('data-state', 'waiting');
    await page.goto(claude.url);
    await say(page, 'Claude Code', 'whoami');
    await expect(replies(page).last()).toContainText('agent=default');
    const rows = page.getByTestId('status-row');
    await expect(rows.filter({ hasText: 'Antigravity' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Claude Code' })).toHaveCount(1);
    await page.goto(agyUrl);
    await expect(state(page)).toHaveAttribute('data-state', 'waiting');
    await card(page).getByRole('button', { name: 'Allow once' }).click();
    await expect(replies(page).last()).toContainText('Ran npm test. chose=allow');
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
  });

  await test.step("each agent's process gets its own key only, and nothing else of the server's environment (AD-16)", async () => {
    const agy = await agentEnv(page, 'Antigravity');
    expect(Object.keys(agy)).toContain('GEMINI_API_KEY');
    expect(Object.keys(agy)).toContain('GEMINI_HOME');
    for (const name of ['ANTHROPIC_API_KEY', PROBE]) expect(Object.keys(agy), name).not.toContain(name);
    expect(Object.keys(agy).filter((name) => name.startsWith('OGDEN_AGENTS_'))).toEqual([]);
    expect(JSON.stringify(agy)).not.toContain('planted-secret');
    await page.goto(claude.url);
    const own = await agentEnv(page, 'Claude Code');
    for (const name of ['GEMINI_API_KEY', 'GEMINI_HOME', PROBE]) expect(Object.keys(own), name).not.toContain(name);
    expect(JSON.stringify(own)).not.toContain('planted-secret');
  });

  await test.step('Antigravity offers Ask and Skip all, never Auto, and the server refuses Auto', async () => {
    await page.goto(agyUrl);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    const picker = page.getByTestId('permission-mode-picker');
    await expect(picker).toHaveAttribute('data-mode', 'ask');
    await picker.click();
    const auto = page.getByTestId('permission-mode-auto');
    await expect(auto).toHaveAttribute('data-disabled', '');
    await expect(auto).toContainText("Antigravity doesn't offer Auto.");
    await page.keyboard.press('Escape');
    const sesId = new URL(agyUrl).pathname.split('/').at(-1)!;
    const refused = await api(page, 'PUT', apiPath(API_ROUTES.sessionPermissionMode, { wsId, sesId }), { mode: 'auto' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('mode_unavailable');
    await expect(picker).toHaveAttribute('data-mode', 'ask');
  });

  await test.step("its protected paths (.gemini, .agents, _bmad) ask with a card even where an edit wouldn't", async () => {
    const patched = await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { cautionLevel: 'ask_risky_only' });
    expect(patched.status).toBe(200);
    await page.reload();
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await say(page, 'Antigravity', 'permission-kind edit src/a.ts');
    await expect(replies(page).last()).toContainText('Did edit src/a.ts.');
    await expect(card(page)).toHaveCount(0);
    for (const path of ['.gemini/settings.json', '.agents/skills/x/SKILL.md', '_bmad/scripts/config_utils.py']) {
      await composerOf(page, 'Antigravity').fill(`permission-kind edit ${path}`);
      await composerOf(page, 'Antigravity').press('Enter');
      await expect(card(page)).toBeVisible(AGENT);
      await expect(card(page).getByTestId('permission-protected')).toBeVisible();
      await card(page).getByRole('button', { name: 'Deny' }).click();
      await expect(replies(page).last()).toContainText(`Denied edit ${path}.`);
      await expect(state(page)).toHaveAttribute('data-state', 'idle');
    }
  });

  await test.step("the project's default agent: set in Workspace settings, preselected, and a chat with no agent named starts with it", async () => {
    await page.goto(`${chats}/settings`);
    await page.getByTestId('default-agent-antigravity').click();
    await expect(page.getByTestId('default-agent-status')).toHaveText('Saved: new chats start with Antigravity.');
    await page.goto(chats);
    await expect(page.getByTestId('agent-picker')).toHaveAttribute('data-agent', 'antigravity');
    const started = await newChat(page, wsId);
    expect(started.status).toBe(201);
    expect(((await started.json()) as { session: { agentId: string } }).session.agentId).toBe('antigravity');
  });

  await test.step('an agent that needs a trusted project: refused until the project is trusted, and again once its scripts change', async () => {
    const refused = await newChat(page, wsId, 'fake-agent');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('project_not_trusted');
    const bmadRepo = server.addRepo({ bmad: true, files: { '_bmad/scripts/config_utils.py': '# the project\'s own BMad Method script\n' }, prefix: 'trusted-repo-' });
    const trustedId = await addProject(page, bmadRepo.path);
    expect((await newChat(page, trustedId, 'fake-agent')).status).toBe(409);
    expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: trustedId }))).status).toBe(200);
    const started = await newChat(page, trustedId, 'fake-agent');
    expect(started.status).toBe(201);
    const { session } = (await started.json()) as { session: { id: string; agentId: string } };
    expect(session.agentId).toBe('fake-agent');
    await page.goto(`${launched.url}/w/${trustedId}/s/${session.id}`);
    await say(page, 'Fake Agent', 'whoami');
    await expect(replies(page).last()).toContainText('agent=fake-agent');
    // The third agent gets no other agent's key either (AD-16).
    const own = await agentEnv(page, 'Fake Agent');
    for (const name of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GEMINI_HOME', PROBE]) expect(Object.keys(own), name).not.toContain(name);
    expect(JSON.stringify(own)).not.toContain('planted-secret');
    // The trust is bound to the scripts as they were (story 4.13): changed, it is asked again.
    const script = join(bmadRepo.path, '_bmad', 'scripts', 'config_utils.py');
    writeFileSync(script, `${readFileSync(script, 'utf8')}\n# changed\n`);
    const again = await newChat(page, trustedId, 'fake-agent');
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('project_not_trusted');
    // The same trust is bound to the files the agent runs (epic 12, 12.3): trusted again, a changed `.mcp.json` asks again.
    expect((await api(page, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: trustedId }))).status).toBe(200);
    expect((await newChat(page, trustedId, 'fake-agent')).status).toBe(201);
    writeFileSync(join(bmadRepo.path, '.mcp.json'), '{"mcpServers":{"planted":{"command":"node"}}}\n');
    const mcp = await newChat(page, trustedId, 'fake-agent');
    expect(mcp.status).toBe(409);
    expect(((await mcp.json()) as { error: { code: string } }).error.code).toBe('project_not_trusted');
    // The picker for that project offers Trust, and the prompt allows it as the files are now.
    await page.goto(`${launched.url}/w/${trustedId}`);
    await page.getByTestId('agent-picker').click();
    await page.getByTestId('agent-trust-project').click();
    await expect(page.getByTestId('script-trust-prompt')).toBeVisible();
    await expect(page.getByTestId('script-trust-prompt')).toHaveAttribute('data-changed', 'true');
    await page.getByTestId('script-trust-allow').click();
    await expect(page.getByTestId('script-trust-prompt')).toBeHidden();
    expect((await newChat(page, trustedId, 'fake-agent')).status).toBe(201);
  });

  await test.step('after a restart, both chats continue their sessions', async () => {
    await page.goto(agyUrl);
    await expect(state(page)).toHaveAttribute('data-state', 'idle');
    await quit(page, launched);
    launched = await server.launch();
    await landConnected(page, launched.launchUrl);
    await expectConnected(page);
    const origin = launched.url;
    for (const [url, agent] of [
      [agyUrl, 'Antigravity'],
      [claude.url, 'Claude Code'],
    ] as const) {
      await page.goto(`${origin}${new URL(url).pathname}`);
      await expect(replies(page).first()).toBeVisible();
      await say(page, agent, 'session-start');
      await expect(replies(page).last()).toContainText('"via":"resumed"');
    }
    await quit(page, launched);
  });
});

test('Welcome asks which agent, and the answer is the default for new projects', async ({ page }) => {
  test.setTimeout(180_000);
  const server = bmadServer('journey-welcome-agent', { antigravity: true, firstRun: true });
  servers.push(server);
  test.skip(!server.antigravity, 'no Antigravity pin for this platform');
  const repo = server.addRepo({ bmad: false, prefix: 'welcome-repo-' });
  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(launched.launchUrl);
  await expect(page).toHaveURL(`${launched.url}/welcome`);
  await expect.poll(() => storedToken(page)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(page.getByTestId('welcome-page')).toHaveAttribute('data-step', 'agent');
  await expect(page.getByTestId('welcome-agent-choice')).toBeVisible();
  await expect(page.getByTestId('welcome-agent-claude-code')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('welcome-agent-antigravity').click();
  await expect(page.getByTestId('welcome-agent-antigravity')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('agent-card-antigravity')).toBeVisible();
  await expect
    .poll(async () => ((await (await api(page, 'GET', API_ROUTES.newProjectDefaults)).json()) as { defaults: { defaultAgentId?: string } }).defaults.defaultAgentId)
    .toBe('antigravity');
  const wsId = await addProject(page, repo.path);
  const started = await newChat(page, wsId);
  expect(started.status).toBe(201);
  expect(((await started.json()) as { session: { agentId: string } }).session.agentId).toBe('antigravity');
  await quit(page, launched);
});

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Serves `archive()` (read at each request) on 127.0.0.1, as the pinned download URL. */
async function serveArchive(archive: () => Buffer): Promise<string> {
  const server = createServer((_req, res) => {
    const body = archive();
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  archives.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/agy.zip`;
}

/** Antigravity's pins for a fixture archive at `url`, under `platform`. */
function fixturePins(url: string, archive: Buffer, files: Record<string, Buffer>, platform: string) {
  return {
    registry: 'antigravity-acp',
    version: '1.3.0',
    archives: {
      [platform]: {
        url,
        sha256: sha256(archive),
        size: archive.length,
        binary: 'agy_acp_server.par',
        args: [],
        files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { size: data.length, sha256: sha256(data) }])),
      },
    },
  };
}

const agentCard = (page: Page) => page.getByTestId('agent-card-antigravity');

test('Settings: Agents installs Antigravity from a local fixture archive (a tampered one installs nothing), signs in with Google, and uninstalls', async ({ page, context }) => {
  test.setTimeout(240_000);
  const files = { 'agy_acp_server.par': randomBytes(40_000), localharness_external: randomBytes(500) };
  const good = zip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const tampered: Buffer = Buffer.from(good);
  tampered[tampered.length - 30] = (tampered[tampered.length - 30] ?? 0) ^ 0xff;
  let serving: Buffer = tampered;
  const url = await serveArchive(() => serving);
  const server = bmadServer('journey-agy-install', { antigravityPins: fixturePins(url, good, files, `${process.platform}-${process.arch}`) });
  servers.push(server);
  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await page.goto(`${launched.url}/settings/agents`);

  // The stand-in Google page: visiting it is the user approving (the fake signs in when it sees the file).
  // Held until the test has seen the card's "Finish signing in" step: the fake approves instantly, so without the
  // gate the card can go straight to "signed in" before the (transient) message is ever polled, most often on a slow runner.
  let approve!: () => void;
  const approved = new Promise<void>((resolve) => (approve = resolve));
  await context.route('https://accounts.google.com/**', async (route) => {
    await approved;
    writeFileSync(join(server.antigravityHome, 'fake-google-consent'), '');
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google</title><p>Signed in. You can close this tab.</p>' });
  });

  await expect(agentCard(page).getByTestId('agent-state')).toContainText('Not installed');
  await agentCard(page).getByRole('button', { name: 'Install' }).click();
  await expect(agentCard(page)).toContainText("The download didn't match the expected file, so nothing was installed.", AGENT);
  expect(existsSync(join(server.install.dataDir, 'agents', 'antigravity', '1.3.0'))).toBe(false);

  serving = good;
  await agentCard(page).getByRole('button', { name: 'Try again' }).click();
  await expect(agentCard(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in', { timeout: 90_000 });
  await expect(agentCard(page).getByTestId('agent-version')).toHaveText('Version 1.3.0');

  await agentCard(page).getByRole('button', { name: 'Sign in with your account' }).click();
  await expect(agentCard(page)).toContainText('Finish signing in in the tab that just opened.');
  approve();
  if (process.platform === 'win32') {
    // Windows: Antigravity opens the browser itself; the card offers the link.
    await expect(agentCard(page).getByRole('link', { name: 'Open the sign-in page' })).toHaveAttribute('href', /^https:\/\/accounts\.google\.com\//);
    writeFileSync(join(server.antigravityHome, 'fake-google-consent'), '');
  }
  await expect(agentCard(page).getByTestId('agent-state')).toContainText('Installed, signed in', { timeout: 90_000 });

  await agentCard(page).getByRole('button', { name: 'Sign out' }).click();
  await expect(agentCard(page).getByTestId('agent-state')).toContainText('Installed, needs sign-in', { timeout: 60_000 });
  await agentCard(page).getByRole('button', { name: 'Uninstall' }).click();
  await agentCard(page).getByRole('group', { name: 'Uninstall Antigravity?' }).getByRole('button', { name: 'Uninstall' }).click();
  await expect(agentCard(page).getByTestId('agent-state')).toContainText('Not installed');
  await expect(agentCard(page).getByRole('button', { name: 'Install' })).toBeVisible();
  await quit(page, launched);
});

test('a computer with no pinned Antigravity archive is told so, with no Install', async ({ page }) => {
  test.setTimeout(120_000);
  const files = { 'agy_acp_server.par': randomBytes(1_000) };
  const archive = zip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const url = await serveArchive(() => archive);
  const elsewhere = `${process.platform}-${process.arch}` === 'linux-arm64' ? 'darwin-x64' : 'linux-arm64';
  const server = bmadServer('journey-agy-unsupported', { antigravityPins: fixturePins(url, archive, files, elsewhere) });
  servers.push(server);
  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await page.goto(`${launched.url}/settings/agents`);
  await expect(agentCard(page).getByTestId('agent-unavailable')).toContainText("Antigravity isn't available on this computer.");
  await expect(agentCard(page).getByRole('button', { name: 'Install' })).toHaveCount(0);
  await quit(page, launched);
});

test("with Planning on, BMad's skills reach .agents/skills only in a project that uses Antigravity", async ({ page }) => {
  test.skip(!uvReady(), 'needs uv and its managed Python 3.12 on PATH (CI provisions both)');
  test.setTimeout(420_000);
  const server = bmadServer('journey-agy-skills', { antigravity: true, bmadSource: true });
  servers.push(server);
  test.skip(!server.antigravity, 'no Antigravity pin for this platform');
  const agyRepo = server.addRepo({ bmad: false, prefix: 'agy-skills-' });
  const claudeRepo = server.addRepo({ bmad: false, prefix: 'claude-skills-' });
  const launched = await server.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  await landConnected(page, launched.launchUrl);
  await expectConnected(page);

  for (const [repo, antigravity] of [
    [agyRepo, true],
    [claudeRepo, false],
  ] as const) {
    const wsId = await addProject(page, repo.path);
    if (antigravity) expect((await api(page, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { defaultAgentId: 'antigravity' })).status).toBe(200);
    await page.goto(`${launched.url}/w/${wsId}/settings`);
    const planning = page.getByRole('switch', { name: 'Planning', exact: true });
    await planning.click();
    await expect(planning).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('bmad-setup-done')).toHaveText('Ready to plan.', { timeout: 180_000 });
    expect(existsSync(join(repo.path, '.claude', 'skills', 'bmad-spec', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repo.path, '.agents', 'skills', 'bmad-spec', 'SKILL.md')), repo.path).toBe(antigravity);
  }
  await quit(page, launched);
});
