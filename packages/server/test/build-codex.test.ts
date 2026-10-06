/**
 * Builds with Codex over REST (epic 17), on a real server with Codex in its
 * wiring slot, its adapter played by the fake ACP agent's Codex personality
 * (`tests/fixtures/fake-codex.mjs`), real `git` on a fixture repo and a fixed
 * sandbox. No test runs the real adapter or Codex, reads `~/.codex`, uses the
 * keychain or reaches OpenAI; the key is the server's environment here.
 */
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexAgent, createFixedSandbox, createMemoryAgentSetup } from '@ogden-agents/adapters';
import type { AgentSetupPort, TicketStorePort } from '@ogden-agents/core';
import { API_ROUTES, apiPath, BuildResponse, ReviewResponse, UNKNOWN_BUILD_AGENT_MESSAGE, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { CodexPorts } from '../src/codex-wiring.js';
import { createFakeBmadRepo, FAKE_BUILD_PLAN, FAKE_BUILD_REPO_FILES, fixtureGit } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createPlanFileTicketStore } from '../../../tests/fixtures/plan-file-ticket-store.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_CODEX = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-codex.mjs');
const KEY = `sk-proj-${'S'.repeat(40)}4321`;
const temp = (prefix: string) => removeAfterTest(mkdtempSync(join(tmpdir(), prefix)));

function codex(unattendedVerified?: boolean): CodexPorts {
  const base = createMemoryAgentSetup({ agentId: 'codex', displayName: 'Codex', installed: true, auth: 'needs_sign_in' });
  const setup: AgentSetupPort = {
    ...base,
    status: async () => ({ ...(await base.status()), subscription: 'signed_out' }),
    apiKey: { envName: 'CODEX_API_KEY', check: () => undefined, verify: async () => 'ok' },
  };
  return { agent: createCodexAgent({ dataDir: temp('ogden-agents-codex-'), server: () => ({ command: process.execPath, args: [FAKE_CODEX] }), ...(unattendedVerified === undefined ? {} : { unattendedVerified }) }), setup };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setup(options: { sandbox?: boolean; verified?: boolean; env?: Record<string, string> } = {}) {
  const repo = createFakeBmadRepo({ git: true, files: FAKE_BUILD_REPO_FILES, prefix: 'ogden-agents-build-repo-' });
  removeAfterTest(repo.path);
  const store = createPlanFileTicketStore([{ ref: '1.1', title: 'Build the thing', plan: FAKE_BUILD_PLAN }]);
  const server = await startTestServer({
    codex: codex(options.verified),
    ticketStore: store as unknown as TicketStorePort,
    sandbox: createFixedSandbox(options.sandbox === true ? { available: true, kind: 'test' } : { available: false, reason: 'none here' }),
    extraAgentEnv: { CODEX_API_KEY: KEY, FAKE_ACP_CHUNK_DELAY_MS: '1', ...options.env },
  });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json()).workspace.id;
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { bmadPieces: ['board', 'builds'] })).status).toBe(200);
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }))).status).toBe(200);
  const review = async () => ReviewResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBuild, { wsId, ref: '1.1' }))).json());
  const settled = async () => {
    let last: ReviewResponse | undefined;
    await waitFor(async () => (last = await review()).outcome !== 'running', 'the run to end', 20_000);
    return last!;
  };
  return { repo, server, tab, wsId, review, settled };
}

