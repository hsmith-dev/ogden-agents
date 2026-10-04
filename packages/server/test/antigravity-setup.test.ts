/**
 * Epic 6 entry 7 end to end on a real server: Antigravity installed from a
 * local fixture archive (served on 127.0.0.1, its own pin), signed in with
 * the fake Google sign-in of the fake agent's Antigravity personality,
 * signed out, given a key and uninstalled, all through `/api/v1/agents`; the
 * new-chat refusals follow each step (6.6's picker reads the same
 * readiness). No URL, sign-in state or key reaches the database, the event
 * log or the log. No test reaches Google or runs the real server.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createAntigravityAgent, createAntigravitySetup, currentPlatform, pinnedServer, type AntigravityPins } from '@ogden-agents/adapters';
import { API_ROUTES, AgentSetupStatus, AgentsResponse, apiPath, SignInResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { zip } from '../../adapters/test/archives.js';
import { agentHomeDir } from '../src/agent-wiring.js';
import { signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_ANTIGRAVITY = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-antigravity.mjs');
const KEY = `AIza${'Q'.repeat(31)}2468`;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function serveArchive(archive: Buffer): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-length': archive.length, etag: '"fixture"' });
    res.end(archive);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/agy.zip`;
}

async function antigravityFromFixture(dataDir: string) {
  const files = { 'agy_acp_server.par': randomBytes(50_000), localharness_external: randomBytes(1000) };
  const archive = zip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const url = await serveArchive(archive);
  const pins: AntigravityPins = {
    registry: 'antigravity-acp',
    version: '1.3.0',
    archives: {
      [currentPlatform()]: {
        url,
        sha256: sha256(archive),
        size: archive.length,
        binary: 'agy_acp_server.par',
        args: [],
        files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { size: data.length, sha256: sha256(data) }])),
      },
    },
  };
  const fake = { command: process.execPath, args: [FAKE_ANTIGRAVITY] };
  return {
    agent: createAntigravityAgent({ dataDir, server: () => (pinnedServer(dataDir, currentPlatform(), pins) === undefined ? undefined : fake) }),
    setup: createAntigravitySetup({
      dataDir,
      pins,
      homeDir: agentHomeDir(dataDir, 'antigravity'),
      env: () => ({ PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }),
      serverCommand: () => fake,
      apiKey: { verify: async () => 'ok' },
      timeouts: { startMs: 20_000, urlMs: 15_000 },
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

/** Every file under `dir`, as text, for a scan. */
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

describe('Antigravity set up from Settings: Agents (epic 6 entry 7)', { timeout: 120_000 }, () => {
  it('installs, signs in with Google, signs out, takes a key and uninstalls; chats follow; no URL or key is kept', async () => {
    const dataDir = tempDataDir();
    const lines: string[] = [];
    const server = await startTestServer({ dataDir, lines, antigravity: await antigravityFromFixture(dataDir) });
    const tab = await signIn(server);
    const repo = tempDataDir();
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
    const newChat = (agentId = 'antigravity') => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { agentId });
    const agentPath = (route: string) => apiPath(route, { agentId: 'antigravity' });
    const card = async () => AgentsResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.agents)).json()).agents.find((agent) => agent.agentId === 'antigravity')!;
    const events = () => server.core.events.readAfter(0);

    expect(await card()).toMatchObject({ install: 'not_installed', provider: 'Google', installNote: expect.stringContaining('from Google') });
    expect((await newChat()).status).toBe(409);

    // Install.
    expect((await request(server, tab, 'POST', agentPath(API_ROUTES.agentInstall))).status).toBe(202);
    await waitFor(() => events().some((event) => event.type === 'agent.install_completed'), 'the install', 60_000);
    expect(await card()).toMatchObject({ install: 'installed', version: '1.3.0', auth: 'needs_sign_in', canUninstall: true, signInTakesCode: false, signInNote: expect.stringContaining('this computer') });
    expect(await (await newChat()).json()).toMatchObject({ error: { code: 'agent_signed_out' } });

    // Google sign-in: the link only in the no-store answer.
    const started = await request(server, tab, 'POST', agentPath(API_ROUTES.agentSignIn));
    expect(started.headers.get('cache-control')).toBe('no-store');
    const answer = SignInResponse.parse(await started.json());
    expect(answer).toMatchObject({ state: 'signing_in' });
    expect(new URL(answer.url!).hostname).toBe('accounts.google.com');
    writeFileSync(join(agentHomeDir(dataDir, 'antigravity'), 'fake-google-consent'), '');
    await waitFor(() => events().some((event) => event.type === 'agent.auth_changed' && event.payload.agentId === 'antigravity' && event.payload.state === 'signed_in'), 'signed in', 30_000);
    expect(await card()).toMatchObject({ auth: 'signed_in', method: 'subscription', canSignOut: true });
    expect((await newChat()).status).toBe(201);

    // Sign out: refused again; then a key takes over.
    const signedOut = await request(server, tab, 'POST', agentPath(API_ROUTES.agentSignOut));
    expect(signedOut.status).toBe(200);
    expect(AgentSetupStatus.parse(await signedOut.json())).toMatchObject({ auth: 'needs_sign_in' });
    expect(await (await newChat()).json()).toMatchObject({ error: { code: 'agent_signed_out' } });
    expect((await request(server, tab, 'PUT', agentPath(API_ROUTES.agentApiKey), { apiKey: KEY })).status).toBe(204);
    expect(await card()).toMatchObject({ auth: 'signed_in', method: 'api_key', apiKey: { saved: true, lastFour: '2468' } });
    expect((await newChat()).status).toBe(201);

    // Uninstall: not installed, its home kept.
    const removed = await request(server, tab, 'DELETE', agentPath(API_ROUTES.agentInstall));
    expect(removed.status).toBe(200);
    expect(AgentSetupStatus.parse(await removed.json())).toMatchObject({ install: 'not_installed' });
    expect(events().some((event) => event.type === 'agent.uninstalled')).toBe(true);
    expect(readdirSync(join(dataDir, 'agents')).sort()).toEqual(expect.arrayContaining(['antigravity-home']));
    expect(readdirSync(join(dataDir, 'agents'))).not.toContain('antigravity');
    expect(await (await newChat()).json()).toMatchObject({ error: { code: 'agent_not_installed' } });

    // Nothing kept the sign-in link, its state or the key: not the event log, the log or the data folder.
    const kept = [JSON.stringify(events()), lines.join('\n'), allText(dataDir)].join('\n');
    expect(kept).not.toContain('fake-state');
    expect(kept).not.toContain('accounts.google.com');
    expect(kept).not.toContain(KEY);
  });

  it('answers 404 for an unknown agent, and refuses to uninstall or sign out an agent that offers neither', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    expect((await request(server, tab, 'DELETE', apiPath(API_ROUTES.agentInstall, { agentId: 'nobody' }))).status).toBe(404);
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.agentSignOut, { agentId: 'nobody' }))).status).toBe(404);
    expect((await request(server, tab, 'DELETE', apiPath(API_ROUTES.agentInstall, { agentId: 'claude-code' }))).status).toBe(400);
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.agentSignOut, { agentId: 'claude-code' }))).status).toBe(400);
  });
});
