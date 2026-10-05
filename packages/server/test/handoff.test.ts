/**
 * Handoff end to end (user decision 2026-10-04): a real server with Claude
 * Code (the fake ACP agent standing in) and the fake ACP agent registered
 * again as a second agent. The first runs out of usage (the fake's
 * `usage-limit`), the chat is previewed and handed to the second, which gets
 * the brief before the user's message. The server enforces every refusal.
 * No real agent runs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent } from '@ogden-agents/adapters';
import type { AgentDescriptor, AgentPort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, HandoffPreviewResponse, HandoffResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentWiring } from '../src/agent-wiring.js';
import { signIn, startTestServer, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

function secondAgent(descriptor: Partial<AgentDescriptor> = {}): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: 'fake-agent' } });
  const agent: AgentPort = {
    displayName: 'Fake Agent',
    permissionModes: ['ask', 'skip_all'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor('fake-agent', agent, descriptor), agent };
}

const folders: string[] = [];
const servers: TestServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function setUp(second: AgentWiring = secondAgent()) {
  const server = await startTestServer({ extraAgents: [second] });
  servers.push(server);
  const tab = await signIn(server);
  const repo = mkdtempSync(join(tmpdir(), 'ogden-agents-repo-'));
  folders.push(repo);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const session = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), {})).json()).session;
  const sesId = session.id;
  const stream = () => server.core.events.readAfter(0).filter((event) => event.streamId === sesId);
  const replies = () => stream().flatMap((event) => (event.type === 'session.message_completed' && event.payload.role === 'agent' ? [event.payload.content] : []));
  const state = () => server.core.entities.getSession(sesId)!.state;
  const send = async (text: string) => {
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
  };
  const handoffPath = apiPath(API_ROUTES.sessionHandoff, { wsId, sesId });
  return { server, tab, wsId, sesId: sesId as SessionId, stream, replies, state, send, handoffPath };
}

describe('continuing a chat with another agent (handoff)', () => {
  it('a usage limit is usage_limit; the preview names the provider; the handoff switches the agent and sends the brief first', async () => {
    const { server, tab, sesId, stream, replies, state, send, handoffPath } = await setUp();
    await send('hello');
    await waitFor(() => state() === 'idle' && replies().length === 1, 'the first reply', 15_000);
    await send('usage-limit');
    await waitFor(() => state() === 'error', 'the usage limit', 15_000);
    const error = stream().findLast((event) => event.type === 'session.state_changed');
    expect(error?.type === 'session.state_changed' && error.payload).toMatchObject({ state: 'error', errorCode: 'usage_limit' });

    const previewed = await request(server, tab, 'GET', `${handoffPath}?agentId=fake-agent`);
    expect(previewed.status).toBe(200);
    const preview = HandoffPreviewResponse.parse(await previewed.json());
    expect(preview.agent).toEqual({ agentId: 'fake-agent', displayName: 'Fake Agent', provider: 'Fake Provider' });
    expect(preview.brief).toContain('Original goal: hello');
    expect(preview.brief).toContain('until now this chat was with Claude Code');

    const handed = await request(server, tab, 'POST', handoffPath, { agentId: 'fake-agent', brief: preview.brief, message: 'session-start' });
    expect(handed.status).toBe(202);
    expect(HandoffResponse.parse(await handed.json()).session.agentId).toBe('fake-agent');
    await waitFor(() => state() === 'idle' && replies().length === 2, "the second agent's reply", 15_000);
    const started = JSON.parse(replies().at(-1)!) as { prompt: string; env: Record<string, string> };
    expect(started.prompt.startsWith('[Ogden Agents] Handoff:')).toBe(true);
    expect(started.prompt).toContain('User: hello');
    expect(started.env.FAKE_ACP_AGENT_NAME).toBe('fake-agent');
    expect(server.core.entities.getSession(sesId)?.agentId).toBe('fake-agent');
    expect(stream().filter((event) => event.type === 'session.agent_changed')).toHaveLength(1);
  });

  it('refuses, appending nothing: the same agent, an unknown one, no agent, an untrusted project, the terminal driving, a brief too long', async () => {
    const { server, tab, sesId, replies, state, send, handoffPath } = await setUp(secondAgent({ needsProjectTrust: true }));
    await send('hello');
    await waitFor(() => state() === 'idle' && replies().length === 1, 'the first reply', 15_000);
    const before = server.core.events.lastSeq();
    const refused = async (method: string, path: string, body: unknown, status: number, code: string) => {
      const response = await request(server, tab, method, path, body);
      expect(response.status).toBe(status);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe(code);
    };
    await refused('POST', handoffPath, { agentId: 'claude-code', brief: '', message: 'x' }, 400, 'invalid_request');
    await refused('POST', handoffPath, { agentId: 'nope-agent', brief: '', message: 'x' }, 400, 'agent_unknown');
    await refused('GET', handoffPath, undefined, 400, 'invalid_request');
    await refused('POST', handoffPath, { agentId: 'fake-agent', brief: '', message: 'x' }, 409, 'project_not_trusted');
    await refused('POST', handoffPath, { agentId: 'fake-agent', brief: 'x'.repeat(200_001), message: 'x' }, 400, 'invalid_request');
    expect(server.core.events.lastSeq()).toBe(before);
    server.core.entities.setSessionDriver(sesId, 'terminal');
    const driven = server.core.events.lastSeq();
    await refused('GET', `${handoffPath}?agentId=fake-agent`, undefined, 409, 'driver_is_terminal');
    expect(server.core.events.lastSeq()).toBe(driven);
    expect(server.core.entities.getSession(sesId)?.agentId).toBe('claude-code');
  });
});
