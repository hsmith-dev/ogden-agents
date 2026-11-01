/**
 * Worktree chats on the real server with real git and the fake ACP agent
 * (epic 27, 27.3): a worktree chat survives a restart on the same data
 * folder (its path, branch, folder and git record) and its next turn runs
 * there; 8.4's Commit these changes on it makes one commit on its own
 * branch only; `DELETE …/sessions/:sesId` deletes it and its copy (the
 * branch kept when it has commits), refusing uncommitted changes without
 * `discardUncommitted`, mid-turn and other kinds; Delete history removes
 * every chat's copy the same way. Nothing outside `<data>/cw` changes.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  ChatDeletedResponse,
  chatWorktreeBranch,
  CommitWorktreeResponse,
  HistoryDeletedResponse,
  SessionResponse,
  WorkspaceResponse,
  type Session,
  type SessionId,
} from '@ogden-agents/shared';
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
  const repo = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-cwdel-repo-'))));
  const markers = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-cwdel-markers-')));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'pre-push']) {
    writeFileSync(join(repo, '.git', 'hooks', name), `#!/bin/sh\ntouch "${join(markers, name)}"\n`);
    chmodSync(join(repo, '.git', 'hooks', name), 0o755);
  }
  return { repo, markers };
}

/** What the main checkout is: its commit, its index and its status. */
const mainCheckout = (repo: string) => ({ head: git(repo, 'rev-parse', 'HEAD'), index: readFileSync(join(repo, '.git', 'index')).toString('base64'), status: git(repo, 'status', '--porcelain') });
const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content).toString('base64')}`;
const agentReplies = (server: TestServer, sessionId: SessionId): string[] =>
  server.core.events.readAfter(0).flatMap((event) => (event.type === 'session.message_completed' && event.streamId === sessionId && event.payload.role === 'agent' ? [event.payload.content] : []));
const branchExists = (repo: string, branch: string) => git(repo, 'branch', '--list', branch).trim() !== '';

async function open(dataDir = tempDataDir(), repo = project()) {
  const server = await startTestServer({ dataDir });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.repo })).json()).workspace.id;
  const sessionPath = (sesId: string) => apiPath(API_ROUTES.workspaceSession, { wsId, sesId });
  const worktreeChat = async (): Promise<Session> => {
    const created = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), { location: 'worktree' });
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
  const remove = (sesId: string, body?: unknown) => request(server, tab, 'DELETE', sessionPath(sesId), body);
  return { server, tab, wsId, dataDir, ...repo, sessionPath, worktreeChat, send, remove };
}

describe('a worktree chat on the real server (27.3)', () => {
  it('keeps its path, branch, folder and git record across a restart, and its next turn runs there', async () => {
    const first = await open();
    const session = await first.worktreeChat();
    const path = session.worktreePath!;
    await first.server.close();

    const second = await open(first.dataDir, { repo: first.repo, markers: first.markers });
    const read = SessionResponse.parse(await (await request(second.server, second.tab, 'GET', second.sessionPath(session.id))).json()).session;
    expect(read).toMatchObject({ id: session.id, worktreePath: path, branch: chatWorktreeBranch(session.id) });
    expect(existsSync(join(path, 'README.md'))).toBe(true);
    expect(git(first.repo, 'worktree', 'list', '--porcelain')).toContain(path);
    expect(existsSync(join(first.repo, '.git', 'worktrees', basename(path)))).toBe(true);
    const started = JSON.parse(await second.send(session.id, 'session-start')) as { cwd: string };
    expect(realpathSync.native(started.cwd)).toBe(path);
  });

  it("commits the agent's change on ogden/chat/<ses> only: the main checkout's HEAD, index and files unchanged, no hook ran", async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    const branch = session.branch!;
    const before = mainCheckout(kit.repo);
    const tip = git(kit.repo, 'rev-parse', branch).trim();
    await kit.send(session.id, writeFile('chat.txt', 'from the chat\n'));
    expect(existsSync(join(session.worktreePath!, 'chat.txt'))).toBe(true);
    expect(existsSync(join(kit.repo, 'chat.txt'))).toBe(false);

    const committed = await request(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.sessionWorktreeCommit, { wsId: kit.wsId, sesId: session.id }), { message: 'Save the chat' });
    expect(committed.status).toBe(200);
    const body = CommitWorktreeResponse.parse(await committed.json());
    expect(body).toEqual({ revision: git(kit.repo, 'rev-parse', branch).trim(), files: 1 });
    expect(git(kit.repo, 'rev-list', '--count', `${tip}..${branch}`).trim()).toBe('1');
    expect(git(kit.repo, 'rev-parse', 'main').trim()).toBe(tip);
    expect(mainCheckout(kit.repo)).toEqual(before);
    expect(readdirSync(kit.markers)).toEqual([]);
  });
});

describe('DELETE …/sessions/:sesId (27.3)', () => {
  it("deletes a clean worktree chat with its folder, git's record and branch; nothing outside <data>/cw changes", async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    const path = session.worktreePath!;
    const before = mainCheckout(kit.repo);
    const response = await kit.remove(session.id);
    expect(response.status).toBe(200);
    expect(ChatDeletedResponse.parse(await response.json())).toEqual({ sessionId: session.id, worktreeRemoved: true, branchKept: false });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(kit.repo, '.git', 'worktrees', basename(path)))).toBe(false);
    expect(branchExists(kit.repo, session.branch!)).toBe(false);
    expect(kit.server.core.entities.getSession(session.id)).toBeUndefined();
    expect(kit.server.core.events.readAfter(0).filter((event) => event.streamId === session.id)).toEqual([]);
    expect(kit.server.core.events.readAfter(0).at(-1)).toMatchObject({ type: 'workspace.chat_deleted', payload: { sessionId: session.id, worktreeRemoved: true, branchKept: false } });
    expect(mainCheckout(kit.repo)).toEqual(before);
    expect(readdirSync(join(kit.dataDir, 'cw'))).toEqual([]);
    // Gone: a second delete is 404.
    expect((await kit.remove(session.id)).status).toBe(404);
  });

  it('keeps a branch with an unmerged commit (branchKept)', async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    writeFileSync(join(session.worktreePath!, 'work.txt'), 'done\n');
    git(session.worktreePath!, 'add', '-A');
    git(session.worktreePath!, 'commit', '-q', '--no-verify', '-m', 'work');
    const response = await kit.remove(session.id);
    expect(ChatDeletedResponse.parse(await response.json())).toEqual({ sessionId: session.id, worktreeRemoved: true, branchKept: true });
    expect(existsSync(session.worktreePath!)).toBe(false);
    expect(branchExists(kit.repo, session.branch!)).toBe(true);
  });

  it('refuses uncommitted changes with 409 uncommitted_changes until discardUncommitted', async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    writeFileSync(join(session.worktreePath!, 'draft.txt'), 'unsaved\n');
    const refused = await kit.remove(session.id);
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('uncommitted_changes');
    expect(existsSync(join(session.worktreePath!, 'draft.txt'))).toBe(true);
    expect((await kit.remove(session.id, { discardUncommitted: false })).status).toBe(409);
    expect((await kit.remove(session.id, { discardUncommitted: 'yes' })).status).toBe(400);
    const confirmed = await kit.remove(session.id, { discardUncommitted: true });
    expect(confirmed.status).toBe(200);
    expect(existsSync(session.worktreePath!)).toBe(false);
  });

  it('refuses a staged-only change too (409 uncommitted_changes) without discardUncommitted', async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    writeFileSync(join(session.worktreePath!, 'README.md'), '# Changed\n');
    git(session.worktreePath!, 'add', 'README.md');
    git(session.worktreePath!, 'checkout', '--', '.');
    expect(git(session.worktreePath!, 'status', '--porcelain').trim()).toBe('M  README.md');
    const refused = await kit.remove(session.id);
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('uncommitted_changes');
    expect(existsSync(session.worktreePath!)).toBe(true);
  });

  it('answers an oversized body with a plain too-large message', async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    const response = await kit.remove(session.id, { discardUncommitted: false, padding: 'x'.repeat(20_000) });
    expect(response.status).toBe(413);
    expect(ApiErrorBody.parse(await response.json()).error.message).toBe('That request is too large.');
  });

  it('refuses mid-turn (409 agent_mid_turn) and a planning session (409 invalid_operation)', async () => {
    const kit = await open();
    const session = await kit.worktreeChat();
    kit.server.core.entities.setSessionState(session.id, 'working');
    const busy = await kit.remove(session.id, { discardUncommitted: true });
    expect(busy.status).toBe(409);
    expect(ApiErrorBody.parse(await busy.json()).error.code).toBe('agent_mid_turn');
    expect(existsSync(session.worktreePath!)).toBe(true);
    const planning = kit.server.core.entities.createSession({ workspaceId: kit.wsId as never, kind: 'planning' });
    const refused = await kit.remove(planning.id);
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('invalid_operation');
  });

  it('deletes a plain chat', async () => {
    const kit = await open();
    const created = SessionResponse.parse(await (await request(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: kit.wsId }), {})).json()).session;
    const response = await kit.remove(created.id);
    expect(ChatDeletedResponse.parse(await response.json())).toEqual({ sessionId: created.id, worktreeRemoved: false, branchKept: false });
  });
});

describe('DELETE …/history removes its chats’ copies (27.3)', () => {
  it('refuses a dirty copy with 409 uncommitted_changes, then with discardUncommitted removes every copy', async () => {
    const kit = await open();
    const clean = await kit.worktreeChat();
    const dirty = await kit.worktreeChat();
    writeFileSync(join(dirty.worktreePath!, 'draft.txt'), 'unsaved\n');
    const history = apiPath(API_ROUTES.workspaceHistory, { wsId: kit.wsId });
    const refused = await request(kit.server, kit.tab, 'DELETE', history);
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('uncommitted_changes');
    expect(kit.server.core.entities.listSessions(kit.wsId as never)).toHaveLength(2);
    const deleted = await request(kit.server, kit.tab, 'DELETE', history, { discardUncommitted: true });
    expect(deleted.status).toBe(200);
    expect(HistoryDeletedResponse.parse(await deleted.json()).deletedSessions).toBe(2);
    expect(existsSync(clean.worktreePath!) || existsSync(dirty.worktreePath!)).toBe(false);
    expect(branchExists(kit.repo, clean.branch!) || branchExists(kit.repo, dirty.branch!)).toBe(false);
    expect(existsSync(join(kit.repo, '.git', 'worktrees'))).toBe(false);
  });
});