describe('a second agent builds (epic 17 tracer): Codex against its fake personality', () => {
  it('an attended Codex build asks a card for each write, runs in the run worktree, and ends as a Claude Code build does', async () => {
    const { repo, server, tab, wsId, settled } = await setup();
    // Codex is asked for by name; the default (Claude Code) is not used.
    const started = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1', mode: 'attended', agent: 'codex' });
    expect(started.status).toBe(201);
    const { run, session } = BuildResponse.parse(await started.json());
    expect(run.agent).toBe('codex');
    expect(session.agentId).toBe('codex');
    expect(run.sandbox).toBe('attended');
    const answered = new Set<string>();
    const pending = () => server.core.events.readAfter(0).find((event) => event.streamId === session.id && event.type === 'permission.requested' && !answered.has(event.payload.requestId));
    for (let asked = 1; asked <= 2; asked++) {
      await waitFor(() => pending() !== undefined, 'a permission card', 15_000);
      const card = pending();
      if (card?.type !== 'permission.requested') throw new Error('not a card');
      answered.add(card.payload.requestId);
      expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionPermission, { wsId, sesId: session.id, requestId: card.payload.requestId }), { decision: asked === 1 ? 'allow_once' : 'deny' })).status).toBe(204);
    }
    const ended = await settled();
    expect(ended.outcome).toBe('verified');
    expect(ended.run.agent).toBe('codex');
    expect(ended.diff).toContain('Built 1.1 by the fake agent.');
    expect(fixtureGit(repo.path, 'cat-file', '-t', ended.headRevision!).trim()).toBe('commit');
    // The agent was asked in Codex's own syntax, and started in Ask (read-only), never in a mode that asks less.
    const sent = server.core.events.readAfter(0).filter((event) => event.streamId === session.id && event.type === 'session.message_completed' && event.payload.role === 'user');
    expect(JSON.stringify(sent)).toContain('$bmad-build-auto ticket 1.1');
    expect(realpathSync.native(run.worktreePath!)).toContain(realpathSync.native(server.dataDir));
  });

  it('an agent that cannot build is refused by name, and an old request without an agent still builds with Claude Code', async () => {
    const { server, tab, wsId } = await setup();
    const refused = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1', mode: 'attended', agent: 'grok' });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain(UNKNOWN_BUILD_AGENT_MESSAGE);
  });

  it('an unattended Codex build starts in workspace-write with the run roots, answers what reaches core by rule, and ends verified', async () => {
    const dump = join(temp('ogden-agents-dump-'), 'env.txt');
    const { server, tab, wsId, settled } = await setup({ sandbox: true, verified: true, env: { FAKE_ACP_BUILD_ENV_DUMP: dump } });
    const started = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1', agent: 'codex' });
    expect(started.status).toBe(201);
    const { run, session } = BuildResponse.parse(await started.json());
    expect(run).toMatchObject({ agent: 'codex', sandbox: 'test' });
    const ended = await settled();
    expect(ended.outcome).toBe('verified');
    // The commit went to the run's own object store, not the repo's (sandboxed runs, story 5.6).
    const seen = `${readFileSync(dump, 'utf8')}\n${readFileSync(`${dump}.session`, 'utf8')}`;
    // The sandbox came at start, in Codex's own places: its mode as its start variable, the run's roots as added directories.
    expect(seen).toContain('INITIAL_AGENT_MODE=workspace-write');
    expect(seen).toContain('session_mode=workspace-write');
    const roots = JSON.parse(/additionalDirectories=(.*)/.exec(seen)![1]!) as string[];
    expect(roots).toContain(realpathSync.native(run.worktreePath!));
    // Never a mode that skips the rule, and the key is only Codex's own.
    expect(seen).toContain(`CODEX_API_KEY=${KEY}`);
    expect(seen).not.toMatch(/ANTHROPIC_API_KEY=|XAI_API_KEY=|GEMINI_API_KEY=/);
    // A write inside the worktree needs no card in workspace-write (as the real sandbox); the one outside it reached core's rule and was refused.
    const transcript = server.core.events.readAfter(0).filter((event) => event.streamId === session.id);
    expect(transcript.some((event) => event.type === 'permission.requested')).toBe(false);
    expect(transcript.some((event) => event.type === 'session.tool_call_updated' && event.payload.toolCallId === 'call-build-escape' && event.payload.status === 'failed')).toBe(true);
    expect(ended.files).toContain('src/built-1.1.txt');
  });

  it('fails closed: with Codex not yet verified an unattended build never starts it, and an attended build still works', async () => {
    const { server, tab, wsId, repo } = await setup({ sandbox: true });
    // Refused before anything is written, with the agent's own plain reason and attended offered; the machine's sandbox does not matter.
    const refused = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { ref: '1.1', agent: 'codex' });
    expect(refused.status).toBe(409);
    const body = JSON.stringify(await refused.json());
    expect(body).toContain('sandbox_unavailable');
    expect(body).toContain('It can build with you watching');
    expect(fixtureGit(repo.path, 'branch', '--format=%(refname:short)').trim()).toBe('main');
  });

  it('Build all ready builds with the agent the request named, and a build session is always Ask whatever the project default', async () => {
    const { server, tab, wsId, settled } = await setup({ sandbox: true, verified: true });
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId }), { defaultPermissionMode: 'auto' })).status).toBe(200);
    const all = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceBuilds, { wsId }), { all: true, agent: 'codex' });
    expect(all.status).toBe(202);
    const ended = await settled();
    expect(ended.run.agent).toBe('codex');
    expect(server.core.entities.getRun(ended.run.id)).toBeDefined();
    const session = server.core.entities.getSession(ended.run.sessionId)!;
    expect(session.agentId).toBe('codex');
    expect(session.permissionMode).toBe('ask');
  });
});
