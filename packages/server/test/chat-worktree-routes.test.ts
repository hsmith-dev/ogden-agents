/**
 * `POST …/sessions` with `location` (epic 27, 27.1), on the real server with
 * real git: Worktree makes `<data>/cw/<8>` on `ogden/chat/<ses>`; a plain
 * folder is 409 `invalid_operation`; a remote machine with Worktree is 400
 * `validation_failed`; This folder is a chat as before.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { newId } from '@ogden-agents/core';
import { API_ROUTES, apiPath, ApiErrorBody, chatWorktreeBranch, SessionResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir } from './helpers.js';

/** Plain git for the test's own setup: no hook, a local identity. */
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', `core.hooksPath=${join(cwd, '.none')}`, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function gitRepo(): string {
  const repo = tempDataDir();
  git(repo, 'init', '-q', '--initial-branch=main');
  writeFileSync(join(repo, 'README.md'), '# Repo\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--no-verify', '-m', 'first');
  return repo;
}

async function setUp() {
  const server = await startTestServer();
  const { headers } = await signIn(server);
  const json = { ...headers, 'content-type': 'application/json' };
  const workspace = async (path: string) =>
    WorkspaceResponse.parse(await (await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: json, body: JSON.stringify({ path }) })).json()).workspace.id;
  const create = (wsId: string, body: unknown) => fetch(`${server.url}${apiPath(API_ROUTES.workspaceSessions, { wsId })}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  return { server, workspace, create };
}

describe('a chat started in its own worktree (27.1)', () => {
  it('makes the worktree in <data>/cw on ogden/chat/<ses> from HEAD', async () => {
    const { server, workspace, create } = await setUp();
    const repo = gitRepo();
    const wsId = await workspace(repo);
    const response = await create(wsId, { kind: 'chat', location: 'worktree' });
    expect(response.status).toBe(201);
    const { session } = SessionResponse.parse(await response.json());
    expect(session.branch).toBe(chatWorktreeBranch(session.id));
    const path = session.worktreePath!;
    expect(basename(path)).toMatch(/^[a-z2-7]{8}$/);
    expect(dirname(path)).toBe(realpathSync.native(join(server.dataDir, 'cw')));
    expect(existsSync(join(path, 'README.md'))).toBe(true);
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(chatWorktreeBranch(session.id));
    expect(git(path, 'rev-parse', 'HEAD').trim()).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    // The project's own checkout is untouched.
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
  });

  it('This folder (and no location) is a chat as before', async () => {
    const { workspace, create } = await setUp();
    const wsId = await workspace(gitRepo());
    for (const body of [{ kind: 'chat', location: 'this_folder' }, { kind: 'chat' }]) {
      const response = await create(wsId, body);
      expect(response.status).toBe(201);
      expect(SessionResponse.parse(await response.json()).session).toMatchObject({ worktreePath: null, branch: null });
    }
  });

  it('refuses a plain folder with 409 invalid_operation, making no chat and no folder', async () => {
    const { server, workspace, create } = await setUp();
    const wsId = await workspace(tempDataDir());
    const response = await create(wsId, { kind: 'chat', location: 'worktree' });
    expect(response.status).toBe(409);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('invalid_operation');
    expect(server.core.entities.listSessions(wsId as never)).toEqual([]);
    expect(existsSync(join(server.dataDir, 'cw'))).toBe(false);
  });

  it('refuses a remote machine with Worktree with 400 validation_failed', async () => {
    const { server, workspace, create } = await setUp();
    const wsId = await workspace(gitRepo());
    const response = await create(wsId, { kind: 'chat', location: 'worktree', machineId: newId('mach') });
    expect(response.status).toBe(400);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('validation_failed');
    expect(server.core.entities.listSessions(wsId as never)).toEqual([]);
  });
});
