/**
 * The Workbench's Changes end to end (story 8.4): a real server on the
 * user's git and the fake ACP agent. Each chat turn in a git project is
 * snapshotted before and after, so This turn shows only that turn's file
 * and the turns list has both; a project that is no repo runs its turns
 * and records none; a fixture worktree chat's Commit these changes makes
 * one commit on its own branch with no hook run, nothing pushed and the
 * main checkout unchanged; nothing to commit is 409. No path or diff is in
 * an event or a log line.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  ChangesResponse,
  chatWorktreeBranch,
  CommitWorktreeResponse,
  FileDiffResponse,
  GIT_POINTER_UNUSUAL_MESSAGE,
  SessionResponse,
  TurnsResponse,
  WorkspaceResponse,
  type CoreEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A repo on `main` with one commit (or a plain folder), its own hooks leaving a file in `markers`. */
function project({ repo: isRepo = true } = {}) {
  const repo = removeAfterTest(realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-changes-repo-'))));
  const markers = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-changes-markers-')));
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  if (!isRepo) return { repo, markers };
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

async function setUp(options: { repo?: boolean } = {}) {
  const lines: string[] = [];
  const server = await startTestServer({ lines });
  const tab = await signIn(server);
  const { repo, markers } = project(options);
  const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo })).json()).workspace.id;
  return { server, tab, wsId, repo, markers, lines };
}

const eventsOf = (server: TestServer, sessionId: SessionId): CoreEvent[] => server.core.events.readAfter(0).filter((event) => event.streamId === sessionId);
const recorded = (server: TestServer, sessionId: SessionId) => eventsOf(server, sessionId).filter((event) => event.type === 'session.turn_changes_recorded');
const writeFile = (path: string, content: string) => `write-file ${path} ${Buffer.from(content).toString('base64')}`;

