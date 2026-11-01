/**
 * Where work runs (epic 27 entry 2; CAP-35). On a real server, through the
 * gate: every route answers 501 until its lane wires it (retention and
 * Restore are wired since 27.6). In-process, with
 * stand-in use-cases: each wired route answers with the shared schema and
 * `no-store`, a hand-off conflict is 409 `handoff_conflict` with the count,
 * a failed Restore is 409 `restore_failed` with its reason, mid-turn is 409
 * `agent_mid_turn`, and a too-large body is refused before the use-case.
 */
import { AgentMidTurnError, HandOffConflictError, newId, NotFoundError, openCore, RestoreFailedError, type ChatLocations, type Core, type Trials, type WorktreeRetention } from '@ogden-agents/core';
import { API_ROUTES, apiPath, ApiErrorBody, chatWorktreeBranch, RESTORE_FAILED_MESSAGE, restoreBranchMovedText, WorkspaceResponse, type RestoreWorktreeResponse, type SessionLocationResponse } from '@ogden-agents/shared';
import type { MiddlewareHandler } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { fullTestApp, signIn, startTestServer, tempDataDir } from './helpers.js';

const cores: Core[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
});

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = ApiErrorBody.parse(await response.json());
  expect(body.error.code).toBe(code);
  return body.error;
}

describe('where work runs routes on the real server', () => {
  it('answers 501 for every lane not wired yet, behind the gate', async () => {
    const server = await startTestServer();
    const { headers } = await signIn(server);
    const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: tempDataDir() }) });
    const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
    const sesId = newId('ses');
    const tryId = newId('try');
    const unwired: Array<[string, string]> = [
      ['GET', apiPath(API_ROUTES.sessionLocation, { wsId, sesId })],
      ['POST', apiPath(API_ROUTES.sessionLocation, { wsId, sesId })],
      ['POST', apiPath(API_ROUTES.workspaceTrials, { wsId })],
      ['GET', apiPath(API_ROUTES.workspaceTrial, { wsId, tryId })],
      ['POST', apiPath(API_ROUTES.workspaceTrialKeep, { wsId, tryId })],
    ];
    for (const [method, path] of unwired) {
      await expectError(await fetch(`${server.url}${path}`, { method, headers }), 501, 'not_implemented');
      // The gate is in front of every one.
      expect((await fetch(`${server.url}${path}`, { method })).status, path).toBe(401);
    }
    // Retention and Restore are wired (27.6), behind the gate too.
    expect((await fetch(`${server.url}${API_ROUTES.worktreeRetention}`, { headers })).status).toBe(200);
    expect((await fetch(`${server.url}${apiPath(API_ROUTES.workspacePutAwayWorktrees, { wsId })}`, { headers })).status).toBe(200);
    for (const path of [API_ROUTES.worktreeRetention, apiPath(API_ROUTES.workspacePutAwayWorktrees, { wsId }), apiPath(API_ROUTES.sessionWorktreeRestore, { wsId, sesId })]) {
      expect((await fetch(`${server.url}${path}`, { method: path.endsWith('restore') ? 'POST' : 'GET' })).status, path).toBe(401);
    }
  });
});

