/**
 * Epic 12 entry 6 end to end on a real server: Codex installed from a local
 * fixture lock (npm's runner stubbed, so nothing is downloaded), given an
 * OpenAI API key through `/api/v1/agents` and chatted with through the fake
 * agent's Codex personality. Codex is API key only (user decision,
 * 2026-10-05): there is no sign-in, and the card says why. No key reaches the
 * database, the event log or the log. No test reaches OpenAI, the keychain or
 * runs the real Codex.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCodexAgent, createCodexSetup, installedCodex, type NpmRunner } from '@ogden-agents/adapters';
import type { ApiKeyVerification } from '@ogden-agents/core';
import { AgentsResponse, API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_CODEX = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-codex.mjs');
const KEY = `sk-proj-${'Q'.repeat(40)}2468`;
const NOTICE = "Codex uses your own OpenAI API key. Signing in with a ChatGPT account isn't supported here, because OpenAI's terms don't allow other apps to use subscription sign-in.";

/** An npm that "installs" the fixture adapter into its working folder, as `npm ci` would. */
const fakeNpm: NpmRunner = (input) => {
  const root = join(input.cwd, 'node_modules', '@agentclientprotocol', 'codex-acp');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@agentclientprotocol/codex-acp', version: '2.1.1' }));
  writeFileSync(join(root, 'dist', 'index.js'), '');
  return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
};

const PINS = {
  packageJson: { name: 'fixture', dependencies: { '@agentclientprotocol/codex-acp': '2.1.1' } },
  lock: { lockfileVersion: 3, packages: { '': {}, 'node_modules/@agentclientprotocol/codex-acp': { version: '2.1.1', integrity: 'sha512-fixture' } } },
};

function codexFromFixture(dataDir: string, verify: () => Promise<ApiKeyVerification> = async () => 'ok') {
  const fake = { command: process.execPath, args: [FAKE_CODEX] };
  return {
    agent: createCodexAgent({ dataDir, server: () => (installedCodex(dataDir, PINS) === undefined ? undefined : fake) }),
    setup: createCodexSetup({ dataDir, install: { pins: PINS, runNpm: fakeNpm, npmCli: FAKE_CODEX }, apiKey: { verify } }),
  };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function allText(dir: string): string {
  let text = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) text += allText(path);
    else if (stat.size < 5_000_000) text += readFileSync(path, 'latin1');
  }
  return text;
}

describe('Codex set up from Settings: Agents (epic 12 entry 6)', { timeout: 120_000 }, () => {
  it('installs, says why there is no sign-in, takes and removes an API key, and chats with it; no key is kept', async () => {
    const dataDir = tempDataDir();
    const lines: string[] = [];
    const server = await startTestServer({ dataDir, lines, codex: codexFromFixture(dataDir) });
    const tab = await signIn(server);
    const repo = tempDataDir();
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    const newChat = () => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'codex' });
    const agentPath = (route: string) => apiPath(route, { agentId: 'codex' });
    const card = async () => AgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.agents)).json()).agents.find((agent) => agent.agentId === 'codex')!;
    const events = () => server.core.events.readAfter(0);
    const picker = async () => ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents.find((agent) => agent.agentId === 'codex')!;

    expect(await card()).toMatchObject({ install: 'not_installed', provider: 'OpenAI', apiKeyOnly: true, notices: [NOTICE] });
    expect((await newChat()).status).toBe(409);

    expect((await request(server, tab, 'POST', agentPath(API_ROUTES.agentInstall))).status).toBe(202);
    await waitFor(() => events().some((event) => event.type === 'agent.install_completed'), 'the install', 60_000);
    expect(await card()).toMatchObject({ install: 'installed', version: '2.1.1', auth: 'needs_sign_in', apiKeyOnly: true, notices: [NOTICE] });
    // Not ready without a key, in words about the key; no sign-in is offered.
    expect(ApiErrorBody.parse(await (await newChat()).json()).error).toMatchObject({ code: 'agent_signed_out', message: 'Codex needs an API key. Add one in Settings → Agents.' });
    expect(await picker()).toMatchObject({ install: 'installed', auth: 'needs_sign_in', signInMethods: [{ kind: 'api_key' }] });
    const signInTry = await request(server, tab, 'POST', agentPath(API_ROUTES.agentSignIn));
    // (The card never offers it; a direct request is answered as a failed sign-in with the reason.)
    expect(await signInTry.json()).toMatchObject({ state: 'failed', url: null });
    expect(await card()).toMatchObject({ auth: 'failed', reason: expect.stringContaining("can't be signed in with an account") });

    // A wrong shape is refused in plain words; a good key is saved and Codex is ready.
    const bad = await request(server, tab, 'PUT', agentPath(API_ROUTES.agentApiKey), { apiKey: 'not-a-key' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await bad.json())).toContain("doesn't look like an OpenAI API key");
    expect((await request(server, tab, 'PUT', agentPath(API_ROUTES.agentApiKey), { apiKey: KEY })).status).toBe(204);
    expect(await card()).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: '2468' } });
    const created = await newChat();
    expect(created.status).toBe(201);
    const session = (await created.json()) as { session: { id: string } };
    await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.session.id }), { text: 'auth' });
    await waitFor(() => events().some((event) => event.type === 'session.message_completed' && event.payload.role === 'agent' && event.payload.content === 'auth=api-key key=2468'), 'the key reached Codex', 20_000);

    // Remove the key: refused again.
    expect((await request(server, tab, 'DELETE', agentPath(API_ROUTES.agentApiKey))).status).toBe(204);
    expect(await card()).toMatchObject({ auth: expect.stringMatching(/^(needs_sign_in|failed)$/), apiKey: { saved: false } });
    expect((await newChat()).status).toBe(409);

    // No key in the event log, the log or the data folder.
    const kept = [JSON.stringify(events()), lines.join('\n'), allText(dataDir)].join('\n');
    expect(kept).not.toContain(KEY);
  });

  it('says a refused key in plain words and does not save it', async () => {
    const dataDir = tempDataDir();
    const server = await startTestServer({ dataDir, codex: codexFromFixture(dataDir, async () => 'refused') });
    const tab = await signIn(server);
    const refused = await request(server, tab, 'PUT', apiPath(API_ROUTES.agentApiKey, { agentId: 'codex' }), { apiKey: KEY });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const card = AgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.agents)).json()).agents.find((agent) => agent.agentId === 'codex')!;
    expect(card.apiKey?.saved).toBe(false);
  });
});
