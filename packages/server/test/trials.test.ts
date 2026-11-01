/**
 * Trials on the real server with real git and two fake ACP agents (epic
 * 27, 27.8; CAP-35): a start makes one worktree chat per agent (distinct
 * branches and ports), each sent the task, answering 201 with the trial;
 * the list and the trial read back; an unknown agent is 409
 * `invalid_operation` and a machine 400, nothing made; Keep this one puts
 * the other's copy away (`not_kept`) and Restore brings its file back;
 * Keep with Delete is 409 `uncommitted_changes` for a changed copy until
 * confirmed; a second Keep is 409 `invalid_operation`. Nothing is merged:
 * the main checkout never changes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeCodeAgent } from '@ogden-agents/adapters';
import type { AgentPort } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, TrialResponse, TrialsResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import type { AgentWiring } from '../src/agent-wiring.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, testDescriptor, waitFor, type SignedIn, type TestServer } from './helpers.js';

const FAKE_AGENT = join(import.meta.dirname, '..', '..', '..', 'tests', 'fixtures', 'fake-acp-agent.mjs');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The fake ACP agent as another agent, `agentId`. */
function fakeAgent(agentId: string, displayName: string): AgentWiring {
  const base = createClaudeCodeAgent({ adapterPath: FAKE_AGENT, claudeExecutable: null });
  const named = <T extends { env: Readonly<Record<string, string>> }>(input: T): T => ({ ...input, env: { ...input.env, FAKE_ACP_AGENT_NAME: agentId } });
  const agent: AgentPort = {
    displayName,
    permissionModes: ['ask', 'skip_all'],
    skillInvocation: (skill, idea) => base.skillInvocation(skill, idea),
    startSession: (input) => base.startSession(named(input)),
    reopenSession: (input) => base.reopenSession(named(input)),
    listAuthMethods: (input) => base.listAuthMethods(input),
  };
  return { descriptor: testDescriptor(agentId, agent), agent };
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function project() {
  const repo = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-try-repo-'))));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  return repo;
}

const mainCheckout = (repo: string) => ({ head: git(repo, 'rev-parse', 'HEAD'), status: git(repo, 'status', '--porcelain'), branch: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD') });
const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content).toString('base64')}`;
const agentReplies = (server: TestServer, sessionId: SessionId): string[] =>
  server.core.events.readAfter(0).flatMap((event) => (event.type === 'session.message_completed' && event.streamId === sessionId && event.payload.role === 'agent' ? [event.payload.content] : []));

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ApiErrorBody.parse(await response.json()).error.code).toBe(code);
}

async function open() {
  const repo = project();
  const server = await startTestServer({ dataDir: tempDataDir(), extraAgents: [fakeAgent('fake-a', 'Fake A'), fakeAgent('fake-b', 'Fake B')] });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  const trials = apiPath(API_ROUTES.workspaceTrials, { wsId });
  const start = async (text: string) => {
    const response = await request(server, tab, 'POST', trials, { text, agentIds: ['fake-a', 'fake-b'] });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { trial } = TrialResponse.parse(await response.json());
    for (const id of trial.sessionIds) {
      await waitFor(() => agentReplies(server, id).length > 0, 'the reply', 20_000);
      await waitFor(() => server.core.entities.getSession(id)?.state === 'idle', 'idle', 20_000);
    }
    return trial;
  };
  const keep = (tryId: string, body: unknown) => request(server, tab, 'POST', apiPath(API_ROUTES.workspaceTrialKeep, { wsId, tryId }), body);
  return { server, tab, wsId, repo, trials, start, keep };
}

describe('trials on the real server (27.8)', () => {
  it('starts two agents side by side, keeps one, puts the other away, and Restore brings its file back; nothing is merged', async () => {
    const kit = await open();
    const before = mainCheckout(kit.repo);
    const trial = await kit.start(writeFile('result.txt', 'an answer\n'));
    const sessions = trial.sessionIds.map((id) => kit.server.core.entities.getSession(id)!);
    expect(sessions.map((session) => session.agentId)).toEqual(['fake-a', 'fake-b']);
    expect(new Set(sessions.map((session) => session.branch)).size).toBe(2);
    const ports = sessions.map((session) => kit.server.core.worktreePorts?.portOf(session.id));
    expect(new Set(ports).size).toBe(2);
    for (const session of sessions) expect(readFileSync(join(session.worktreePath!, 'result.txt'), 'utf8')).toBe('an answer\n');
    // Read back: the list and the one.
    expect(TrialsResponse.parse(await (await request(kit.server, kit.tab, 'GET', kit.trials)).json()).trials.map((each) => each.id)).toEqual([trial.id]);
    const read = await request(kit.server, kit.tab, 'GET', apiPath(API_ROUTES.workspaceTrial, { wsId: kit.wsId, tryId: trial.id }));
    expect(TrialResponse.parse(await read.json()).trial).toMatchObject({ text: writeFile('result.txt', 'an answer\n'), keptSessionId: null });

    const [kept, other] = sessions as [(typeof sessions)[number], (typeof sessions)[number]];
    const response = await kit.keep(trial.id, { sessionId: kept.id });
    expect(response.status).toBe(200);
    expect(TrialResponse.parse(await response.json()).trial.chats.map((chat) => chat.result)).toEqual(['kept', 'put_away']);
    expect(kit.server.core.worktreePutAway.get(other.id)).toMatchObject({ cause: 'not_kept', files: 1 });
    await waitFor(() => !existsSync(other.worktreePath!), 'its folder removed', 20_000);
    expect(git(kit.repo, 'branch', '--list', other.branch!).trim()).not.toBe('');
    // The kept chat is untouched, and nothing reached the main checkout.
    expect(readFileSync(join(kept.worktreePath!, 'result.txt'), 'utf8')).toBe('an answer\n');
    expect(mainCheckout(kit.repo)).toEqual(before);
    await expectError(await kit.keep(trial.id, { sessionId: other.id }), 409, 'invalid_operation');

    // Restore: a normal worktree chat again, with its file.
    const restored = await request(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.sessionWorktreeRestore, { wsId: kit.wsId, sesId: other.id }));
    expect(restored.status).toBe(200);
    expect(readFileSync(join(other.worktreePath!, 'result.txt'), 'utf8')).toBe('an answer\n');
  });

  it('refuses deleting a changed copy until confirmed, then deletes it', async () => {
    const kit = await open();
    const trial = await kit.start(writeFile('draft.txt', 'not committed\n'));
    const [kept, other] = trial.sessionIds as [SessionId, SessionId];
    const copy = kit.server.core.entities.getSession(other)!.worktreePath!;
    await expectError(await kit.keep(trial.id, { sessionId: kept, others: 'delete' }), 409, 'uncommitted_changes');
    expect(existsSync(copy)).toBe(true);
    const response = await kit.keep(trial.id, { sessionId: kept, others: 'delete', discard: [other] });
    expect(response.status).toBe(200);
    expect(TrialResponse.parse(await response.json()).trial.chats.map((chat) => chat.result)).toEqual(['kept', 'removed']);
    expect(kit.server.core.entities.getSession(other)).toBeUndefined();
    expect(existsSync(copy)).toBe(false);
  });

  it('makes nothing for an unknown agent (409) or a machine (400), and answers 404 for an unknown trial', async () => {
    const kit = await open();
    await expectError(await request(kit.server, kit.tab, 'POST', kit.trials, { text: 'Fix it', agentIds: ['fake-a', 'nobody'] }), 409, 'invalid_operation');
    await expectError(await request(kit.server, kit.tab, 'POST', kit.trials, { text: 'Fix it', agentIds: ['fake-a', 'fake-b'], machineId: 'mach_01J9Z3K4M5N6P7Q8R9S0T1V2W9' }), 400, 'invalid_request');
    expect(kit.server.core.entities.listSessions(kit.wsId)).toEqual([]);
    await expectError(await request(kit.server, kit.tab, 'GET', apiPath(API_ROUTES.workspaceTrial, { wsId: kit.wsId, tryId: 'try_01J9Z3K4M5N6P7Q8R9S0T1V2W6' })), 404, 'not_found');
  });
});