describe('workbench changes on git (story 8.4)', () => {
  it("shows only each turn's own file in This turn, and both turns in the list", async () => {
    const { server, tab, wsId, lines } = await setUp();
    const sesId = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), {})).json()).session.id;
    const send = (text: string) => request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text });
    expect((await send(writeFile('a.txt', 'first secret line\n'))).status).toBe(202);
    await waitFor(() => recorded(server, sesId).length === 1, 'the first turn', 20_000);
    expect((await send(writeFile('b.txt', 'second\n'))).status).toBe(202);
    await waitFor(() => recorded(server, sesId).length === 2, 'the second turn', 20_000);
    expect(recorded(server, sesId).map((event) => event.payload)).toEqual([
      expect.objectContaining({ files: 1, additions: 1, deletions: 0 }),
      expect.objectContaining({ files: 1, additions: 1, deletions: 0 }),
    ]);
    const changes = (query: Record<string, string>) => request(server, tab, 'GET', `${apiPath(API_ROUTES.workspaceChanges, { wsId })}?${new URLSearchParams(query)}`);
    const latest = ChangesResponse.parse(await (await changes({ view: 'turn', session: sesId })).json());
    expect(latest.files.map((file) => file.path)).toEqual(['b.txt']);
    const turns = TurnsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.sessionTurns, { wsId, sesId }))).json()).turns;
    expect(turns).toHaveLength(2);
    expect(latest.turn).toBe(turns[0]!.id);
    const first = ChangesResponse.parse(await (await changes({ view: 'turn', session: sesId, turn: turns[1]!.id })).json());
    expect(first.files.map((file) => file.path)).toEqual(['a.txt']);
    const diff = FileDiffResponse.parse(await (await request(server, tab, 'GET', `${apiPath(API_ROUTES.workspaceChangesFile, { wsId })}?${new URLSearchParams({ view: 'turn', session: sesId, turn: turns[1]!.id, path: 'a.txt' })}`)).json());
    expect(diff.hunks[0]?.lines).toEqual([{ kind: 'add', text: 'first secret line', newLine: 1 }]);
    // Unstaged shows both (untracked as Added); nothing is staged.
    expect(ChangesResponse.parse(await (await changes({ view: 'unstaged' })).json()).files.map((file) => [file.path, file.change])).toEqual([
      ['a.txt', 'added'],
      ['b.txt', 'added'],
    ]);
    expect(ChangesResponse.parse(await (await changes({ view: 'staged' })).json()).files).toEqual([]);
    // No diff or file content in the log, nor in the turns' events.
    expect(lines.join('\n')).not.toContain('first secret line');
    expect(JSON.stringify(recorded(server, sesId))).not.toContain('a.txt');
    // Hunk actions are 8.5's.
    const hunk = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceChangesHunks, { wsId }), { action: 'stage', view: 'unstaged', path: 'a.txt' });
    expect(hunk.status).toBe(501);
  });

  it('runs turns in a project that is no repository, recording none; its views are empty', async () => {
    const { server, tab, wsId } = await setUp({ repo: false });
    const sesId = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId }), {})).json()).session.id;
    expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId, sesId }), { text: writeFile('a.txt', 'x\n') })).status).toBe(202);
    await waitFor(() => eventsOf(server, sesId).some((event) => event.type === 'session.message_completed' && event.payload.role === 'agent'), 'the turn', 20_000);
    await waitFor(() => server.core.entities.getSession(sesId)?.state === 'idle', 'idle', 20_000);
    expect(recorded(server, sesId)).toEqual([]);
    const unstaged = await request(server, tab, 'GET', `${apiPath(API_ROUTES.workspaceChanges, { wsId })}?view=unstaged`);
    expect(ChangesResponse.parse(await unstaged.json()).files).toEqual([]);
  });

  it("refuses a project whose .git file points at an unrelated repo with the plain sentence, as 409", async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const tab = await signIn(server);
    const { repo: other } = project();
    const { repo: folder } = project({ repo: false });
    writeFileSync(join(folder, '.git'), `gitdir: ${join(other, '.git')}\n`);
    const wsId = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: folder })).json()).workspace.id;
    const refused = await request(server, tab, 'GET', `${apiPath(API_ROUTES.workspaceChanges, { wsId })}?view=unstaged`);
    expect(refused.status).toBe(409);
    expect(ApiErrorBody.parse(await refused.json()).error).toEqual({ code: 'invalid_operation', message: GIT_POINTER_UNUSUAL_MESSAGE });
    // The other repo's path is in no log line.
    expect(lines.join('\n')).not.toContain(other);
  });

  it("commits a fixture worktree chat's changes on its branch: one commit, no hook, nothing pushed, the main checkout unchanged", async () => {
    const { server, tab, wsId, repo, markers } = await setUp();
    const id = newId('ses');
    const branch = chatWorktreeBranch(id);
    const worktree = join(server.dataDir, 'chat-worktrees', 'chat-1');
    mkdirSync(join(server.dataDir, 'chat-worktrees'));
    git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
    server.core.entities.createSession({ workspaceId: wsId, kind: 'chat', id, worktreePath: worktree, branch });
    const commit = (message: string) => request(server, tab, 'POST', apiPath(API_ROUTES.sessionWorktreeCommit, { wsId, sesId: id }), { message });
    const nothing = await commit('Nothing yet');
    expect(nothing.status).toBe(409);
    expect(ApiErrorBody.parse(await nothing.json()).error.code).toBe('invalid_operation');
    writeFileSync(join(worktree, 'chat.txt'), 'from the chat\n');
    const mainBefore = { head: git(repo, 'rev-parse', 'HEAD'), index: readFileSync(join(repo, '.git', 'index')).toString('base64'), status: git(repo, 'status', '--porcelain') };
    const tip = git(repo, 'rev-parse', branch).trim();
    const unstaged = ChangesResponse.parse(await (await request(server, tab, 'GET', `${apiPath(API_ROUTES.workspaceChanges, { wsId })}?view=unstaged&session=${id}`)).json());
    expect(unstaged.files.map((file) => file.path)).toEqual(['chat.txt']);
    const committed = await commit('Save the chat');
    expect(committed.status).toBe(200);
    const body = CommitWorktreeResponse.parse(await committed.json());
    expect(body).toEqual({ revision: git(repo, 'rev-parse', branch).trim(), files: 1 });
    expect(git(repo, 'rev-list', '--count', `${tip}..${branch}`).trim()).toBe('1');
    expect(readdirSync(markers)).toEqual([]);
    expect(git(repo, 'remote').trim()).toBe('');
    expect({ head: git(repo, 'rev-parse', 'HEAD'), index: readFileSync(join(repo, '.git', 'index')).toString('base64'), status: git(repo, 'status', '--porcelain') }).toEqual(mainBefore);
    expect(eventsOf(server, id).find((event) => event.type === 'session.worktree_committed')?.payload).toEqual({ sessionId: id, branch, revision: body.revision, files: 1 });
    // A tampered worktree runs nothing: 500, nothing committed.
    writeFileSync(join(worktree, 'more.txt'), 'm\n');
    writeFileSync(join(repo, '.git', 'worktrees', 'chat-1', 'HEAD'), 'ref: refs/heads/main\n');
    const tampered = await commit('Again');
    expect(tampered.status).toBe(500);
    expect(git(repo, 'rev-parse', branch).trim()).toBe(body.revision);
  });
});
