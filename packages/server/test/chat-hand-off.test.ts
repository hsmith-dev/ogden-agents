/**
 * Hand off on the real server with real git and the fake ACP agent (epic
 * 27, 27.4): `POST …/sessions/:sesId/location` moves an idle chat and the
 * agent's uncommitted edit to its own worktree and back, the edit intact
 * both ways, each recorded as `session.location_changed`, and the agent's
 * next turn runs in the new folder; `GET` answers the place. Refused
 * mid-turn (409 `agent_mid_turn`), on an overlap (409 `handoff_conflict`
 * with `details.files`), for the same place (409 `invalid_operation`) and a
 * malformed body (400), nothing moved. No hook runs.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, chatWorktreeBranch, HandOffResponse, SessionLocationResponse, SessionResponse, WorkspaceResponse, type SessionId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A repo on `main` with one commit whose own hooks leave a file in `markers`. */
function project() {
  const repo = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-handoff-repo-'))));
  const markers = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-handoff-markers-')));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  for (const name of ['pre-commit', 'post-checkout', 'post-index-change', 'reference-transaction']) {
    writeFileSync(join(repo, '.git', 'hooks', name), `#!/bin/sh\ntouch "${join(markers, name)}"\n`);
    chmodSync(join(repo, '.git', 'hooks', name), 0o755);
  }
  return { repo, markers };
}

const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content).toString('base64')}`;
const agentReplies = (server: TestServer, sessionId: SessionId): string[] =>
  server.core.events.readAfter(0).flatMap((event) => (event.type === 'session.message_completed' && event.streamId === sessionId && event.payload.role === 'agent' ? [event.payload.content] : []));

async function open() {
  const server = await startTestServer({ dataDir: tempDataDir() });
  const tab = await signIn(server);
  const repo = project();
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.repo })).json()).workspace.id;
  const chat = async (body: unknown = {}) => {
    const created = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), body);
    expect(created.status).toBe(201);
    return SessionResponse.parse(await created.json()).session;
  };
  const send = async (sesId: SessionId, text: string) => {
    const before = agentReplies(server, sesId).length;
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text })).status).toBe(202);
    await waitFor(() => agentReplies(server, sesId).length > before, 'the reply', 20_000);
    await waitFor(() => server.core.entities.getSession(sesId)?.state === 'idle', 'idle', 20_000);
    return agentReplies(server, sesId).at(-1)!;
  };
  const cwdOf = async (sesId: SessionId) => realpathSync.native((JSON.parse(await send(sesId, 'session-start')) as { cwd: string }).cwd);
  const location = (sesId: string) => apiPath(API_ROUTES.sessionLocation, { wsId, sesId });
  const move = (sesId: string, body: unknown) => request(server, tab, 'POST', location(sesId), body);
  const moved = (sesId: SessionId) => server.core.events.readAfter(0).filter((event) => event.type === 'session.location_changed' && event.streamId === sesId);
  return { server, tab, wsId, ...repo, chat, send, cwdOf, location, move, moved };
}

describe('Hand off on the real server (27.4)', () => {
  it("moves a chat and its agent's edit to its own worktree and back, the edit intact both times, the next turn in the new folder", async () => {
    const kit = await open();
    const session = await kit.chat();
    await kit.send(session.id, writeFile('notes.md', 'from the agent\n'));
    expect(readFileSync(join(kit.repo, 'notes.md'), 'utf8')).toBe('from the agent\n');
    expect(await kit.cwdOf(session.id)).toBe(kit.repo);

    const there = await kit.move(session.id, { to: 'worktree' });
    expect(there.status).toBe(200);
    const moved = HandOffResponse.parse(await there.json()).session;
    const branch = chatWorktreeBranch(session.id);
    expect(moved).toMatchObject({ id: session.id, branch });
    const copy = moved.worktreePath!;
    expect(readFileSync(join(copy, 'notes.md'), 'utf8')).toBe('from the agent\n');
    expect(existsSync(join(kit.repo, 'notes.md'))).toBe(false);
    expect(git(kit.repo, 'status', '--porcelain')).toBe('');
    expect(SessionLocationResponse.parse(await (await request(kit.server, kit.tab, 'GET', kit.location(session.id))).json())).toEqual({ location: { kind: 'worktree', branch, port: null, putAway: false } });
    expect(await kit.cwdOf(session.id)).toBe(copy);

    const back = await kit.move(session.id, { to: 'this_folder' });
    expect(back.status).toBe(200);
    expect(HandOffResponse.parse(await back.json()).session).toMatchObject({ worktreePath: null, branch: null });
    expect(readFileSync(join(kit.repo, 'notes.md'), 'utf8')).toBe('from the agent\n');
    // The clean copy went, and its branch with no commits of its own.
    expect(existsSync(copy)).toBe(false);
    expect(git(kit.repo, 'branch', '--list', branch).trim()).toBe('');
    expect(await kit.cwdOf(session.id)).toBe(kit.repo);

    expect(kit.moved(session.id).map((event) => event.payload)).toEqual([
      { sessionId: session.id, location: 'worktree', previous: 'this_folder', branch, files: 1, resumes: true },
      { sessionId: session.id, location: 'this_folder', previous: 'worktree', branch: null, files: 1, resumes: true },
    ]);
    expect(readdirSync(kit.markers)).toEqual([]);
  });

  it('refuses mid-turn (409 agent_mid_turn), nothing moved', async () => {
    const kit = await open();
    const session = await kit.chat();
    const other = await kit.chat();
    writeFileSync(join(kit.repo, 'draft.txt'), 'mine\n');
    kit.server.core.entities.setSessionState(other.id, 'working');
    const refused = await kit.move(session.id, { to: 'worktree' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('agent_mid_turn');
    expect(readFileSync(join(kit.repo, 'draft.txt'), 'utf8')).toBe('mine\n');
    expect(kit.server.core.entities.getSession(session.id)?.worktreePath).toBeNull();
  });

  it('refuses an overlap (409 handoff_conflict, details.files), the same place (409 invalid_operation) and a bad body (400)', async () => {
    const kit = await open();
    const session = await kit.chat({ location: 'worktree' });
    writeFileSync(join(session.worktreePath!, 'README.md'), '# Copy\n');
    writeFileSync(join(kit.repo, 'README.md'), '# Project\n');
    const conflict = await kit.move(session.id, { to: 'this_folder' });
    expect(conflict.status).toBe(409);
    const body = ApiErrorBody.parse(await conflict.json());
    expect(body.error).toMatchObject({ code: 'handoff_conflict', details: { files: 1 } });
    expect(readFileSync(join(session.worktreePath!, 'README.md'), 'utf8')).toBe('# Copy\n');
    expect(readFileSync(join(kit.repo, 'README.md'), 'utf8')).toBe('# Project\n');

    const same = await kit.move(session.id, { to: 'worktree' });
    expect(same.status).toBe(409);
    expect(ApiErrorBody.parse(await same.json()).error.code).toBe('invalid_operation');
    const bad = await kit.move(session.id, { to: 'elsewhere' });
    expect(bad.status).toBe(400);
    expect(kit.moved(session.id)).toEqual([]);
  });
});
