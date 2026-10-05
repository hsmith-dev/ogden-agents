/**
 * Epic 12 entry 8 end to end on a real server: Grok installed from a local
 * fixture lock (npm's runner stubbed, so nothing is downloaded), given an
 * xAI API key through `/api/v1/agents` and chatted with through the fake
 * agent's Grok personality. Grok is API key only (user decision,
 * 2026-10-05): there is no sign-in, and the card says why. No key reaches the
 * database, the event log or the log. No test reaches xAI, the keychain or
 * runs the real Grok.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { createGrokAgent, createGrokSetup, installedGrok, type NpmRunner } from '@ogden-agents/adapters';
import type { ApiKeyVerification } from '@ogden-agents/core';
import { AgentsResponse, API_ROUTES, ApiErrorBody, apiPath, ChatAgentsResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_GROK = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-grok.mjs');
const KEY = `xai-${'Q'.repeat(60)}2468`;
const NOTICE = "Grok works with your own xAI API access token only. Signing in with an account isn't supported here.";
const PLATFORM = `${process.platform}-${process.arch}`;
const BINARY = 'fixture grok binary';

/** An npm that "installs" the fixture package and this platform's compressed binary, as `npm ci` would. */
const fakeNpm: NpmRunner = (input) => {
  const root = join(input.cwd, 'node_modules', '@xai-official', 'grok');
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@xai-official/grok', version: '1.0.49' }));
  writeFileSync(join(root, 'bin', 'grok'), '');
  const platform = join(input.cwd, 'node_modules', '@xai-official', `grok-${PLATFORM}`, 'bin');
  mkdirSync(platform, { recursive: true });
  writeFileSync(join(platform, process.platform === 'win32' ? 'grok.exe.br' : 'grok.br'), brotliCompressSync(Buffer.from(BINARY)));
  return { exited: Promise.resolve({ exitCode: 0 }), kill: () => {} };
};

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

function grokFromFixture(dataDir: string, verify: () => Promise<ApiKeyVerification> = async () => 'ok') {
  const fake = { command: process.execPath, args: [FAKE_GROK] };
  return {
    agent: createGrokAgent({ dataDir, server: () => (installedGrok(dataDir, PINS) === undefined ? undefined : fake) }),
    setup: createGrokSetup({
      dataDir,
      install: { pins: PINS, runNpm: fakeNpm, npmCli: FAKE_GROK, binarySha256: { [PLATFORM]: createHash('sha256').update(BINARY).digest('hex') } as never, tokenProbe: async () => true },
      apiKey: { verify },
    }),
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

describe('Grok set up from Settings: Agents (epic 12 entry 8)', { timeout: 120_000 }, () => {
  it('installs, says why there is no sign-in, takes and removes an API key, and chats with it; no key is kept', async () => {
    const dataDir = tempDataDir();
    const lines: string[] = [];
    const server = await startTestServer({ dataDir, lines, grok: grokFromFixture(dataDir) });
    const tab = await signIn(server);
    const repo = tempDataDir();
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
    const newChat = () => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId: 'grok' });
    const agentPath = (route: string) => apiPath(route, { agentId: 'grok' });
    const card = async () => AgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.agents)).json()).agents.find((agent) => agent.agentId === 'grok')!;
    const events = () => server.core.events.readAfter(0);
    const picker = async () => ChatAgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.chatAgents)).json()).agents.find((agent) => agent.agentId === 'grok')!;

    expect(await card()).toMatchObject({ install: 'not_installed', provider: 'xAI', apiKeyOnly: true, notices: [NOTICE] });
    expect((await newChat()).status).toBe(409);

    expect((await request(server, tab, 'POST', agentPath(API_ROUTES.agentInstall))).status).toBe(202);
    await waitFor(() => events().some((event) => event.type === 'agent.install_completed'), 'the install', 60_000);
    expect(await card()).toMatchObject({ install: 'installed', version: '1.0.49', auth: 'needs_sign_in', apiKeyOnly: true, notices: [NOTICE] });
    // Not ready without a key, in words about the key; no sign-in is offered.
    expect(ApiErrorBody.parse(await (await newChat()).json()).error).toMatchObject({ code: 'agent_signed_out', message: 'Grok needs your xAI API access token. Add it in Settings → Agents.' });
    expect(await picker()).toMatchObject({ install: 'installed', auth: 'needs_sign_in', signInMethods: [{ kind: 'api_key' }] });
    const signInTry = await request(server, tab, 'POST', agentPath(API_ROUTES.agentSignIn));
    // (The card never offers it; a direct request is answered as a failed sign-in with the reason.)
    expect(await signInTry.json()).toMatchObject({ state: 'failed', url: null });
    expect(await card()).toMatchObject({ auth: 'failed', reason: expect.stringContaining("can't be signed in with an account") });

    // A wrong shape is refused in plain words; a good key is saved and Grok is ready.
    const bad = await request(server, tab, 'PUT', agentPath(API_ROUTES.agentApiKey), { apiKey: 'not-a-key' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await bad.json())).toContain("doesn't look like an xAI API access token");
    expect((await request(server, tab, 'PUT', agentPath(API_ROUTES.agentApiKey), { apiKey: KEY })).status).toBe(204);
    expect(await card()).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: '2468' } });
    const created = await newChat();
    expect(created.status).toBe(201);
    const session = (await created.json()) as { session: { id: string } };
    await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId: session.session.id }), { text: 'auth' });
    await waitFor(() => events().some((event) => event.type === 'session.message_completed' && event.payload.role === 'agent' && event.payload.content === 'auth=xai.api_key key=2468'), 'the key reached Grok', 20_000);

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
    const server = await startTestServer({ dataDir, grok: grokFromFixture(dataDir, async () => 'refused') });
    const tab = await signIn(server);
    const refused = await request(server, tab, 'PUT', apiPath(API_ROUTES.agentApiKey, { agentId: 'grok' }), { apiKey: KEY });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const card = AgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.agents)).json()).agents.find((agent) => agent.agentId === 'grok')!;
    expect(card.apiKey?.saved).toBe(false);
  });
});