describe('where work runs routes in-process, with stand-in use-cases', () => {
  function app() {
    const core = openCore(tempDataDir());
    cores.push(core);
    const wsId = newId('ws');
    const sesId = newId('ses');
    const tryId = newId('try');
    const calls: string[] = [];
    const worktree: SessionLocationResponse = { location: { kind: 'worktree', branch: chatWorktreeBranch(sesId), port: 41_000, putAway: false } };
    const session = core.entities.createSession({ workspaceId: core.entities.ensureWorkspace(tempDataDir()).id, kind: 'chat' });
    let handOff: () => Promise<{ session: typeof session }> = async () => ({ session });
    let restore: () => Promise<RestoreWorktreeResponse> = async () => ({ ...worktree, restored: 'newer' });
    const chatLocations: ChatLocations = {
      location: async (ws, ses) => {
        calls.push(`location ${String(ws)} ${String(ses)}`);
        return worktree;
      },
      handOff: async (_ws, _ses, body) => {
        calls.push(`handOff ${JSON.stringify(body)}`);
        return handOff();
      },
    };
    const worktreeRetention: WorktreeRetention = {
      setting: async () => ({ keep: 15 }),
      setSetting: async (body) => {
        calls.push(`setSetting ${JSON.stringify(body)}`);
        return { keep: 20 };
      },
      listPutAway: async () => ({ worktrees: [] }),
      putAway: async () => {
        throw new Error('not through a route');
      },
      restore: async () => restore(),
      enforce: async () => [],
    };
    const trial = { id: tryId, workspaceId: wsId, sessionIds: [sesId, newId('ses')], keptSessionId: null, createdAt: '2026-11-01T00:00:00.000Z' };
    const trials: Trials = {
      start: async (_ws, body) => {
        calls.push(`start ${JSON.stringify(body)}`);
        return { trial };
      },
      get: async () => ({ trial }),
      keep: async () => ({ trial: { ...trial, keptSessionId: sesId } }),
    };
    const open: MiddlewareHandler = async (_c, next) => next();
    const hono = fullTestApp(core, { gate: open, chatLocations, worktreeRetention, trials });
    const json = (method: string, path: string, body: unknown) => hono.request(path, { method, headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    return {
      hono,
      json,
      calls,
      wsId,
      sesId,
      tryId,
      setHandOff: (next: typeof handOff) => (handOff = next),
      setRestore: (next: typeof restore) => (restore = next),
    };
  }

  it('answers each wired route with its schema and no-store', async () => {
    const { hono, json, calls, wsId, sesId, tryId } = app();
    const location = await hono.request(apiPath(API_ROUTES.sessionLocation, { wsId, sesId }));
    expect(location.status).toBe(200);
    expect(location.headers.get('cache-control')).toBe('no-store');
    expect(await location.json()).toEqual({ location: { kind: 'worktree', branch: chatWorktreeBranch(sesId), port: 41_000, putAway: false } });
    expect((await json('POST', apiPath(API_ROUTES.sessionLocation, { wsId, sesId }), { to: 'this_folder' })).status).toBe(200);
    expect(await (await hono.request(API_ROUTES.worktreeRetention)).json()).toEqual({ keep: 15 });
    expect(await (await json('PUT', API_ROUTES.worktreeRetention, { keep: 20 })).json()).toEqual({ keep: 20 });
    expect(await (await hono.request(apiPath(API_ROUTES.workspacePutAwayWorktrees, { wsId }))).json()).toEqual({ worktrees: [] });
    expect((await json('POST', apiPath(API_ROUTES.workspaceTrials, { wsId }), { text: 'Fix it', agentIds: ['a', 'b'] })).status).toBe(201);
    expect((await hono.request(apiPath(API_ROUTES.workspaceTrial, { wsId, tryId }))).status).toBe(200);
    expect(await (await json('POST', apiPath(API_ROUTES.workspaceTrialKeep, { wsId, tryId }), { sessionId: sesId })).json()).toMatchObject({ trial: { keptSessionId: sesId } });
    expect(calls).toEqual([
      `location ${wsId} ${sesId}`,
      'handOff {"to":"this_folder"}',
      'setSetting {"keep":20}',
      'start {"text":"Fix it","agentIds":["a","b"]}',
    ]);
  });

  it('maps a hand-off conflict, mid-turn and a failed Restore to their 409s; refuses bad JSON and a large body first', async () => {
    const { json, calls, wsId, sesId, setHandOff, setRestore } = app();
    const handOff = apiPath(API_ROUTES.sessionLocation, { wsId, sesId });
    setHandOff(async () => {
      throw new HandOffConflictError('conflict', 2);
    });
    const conflict = await expectError(await json('POST', handOff, { to: 'this_folder' }), 409, 'handoff_conflict');
    expect(conflict.details).toEqual({ files: 2 });
    setHandOff(async () => {
      throw new AgentMidTurnError('busy');
    });
    await expectError(await json('POST', handOff, { to: 'this_folder' }), 409, 'agent_mid_turn');
    const restore = apiPath(API_ROUTES.sessionWorktreeRestore, { wsId, sesId });
    // Where the copy went comes back with the chat's place.
    expect(await (await json('POST', restore, {})).json()).toEqual({ location: { kind: 'worktree', branch: chatWorktreeBranch(sesId), port: 41_000, putAway: false }, restored: 'newer' });
    setRestore(async () => {
      throw new RestoreFailedError('gone', 'branch_missing');
    });
    expect((await expectError(await json('POST', restore, {}), 409, 'restore_failed')).details).toEqual({ reason: 'branch_missing' });
    // The branch's own sentence when core names the chat's branch (never a path), the fixed one otherwise.
    const branch = chatWorktreeBranch(sesId);
    setRestore(async () => {
      throw new RestoreFailedError('moved', 'branch_moved', branch);
    });
    const moved = await expectError(await json('POST', restore, {}), 409, 'restore_failed');
    expect(moved).toMatchObject({ message: restoreBranchMovedText(branch), details: { reason: 'branch_moved' } });
    setRestore(async () => {
      throw new RestoreFailedError('moved', 'branch_moved', '/tmp/a path');
    });
    expect((await expectError(await json('POST', restore, {}), 409, 'restore_failed')).message).toBe(RESTORE_FAILED_MESSAGE);
    setRestore(async () => {
      throw new AgentMidTurnError('busy');
    });
    await expectError(await json('POST', restore, {}), 409, 'agent_mid_turn');
    setRestore(async () => {
      throw new NotFoundError('session', sesId);
    });
    const missing = await expectError(await json('POST', restore, {}), 404, 'not_found');
    expect(missing.message).toBe(new NotFoundError('session', sesId).message);
    const before = calls.length;
    await expectError(await json('POST', handOff, '{not json'), 400, 'invalid_request');
    await expectError(await json('POST', apiPath(API_ROUTES.workspaceTrials, { wsId }), { text: 'x'.repeat(200 * 1024), agentIds: ['a', 'b'] }), 413, 'invalid_request');
    expect(calls.length).toBe(before);
  });
});
