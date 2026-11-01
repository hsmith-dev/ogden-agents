/**
 * Worktree retention and Restore on the real server with real git and the
 * fake ACP agent (epic 27, 27.6): with the cap at 1 a second worktree chat
 * puts the first (idle) one away, its change saved and its folder gone, its
 * branch kept; a message to it is 409 `worktree_put_away`; the project's
 * list names it; Restore brings the copy back with its file, unstaged;
 * Restore of a chat whose branch is gone is 409 `restore_failed`
 * `branch_missing` with the record kept; the setting is 400 outside 1 to
 * 100. The main checkout never changes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, ApiErrorBody, apiPath, PutAwayWorktreesResponse, SessionLocationResponse, SessionResponse, WorkspaceResponse, WorktreeRetentionSetting, type Session, type SessionId } from '@ogden-agents/shared';
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

function project() {
  const repo = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-ret-repo-'))));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  return repo;
}

const mainCheckout = (repo: string) => ({ head: git(repo, 'rev-parse', 'HEAD'), index: readFileSync(join(repo, '.git', 'index')).toString('base64'), status: git(repo, 'status', '--porcelain') });
const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content).toString('base64')}`;
const agentReplies = (server: TestServer, sessionId: SessionId): string[] =>
  server.core.events.readAfter(0).flatMap((event) => (event.type === 'session.message_completed' && event.streamId === sessionId && event.payload.role === 'agent' ? [event.payload.content] : []));

async function open() {
  const repo = project();
  const server = await startTestServer({ dataDir: tempDataDir() });
  const tab = await signIn(server);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
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
  };
  const putAway = async () => PutAwayWorktreesResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspacePutAwayWorktrees, { wsId }))).json()).worktrees;
  const restore = (sesId: string) => request(server, tab, 'POST', apiPath(API_ROUTES.sessionWorktreeRestore, { wsId, sesId }));
  return { server, tab, wsId, repo, worktreeChat, send, putAway, restore };
}

describe('worktree retention on the real server (27.6)', () => {
  it('with the cap at 1, a second worktree chat puts the first away; Restore brings its file back on its branch', async () => {
    const kit = await open();
    expect((await request(kit.server, kit.tab, 'PUT', API_ROUTES.worktreeRetention, { keep: 1 })).status).toBe(200);
    const first = await kit.worktreeChat();
    await kit.send(first.id, writeFile('notes.txt', 'from the first chat\n'));
    const before = mainCheckout(kit.repo);

    const second = await kit.worktreeChat();
    await waitFor(() => kit.server.core.worktreePutAway.get(first.id) !== undefined, 'the first copy put away', 20_000);
    await waitFor(() => !existsSync(first.worktreePath!), 'its folder removed', 20_000);
    expect(existsSync(second.worktreePath!)).toBe(true);
    expect(git(kit.repo, 'branch', '--list', first.branch!).trim()).not.toBe('');
    expect(await kit.putAway()).toEqual([expect.objectContaining({ sessionId: first.id, branch: first.branch, files: 1, cause: 'retention' })]);

    // A put-away chat takes no message.
    const refused = await request(kit.server, kit.tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId: kit.wsId, sesId: first.id }), { text: 'hello' });
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error.code).toBe('worktree_put_away');

    // Restore puts the cap over again: the other one (idle) is put away, sparing the one restored.
    const restored = await kit.restore(first.id);
    expect(restored.status).toBe(200);
    expect(SessionLocationResponse.parse(await restored.json())).toEqual({ location: { kind: 'worktree', branch: first.branch, port: null, putAway: false } });
    expect(readFileSync(join(first.worktreePath!, 'notes.txt'), 'utf8')).toBe('from the first chat\n');
    expect(git(first.worktreePath!, 'status', '--porcelain')).toBe('?? notes.txt\n');
    await waitFor(() => kit.server.core.worktreePutAway.get(second.id) !== undefined, 'the second copy put away', 20_000);
    expect(kit.server.core.worktreePutAway.get(first.id)).toBeUndefined();
    expect(mainCheckout(kit.repo)).toEqual(before);
    // Its next turn runs in the copy again.
    await kit.send(first.id, writeFile('more.txt', 'again\n'));
    expect(existsSync(join(first.worktreePath!, 'more.txt'))).toBe(true);
  });

  it('refuses Restore when the branch is gone (409 restore_failed, the record kept), and a setting outside 1 to 100', async () => {
    const kit = await open();
    expect(WorktreeRetentionSetting.parse(await (await request(kit.server, kit.tab, 'GET', API_ROUTES.worktreeRetention)).json())).toEqual({ keep: 15 });
    for (const keep of [0, 101]) expect((await request(kit.server, kit.tab, 'PUT', API_ROUTES.worktreeRetention, { keep })).status).toBe(400);
    const first = await kit.worktreeChat();
    await kit.worktreeChat();
    expect((await request(kit.server, kit.tab, 'PUT', API_ROUTES.worktreeRetention, { keep: 1 })).status).toBe(200);
    await waitFor(() => kit.server.core.worktreePutAway.get(first.id) !== undefined, 'the first copy put away', 20_000);
    await waitFor(() => !existsSync(first.worktreePath!), 'its folder removed', 20_000);
    git(kit.repo, 'branch', '-D', first.branch!);

    const failed = await kit.restore(first.id);
    expect(failed.status).toBe(409);
    const body = ApiErrorBody.parse(await failed.json()).error;
    expect(body).toMatchObject({ code: 'restore_failed', details: { reason: 'branch_missing' } });
    expect(body.message).toContain(first.branch!);
    expect(kit.server.core.worktreePutAway.get(first.id)).toBeDefined();
    expect(existsSync(first.worktreePath!)).toBe(false);
  });
});
